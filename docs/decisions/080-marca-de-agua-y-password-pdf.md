# ADR-080 — Vista previa de impresión, marca de agua y PDF cifrado con contraseña

**Status**: accepted (implementado 2026-08-02)
**Fecha**: 2026-08-02
**Autores**: EC
**Ámbito**: reports

> El "Imprimir" del ribbon imprimía la app completa (chrome incluido, sin vista
> previa real) y el PDF exportado (ADR-016) no llevaba ninguna marca de agua
> ni protección — cualquiera con el archivo podía abrirlo. Este ADR agrega
> vista previa de impresión real, marca de agua en cada página del PDF
> exportado, y cifrado con contraseña generada al momento de la descarga.

## Contexto

ADR-016 ya resuelve el export PDF server-side: el backend le pide al sidecar
`pdf-export-service` (Node + Puppeteer) que navegue `print-report.html` (el
mismo `ReadOnlyViewer` que ve el usuario) y devuelva los bytes del PDF —
sin ningún post-procesado. `report_document_settings.watermark_json`
(`db_scripts/19_report_technical_mining_enterprise.sql`) existía en el
schema desde esa migración pero ningún código lo leía ni escribía.

## Decisión

### Dónde vive el post-procesado — el sidecar Node, no el backend C++
Watermark y cifrado se aplican en `pdf-export-service/server.js`, justo
después de `page.pdf()`, antes de responder. Es el único proceso que ya
tiene los bytes del PDF en memoria, y mantiene la arquitectura poliglota de
sidecars especializados (ADR-004): el backend C++ sigue sin ninguna
dependencia de manipulación de PDF.

### Marca de agua — `pdf-lib`, texto resuelto server-side (C++)
`pdf-lib` dibuja el texto en diagonal, repetido en cuadrícula, semitransparente,
sobre cada página ya renderizada — no requiere tocar el HTML/CSS de
`print-report.html`. El texto en sí lo resuelve el backend C++
(`reports::resolveWatermarkText`, `report_document_settings.cpp`) ANTES de
pedirle al sidecar que renderice: lee `report_document_settings.watermark_json`
(si existe y trae `text`) o arma un default
`"CONFIDENCIAL — {tenant} — Generado para {usuario} — {fecha}"` con el
tenant/usuario reales de la sesión que pide el export. El sidecar solo dibuja
el string que recibe — no conoce el modelo de datos ni toca Postgres. Sin UI
de edición de watermark en esta iteración (el campo queda listo para que una
futura pantalla de configuración lo escriba).

### Contraseña — `qpdf`, no `pdf-lib`
`pdf-lib` no soporta cifrado; se shell-ea a `qpdf` (agregado al `Dockerfile`
del sidecar vía `apt-get`) con `child_process.execFile` (argumentos como
array, nunca un string interpolado en un shell — evita inyección de
comandos). `qpdf --encrypt <userPw> <ownerPw> 256 --print=full --modify=none`
aplica cifrado PDF real (AES-256, ISO 32000): con la contraseña de usuario se
puede abrir e imprimir; sin la de propietario no se puede copiar texto ni
editar. La contraseña de usuario es aleatoria por descarga
(`crypto.randomBytes`, alfabeto sin caracteres ambiguos) y **nunca se
persiste** — no hay tabla ni columna que la guarde; cada `GET
.../export/pdf` genera un PDF y una contraseña nuevos. La de propietario es
un secreto fijo del servidor (`PDF_OWNER_PASSWORD_SECRET`, obligatorio en
`docker-compose.prod.yml`) que el usuario final nunca ve.

Se descartó el contenedor propietario `.mreport` de ADR-044 como base para
esto: ese formato deliberadamente **no** es abrible por herramientas
externas (para portabilidad interna entre terminales de la misma unidad). Un
PDF protegido por contraseña necesita justo lo contrario — seguir siendo un
PDF estándar, abrible en cualquier lector, solo que cifrado con el mecanismo
del propio formato.

### Entrega de la contraseña al usuario
El sidecar la devuelve en el header `X-Pdf-User-Password` de la respuesta
`POST /render`. El backend la reenvía en `X-Pdf-Password` sobre su propia
respuesta (`makePdfResponse`, `http_utils.cpp`) y registra un evento de
auditoría best-effort (`appendAuthAuditLogPg`, acción
`report.export.pdf`) — solo el hecho de que se exportó, nunca la contraseña
en sí. El frontend (`fetchReportPdfBlob`, `usePdfExport`) la lee del header
de respuesta y la muestra una única vez en `PdfPasswordModal` (copiar al
portapapeles) — no queda guardada en ningún lado del cliente tampoco. Si el
usuario pierde la contraseña, la única opción es volver a exportar (nuevo
PDF, nueva contraseña); no hay recuperación posible por diseño.

### Vista previa de impresión
El botón "Imprimir" del ribbon (`RibbonToolbar` → `App.tsx`) dejó de llamar
`window.print()` directamente sobre la app completa. Ahora abre
`ReadOnlyViewer` con el documento actual en edición (`handlePrintPreview`),
el mismo componente que ya usa "Mis Informes → Leer" y que `print-report.html`
reutiliza para el export server-side — así la vista previa es fiel a lo que
terminará en el PDF. Dentro de esa vista, "Imprimir" (impresión nativa del
navegador — sin marca de agua ni contraseña, para uso interno rápido) y
"Descargar PDF protegido" (el pipeline completo de este ADR) quedan como
acciones separadas y explícitas.

## Consecuencias

### Positivas
- Todo PDF descargado por la API queda protegido; no hay camino que devuelva
  un PDF sin marca de agua ni cifrado.
- Reutiliza infraestructura existente en vez de crear nueva: el sidecar
  (ADR-016), la columna `watermark_json` (ya en schema desde ADR-019), el
  gate RBAC `informes.view` (ADR-079) y el mecanismo de auditoría de
  `auth_storage_pg`.
- "Imprimir" y "Descargar PDF protegido" quedan conceptualmente separados: la
  impresión nativa no depende del sidecar ni de qpdf y sigue funcionando
  aunque el pipeline de export esté caído.

### Negativas / Trade-offs
- La contraseña no es recuperable — cada descarga es un artefacto nuevo. Para
  un flujo de "reenviar el mismo PDF" hay que exportar de nuevo (comportamiento
  intencional: evita guardar contraseñas en texto plano en la base de datos).
- Watermark sin UI de configuración: cambiar el texto por tenant hoy requiere
  escribir directamente en `report_document_settings.watermark_json` (sin
  pantalla en el editor todavía).
- `qpdf` agrega ~unos ms de latencia por export (proceso externo) — dentro
  del presupuesto de ADR-023 (O3, <5s) en las pruebas hechas, pero a vigilar
  si el volumen de páginas crece mucho.
- `PDF_OWNER_PASSWORD_SECRET` sin fijar en producción cae al literal de
  desarrollo del código — mismo patrón de deuda que otros secretos
  (`BEEMETRY_REPORT_EXPORT_KEY`, ADR-044): `docker-compose.prod.yml` lo exige
  vía `:?`, pero no hay validación en runtime que lo detecte si alguien
  bypassea ese compose file.

## Alternativas descartadas

### Cifrar en el backend C++ (libharu/PoDoFo/qpdf enlazado nativamente)
Requeriría agregar una dependencia nueva a `backend/Dockerfile` y romper el
patrón "el backend C++ nunca toca bytes de PDF" que ADR-016 estableció a
propósito. El sidecar Node ya tiene los bytes en memoria — no hay razón para
mover esa responsabilidad.

### Watermark dibujado en el HTML de `print-report.html` (CSS)
Depende de que `position: fixed` se repita de forma confiable en cada página
impresa por Chromium — comportamiento no garantizado entre versiones. Dibujar
sobre el PDF ya generado (`pdf-lib`, coordenadas explícitas por página) es
determinístico independientemente del motor de renderizado HTML.

## Referencias
- `pdf-export-service/server.js` (watermark + cifrado, `Dockerfile`,
  `package.json`)
- `backend/src/reports/report_document_settings.hpp/cpp` (nuevo)
- `backend/src/reports/report_pdf_export.hpp/cpp` (`userPassword`, parámetro
  `watermarkText`)
- `backend/src/reports/report_routes.cpp` (`GET .../export/pdf`)
- `backend/src/http/http_utils.hpp/cpp` (`makePdfResponse` con
  `X-Pdf-Password`, `Access-Control-Expose-Headers`)
- `frontend/src/components/ReportStudioV2/lib/api.ts` (`fetchReportPdfBlob`)
- `frontend/src/components/ReportStudioV2/lib/usePdfExport.ts` (nuevo)
- `frontend/src/components/ReportStudioV2/components/PdfPasswordModal.tsx`
  (nuevo)
- `frontend/src/components/ReportStudioV2/components/viewers/ReadOnlyViewer.tsx`
  (botones Imprimir / Descargar PDF protegido)
- `frontend/src/components/ReportStudioV2/App.tsx` (`handlePrintPreview`,
  `handleExportPdf`)
- `docker-compose.yml` / `docker-compose.prod.yml` (`PDF_OWNER_PASSWORD_SECRET`)
- ADR-016 (export server-side), ADR-044 (contenedor cifrado `.mreport`,
  contraste de por qué este caso es distinto), ADR-004 (sidecars poliglotas),
  ADR-079 (RBAC de informes, gate reutilizado)
