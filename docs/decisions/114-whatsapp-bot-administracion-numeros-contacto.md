# ADR-114 — Administración en caliente de los números de contacto del bot de WhatsApp

**Status**: implemented — tabla, allowlist, endpoints web, pantalla de
administración y rama conversacional `kMenuAdmin` en `handleInboundMessage`,
todos en producción (ver "Estado de implementación", actualizado 2026-08-19
tras cerrar el gap que esta misma versión del ADR documentaba como pendiente).

**Fecha**: 2026-08-19

**Autores**: EC

**Ámbito**: soporte

**Relación**: extiende el bot conversacional de ADR-112 y el multi-línea de
ADR-113 (`whatsapp_bot_engine.cpp`, `whatsapp_menu.cpp`, `support_storage_pg.hpp`,
`app_config.hpp/.cpp`); antecede a ADR-115 (agrega el tercer contacto `rrhh` al
mismo mecanismo).

## Nota de trazabilidad

Este archivo formaliza una decisión que ya estaba citada como `ADR-114` en 10
archivos del repositorio (`db_scripts/61_whatsapp_contact_numbers.sql`,
`backend/src/support/whatsapp_menu.hpp/.cpp`, `whatsapp_bot_engine.cpp`,
`backend/src/config/app_config.hpp`, `backend/src/support/support_routes.cpp`,
`backend/src/support/support_storage_pg.hpp`, `backend/tests/test_whatsapp_bot_menu.cpp`,
`frontend/src/App.tsx`, `frontend/.../WhatsappConfigView.tsx`) sin tener nunca
un archivo `.md` propio — el catálogo real de `docs/decisions/` terminaba en
`113-whatsapp-multilinea-enrutamiento-por-area.md`. Mismo patrón de brecha de
trazabilidad que este log ya cerró antes para ADR-079/082/089-091 (ver
`docs/decisions/README.md`): el código y los comentarios ya asumían la
decisión, solo faltaba el archivo.

## Contexto

Los números de escalamiento humano del bot (`SUPPORT_TO_E164`/`COMERCIAL_TO_E164`,
ADR-112) vivían únicamente en variables de entorno: cambiar el número de
soporte o comercial exigía editar el `.env` y redesplegar el backend. Para un
número que cambia por rotación de guardia, vacaciones o error de tipeo, ese
costo es desproporcionado frente a lo simple del cambio.

Se pidió un mecanismo para editar esos números **en caliente**, sin redeploy,
desde dos superficies: la plataforma web (para un administrador con sesión) y
el propio bot de WhatsApp (para quien no tiene acceso a la plataforma pero sí
un teléfono ya autorizado — p. ej. el responsable de soporte en campo).

## Decisión

### Tabla `whatsapp_contact_number` con fallback a la variable de entorno

`db_scripts/61_whatsapp_contact_numbers.sql` agrega
`whatsapp_contact_number(contact_key PRIMARY KEY, label, phone_e164, updated_at,
updated_by)`. `contact_key` es `'soporte'` o `'comercial'` (ampliado a `'rrhh'`
por ADR-115). Solo existen filas para las claves que alguna vez se editaron —
sin fila, el valor "de fábrica" sigue siendo la variable de entorno
correspondiente (`getContactNumberPg` en `support_storage_pg.cpp`, con
`effectiveContactNumber()` en `whatsapp_bot_engine.cpp` resolviendo el
fallback). Ningún despliegue existente se rompe por esta migración: sin uso
del panel ni del menú de administración, el comportamiento es idéntico al de
ADR-112/113.

### Allowlist de teléfonos, no login

WhatsApp no tiene sesión ni contraseña — la autorización para la opción
"Administración" del bot es una **lista de números permitidos**:
`BEEMETRY_WHATSAPP_ADMIN_TO_E164` (E.164 separados por coma) →
`AppConfig::gWhatsappAdminPhones` / `AppConfig::isWhatsappAdminPhone()`
(`app_config.hpp/.cpp`). Es el mismo criterio ya usado en el resto del bot: la
lista de destino de escalamiento (`SUPPORT_TO_E164`) también es una simple
variable de entorno, sin capa de autenticación adicional — aquí la lista hace
de mecanismo de autorización completo.

### Opción oculta en el menú, sin dígito publicado

`whatsapp_menu.cpp` agrega `kMenuAdmin` (`"menu_admin"`) a
`resolveRootMenuChoice()`, alcanzable solo por palabra clave
(`"admin"`/`"administracion"`/`"administración"`) — **a propósito sin dígito
asignado** ni mención en `menuRootBodyText()`: el menú numerado que ve
cualquier usuario no la anuncia, solo quien ya conoce la palabra clave llega
hasta ahí. La resolución del sub-menú de administración
(`resolveAdminMenuChoice()`, ids `kAdminContactSoporte`/`kAdminContactComercial`,
más `kAdminContactRrhh` agregado por ADR-115) es lógica pura sin acceso a
`AppConfig`/DB, mismo criterio de testabilidad que el resto de
`whatsapp_menu.cpp` (ADR-112) — cubierta por Catch2 en
`test_whatsapp_bot_menu.cpp`. La autorización real (contra
`gWhatsappAdminPhones`) es responsabilidad de `whatsapp_bot_engine.cpp`, que sí
tiene acceso a config — este módulo deliberadamente no la conoce.

### Endpoint web + pantalla dedicada

`GET /api/support/whatsapp/contact-numbers` y
`PUT /api/support/whatsapp/contact-numbers/{key}` (`support_routes.cpp`),
gateados por el permiso `soporte.manage` (mismo permiso que
`PUT .../tickets/{code}/status` de ADR-112). `WhatsappConfigView.tsx`
(`ReportStudioV2/components/views/`) consume ambos: lista soporte/comercial
con badge "Editado"/"Valor de fábrica" y fecha/autor del último cambio,
valida E.164 sin `+` (8–15 dígitos) antes de guardar. Mismo lenguaje visual
que `AlarmConfigView`/`PermissionsManagementView` (slate-900/950,
`font-black uppercase tracking-widest`, indigo-600 primario).

### Un solo destino de escritura para ambos caminos

`setContactNumberPg()` (`support_storage_pg.hpp/.cpp`) es el único punto de
escritura, con `updated_by` distinguiendo el origen: `"wa:<telefono>"` si vino
de la opción "Administración" del bot, o el `username` si vino de
`PUT .../contact-numbers/{key}`. Ambos caminos terminan en la misma fila —
editar desde la plataforma y desde el bot no pueden divergir en cuál es el
número vigente.

## Estado de implementación (verificado contra el código, 2026-08-19)

- **Construido y en uso**: la tabla (`db_scripts/61`), la allowlist
  (`gWhatsappAdminPhones`/`isWhatsappAdminPhone`), los endpoints REST
  (`support_routes.cpp`) y `WhatsappConfigView.tsx` — un administrador con
  sesión web ya puede editar soporte/comercial/rrhh. El **camino de lectura**
  también está conectado: `effectiveContactNumber()` en
  `whatsapp_bot_engine.cpp::outcomeForFlow()` usa el número editado (por el
  panel o por el bot) al notificar a un humano.
- **Gap cerrado (2026-08-19)**: `handleInboundMessage()` ahora sí compara
  `choice == kMenuAdmin` en la rama `MENU_ROOT` y, si `isWhatsappAdminPhone`
  autoriza el número, transiciona a un estado nuevo `ADMIN_MENU` (envía
  `sendAdminSubmenu`, resuelto con `resolveAdminMenuChoice` — ya existía y
  tenía cobertura Catch2, solo faltaba conectarlo) y de ahí a
  `ADMIN_EDIT_NUMBER` (`handleAdminEditNumberStep`, valida el teléfono nuevo y
  llama `setContactNumberPg` con `updated_by="wa:<telefono>"`). Un número NO
  autorizado que escribe "administracion" sigue sin recibir ninguna pista de
  que la opción existe (reenvío silencioso del menú raíz) — el
  comportamiento de ocultamiento que esta decisión pedía se mantiene intacto,
  solo se conectó el camino de quien SÍ está en la allowlist.
- La edición desde el propio bot de WhatsApp, tal como la anuncia esta
  decisión, es alcanzable en runtime desde ambos caminos (plataforma web y
  bot) para las tres claves `soporte`/`comercial`/`rrhh`.
- **Hallazgo de despliegue (2026-08-19)**: `BEEMETRY_WHATSAPP_ADMIN_TO_E164`
  (y `BEEMETRY_WHATSAPP_RRHH_TO_E164`, ADR-115) nunca estaban en el bloque
  `environment:` de `docker-compose.yml` para el servicio `web` — solo
  `SUPPORT_TO_E164`/`COMERCIAL_TO_E164` lo estaban. El contenedor arrancaba
  con `gWhatsappAdminPhones` vacío pese a tener el valor correcto en `.env`,
  así que la allowlist rechazaba SIEMPRE, incluso a un número legítimo.
  Confirmado en vivo: la primera corrida de la prueba E2E de este ADR (webhook
  simulado firmado, número real en la allowlist) cayó al menú genérico en vez
  de `ADMIN_MENU`, y `whatsapp_contact_number` quedó vacía tras el intento de
  edición. Se agregaron ambas líneas a `docker-compose.yml`; repetida la
  prueba, la edición completó y quedó persistida
  (`updated_by='wa:<telefono>'`).

## Consecuencias

### Positivas
- Cambiar un número de escalamiento deja de requerir editar `.env` y
  redesplegar — es una mutación de base de datos con auditoría de quién y
  cuándo (`updated_at`/`updated_by`).
- El fallback a la variable de entorno hace la migración transparente para
  cualquier despliegue existente: sin uso del panel/bot, cero cambio de
  comportamiento.
- La lógica de resolución de menú más sensible a errores silenciosos
  (`resolveAdminMenuChoice`) queda cubierta por test real sin depender de
  DB/red, mismo criterio que el resto de `whatsapp_menu.cpp`.

### Negativas / Trade-offs
- La autorización del bot es una allowlist de teléfonos en variable de
  entorno, no un mecanismo de identidad real (no hay MFA, no hay revocación
  instantánea salvo redeploy) — aceptable porque WhatsApp no ofrece un
  concepto de sesión autenticable, y porque el endpoint web (con sesión JWT
  real + RBAC) sigue siendo el camino recomendado para administración seria;
  el bot es el canal de emergencia.
- Doble chequeo de autorización en cada turno de `ADMIN_MENU`/`ADMIN_EDIT_NUMBER`
  (no solo al entrar): si el número sale de la allowlist a mitad de una
  edición en curso (redeploy que quita el teléfono de
  `BEEMETRY_WHATSAPP_ADMIN_TO_E164`), el turno siguiente lo devuelve al menú
  raíz en vez de dejarlo completar la edición con una autorización ya
  revocada.

### Neutras
- `WhatsappConfigView.tsx` (pantalla web) itera sobre las tres claves
  `soporte`/`comercial`/`rrhh` desde ADR-115; el bot ya las administra las
  tres por igual desde este ADR.

## Alternativas descartadas

### Exigir sesión web también para editar desde WhatsApp
Habría significado pedirle al administrador que abra la plataforma para un
cambio de un número — exactamente el costo que se pidió eliminar. Se aceptó
el trade-off de una allowlist más débil que RBAC+JWT a cambio de que el
camino de emergencia (bot) funcione sin sesión.

### Una tabla de configuración genérica clave-valor en vez de una tabla dedicada
Habría sido más flexible, pero sin tipado de columnas (`phone_e164`,
`updated_by`) ni comentario de esquema explícito — se prefirió una tabla
angosta y explícita, mismo criterio que otras tablas de configuración puntual
de este log (p. ej. `whatsapp_conversation` de ADR-112).

## Evidencia y referencias

- `db_scripts/61_whatsapp_contact_numbers.sql`
- `backend/src/config/app_config.hpp/.cpp` (`gWhatsappAdminPhones`,
  `isWhatsappAdminPhone`, `BEEMETRY_WHATSAPP_ADMIN_TO_E164`)
- `backend/src/support/whatsapp_menu.hpp/.cpp` (`kMenuAdmin`,
  `kAdminContactSoporte`, `kAdminContactComercial`, `resolveAdminMenuChoice`)
- `backend/src/support/whatsapp_bot_engine.cpp` (`effectiveContactNumber`,
  `outcomeForFlow` — camino de lectura conectado; `handleInboundMessage` —
  camino de escritura por bot, pendiente)
- `backend/src/support/support_storage_pg.hpp/.cpp` (`ContactNumberRecord`,
  `getContactNumberPg`/`listContactNumbersPg`/`setContactNumberPg`)
- `backend/src/support/support_routes.cpp` (`handleListContactNumbers`,
  `handleSetContactNumber`, RBAC `soporte.manage`)
- `frontend/.../ReportStudioV2/components/views/WhatsappConfigView.tsx`
- `backend/tests/test_whatsapp_bot_menu.cpp` (cobertura de
  `resolveRootMenuChoice`/`resolveAdminMenuChoice` para las opciones de
  administración)
