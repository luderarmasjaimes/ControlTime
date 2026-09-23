import React, { useEffect, useState } from 'react';
import { KeyRound, Copy, Check, X, Plus } from 'lucide-react';
import { fetchPdfShareRecipients, savePdfShareRecipients } from '../lib/api';

interface PdfPasswordModalProps {
  password: string;
  reportId: string;
  onClose: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 10;

/**
 * ADR-080: muestra UNA sola vez la contraseña con la que quedó cifrado el
 * PDF recién descargado (el servidor no la persiste — si se cierra este
 * modal sin copiarla, hay que volver a exportar para obtener una nueva).
 *
 * ADR-204: el PDF (adjunto) + esta misma contraseña ya se enviaron por
 * correo automáticamente a quien exportó y a la lista de abajo -- esta
 * sección deja agregar/borrar esos correos adicionales (persistida en
 * `report_document_settings.pdf_share_recipients_json`, se aplica desde el
 * PRÓXIMO export, no reenvía nada retroactivamente). El QR que vivía acá
 * (codificaba la contraseña para copiarla desde el celular) se quitó por
 * pedido explícito -- no es necesario para este flujo.
 */
function PdfPasswordModal({ password, reportId, onClose }: PdfPasswordModalProps) {
  const [copied, setCopied] = useState(false);
  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [recipientsError, setRecipientsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPdfShareRecipients(reportId)
      .then((list) => { if (!cancelled) setEmails(list); })
      .catch(() => { /* lista vacía si falla -- no bloquea ver la contraseña */ });
    return () => { cancelled = true; };
  }, [reportId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Portapapeles no disponible (permiso denegado, contexto no seguro):
      // la contraseña sigue visible en pantalla para copiarla a mano.
    }
  };

  const handleAddEmail = () => {
    const value = newEmail.trim().toLowerCase();
    setRecipientsError(null);
    if (!value) return;
    if (!EMAIL_RE.test(value)) {
      setRecipientsError('Correo inválido.');
      return;
    }
    if (emails.includes(value)) {
      setRecipientsError('Ese correo ya está en la lista.');
      return;
    }
    if (emails.length >= MAX_RECIPIENTS) {
      setRecipientsError(`Máximo ${MAX_RECIPIENTS} correos.`);
      return;
    }
    setEmails((prev) => [...prev, value]);
    setNewEmail('');
    setDirty(true);
  };

  const handleRemoveEmail = (email: string) => {
    setEmails((prev) => prev.filter((e) => e !== email));
    setDirty(true);
  };

  const handleSaveRecipients = async () => {
    setSaving(true);
    setRecipientsError(null);
    try {
      const saved = await savePdfShareRecipients(reportId, emails);
      setEmails(saved);
      setDirty(false);
    } catch {
      setRecipientsError('No se pudo guardar la lista.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pdf-pw-overlay" role="dialog" aria-modal="true">
      <div className="pdf-pw-modal">
        <div className="pdf-pw-header">
          <KeyRound size={18} style={{ color: '#6366f1' }} />
          <h3>PDF protegido generado</h3>
          <button className="pdf-pw-close" onClick={onClose} title="Cerrar">
            <X size={16} />
          </button>
        </div>
        <p className="pdf-pw-desc">
          El PDF descargado lleva marca de agua y quedó cifrado con esta contraseña.
          Se necesita para abrirlo — <strong>no se volverá a mostrar</strong>, guárdala en un
          lugar seguro. Ya se envió una copia + esta contraseña por correo a tu casilla y a
          los destinatarios configurados abajo.
        </p>
        <div className="pdf-pw-value-row">
          <code className="pdf-pw-value">{password}</code>
          <button className="pdf-pw-copy-btn" onClick={handleCopy} title="Copiar contraseña">
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? 'Copiada' : 'Copiar'}
          </button>
        </div>

        <div className="pdf-pw-recipients">
          <p className="pdf-pw-recipients-label">Enviar copia a más correos</p>
          <div className="pdf-pw-recipients-row">
            <input
              type="email"
              className="pdf-pw-recipients-input"
              placeholder="correo@empresa.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddEmail(); } }}
            />
            <button className="pdf-pw-recipients-add-btn" onClick={handleAddEmail} title="Agregar correo">
              <Plus size={14} /> Agregar
            </button>
          </div>
          {recipientsError && <p className="pdf-pw-recipients-error">{recipientsError}</p>}
          {emails.length > 0 && (
            <div className="pdf-pw-recipients-list">
              {emails.map((email) => (
                <span key={email} className="pdf-pw-recipient-chip">
                  {email}
                  <button
                    className="pdf-pw-recipient-chip-remove"
                    onClick={() => handleRemoveEmail(email)}
                    title={`Quitar ${email}`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {dirty && (
            <button className="pdf-pw-recipients-save-btn" onClick={handleSaveRecipients} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar lista'}
            </button>
          )}
        </div>

        <button className="pdf-pw-done-btn" onClick={onClose}>Entendido</button>
      </div>
    </div>
  );
}

export default PdfPasswordModal;
