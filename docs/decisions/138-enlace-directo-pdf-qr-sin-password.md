# ADR-138 — Enlace de acceso directo a PDF vía QR (sin contraseña)

**Status**: accepted (implementado 2026-08-31)
**Fecha**: 2026-08-31
**Autores**: EC
**Ámbito**: reports

> Pedido del usuario: que escanear el QR de la contraseña del PDF (ADR-080)
> abra el PDF ya desbloqueado, sin pegar nada. Verificado en vivo que eso es
> imposible con un PDF realmente cifrado — ningún lector estándar permite que
> un QR le escriba una contraseña. Este ADR agrega la única forma real de
> lograr "cero pasos": un segundo mecanismo, complementario al de ADR-080, no
> un reemplazo.

## Contexto

ADR-080 ya resuelve "PDF protegido con contraseña aleatoria, mostrada una
vez, nunca persistida". Se probó en vivo (export real + QR + `jsQR` +
`pypdf`) que el QR de esa contraseña funciona exactamente como está diseñado:
agiliza copiarla, pero el lector de PDF SIEMPRE muestra su propio diálogo —
ningún sistema operativo permite que un QR/URL escriba texto dentro de otra
app al abrirla (por diseño de seguridad, no una limitación de esta app).

El usuario pidió explícitamente "cero pasos al escanear". Se le explicó que
las dos propiedades (PDF con cifrado real + apertura automática) son
mutuamente excluyentes, y confirmó que quiere **ambos mecanismos
disponibles**, no reemplazar ADR-080.

## Decisión

### Un token opaco reemplaza la contraseña como mecanismo de protección
`report_pdf_share_links` (`db_scripts/88_report_pdf_share_links.sql`):
`token` (clave primaria, `http_utils::secureRandomHex(32)` → 64 hex chars),
`report_id`, `tenant_id`, `created_by_user_id/username`, `expires_at` (48h
fijas desde la creación), `revoked`, `accessed_count`/`last_accessed_at`
(trazabilidad best-effort). El PDF servido a través del token **no lleva
cifrado propio** — quien tiene el link (o el QR) entra sin loguearse
mientras no venza. La protección deja de ser "algo que solo el destinatario
sabe" (la contraseña) y pasa a ser "algo que solo el destinatario tiene" (el
link), igual que cualquier "enlace para compartir" de Google Drive/Dropbox.

### El sidecar aprende a NO cifrar (`encrypt: false`)
`pdf-export-service/server.js`: `POST /render` acepta `{ encrypt?: boolean }`
(default `true`, preserva ADR-080 sin cambios para todo caller existente).
Con `encrypt: false` se salta el paso `qpdf` — mismo render, misma marca de
agua, sin contraseña. `report_pdf_export.cpp::exportReportPdf` propaga el
flag (`encrypt = true` por default).

### Render público sin sesión de usuario, con una sesión interna efímera
`GET /api/reports/share/{token}/pdf` es la única ruta de este archivo que se
resuelve **antes** de `resolveAuthSession` — quien escanea el QR no tiene
(ni debe necesitar) sesión logueada. El token validado (`resolveReportShareLinkPg`)
da `report_id`/`tenant_id`/`created_by_user_id`. Para que el sidecar pueda
navegar `print-report.html` (que sí requiere auth para leer el informe), el
backend mintea solo un access token interno de corta vida para el usuario que
CREÓ el link (`findUserByIdPg` + `issueEphemeralAccessToken`, sin refresh
token persistido) — ese token nunca sale del backend y expira naturalmente.
Alternativa descartada: reusar el token de sesión
de quien creó el link — expira en minutos (ADR-029, TTL corto) y el link
puede abrirse horas/días después.

### `Content-Disposition: inline`, no `attachment`
`makeInlinePdfResponse` (nuevo, `http_utils.cpp`) — a diferencia de
`makePdfResponse` (ADR-080, fuerza descarga), esto hace que el navegador del
celular MUESTRE el PDF al navegar la URL, sin diálogo de guardar archivo.
Es la pieza que realmente logra "cero pasos": sin esto, aunque el PDF no
tuviera contraseña, seguiría aaperciendo un prompt de descarga.

### Creación gateada por `informes.share`, no uno nuevo
`POST /api/reports/{id}/share-link` (autenticado) reusa el permiso que ya
protege `/api/reports/{id}/share` (ADR-137, compartir hacia otro usuario de
la empresa) — semánticamente es la misma acción ("compartir este informe
hacia afuera"), no ameritaba una fila RBAC nueva.

### Frontend: complementa, no reemplaza
`ShareLinkModal.tsx` (nuevo) es un componente hermano de `PdfPasswordModal.tsx`,
mismo patrón (QR client-side con la librería `qrcode`, ya agregada para
ADR-080). Botón "Enlace + QR" nuevo en el ribbon (`RibbonToolbar.tsx`, grupo
"Acceso directo") y en `ReadOnlyViewer.tsx`, al lado de "Descargar PDF
protegido" — dos acciones explícitas y separadas, el usuario elige cuál
mecanismo usar según el caso.

## Consecuencias

### Positivas
- Logra el pedido real del usuario ("escanear y ya está") sin comprometer
  el mecanismo existente de ADR-080, que sigue disponible sin cambios.
- Reusa infraestructura: `qrcode` (ya instalado), emisión JWT interna/
  `findUserByIdPg` (patrón de tenant-switch), permiso `informes.share`
  existente, `exportReportPdf`/sidecar ya existentes (solo un flag nuevo).

### Negativas / Trade-offs
- **Contradice explícitamente el trade-off de seguridad de ADR-080**: ese
  ADR eligió A PROPÓSITO no persistir nunca el PDF ni una forma de acceder a
  él sin contraseña ("la única opción es volver a exportar"). Este ADR
  introduce justo eso para un segundo flujo — el usuario lo pidió y confirmó
  explícitamente tras que se le explicara el trade-off en detalle.
- Quien intercepte el link/QR (no solo quien lo recibe a propósito) puede
  ver el informe sin loguearse hasta que venza — 48h fijas, sin UI para
  acortar/revocar todavía (la columna `revoked` existe en el schema, sin
  endpoint que la use).
- Cada acceso al link mintea un access token JWT efímero solo para ese render;
  no crea refresh tokens persistidos. Sin rate limiting dedicado todavía, un
  crawler de previews podría aun forzar renders costosos.
- Sin UI para listar/revocar links activos de un informe — hoy `revoked`
  solo se puede setear a mano en Postgres.

## Alternativas descartadas

### Automatizar el llenado de la contraseña vía QR/deep link
Es la solicitud original del usuario. Técnicamente imposible: ningún sistema
operativo permite que abrir una URL/archivo escriba texto dentro de la UI de
OTRA app — es una restricción de seguridad deliberada (si existiera, un QR
malicioso podría automatizar acciones en cualquier app). No es algo que este
backend pueda programar distinto.

### Mantener el PDF cifrado y solo cambiar cómo se entrega el link
Descartado en la misma conversación: para que el navegador no muestre NINGÚN
diálogo, el PDF que llega al navegador tiene que estar ya sin cifrar — un
PDF `qpdf`-encriptado siempre dispara el prompt del lector, sea cual sea el
transporte (link, QR, adjunto).

## Referencias
- `db_scripts/88_report_pdf_share_links.sql` (tabla nueva)
- `pdf-export-service/server.js` (`encrypt` flag en `POST /render`)
- `backend/src/reports/report_pdf_export.hpp/cpp` (parámetro `encrypt`)
- `backend/src/reports/report_share_links.hpp/cpp` (nuevo — create/resolve)
- `backend/src/reports/report_routes.cpp` (`GET .../share/{token}/pdf` sin
  sesión, `POST .../share-link` autenticado)
- `backend/src/http/http_utils.hpp/cpp` (`makeInlinePdfResponse`)
- `frontend/src/components/ReportStudioV2/lib/api.ts` (`createReportShareLink`)
- `frontend/src/components/ReportStudioV2/lib/useShareLink.ts` (nuevo)
- `frontend/src/components/ReportStudioV2/components/ShareLinkModal.tsx` (nuevo)
- `frontend/src/components/ReportStudioV2/components/layout/RibbonToolbar.tsx`
  (botón "Enlace + QR", grupo "Acceso directo")
- `frontend/src/components/ReportStudioV2/components/viewers/ReadOnlyViewer.tsx`
  (mismo botón en la vista previa)
- ADR-080 (PDF cifrado con contraseña — mecanismo complementario, sin
  cambios), ADR-137 (`informes.share`, permiso reusado), ADR-029 (JWT
  híbrido, `issueAuthSession` reusado igual que en tenant-switch)
