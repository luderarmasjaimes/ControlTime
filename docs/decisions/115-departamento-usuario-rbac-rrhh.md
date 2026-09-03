# ADR-115 — Departamento de usuario + RRHH como quinta categoría de soporte

> **Actualización 2026-08-30 (auditoría de trazabilidad, ver `README.md`)**:
> verificado por grep directo sobre el código real que los 3 pendientes que
> este ADR dejó documentados el 2026-08-19 (ver "Estado de implementación"
> original abajo, sin editar) **ya están cerrados**, en un cambio posterior
> a la fecha de este ADR que nunca actualizó su estado: (1)
> `whatsapp_bot_engine.cpp` ahora sí maneja `rrhh`/`kMenuRrhh` de punta a
> punta (`choice == kMenuRrhh` en `handleInboundMessage`,
> `startCollectingFlow(..., "rrhh")`, resolución de contacto y flow
> questions) — la opción 8 del menú ya es funcional, no solo visible. (2)
> `handleUpdateTicketStatus` y `handleSetContactNumber`
> (`support_routes.cpp`) ya implementan la alternativa "permiso global O
> `department == category`" descrita en la Decisión de este ADR, con
> comentario inline citando `ADR-115` explícitamente. (3) Los endpoints de
> búsqueda de tickets/chat de ADR-116 ya distinguen `soporte.view` de
> `soporte.manage` en su chequeo de autorización. El frontend
> `SupportAdminView.tsx` también aplica el filtro `isDepartmentScoped`
> correctamente. **Hallazgo nuevo, cerrado en la misma pasada** (mismo
> criterio de ADR-063/079/093/137 de este log): `handleListContactNumbers`
> (`GET`, lista los 3 números de contacto) seguía exigiendo
> `soporte.manage` estricto sin la alternativa `soporte.view`/`department`
> que sí tenían sus contrapartes de escritura — un agente de RRHH con
> `department` seteado podía EDITAR su número de contacto vía
> `handleSetContactNumber` pero no podía VERLO primero vía
> `handleListContactNumbers`. Corregido: ahora acepta `soporte.view` O
> `department == key` (devolviendo solo la fila del departamento propio si
> no hay permiso global) — build verificado limpio (`Dockerfile.verify`,
> CTest 1/1). Este ADR sube de `accepted` a `implemented` — no quedan
> pendientes de código conocidos; solo la prueba E2E de punta a punta contra
> WhatsApp Business real (bloqueada por credenciales de producción de Meta,
> mismo bloqueo que ADR-112/113/129).

**Status**: implemented (2026-08-30, ver actualización arriba); esquema de datos y capa RBAC
implementados y aplicados, wiring del bot/panel admin cerrado — pendiente solo prueba E2E con
WhatsApp Business real (credenciales de producción de Meta).

**Fecha**: 2026-08-19

**Autores**: EC

**Ámbito**: soporte, plataforma

**Relación**: extiende el bot de ADR-112/114 (nueva categoría de menú/ticket) y
el RBAC multitenant de ADR-029/036 (nuevo permiso `soporte.view`, nuevo campo
por usuario); antecede a ADR-116 (el panel admin de búsqueda de tickets que
usa `department` para segmentar todavía no existe como endpoint).

## Contexto

Hasta esta decisión, "departamento" no existía como concepto en ningún lado
del sistema. Las categorías de ticket de soporte eran
`soporte`/`comercial`/`reclamo`/`agenda` (ADR-112); los roles RBAC eran
`admin`/`manager`/`supervisor`/`geologist`/`safety`/`operator`/`viewer`
(ADR-036) — ninguno modela a qué área de la empresa pertenece un usuario, solo
qué puede hacer. Cualquiera con el permiso `soporte.manage` veía y gestionaba
absolutamente todo el tráfico de soporte, sin segmentación.

El usuario final pidió dos cosas relacionadas: (1) agregar Recursos Humanos
como quinto departamento, con el mismo patrón que los cuatro existentes
(categoría de ticket propia + opción en el menú del bot + número de contacto
configurable vía ADR-114); y (2) que el futuro panel de administración de
búsqueda de tickets/conversaciones (ADR-116) segmente por departamento — un
agente de RRHH debe poder ver y gestionar sus propios casos sin que eso le dé
visibilidad sobre soporte técnico, comercial o reclamos, y sin necesitar el
permiso global `soporte.manage`.

## Decisión

### `rrhh` como quinta categoría, mismo patrón que las cuatro existentes

`db_scripts/62_support_departments_rrhh.sql` agrega `'rrhh'` al `CHECK` de
`support_ticket.category` y a `generate_support_ticket_code()` (prefijo
`RRH-YYYYMMDD-NNNN`, mismo generador por secuencia que
`SOP`/`COM`/`RCL`/`AGE`). En el bot, `whatsapp_menu.cpp` gana `kMenuRrhh`
(`"8"`/`"rrhh"`/`"recursos humanos"`, con dígito publicado en
`menuRootBodyText()` — a diferencia de `kMenuAdmin` de ADR-114, este sí es una
opción visible del menú principal) y `kAdminContactRrhh` en
`resolveAdminMenuChoice()` (tercera opción del sub-menú de administración).
`AppConfig` gana `gWhatsappRrhhToE164` (`BEEMETRY_WHATSAPP_RRHH_TO_E164`), el
mismo patrón que `gWhatsappSupportToE164`/`gWhatsappComercialToE164`. La
tabla `whatsapp_contact_number` de ADR-114 acepta `'rrhh'` como tercer
`contact_key` sin cambio de esquema — ya era una tabla de filas libres por
clave, no columnas fijas.

### `auth_user_tenant.department`: departamento del agente, no un rol nuevo

Se agrega la columna `department` (nullable, `CHECK` contra los mismos 5
valores de categoría) a `auth_user_tenant` — mismo patrón que ya usa esa
tabla para `role` por tenant (`db_scripts/42`). Se modela como atributo del
agente, no como un octavo rol RBAC: un usuario sigue teniendo un rol
(`operator`, `supervisor`, etc.) que determina QUÉ puede hacer en la
plataforma en general, y opcionalmente un `department` que acota A QUÉ
categoría de soporte queda restringido cuando ese acotamiento aplica (ver
regla de autorización abajo). `admin`/`manager`/`supervisor` no llevan
`department` seteado por defecto — ya tienen los permisos globales
(`soporte.view`/`soporte.manage`) y ven todo; para ellos no cambia nada.

### `soporte.view`: permiso de solo lectura, separado de `soporte.manage`

Nuevo permiso `soporte.view` (`platform_permissions`), otorgado por defecto a
`admin`/`manager`/`supervisor` (`role_permissions`, `tenant_id NULL` =
default global, mismo mecanismo de override por tenant de ADR-042).
`soporte.manage` (ADR-112) sigue siendo el único permiso que gatea mutaciones
— cambiar estado de un ticket, editar un número de contacto. `soporte.view`
solo habilita lectura/búsqueda (el panel admin de ADR-116). Separarlos permite
dar visibilidad de solo-lectura sin también otorgar la capacidad de mutar
configuración operativa sensible (números de escalamiento humano).

### Regla de autorización: view/manage globales, o departamento propio — nunca ambigua

`auth::effectiveDepartment(userId, tenantId)` (`permissions.hpp/.cpp`) resuelve
el departamento efectivo del usuario en el tenant (`std::nullopt` = sin
restricción de departamento). La regla que gobierna cualquier endpoint de
soporte que filtre por categoría:

- `soporte.view` o `soporte.manage` → sin restricción, ve/gestiona todas las
  categorías (comportamiento actual, sin cambios para quien ya tenía el
  permiso global).
- Sin ninguno de los dos permisos globales, pero con `department` seteado →
  el usuario puede operar SOLO sobre esa categoría. Un filtro de categoría
  pedido explícitamente (query param, o el propio código de ticket) que no
  coincida con el `department` del usuario se **rechaza con 403** — nunca se
  ignora silenciosamente ni se reinterpreta a favor del usuario. Esto es
  deliberado: un 403 explícito es auditable y comprensible; un filtro
  ignorado en silencio dejaría a un agente de RRHH sin saber si "no hay
  resultados" significa "no hay tickets" o "no tienes permiso para verlos".
- Sin ninguno de los dos permisos y sin `department` → sin acceso, mismo
  comportamiento que antes de este ADR.

`PUT /api/support/tickets/{code}/status` (ADR-112) y los endpoints de números
de contacto de ADR-114 amplían su autorización para aceptar
`department == category` del ticket/contacto como alternativa a
`soporte.manage` — así un agente de RRHH puede cerrar sus propios tickets y
editar el número de contacto de RRHH sin que eso requiera el permiso global
que también le daría acceso a mutar soporte/comercial/reclamos.

## Estado de implementación (verificado contra el código, 2026-08-19)

- **Aplicado**: `db_scripts/62_support_departments_rrhh.sql` (categoría
  `rrhh`, columna `department`, permiso `soporte.view` seedeado a
  `admin`/`manager`/`supervisor`).
- **Construido**: `auth::effectiveDepartment()` (`permissions.hpp/.cpp`);
  `whatsapp_menu.cpp/.hpp` con `kMenuRrhh`/`kAdminContactRrhh` ya integrados en
  `resolveRootMenuChoice()`/`resolveAdminMenuChoice()`/`menuRootBodyText()`,
  con cobertura Catch2 real (`test_whatsapp_bot_menu.cpp`,
  `REQUIRE(resolveRootMenuChoice("8") == kMenuRrhh)` y equivalentes);
  `AppConfig::gWhatsappRrhhToE164`.
- **Pendiente, verificado por grep directo sobre
  `backend/src/support/whatsapp_bot_engine.cpp` al escribir este ADR**: el
  motor del bot no tiene ninguna referencia a `rrhh`/`kMenuRrhh` — ni
  `outcomeForFlow()` ni `humanFlowLabel()` ni la rama `conv.state ==
  "MENU_ROOT"` de `handleInboundMessage()` la contemplan todavía. Un usuario
  que elige la opción 8 en el menú real hoy cae al mismo `else` de "opción no
  reconocida" que cualquier entrada inválida. La opción SÍ aparece en el texto
  del menú (`menuRootBodyText()` ya la anuncia como "8. 🧑‍💼 Recursos
  Humanos") pero todavía no es funcional de punta a punta — es una
  discrepancia activa entre lo que el usuario ve y lo que el motor procesa,
  que debe cerrarse antes de anunciar esta opción como disponible en
  producción.
- **Pendiente**: `auth::hasPermission()` (`permissions.cpp`) todavía no
  distingue `soporte.view` de un chequeo de permiso genérico ni implementa la
  regla de "permiso global O departamento propio" descrita arriba;
  `handleUpdateTicketStatus()` y los handlers de `contact-numbers` en
  `support_routes.cpp` siguen exigiendo `soporte.manage` estricto, sin la
  alternativa `department == category`. La tabla/columna/permiso ya existen
  en base de datos; la lógica de autorización que los consume todavía no.
- Esto es trabajo en curso en el mismo esfuerzo que cierra el gap de ADR-114
  (`ADMIN_MENU`) — ambos comparten el mismo punto de integración
  (`handleInboundMessage`) y se documentan aquí con su estado real, no como
  "ya resuelto", siguiendo el mismo criterio de honestidad de estado que el
  resto de este log (ver `docs/decisions/README.md`, hallazgos de ADR-074/079/
  083 sobre "el ADR afirmando algo que el código no hacía todavía").

## Consecuencias

### Positivas
- RRHH gana el mismo tratamiento de primera clase que las cuatro categorías
  existentes (código de seguimiento propio, número de contacto configurable,
  opción de menú) sin duplicar ningún mecanismo — reutiliza `support_ticket`,
  `generate_support_ticket_code`, `whatsapp_contact_number`.
- La segmentación por departamento es aditiva y estrictamente más restrictiva
  que el estado anterior: nadie pierde acceso que ya tenía (`admin`/`manager`/
  `supervisor` no llevan `department`, siguen viendo todo vía `soporte.view`/
  `soporte.manage`); solo un usuario nuevo con `department` seteado y sin
  permiso global queda acotado.
- La regla "403 explícito, nunca filtro ignorado" hace la restricción
  auditable y depurable — un agente de RRHH que reciba 403 sabe exactamente
  por qué, en vez de una lista vacía ambigua.

### Negativas / Trade-offs
- Como se documenta en "Estado de implementación", la opción RRHH ya es
  visible en el menú del bot antes de que el motor la procese — riesgo real
  de confundir a un usuario que la elige y recibe una respuesta genérica. No
  se debe considerar esta feature lista para anunciar externamente hasta que
  se cierre `handleInboundMessage`.
- `department` es un solo valor por (usuario, tenant) — un agente que
  atienda dos departamentos (p. ej. RRHH y comercial) no está soportado sin
  el permiso global; se aceptó esa limitación por ahora, sin especificación
  de un modelo de "múltiples departamentos" pedida por el usuario final.

### Neutras
- No se modela `department` como parte de las claims del JWT (ADR-029) — se
  resuelve en cada request contra `auth_user_tenant`, mismo criterio
  sin-caché que `effectiveRole()` (documentado en el propio
  `permissions.hpp`: "los permisos cambian rara vez y la consulta es trivial
  sobre índices").

## Alternativas descartadas

### Un octavo rol RBAC (`rrhh_agent`) en vez de un campo `department`
Habría mezclado dos ejes distintos — "qué puede hacer" (rol) y "sobre qué
área" (departamento) — en una sola dimensión, forzando combinaciones
absurdas (¿un `rrhh_agent` con permisos de `supervisor`?). Se prefirió
mantenerlos ortogonales: cualquier rol puede opcionalmente llevar un
`department`.

### Ignorar en silencio un filtro de categoría fuera del departamento del usuario
Devolver una lista vacía o filtrar transparentemente al departamento propio
sin avisar parecía más "amigable", pero oculta la causa real (falta de
permiso) detrás de un resultado ambiguo — se prefirió el 403 explícito,
mismo criterio de "nunca fallar en silencio" que ya rige el resto de este
sistema (p. ej. el fallback nunca-silencioso de números de contacto en
ADR-114, o el `403 csrf_token_mismatch` explícito de ADR-029).

## Evidencia y referencias

- `db_scripts/62_support_departments_rrhh.sql`
- `backend/src/auth/permissions.hpp/.cpp` (`effectiveDepartment`, pendiente:
  integración en `hasPermission`)
- `backend/src/support/whatsapp_menu.hpp/.cpp` (`kMenuRrhh`,
  `kAdminContactRrhh`, `menuRootBodyText`)
- `backend/src/config/app_config.hpp/.cpp` (`gWhatsappRrhhToE164`,
  `BEEMETRY_WHATSAPP_RRHH_TO_E164`)
- `backend/tests/test_whatsapp_bot_menu.cpp` (cobertura de la opción 8/rrhh)
- `backend/src/support/whatsapp_bot_engine.cpp` (pendiente: `outcomeForFlow`,
  `humanFlowLabel`, rama `MENU_ROOT` de `handleInboundMessage`)
- `backend/src/support/support_routes.cpp` (pendiente: alternativa
  `department == category` en `handleUpdateTicketStatus` y en los handlers de
  `contact-numbers`)
- ADR-112 (categorías de ticket originales), ADR-114 (números de contacto
  editables, mecanismo que RRHH reutiliza)
