# ADR-113 — WhatsApp multi-línea: enrutamiento por área vía `metadata.phone_number_id`

**Status**: implemented, verificado por build/tests (ver "Evidencia y referencias"); conexión de una segunda línea real pendiente de que el equipo registre el número adicional en la WABA de Meta.

**Fecha**: 2026-08-19

**Autores**: EC

**Ámbito**: soporte

**Relación**: extiende el bot conversacional de ADR-112 (`whatsapp_client.hpp`, `whatsapp_bot_engine.hpp`, `whatsapp_webhook_routes.hpp`, `support_storage_pg.hpp`, `db_scripts/59_whatsapp_bot_reclamos.sql`).

## Contexto

El bot de ADR-112 asume una sola línea de WhatsApp: un `phone_number_id`/
`access_token` fijos en `AppConfig`, un solo webhook, y `whatsapp_conversation`
con `phone_e164` como clave primaria única. "Soporte" y "Comercial" ya
existían como categorías del menú, pero solo como **números de destino
humano** (`SUPPORT_TO_E164`/`COMERCIAL_TO_E164`, vía link `wa.me/`) — no como
cuentas de WhatsApp con su propio número entrante y su propio bot.

Se pidió permitir conectar **varias cuentas de WhatsApp registradas** (área
de soporte, área comercial, "etc.") para que cada una reciba y responda
mensajes de forma independiente, en vez de que todo el tráfico entre por un
único número.

El payload de webhook que manda Meta ya trae la información necesaria para
esto y no se estaba usando: cada `entry[].changes[].value` incluye un objeto
`metadata` con el `phone_number_id` del número que recibió el mensaje. Con
una sola línea configurada da igual (solo hay un valor posible); con varias,
es la única forma de saber a cuál línea/área pertenece cada mensaje entrante.

## Decisión

### Config: lista de líneas, no un número fijo

`AppConfig` gana `WhatsappLine{id, phoneNumberId, accessToken, label}` y
`std::vector<WhatsappLine> gWhatsappLines`. La línea `"default"` se arma sola
a partir de `BEEMETRY_WHATSAPP_PHONE_NUMBER_ID`/`_ACCESS_TOKEN` (cero cambios
para un despliegue de una sola línea, compatibilidad total con ADR-112).
Líneas adicionales se declaran por id en `BEEMETRY_WHATSAPP_EXTRA_LINES`
(lista separada por comas) más un bloque `BEEMETRY_WHATSAPP_LINE_<ID>_*` por
cada una (`PHONE_NUMBER_ID`, `ACCESS_TOKEN`, `LABEL` opcional). `api_base_url`,
`api_version`, `app_secret` y el token de verificación del webhook siguen
siendo **globales**: una WABA/App de Meta puede tener varios números, pero
firma todos sus webhooks con el mismo app secret — no hay nada que duplicar
ahí.

### `whatsapp_client` recibe la línea explícita, no un global

Las 4 funciones de envío (`sendWhatsappTemplateMessage`,
`sendWhatsappTextMessage`, `sendWhatsappInteractiveListMessage`,
`sendWhatsappInteractiveButtonsMessage`) pasan a recibir
`const config::WhatsappLine &line` como primer parámetro en vez de leer
`gWhatsappPhoneNumberId`/`gWhatsappAccessToken` de `AppConfig` directamente.
Es el cambio que de verdad habilita multi-línea: sin esto, sin importar
cuántas líneas se configuraran, todo mensaje saliente seguiría emitiéndose
desde el mismo número fijo.

### El webhook resuelve la línea antes de despachar

`whatsapp_webhook_routes.cpp` agrega `resolveLineId()`: lee
`value.metadata.phone_number_id` y busca la línea configurada con ese id
(`AppConfig::whatsappLineByPhoneNumberId`). Si no coincide con ninguna
(línea nueva sin desplegar, o webhook mal configurado) cae a la línea por
defecto en vez de descartar el mensaje — mismo criterio de "nunca dejar al
usuario sin respuesta" que ya regía el menú (ADR-112). El id resuelto viaja
en el nuevo campo `InboundWhatsappMessage::lineId`.

### Conversación y auditoría escopadas por (teléfono, línea)

El mismo número de cliente puede escribirle al número de soporte y al
número comercial en momentos distintos, con estados de menú
independientes — así que `whatsapp_conversation` ya no puede tener
`phone_e164` como única clave. Se agrega `line_id` y la clave primaria pasa
a ser `(phone_e164, line_id)` (`db_scripts/60_whatsapp_bot_multilinea.sql`,
migración idempotente que no rompe filas existentes: `line_id` nuevo con
`DEFAULT 'default'`). `whatsapp_message_log` gana la misma columna, sin
cambiar su clave, para que la auditoría cruda registre por cuál línea entró
o salió cada mensaje. `getOrCreateConversationPg`/`saveConversationStatePg`/
`appendMessageLogPg` (`support_storage_pg.hpp/.cpp`) reciben `lineId` como
parámetro explícito.

### `whatsapp_bot_engine` propaga `line` en vez de leer un global

Cada función interna que ya enviaba mensajes (`sendText`, `sendRootMenu`,
`sendReclamosSubmenu`, los handlers de cada estado de la máquina) recibe
`const config::WhatsappLine &line` como parámetro adicional. `handleInboundMessage`
resuelve la línea una sola vez (`AppConfig::whatsappLineById(msg.lineId)`,
con fallback a una línea "vacía" si no existe — los envíos fallan igual que
hoy cuando falta configurar credenciales, sin crashear) y la pasa a todo el
resto del turno.

## Consecuencias

### Positivas
- Conectar una línea adicional (p. ej. "comercial") es 100% configuración
  (`BEEMETRY_WHATSAPP_EXTRA_LINES` + 3 variables) — cero cambio de código
  para agregar la n-ésima línea.
- Compatibilidad total con un despliegue de una sola línea: sin
  `BEEMETRY_WHATSAPP_EXTRA_LINES`, el comportamiento es idéntico al de
  ADR-112 (una sola línea "default").
- La auditoría (`whatsapp_message_log`) y el estado de conversación quedan
  correctamente aislados por línea — evita que una conversación de soporte
  y una comercial del mismo cliente se pisen entre sí.

### Negativas / Trade-offs
- No se agregó lógica para que cada línea muestre un menú distinto (p. ej.
  que la línea "soporte" salte directo al sub-flujo de soporte en vez de
  mostrar el menú completo) — hoy todas las líneas exponen el mismo menú de
  8 opciones; solo cambia por cuál número entra/sale la conversación. Es una
  decisión de producto (¿la línea de soporte solo debería hacer soporte, o
  también dejar pasar a comercial/reclamos?) que no vino especificada y se
  deja para una iteración futura si se necesita.
- El límite de números por WABA (2 sin verificación de empresa, 20 tras
  verificarla, ver informe de costos previo a este ADR) es de Meta, no de
  este código — no hay forma de evitarlo desde el backend.
- Sin credenciales reales de una segunda línea en este entorno, no se pudo
  verificar el enrutamiento end-to-end contra Meta (mismo trade-off ya
  documentado en ADR-112 para la línea única).

### Neutras
- `mining_chatbot_service.cpp` (escalamiento de un solo botón desde el
  widget web, independiente del bot de WhatsApp) sigue usando siempre la
  línea `"default"` vía `AppConfig::defaultWhatsappLine()` — no tiene
  selector de área, así que no había motivo para tocarlo más allá de pasar
  la línea explícita que ahora piden las funciones de `whatsapp_client`.

## Alternativas descartadas

### Una WABA/App de Meta separada por área en vez de varios números en la misma WABA
Meta permite ambas formas. Varios números bajo una sola WABA comparten app
secret/token de verificación de webhook y un solo endpoint de webhook — menos
configuración y menos superficie de despliegue que gestionar credenciales de
apps separadas por área, sin ninguna ventaja funcional para este caso. Se
descartó por complejidad innecesaria.

### Guardar el `phone_number_id` crudo de Meta en vez de un id corto interno
Usar el `phone_number_id` de Meta (un número largo) como clave en
`whatsapp_conversation`/`whatsapp_message_log` y como parámetro que viaja por
todo `whatsapp_bot_engine.cpp` funcionaría, pero acopla el esquema de datos y
los logs a un identificador externo opaco. Un id corto propio (`"soporte"`,
`"comercial"`) es legible en la base de datos y en los logs, y el mapeo a
`phone_number_id` real queda contenido en `AppConfig` — se descartó exponer
el id de Meta más allá de la resolución en el webhook.

## Evidencia y referencias

- `backend/src/config/app_config.hpp/.cpp` (`WhatsappLine`, `gWhatsappLines`,
  `whatsappLineByPhoneNumberId`/`whatsappLineById`/`defaultWhatsappLine`)
- `backend/src/support/whatsapp_client.hpp/.cpp` (línea explícita en las 4
  funciones de envío)
- `backend/src/support/whatsapp_webhook_routes.cpp` (`resolveLineId`)
- `backend/src/support/whatsapp_bot_engine.hpp/.cpp` (`InboundWhatsappMessage::lineId`,
  línea propagada por todo el turno)
- `backend/src/support/support_storage_pg.hpp/.cpp` (`ConversationRecord::lineId`,
  `lineId` en `getOrCreateConversationPg`/`saveConversationStatePg`/`appendMessageLogPg`)
- `backend/src/support/mining_chatbot_service.cpp` (usa `defaultWhatsappLine()`)
- `db_scripts/60_whatsapp_bot_multilinea.sql`
- `.env.example`, `docker-compose.yml` (`BEEMETRY_WHATSAPP_EXTRA_LINES` y
  bloques `BEEMETRY_WHATSAPP_LINE_<ID>_*` de ejemplo para `soporte`/`comercial`)
- Build de verificación: `backend/Dockerfile.verify` (mismo criterio que
  ADR-112) — ver resultado en la sesión que introdujo este ADR.
