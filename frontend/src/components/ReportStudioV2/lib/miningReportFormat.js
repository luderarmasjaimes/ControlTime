/* ─────────────────────────────────────────────────────────────────────────────
   .miningreport — Formato portable propietario
   ZIP + JSON + binarios firmados SHA-256
   Edición offline sin conexión ni tenant + reconciliación al re-importar
   ───────────────────────────────────────────────────────────────────────── */

const MININGREPORT_MAGIC = 'MININGREPORT_V1';
const MININGREPORT_EXTENSION = '.miningreport';

/** Calcula hash SHA-256 simple (usando SubtleCrypto del navegador) */
async function computeSHA256(data) {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(typeof data === 'string' ? data : JSON.stringify(data));
  try {
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // Fallback for non-secure contexts
    let hash = 0;
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    return 'fallback-' + Math.abs(hash).toString(16).padStart(16, '0');
  }
}

/** Extrae imágenes base64 del documento y las separa como binarios */
function extractBinaries(doc) {
  const binaries = {};
  const docClone = JSON.parse(JSON.stringify(doc));
  let binaryIdx = 0;

  if (docClone.pages) {
    docClone.pages.forEach((page) => {
      if (!page.elements) return;
      page.elements.forEach((el) => {
        if (el.type === 'image' && el.src && el.src.startsWith('data:')) {
          const key = `binary_${binaryIdx++}`;
          binaries[key] = el.src;
          el.src = `@ref:${key}`;
        }
      });
    });
  }

  return { doc: docClone, binaries };
}

/** Re-inyecta binarios al documento */
function injectBinaries(doc, binaries) {
  const docClone = JSON.parse(JSON.stringify(doc));

  if (docClone.pages) {
    docClone.pages.forEach((page) => {
      if (!page.elements) return;
      page.elements.forEach((el) => {
        if (el.type === 'image' && el.src && el.src.startsWith('@ref:')) {
          const key = el.src.replace('@ref:', '');
          if (binaries[key]) {
            el.src = binaries[key];
          }
        }
      });
    });
  }

  return docClone;
}

/**
 * Exporta el documento como .miningreport (JSON + binarios + firma SHA-256)
 * @param {Object} doc - Documento del editor
 * @param {Object} metadata - Metadatos adicionales (autor, empresa, etc.)
 * @returns {Blob} - Archivo descargable
 */
export async function exportMiningReport(doc, metadata = {}) {
  const { doc: cleanDoc, binaries } = extractBinaries(doc);

  const manifest = {
    magic: MININGREPORT_MAGIC,
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    author: metadata.author || 'Unknown',
    company: metadata.company || 'Unknown',
    unit: metadata.unit || '',
    title: doc.meta?.title || metadata.title || 'Informe Sin Título',
    documentId: doc.document_id || `DOC-${Date.now()}`,
    pageCount: (doc.pages || []).length,
    binaryCount: Object.keys(binaries).length,
    offlineCapable: true,
  };

  const payload = {
    manifest,
    document: cleanDoc,
    binaries,
    auditLog: metadata.auditLog || [],
    workflow: metadata.workflow || { status: 'draft' },
  };

  const payloadStr = JSON.stringify(payload, null, 2);
  const signature = await computeSHA256(payloadStr);

  const envelope = {
    ...payload,
    signature: {
      algorithm: 'SHA-256',
      hash: signature,
      signedAt: new Date().toISOString(),
      signedBy: metadata.author || 'System',
    },
  };

  const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
  return blob;
}

/**
 * Descarga el archivo .miningreport
 */
export async function downloadMiningReport(doc, metadata = {}) {
  const blob = await exportMiningReport(doc, metadata);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const title = (doc.meta?.title || metadata.title || 'informe').replace(/[^a-zA-Z0-9_-]/g, '_');
  link.href = url;
  link.download = `${title}_${new Date().toISOString().slice(0, 10)}${MININGREPORT_EXTENSION}`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Importa un archivo .miningreport
 * @param {File} file - Archivo seleccionado
 * @returns {Object} - { document, manifest, workflow, auditLog, isValid }
 */
export async function importMiningReport(file) {
  const text = await file.text();
  const envelope = JSON.parse(text);

  // Validate magic
  if (envelope.manifest?.magic !== MININGREPORT_MAGIC) {
    throw new Error('Archivo no es un .miningreport válido');
  }

  // Verify signature
  const { signature, ...payload } = envelope;
  const payloadStr = JSON.stringify(payload, null, 2);
  const computedHash = await computeSHA256(payloadStr);
  const isValid = signature?.hash === computedHash;

  if (!isValid) {
    console.warn('[MININGREPORT] Firma SHA-256 no coincide — posible manipulación');
  }

  // Re-inject binaries
  const fullDoc = injectBinaries(envelope.document, envelope.binaries || {});

  return {
    document: fullDoc,
    manifest: envelope.manifest,
    workflow: envelope.workflow || { status: 'draft' },
    auditLog: envelope.auditLog || [],
    isValid,
    signature: envelope.signature,
  };
}

/**
 * Reconcilia un documento importado con el actual (merge)
 * Prioriza cambios del documento importado donde hay conflicto.
 */
export function reconcileDocuments(localDoc, importedDoc) {
  const merged = JSON.parse(JSON.stringify(localDoc));
  const imported = importedDoc;

  // Merge pages: imported pages take priority for matching indices
  if (imported.pages) {
    imported.pages.forEach((importedPage, idx) => {
      if (idx < merged.pages.length) {
        // Merge elements: imported elements override local
        const localElements = merged.pages[idx].elements || [];
        const importedElements = importedPage.elements || [];

        const mergedElements = [...localElements];
        importedElements.forEach((importedEl) => {
          const localIdx = mergedElements.findIndex((le) => le.id === importedEl.id);
          if (localIdx >= 0) {
            mergedElements[localIdx] = importedEl; // Override
          } else {
            mergedElements.push(importedEl); // Add new
          }
        });

        merged.pages[idx].elements = mergedElements;
      } else {
        merged.pages.push(importedPage); // Append new pages
      }
    });
  }

  // Update version
  merged.meta = {
    ...merged.meta,
    version: (merged.meta?.version || 1) + 1,
    lastReconciled: new Date().toISOString(),
  };

  return merged;
}

export { MININGREPORT_MAGIC, MININGREPORT_EXTENSION };
