# ADR-116 — Persistencia del chat web (`support_chat_message`) y panel admin de búsqueda

> **Actualización 2026-08-20 (auditoría de trazabilidad ADR-103/106/112-120,
> ver `README.md`)**: el "Estado de implementación" de abajo quedó
> desactualizado — verificado por grep directo sobre el árbol de trabajo
> actual que el wiring pendiente **ya se cerró**:
> - `persistChatMessagePg` está conectado tanto en `backend/src/main.cpp`
>   (`handleChatStreamSse`, el dispatcher SSE) como en
>   `backend/src/support/support_routes.cpp` — el historial del chat web ya
>   se escribe en `support_chat_message`, no solo vive en memoria del
>   navegador.
> - `GET /api/support/admin/tickets` (`handleSearchTickets`) y
>   `GET /api/support/admin/chat-messages` (`handleSearchChatMessages`) están
>   registrados en `support_routes.cpp` y `searchTicketsPg`/el filtro de
>   mensajes correspondiente existen en `support_storage_pg.cpp`.
>
> El texto original de "Contexto"/"Decisión"/"Estado de implementación" no se
> edita (queda como registro histórico de lo que estaba pendiente al
> redactar el ADR); el **Status** efectivo pasa a **implemented**.

**Status**: accepted; esquema de datos aplicado, persistencia real y
endpoints de búsqueda todavía no implementados en el backend (ver "Estado de
implementación"). *(Superado por la actualización de arriba: 2026-08-20,
ambos ya implementados y verificados por lectura directa del código.)*

**Fecha**: 2026-08-19

**Autores**: EC

**Ámbito**: soporte

**Relación**: separa la persistencia del widget web de la del bot de WhatsApp
(ADR-112, `whatsapp_message_log`); consume la regla de autorización
`soporte.view`/`soporte.manage`/`department` de ADR-115; antecede a ADR-117
(agrega la columna `channel` a la misma tabla nueva de este ADR).

## Contexto

El chatbot IA del widget web (`SupportChatWidget.tsx`, servido por
`mining_chatbot_service.cpp::handleChatMessage`/`handleChatStreamSse`) nunca
persistió ningún mensaje: todo el historial de una conversación vivía
exclusivamente en el estado de React del navegador. Recargar la página, o
abrir el widget en otra pestaña, perdía el historial completo — y no existía
ninguna vía para auditar, buscar o revisar una conversación después del
hecho.

Tampoco existía ningún endpoint de búsqueda o filtro sobre tickets o
conversaciones de soporte. Esta es una deuda reconocida explícitamente por el
propio ADR-112, en su sección "Negativas / Trade-offs": *"No se agregó
pantalla de backoffice nueva para gestión de tickets; el endpoint
`PUT .../tickets/{code}/status` existe (...) pero la operación hoy se hace
por API/DB directa hasta que se justifique una UI dedicada."*

## Decisión

### Tabla nueva `support_chat_message`, no una generalización de `whatsapp_message_log`

`db_scripts/63_support_web_chat_message.sql` agrega
`support_chat_message(id, conversation_id, tenant_id, user_id, channel, role,
content, intent, created_at)`. Se evaluó explícitamente extender
`whatsapp_message_log` (la tabla de auditoría cruda del bot, ADR-112) para
cubrir también el chat web, y se descartó por incompatibilidad real de
esquema, no solo de gusto:

- `whatsapp_message_log` tiene `phone_e164`/`line_id`/`direction` como
  identidad **obligatoria** (`NOT NULL`) — un teléfono es la clave natural de
  una conversación de WhatsApp. El chat web no tiene teléfono: su identidad
  es un usuario autenticado de un tenant real (`tenant_id`/`user_id`, que
  `whatsapp_message_log` ni siquiera tiene como columnas).
- Su `payload jsonb` guarda el formato crudo de los mensajes de Meta
  (`interactive`/`template`/`text`, ver ADR-112) — el chat web solo tiene
  `role`/`content` de texto plano, sin esa estructura.

Forzar el mismo esquema habría significado columnas nullable a medias en una
tabla que hoy es, deliberadamente, un log de auditoría estricto — se prefirió
una tabla angosta y propia, mismo criterio de "no generalizar prematuramente"
que ADR-114 ya aplicó para no forzar una tabla de configuración genérica.

### `conversation_id`: agrupación de sesión, generada server-side si falta

`conversation_id` (`uuid`) agrupa los turnos de una misma sesión de widget.
Si el cliente no manda uno (primer turno), el servidor lo genera y lo
devuelve en la respuesta para que el frontend lo reenvíe en los turnos
siguientes — mismo patrón de "el servidor es la fuente de verdad del id de
sesión" que ya usa `whatsapp_conversation` (clave por teléfono+línea, ADR-113)
para el bot.

### Endpoints de búsqueda paginados, mismo patrón que `AuditFilter`

`GET /api/support/admin/tickets` y `GET /api/support/admin/chat-messages`
siguen el mismo patrón de paginación en SQL que `AuditFilter`/`fetchAuditPg`
(`backend/src/auth/auth_types.hpp`, `auth_storage_pg.cpp`), ya usado por
`GET /api/auth/audit` — filtros como parámetros de query, `LIMIT`/`OFFSET` (o
cursor) resueltos en la propia consulta SQL, no en memoria del backend. La
autorización de ambos sigue la regla de ADR-115: `soporte.view` o
`soporte.manage` sin restricción; con solo `department` seteado, el filtro de
categoría/canal se acota (o se rechaza con 403 si el caller pide una
categoría fuera de su departamento) — nunca se filtra en silencio.

## Estado de implementación (verificado contra el código, 2026-08-19)

- **Aplicado**: `db_scripts/63_support_web_chat_message.sql` — la tabla, sus
  índices (`(conversation_id, created_at)`, `(tenant_id, created_at DESC)`) y
  sus comentarios de esquema ya existen en base de datos.
- **Pendiente, verificado por grep directo sobre
  `backend/src/support/mining_chatbot_service.cpp` y `support_routes.cpp` al
  escribir este ADR**: ni `handleChatMessage()` ni la ruta SSE
  `handleChatStreamSse()` (`backend/src/main.cpp`, dispatcher de
  `POST /api/support/chat/stream`) insertan ninguna fila en
  `support_chat_message` — el historial del widget web sigue viviendo
  exclusivamente en memoria del navegador, exactamente como antes de este
  ADR. La tabla está lista para recibir escritura; nada la escribe todavía.
- **Pendiente**: no existe ninguna ruta `/api/support/admin/tickets` ni
  `/api/support/admin/chat-messages` registrada en `support_routes.cpp` ni en
  el dispatcher de `main.cpp` — el panel de búsqueda descrito en este ADR es,
  a la fecha de este documento, una decisión de diseño aceptada y no una
  superficie disponible.
- Se documenta este ADR en este estado (esquema aceptado, wiring pendiente)
  en vez de esperar a que la implementación esté completa porque el equipo
  de backend está construyendo esta pieza en paralelo a la redacción de este
  documento — mismo criterio que ADR-114/115: registrar la decisión ya
  tomada con su estado real verificado, no proyectar un estado futuro como si
  ya existiera.

## Consecuencias

### Positivas
- Una vez conectada la escritura, ningún mensaje del chat web vuelve a
  perderse por un refresh de página — mismo estándar de "nada al aire" que
  ADR-112 ya exigió para el bot de WhatsApp.
- La separación de `whatsapp_message_log` mantiene ambas tablas con una única
  responsabilidad clara (auditoría cruda por teléfono vs. historial de
  conversación por usuario/tenant autenticado), evitando el acoplamiento que
  habría forzado columnas nullable a medias.
- Reutilizar el patrón de paginación de `AuditFilter`/`fetchAuditPg` evita
  reinventar un mecanismo de filtro/paginación distinto para este endpoint.

### Negativas / Trade-offs
- Hasta que se cierre el wiring pendiente, el valor de este ADR es
  exclusivamente el del esquema de datos y la decisión de arquitectura — no
  hay todavía ninguna mejora observable para un usuario ni para un
  administrador.
- `support_chat_message.user_id`/`tenant_id` usan `ON DELETE SET NULL` — un
  historial de chat de un usuario eliminado (o tenant eliminado) sobrevive
  huérfano en vez de eliminarse en cascada. Decisión deliberada (mismo
  criterio de preservar auditoría que el resto del sistema), pero significa
  que "borrar un usuario" no borra su historial de chat.

### Neutras
- El `intent` (`chat`/`summarize`/`expand`/`ideas`, ver `ChatIntent` en
  `mining_chatbot_service.hpp`) se persiste como columna de texto libre, sin
  `CHECK` — a diferencia de `channel` (ADR-117), que sí lleva `CHECK`. La
  falta de restricción es deliberada: los intents del chatbot cambian con más
  frecuencia que los canales de origen y no justifican una migración de
  esquema por cada uno nuevo.

## Alternativas descartadas

### Generalizar `whatsapp_message_log` para cubrir también el chat web
Ver la sección "Decisión" arriba — incompatibilidad real de esquema
(identidad obligatoria por teléfono, payload en formato crudo de Meta), no
solo preferencia estilística. Descartado.

### Persistir el historial en el propio `localStorage` del navegador, cifrado
Resolvería la pérdida al recargar sin tocar el backend, pero no resuelve el
problema real pedido (auditoría/búsqueda server-side) y reintroduce el mismo
patrón de "estado sensible en el cliente" que ADR-029 ya corrigió para el
refresh token. Descartado sin necesidad de mayor análisis.

## Evidencia y referencias

- `db_scripts/63_support_web_chat_message.sql`
- `backend/src/support/mining_chatbot_service.cpp` (`handleChatMessage` —
  pendiente de persistencia)
- `backend/src/main.cpp` (`handleChatStreamSse`, dispatcher de
  `POST /api/support/chat/stream` — pendiente de persistencia)
- `backend/src/auth/auth_types.hpp` (`AuditFilter`), `auth_storage_pg.cpp`
  (`fetchAuditPg` — patrón de referencia para los endpoints pendientes)
- `backend/src/support/support_routes.cpp` (pendiente: `GET
  /api/support/admin/tickets`, `GET /api/support/admin/chat-messages`)
- ADR-112 (`whatsapp_message_log`, deuda original reconocida), ADR-115
  (regla de autorización `soporte.view`/`soporte.manage`/`department`)
