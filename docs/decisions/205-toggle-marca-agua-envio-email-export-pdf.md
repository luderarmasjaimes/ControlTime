# ADR-204 — Toggle de marca de agua para perfiles avanzados, envío automático por email del PDF exportado y limpieza del modal de contraseña

**Status**: implemented, verificado por build real del backend (Docker, `Dockerfile.verify`, CTest 100%) + typecheck completo del frontend (`tsc --noEmit`, 0 errores). Sin verificación E2E en vivo todavía (pendiente, ver Consecuencias).
**Fecha**: 2026-09-22
**Autores**: Claude (sesión con Luder Armas)
**Ámbito**: reports

## Contexto

Pedido explícito sobre el export PDF del Informe Técnico Minero: máxima fidelidad respecto al lienzo origen (tablas, tamaños de hoja/orientación variados, TOC, pies de página, imágenes, videos, sensores, márgenes, carátula, listas), un toggle "con/sin sello de agua" visible solo para perfiles avanzados, envío automático del PDF + contraseña por correo al usuario que exportó y a una lista configurable de destinatarios adicionales, y eliminar el QR de contraseña del modal post-export (`PdfPasswordModal.tsx`, no el QR de "Acceso directo" de [ADR-138](138-enlace-directo-pdf-qr-sin-password.md), que es una feature distinta y no se toca).

Investigación previa confirmó que el mecanismo de fidelidad de tamaño de hoja/orientación por página YA estaba bien resuelto: `pdf-export-service/server.js::reportPageSizes()` lee el tamaño renderizado real de cada `.ro-page-canvas` y llama `page.pdf({width, height})` por página individual — el pedido de fidelidad se trata como verificación, no como rediseño (ver Consecuencias, pendiente de cerrar con un informe de prueba real).

Se encontraron dos huecos reales:
- El sidecar dibujaba la marca de agua de forma **incondicional** en `/render` y `/render-pdf` (`buildWatermarkText(watermark)` nunca devolvía vacío) — no existía ninguna forma de desactivarla.
- No existía ningún flujo que adjuntara el PDF ya exportado a un correo. El único "compartir" existente (`POST /api/reports/{id}/share`, [ADR-137](137-envio-informes-notificaciones-multicanal.md)) notifica a un usuario INTERNO con texto plano, sin adjunto — feature distinta, no se toca.

`report_document_settings` (`report_id, header_footer_json, cover_json, watermark_json, page_setup_json`) nunca había recibido un INSERT/UPSERT — solo se leía (`resolveWatermarkText`). Esta decisión escribe el primer UPSERT real de esa tabla.

## Decisión

**Permission code del watermark toggle.** `informes.export_sin_marca_agua` (`db_scripts/115`), calcado de `informes.export_sin_clave` ([ADR-201](201-xlsx-tablas-pptx-nativo-pdf-indice-real.md), `db_scripts/112`): sembrado a `admin`+`manager` únicamente. `POST /export/pdf` (job async) y `GET /export/pdf` (síncrono, vía `?no_watermark=1`) rechazan con 403 si `no_watermark:true`/`?no_watermark=1` viene de un rol sin ese permiso — nunca se pasa como si fuera `false` en silencio, mismo criterio exacto que `unprotected`. `runPdfExportJob`/`exportReportPdf` mandan `"watermark": false` explícito al sidecar cuando corresponde; `server.js` (ambos call sites, `/render` y `/render-pdf`) ahora solo dibuja si `watermark !== false` — retrocompatible, cualquier caller viejo (o sin la clave) sigue dibujando el default. Default siempre CON marca de agua; el texto sigue siendo el que ya arma `resolveWatermarkText` (arranca con "CONFIDENCIAL — …", no se tocó).

**Lista de correos adicionales.** Columna JSONB nueva `report_document_settings.pdf_share_recipients_json` (`db_scripts/116`), no tabla dedicada — ver Alternativas descartadas. `report_document_settings.cpp` gana `resolvePdfShareRecipients`/`savePdfShareRecipients` (primer INSERT/UPSERT real de la tabla; valida formato con un regex propio duplicado de `isSafeEmail` de `mining_iot::alarm_notifier` a propósito, trunca a 10). Nuevas rutas `GET`/`POST /api/reports/{id}/pdf-share-recipients` (POST y no PUT: este router solo expone un PUT de recurso completo, `r.put("/api/reports/", handleUpdateReport)`; el resto de sub-acciones de informe ya son POST por convención de `report_routes.cpp`), gateadas por el permission YA existente `informes.share` — mismo propósito semántico que `/share` (ADR-137), solo cambia el mecanismo de entrega.

**Envío de email al exportar.** `runPdfExportJob` (async) y el bloque `GET /export/pdf` (síncrono) resuelven `ownerEmail` (`findUserByIdPg(session->userId)`, `AuthUser::email`) y `extraRecipients` (`resolvePdfShareRecipients`) ANTES de lanzar el hilo/job, igual que ya se precomputa `watermarkText`. Tras el éxito del export, `sendPdfExportEmails` (nueva, `report_export_jobs.hpp/.cpp`, reutilizada por ambos pipelines) manda un correo por destinatario (`sendEmailWithAttachment`/`sendPlainEmail` de `mining_iot::alarm_notifier` toman un solo `to`) con el PDF adjunto + la contraseña (si el export quedó cifrado) + una nota sobre si lleva o no marca de agua. Si el PDF supera `AppConfig::gPdfEmailMaxAttachmentMb` (env var nueva `BEEMETRY_PDF_EMAIL_MAX_ATTACHMENT_MB`, default 20 MB) se manda sin adjunto con una nota aclaratoria — no hay deep-link real a un informe puntual dentro de la SPA hoy (`activeTab` es estado en memoria, sin ruta `/reports/:id`), así que el cuerpo no intenta armar uno roto. Best-effort en todos los casos: un fallo de SMTP a un destinatario nunca revierte el resultado `success` del export, que ya terminó bien. En el pipeline síncrono el envío se lanza en su propio `std::thread(...).detach()` para no sumar latencia al request ya medido ([ADR-183](183-benchmark-real-o3-export-pdf-falla-umbral-5s.md)/[184](184-optimizacion-real-export-o3-fuentes-locales-domcontentloaded.md)/[185](185-decision-negocio-cierre-o3-export-async-tolerancia-espera.md)).

**Limpieza del modal.** `PdfPasswordModal.tsx` pierde el QR de contraseña (`qrcode`, `useEffect` de generación, `handleDownloadQr`, bloque JSX) — pedido explícito del usuario, no reemplaza ni afecta al QR de "Acceso directo" de ADR-138 (`ShareLinkModal.tsx`, sigue usando `qrcode` sin cambios). Gana una sección "Enviar copia a más correos": input + agregar/borrar con chips, prellenada vía `fetchPdfShareRecipients` al montar y guardada vía `savePdfShareRecipients`. `RibbonToolbar.tsx` gana un botón-toggle "Sin sello de agua" en el grupo "Documentos", junto al ya existente "PDF (sin contraseña)", visible solo cuando `canToggleWatermark` (`hasPermission('informes.export_sin_marca_agua')`) es verdadero.

## Consecuencias

- Usuarios básicos nunca ven el toggle de marca de agua (el permission code no se les asigna) — perfiles avanzados (`admin`/`manager`) lo ven y pueden exportar sin ella.
- Cada export PDF exitoso ahora dispara hasta 11 envíos SMTP best-effort (dueño + hasta 10 destinatarios) — en dev apunta a mailpit (no entrega real), en producción depende del relay SMTP configurado (`BEEMETRY_SMTP_*`); un relay lento no bloquea la respuesta del export en ningún pipeline.
- El cuerpo del correo NO incluye un link al informe (decisión explícita, no un pendiente oculto: no existe deep-link real en la SPA hoy). Si se agrega ruteo real a `App.tsx` en el futuro, el email debería actualizarse para incluirlo.
- Un nuevo permission code (`informes.export_sin_marca_agua`) amplía la matriz RBAC — cualquier tenant puede reasignarlo a otros roles vía la pantalla de permisos existente, sin código nuevo.
- `report_document_settings` recibe su primer UPSERT real — `header_footer_json`/`cover_json`/`page_setup_json` siguen huérfanas (nadie las lee ni escribe todavía), fuera de alcance de esta decisión.
- **Pendiente real, no cerrado en esta pasada**: verificación E2E con un informe de prueba real (páginas A4/A3 retrato/paisaje mixtas, carátula, TOC, tabla, imagen, gráfico de sensor, footer) exportado en las 4 combinaciones de `unprotected`×`no_watermark`, inspeccionando el PDF resultante (tamaño/orientación por página, marca de agua, cifrado, marcadores, márgenes) y confirmando en mailpit que el correo automático llega con adjunto y contraseña correctos. La verificación hecha esta pasada fue: build C++ real (Docker, CTest 100%) y typecheck completo del frontend (0 errores).

## Alternativas descartadas

- **Tabla dedicada para la lista de correos** (`report_pdf_share_recipient`, una fila por email): descartada — es una lista corta (tope 10) que se reemplaza entera en cada guardado, sin caso de uso de auditoría por-fila; una columna JSONB en la misma tabla de settings ya usada para watermark/cover/header-footer es consistente y evita una tabla + FK + índice nuevos para algo tan chico.
- **Exportar `isSafeEmail` de `mining_iot::alarm_notifier` para validar la lista antes de persistirla**: descartada — se duplica un regex mínimo propio en `reports/report_document_settings.cpp`, mismo criterio que ya usa el repo para no acoplar dominios no relacionados (ver comentario de `parseUrl` en `report_pdf_export.cpp`/`report_export_jobs.cpp`).
- **Incluir un link al informe en el correo automático**: descartada por ahora — no existe ningún deep-link real a un informe puntual dentro de la SPA (`activeTab` es estado en memoria), y mandar una URL rota es peor que omitirla.
- **PUT para `/pdf-share-recipients`**: descartada — este router solo tiene un PUT de recurso completo (`handleUpdateReport`); el resto de sub-acciones de informe (`/share`, `/export/*`) ya son POST por convención establecida de `report_routes.cpp`.

## Referencias

- [ADR-080](080-marca-de-agua-y-password-pdf.md) — marca de agua/contraseña de PDF (comportamiento base que este ADR extiende con el toggle).
- [ADR-137](137-envio-informes-notificaciones-multicanal.md) — compartir informe a un usuario interno (permission `informes.share`, reusado acá para gatear la lista de correos externos; mecanismo de entrega distinto, sin adjunto).
- [ADR-138](138-enlace-directo-pdf-qr-sin-password.md) — QR de "Acceso directo" (feature separada, NO tocada por este ADR; el QR eliminado es el de contraseña en `PdfPasswordModal.tsx`).
- [ADR-201](201-xlsx-tablas-pptx-nativo-pdf-indice-real.md) — permission code `informes.export_sin_clave` (patrón que este ADR extiende con `informes.export_sin_marca_agua`) y el mecanismo de índice/marcadores real del PDF (fidelidad ya resuelta, referenciada en Contexto).
