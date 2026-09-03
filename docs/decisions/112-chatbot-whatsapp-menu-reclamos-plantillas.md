# ADR-112 — Bot conversacional de WhatsApp Business (menú, reclamos, IA) + plantillas de presentación

> **Actualización 2026-08-30**: el desarrollador confirmó que se va a usar
> el token de prueba de Meta ahora (compra del comercial diferida a más
> adelante) — con eso, se auditó el camino de entrega real. `.env` sí tiene
> credenciales reales cargadas (`BEEMETRY_WHATSAPP_ACCESS_TOKEN`,
> `PHONE_NUMBER_ID`, `BUSINESS_ACCOUNT_ID`, webhook verify token). Pero el
> túnel que expone el webhook local a Meta (`beemetry-webhook-tunnel`,
> Cloudflare "quick tunnel" sin cuenta) estaba **caído de verdad** al
> revisarlo: la URL pública conocida (`rabbit-eau-has-raymond.trycloudflare.com`)
> ya ni resolvía por DNS — Cloudflare la había dado de baja. Recreado el
> contenedor (`docker stop/rm` + `docker run` con la misma config: imagen
> `cloudflare/cloudflared:latest`, `tunnel --no-autoupdate --url
> http://backend:8081`, red `informecliente_default`) para forzar que
> pidiera una URL nueva — un simple `docker restart` no alcanzó, cloudflared
> no volvió a pedir tunnel nuevo con el proceso reiniciado in-place.
>
> **Verificado en vivo, extremo a extremo, con la URL nueva**
> (`https://reaching-comm-sectors-derived.trycloudflare.com`):
> `GET /api/support/whatsapp/webhook?hub.verify_token=<token incorrecto a propósito>`
> a través del túnel devolvió `403 {"error":"verification_failed"}` — la
> petición viajó Cloudflare → túnel → red Docker → `handleWebhookVerify`
> real y fue rechazada correctamente (con el token real devolvería `200` +
> el `hub.challenge`, completando el handshake que Meta exige). El camino
> completo está probado; falta solo (1) actualizar la URL del webhook en el
> dashboard de Meta a la nueva dirección — paso manual, requiere acceso a la
> cuenta de Meta Business — y (2) correr el envío/recepción real de un
> mensaje de punta a punta.
>
> **Esto NO cierra el pendiente de "entrega real a un teléfono"**: un
> "quick tunnel" sin cuenta es explícitamente para pruebas — Cloudflare
> mismo advierte "no uptime guarantee", y **la URL cambia cada vez que el
> contenedor se recrea**, exigiendo re-registrarla en Meta cada vez. Para
> un entorno que sobreviva más que una sesión de pruebas hace falta un
> túnel con nombre (cuenta Cloudflare) o el `nginx-tls-server.conf.example`
> ya mencionado en ADR-130 — ninguno de los dos existe todavía. El estado
> real es: **infraestructura de prueba reparada y verificada hoy**, no
> "listo para producción".

**Status**: implemented, verificado por build/tests (ver "Evidencia y referencias"); entrega real a un teléfono pendiente de credenciales de producción de Meta.

**Fecha**: 2026-08-18

**Autores**: EC

**Ámbito**: soporte, reports

**Relación**: extiende el escalamiento de solo-salida existente (`whatsapp_client.hpp`, `mining_chatbot_service.hpp`); extiende ADR-070 (plantillas por composición) y el catálogo de plantillas de documento completo introducido 2026-07-30 (`documentTemplates.ts`); reutiliza `layoutMode: 'presentation'` (ADR-083, export PPTX real); sigue el patrón de auditoría 100% (ADR-030/031) y RBAC granular (ADR-036/042/043).

## Contexto

El "chatbot de WhatsApp" existente era, en realidad, dos piezas separadas sin
conexión real entre sí:

1. Un widget de chat web (`SupportChatWidget.tsx`) con IA local (Ollama), sin
   ningún vínculo con WhatsApp salvo un botón que dispara **un único mensaje
   saliente** de escalamiento.
2. Un cliente de WhatsApp **de solo salida** (`whatsapp_client.cpp`) que
   únicamente sabe enviar plantillas pre-aprobadas (`hello_world`) a un
   número fijo. **No existía webhook de entrada**: WhatsApp nunca le hablaba
   al backend, así que no había conversación real, ni menú, ni estado, ni
   registro de reclamos.

Se pidió construir el bot conversacional real que falta: un menú de WhatsApp
con soporte técnico, área comercial, gestión de reclamos con código de
seguimiento, generación de documentos, consultas a la IA y opciones
adicionales útiles para minería (emergencia, agenda de visita técnica); que
valide datos antes de derivar a un número humano; que registre todo en base
de datos (ninguna interacción "al aire"); y una galería de plantillas de
documento que distinga tipo Word / tipo PowerPoint, insertando la plantilla
completa en el lienzo con un clic.

Hallazgo clave durante la implementación: la parte de "plantillas de
documento" ya existía en un 80% (`lib/documentTemplates.ts` +
`RightInspector.tsx`, con `applyDocumentTemplate` reemplazando el documento
completo) y el editor ya soportaba `layoutMode: 'presentation'` (lienzo 16:9,
consumido por el export PPTX real de ADR-083) — no hizo falta reconstruir esa
infraestructura, solo taggearla por tipo y agregar plantillas nuevas.

## Decisión

### Menú de WhatsApp como interactive list, con fallback de texto/dígitos
`whatsapp_client` se extiende (sin tocar `sendWhatsappTemplateMessage`, que
sigue siendo la única vía para contacto iniciado por el negocio fuera de la
ventana de 24h) con `sendWhatsappTextMessage`,
`sendWhatsappInteractiveListMessage` y `sendWhatsappInteractiveButtonsMessage`
— válidas dentro de la ventana de 24h que abre un mensaje entrante real. El
menú raíz (8 filas: soporte, comercial, reclamos, documentos, IA, emergencia,
agenda, hablar con agente) se envía como lista nativa con emoji+título+
descripción por fila; cualquier cliente de WhatsApp que no renderice listas
igual puede escribir el dígito o una palabra clave — `whatsapp_menu.cpp`
(`resolveRootMenuChoice`/`resolveReclamosSubmenuChoice`) es lógica pura,
separada del motor con estado, para que ese mapeo id↔dígito↔palabra-clave
tenga cobertura de test real sin depender de DB/red.

### Webhook de entrada con verificación de firma real
`whatsapp_webhook_routes.cpp` agrega `GET` (handshake `hub.challenge` de
Meta) y `POST /api/support/whatsapp/webhook`. El `POST` valida
`X-Hub-Signature-256` (HMAC-SHA256 del body crudo con el app secret de Meta,
comparación en tiempo constante) **antes** de parsear cualquier JSON —
extraído a `whatsapp_signature.hpp/.cpp`, sin dependencias de DB/red, mismo
criterio de testabilidad que el menú. Sin firma válida, `403` sin procesar.
Siempre responde `200` una vez autenticada la request (incluso ante payload
malformado): Meta reintenta indefinidamente cualquier respuesta que no sea
2xx, y un payload roto no se arregla reintentando el mismo evento.

### Máquina de estado por número de teléfono
`whatsapp_conversation` (una fila por `phone_e164`) guarda `state` +
`context jsonb`; se resetea a `MENU_ROOT` si el último mensaje fue hace más
de 30 minutos. `whatsapp_bot_engine.cpp` resuelve el turno: sub-flujos de
calificación genéricos (estado `COLLECTING`, 3 preguntas para
soporte/comercial/reclamo/agenda, 1 para emergencia) evitan un estado C++
distinto por cada combinación de flujo × pregunta. Al completarse, crea un
`support_ticket`, notifica al número humano correspondiente
(`gWhatsappSupportToE164`/nuevo `gWhatsappComercialToE164`) con un resumen y
responde al usuario con el código y el link `wa.me/<numero>` para contacto
directo — esa es la vía de "direccionar la comunicación con un número de
WhatsApp" pedida. La opción "IA" reenvía el turno a
`support::handleChatMessage` (mismo Ollama que ya usa `SupportChatWidget`),
manteniendo una ventana corta de historia (6 mensajes) en `context`. La
opción "Documentos" no intenta insertar nada en el lienzo desde WhatsApp —
eso es una acción del navegador — y lo explicita al usuario en vez de
prometer algo que la API de WhatsApp no puede hacer.

### Reclamos con código de seguimiento, sin nada "al aire"
`db_scripts/59_whatsapp_bot_reclamos.sql` agrega `whatsapp_conversation`,
`whatsapp_message_log` (auditoría cruda de cada mensaje entrante/saliente),
`support_ticket` y `support_ticket_event` (línea de tiempo). El código
(`generate_support_ticket_code`, p. ej. `RCL-20260818-0007`) se genera en SQL
vía secuencia + prefijo por categoría. `support_storage_pg.hpp/.cpp`
centraliza el acceso (create/find-por-código/update-status), reutilizado por
el motor del bot y por los nuevos endpoints REST
(`POST /api/support/tickets`, `GET .../tickets/{code}` público sin sesión,
`PUT .../tickets/{code}/status` gateado por el permiso nuevo
`soporte.manage`, mismo patrón de matriz RBAC que ADR-042/043).

### Plantillas de documento: Word vs PowerPoint sobre la infraestructura existente
`DocumentTemplateMeta` gana `docType?: 'document' | 'presentation'`; las 8
plantillas existentes quedan `'document'`. Se agregan dos plantillas
`'presentation'` ("Presentación de Resultados", "Presentación Comercial")
cuyo builder usa el mismo motor de flujo (`addHeading`/`addParagraph`/
`addBullets`) sobre métricas de lienzo 960×540 (`getReportLayoutMetrics`),
con un `forceNewSlide` nuevo para que cada bloque de contenido sea su propia
diapositiva en vez de paginar solo por desborde (criterio distinto al de un
documento largo). `buildDocumentTemplate` bifurca por `docType`: las
presentaciones no llevan índice (innecesario en un mazo corto) y su
`meta.layoutMode` queda en `'presentation'`, por lo que el export PPTX real
de ADR-083 les funciona sin ningún cambio en el sidecar. `RightInspector.tsx`
y `SupportChatWidget.tsx` (que ya tenía su propio selector de plantillas
completas) agregan una insignia Word/PowerPoint con ícono (`lucide-react`,
`FileText`/`Presentation`) sobre el flujo de selección única + "Insertar" ya
existente — no se tocó ese flujo, ya hacía exactamente lo pedido.

## Consecuencias

### Positivas
- El bot pasa de "solo-salida, un mensaje fijo" a una conversación real de
  dos vías con menú, calificación de datos y registro persistente.
- Ningún reclamo/solicitud queda sin trazabilidad: `whatsapp_message_log`
  audita cada mensaje, `support_ticket_event` audita cada cambio de estado.
- La galería de plantillas gana el eje Word/PowerPoint pedido reutilizando
  al 100% la infraestructura de composición ya existente (ADR-070) y el
  export PPTX ya implementado (ADR-083) — cero código nuevo de renderizado.
- La lógica más sensible a errores silenciosos (resolución de menú, firma
  HMAC del webhook) quedó aislada en módulos puros (`whatsapp_menu.cpp`,
  `whatsapp_signature.cpp`) con cobertura Catch2 real, sin forzar al target
  de tests (deliberadamente sin libpq/red, ADR-060) a cargar dependencias
  pesadas.

### Negativas / Trade-offs
- **Sin credenciales reales de Meta ni webhook expuesto a Internet en este
  entorno, no se pudo verificar la entrega end-to-end a un teléfono real.**
  Se verificó todo lo demás: build limpio, suite Catch2 (menú + firma HMAC),
  y simulación local del webhook con payloads con forma real de Meta contra
  Postgres real (ver evidencia). Falta la validación en vivo cuando el
  equipo cargue `BEEMETRY_WHATSAPP_ACCESS_TOKEN`/`APP_SECRET`/
  `WEBHOOK_VERIFY_TOKEN` de producción y registre la URL del webhook en el
  panel de Meta.
- La opción "IA" del bot no tiene contexto de sensores por tenant (a
  diferencia del widget web, que sí lo inyecta vía `tenantId` de sesión):
  un usuario de WhatsApp no tiene sesión autenticada, así que no hay un
  tenant seguro que resolver sin pedir credenciales — queda como Q&A general.
- No se agregó pantalla de backoffice nueva para gestión de tickets; el
  endpoint `PUT .../tickets/{code}/status` existe y está gateado por RBAC,
  pero la operación hoy se hace por API/DB directa hasta que se justifique
  una UI dedicada.
- Las respuestas del bot usan Markdown de WhatsApp (`*negrita*`) y emoji como
  único mecanismo de "iconografía amigable" disponible en mensajes de texto/
  lista — la API de WhatsApp Business no permite imágenes custom dentro de
  una lista interactiva, solo en el header del mensaje (no implementado por
  no depender de una URL de imagen pública en este entorno).

### Neutras
- `support_ticket` reutiliza una sola tabla para 4 categorías
  (soporte/comercial/reclamo/agenda) en vez de 4 tablas — se distinguen por
  `category`, mismo criterio de no-duplicar-esquema ya usado en otras partes
  del sistema.

## Alternativas descartadas

### Persistir el estado de conversación en memoria del proceso
Más simple, pero no sobrevive un reinicio del backend y no es auditable —
rechazado por el mismo criterio de "nada al aire" que pidió la sesión;
`whatsapp_conversation` en Postgres además reutiliza el pool ya existente
(`storage::PgPool`).

### Un tipo de bloque nuevo para "diapositiva" en vez de reusar `layoutMode: 'presentation'`
Habría duplicado exactamente la infraestructura que ADR-083 ya construyó
para el export PPTX real (métricas 960×540, mapeo de overlay). Se descartó
por el mismo principio de no-duplicar-renderizado que otros ADR de este log
(ADR-016, ADR-070) ya aplicaron.

### Incluir `whatsapp_bot_engine.cpp`/`support_storage_pg.cpp` completos en el target de tests
Habría roto la premisa del target `beemetry_backend_tests` (ADR-060: lógica
pura, sin libpq/red) al arrastrar el pool de Postgres y el cliente TLS de
WhatsApp. Se extrajo la lógica de decisión pura (menú, firma) a módulos
aparte en vez de mockear DB/red dentro del target de tests existente.

## Evidencia y referencias

- `db_scripts/59_whatsapp_bot_reclamos.sql`
- `backend/src/support/whatsapp_client.hpp/.cpp` (extendido),
  `whatsapp_menu.hpp/.cpp`, `whatsapp_signature.hpp/.cpp`,
  `whatsapp_bot_engine.hpp/.cpp`, `whatsapp_webhook_routes.hpp/.cpp`,
  `support_storage_pg.hpp/.cpp`, `support_routes.cpp` (extendido)
- `backend/src/config/app_config.hpp/.cpp`, `.env.example` (variables
  `BEEMETRY_WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `_APP_SECRET`,
  `_COMERCIAL_TO_E164`)
- `backend/tests/test_whatsapp_bot_menu.cpp`,
  `test_whatsapp_webhook_signature.cpp`
- `frontend/.../ReportStudioV2/lib/documentTemplates.ts` (`docType`,
  `presentacion-resultados`, `presentacion-comercial`, `forceNewSlide`),
  `documentTemplates.presentation.test.ts` (nuevo, 9 casos)
- `frontend/.../ReportStudioV2/components/layout/RightInspector.tsx`,
  `components/support/SupportChatWidget.tsx` (insignia Word/PowerPoint)

**Build de verificación (2026-08-19)**: `backend/Dockerfile.verify` (GCC
13.3/Ubuntu 24.04, igual que ADR-060) — `beemetry_backend` y
`beemetry_backend_tests` compilan limpio con los 5 archivos nuevos
(`support_storage_pg.cpp`, `whatsapp_menu.cpp`, `whatsapp_bot_engine.cpp`,
`whatsapp_webhook_routes.cpp`, `whatsapp_signature.cpp`) y los 2 tests nuevos.
`ctest`: **100% tests passed, 0 failed** (1/1 — el target agrupa todo Catch2
en un solo caso de ctest, ver ADR-060). Corrida directa del binario con
reporte detallado (`-s -r compact`): **664 aserciones en 38 test cases,
todas passed** (incluye los 15 casos nuevos: 5 en
`test_whatsapp_webhook_signature.cpp`, resto en `test_whatsapp_bot_menu.cpp`).

**Frontend**: `npm run type-check` y `npm run build` sin errores; suite
`vitest` completa **56/56 tests passed** en 12 archivos (incluye
`documentTemplates.presentation.test.ts`, 9/9 nuevos, cubriendo
`layoutMode`, ausencia de índice, conteo de diapositivas, límites del lienzo
960×540 y sustitución de placeholders por respuestas reales).

**Simulación local end-to-end del webhook (2026-08-19)**: backend real
(binario de `Dockerfile.verify`) + Postgres real (TimescaleDB en contenedor,
con `db_scripts/01` a `59` aplicados en orden; solo 4 scripts pre-existentes
fallaron por dependencias no relacionadas con este ADR — `37`, `40`, `50`,
`51` — documentado como hallazgo aparte, no bloqueó nada de lo nuevo),
recibiendo `POST /api/support/whatsapp/webhook` con payloads con forma real
de Meta, firmados con HMAC-SHA256 real vía `openssl dgst`:
  - Handshake `GET` con `hub.verify_token` correcto → `200` + eco exacto de
    `hub.challenge`; token incorrecto → `403`.
  - Menú → *Soporte* (opción `1`) → 3 preguntas → `support_ticket` creado
    (`SOP-20260819-0002`, categoría/contacto/descripción/estado correctos) +
    `support_ticket_event` (`created`, actor `bot`) + intento real de
    notificación al número humano configurado (falló con `whatsapp_http_401`
    contra la Graph API real, por token dummy — **registrado en
    `whatsapp_message_log` con `send_ok:false`, sin romper la confirmación al
    usuario**, exactamente el comportamiento de degradación esperado).
  - Menú → *Reclamos* → *Nuevo* → `RCL-20260819-0003` generado; luego
    *Reclamos* → *Consultar* → mismo código → el bot respondió con
    estado/categoría/fecha correctos y volvió a `MENU_ROOT`.
  - `GET /api/support/tickets/RCL-20260819-0003` (sin sesión): `200` con el
    ticket completo; código inexistente: `404`.
  - `PUT /api/support/tickets/{code}/status` sin sesión: `401`.
  - Firma HMAC alterada/incorrecta en el `POST` del webhook: `403`, sin
    procesar el payload.
  - Cada turno completo quedó en `whatsapp_message_log` (9 filas para el
    flujo de soporte: 4 entrantes, 5 salientes incluida la notificación al
    humano) — verificado por consulta SQL directa, no solo por el código de
    respuesta HTTP.
- **Limitación que queda explícita**: no hay credenciales reales de Meta ni
  webhook expuesto a Internet en este entorno, así que la entrega real a un
  teléfono WhatsApp no se pudo verificar — todo lo demás (lógica del motor,
  esquema de BD, HTTP, seguridad de firma, RBAC) sí quedó verificado de
  punta a punta contra software real, no solo simulado en memoria.
