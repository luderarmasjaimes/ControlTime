# ADR-128 — Autoría nativa de documentos tipo "presentación" (16:9) en ReportStudioV2

**Status**: implemented (2026-08-20/21, hallado y documentado en auditoría 2026-08-21)

**Fecha**: 2026-08-20

**Ámbito**: reports

**Relación**: distinto de ADR-083/084 (exportación de un informe ya existente
a PPTX/video) — este ADR cubre la dirección inversa: autoría nativa de una
presentación desde cero, usando el mismo modelo de documento por composición
de ADR-070.

## Contexto

ADR-083/084 ya resolvían **exportar** un informe existente (tipo documento,
A4) a formato PPTX o a video narrado. No existía ninguna forma de **crear
directamente** un documento tipo presentación (lienzo 16:9, una idea por
diapositiva) desde el wizard de plantillas del editor — todas las plantillas
existentes (`DOCUMENT_TEMPLATES`) asumían implícitamente `docType:
'document'` (A4, con tabla de contenidos, paginado por desborde de texto).

## Decisión

1. **`DocumentTemplateMeta.docType?: 'document' | 'presentation'`** (nuevo
   campo opcional, default `'document'` si se omite — las 8 plantillas de
   documento existentes se marcan explícitamente `'document'` por claridad,
   sin cambiar su comportamiento).
2. **Dos plantillas nuevas**: `presentacion-resultados` (resumen ejecutivo,
   hallazgos clave, próximos pasos) y `presentacion-comercial` (propuesta de
   valor, diferenciadores, llamado a la acción) — ambas `docType:
   'presentation'`, clasificación `USO INTERNO`/`CONFIDENCIAL — USO
   COMERCIAL` respectivamente, siguiendo el mismo patrón de metadatos que el
   resto del catálogo.
3. **`forceNewSlide(flow)`**: los builders de presentación fuerzan un salto
   de página tras cada bloque de contenido (una idea por diapositiva), a
   diferencia de los builders de documento (que dejan que el flujo pagine
   solo por desborde de texto) — en un lienzo 960×540, varios párrafos
   cortos entrarían en la misma diapositiva si se dejara paginar por
   overflow, que no es la convención esperada de una presentación.
4. **`buildDocumentTemplate`**: cuando `meta.docType === 'presentation'`, usa
   `getReportLayoutMetrics('presentation', ...)` (lienzo fijo 960×540,
   ignora `paperSize`/`orientation` — se pasan igual por uniformidad de
   firma con el resto de plantillas) y **omite la página de tabla de
   contenidos** (`buildTocPage`) — una presentación corta no la necesita,
   a diferencia de los informes/propuestas largos que sí la llevan en la
   página 2. `meta.layoutMode` del documento resultante queda en
   `'presentation'`, el mismo valor que ya consume el export PPTX real de
   ADR-083 — una presentación creada nativamente con este ADR es, para el
   resto del pipeline de exportación, indistinguible de una creada
   exportando un informe existente.

## Consecuencias

- Reutiliza el modelo de documento por composición de bloques (ADR-070) y el
  pipeline de export PPTX ya existente (ADR-083) sin ningún cambio en ellos
  — el trabajo nuevo se acota a los builders de contenido y al gateo de
  `docType` en `buildDocumentTemplate`.
- Un usuario ahora puede crear una presentación de punta a punta (autoría +
  edición + export a PPTX) sin pasar primero por un informe de documento —
  antes la única vía a un PPTX era exportar un informe A4 ya escrito.
- Las plantillas de presentación son deliberadamente simples (3 diapositivas
  de contenido cada una, con placeholders `[completar con ...]`) — no se
  intentó anticipar todo el universo de estructuras de presentación posibles;
  el usuario edita el contenido libremente después de generarla, igual que
  con cualquier otra plantilla.

## Alternativas descartadas

- **Reutilizar las plantillas de documento existentes con un flag de
  "vista de presentación" en el visor/export, sin `docType` propio**:
  descartado — el paginado por desborde de un documento A4 no produce el
  resultado "una idea por diapositiva" esperado de una presentación nativa;
  se necesitaban builders de contenido con `forceNewSlide` explícito.
- **Un editor de presentaciones completamente separado del editor de
  documentos**: descartado por costo — habría duplicado gran parte de la
  infraestructura de edición/composición/export ya existente para un
  beneficio incremental menor que extender el modelo actual con `docType`.

## Referencias

- `frontend/src/components/ReportStudioV2/lib/documentTemplates.ts`
  (`docType`, `presentacion-resultados`, `presentacion-comercial`,
  `forceNewSlide`, `buildPresentacionResultados`, `buildPresentacionComercial`,
  `buildDocumentTemplate`)
- `frontend/src/components/ReportStudioV2/components/support/SupportChatWidget.tsx`
  (`isPresentation`, ícono `Presentation` — punto de entrada desde el wizard
  de chat)
- ADR-070 (bloques técnicos / plantillas semánticas por composición),
  ADR-083 (export PPTX — consumidor de `layoutMode: 'presentation'`)
