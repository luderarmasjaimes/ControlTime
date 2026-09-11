# ADR-137 — Envío de informes a otros usuarios + API de notificaciones multi-canal

> **Actualización 2026-09-11 — causa completa del bloqueo del canal `sms`
> confirmada (ADR-168).** El developer confirma que sí existe una cuenta
> Twilio configurada, pero es la cuenta **trial gratuita** (documentada en
> `.env.example`): solo envía a números previamente verificados en la
> consola de Twilio y antepone *"Sent from your Twilio trial account -"* a
> cada mensaje — inutilizable para notificar a usuarios/clientes reales sin
> ese paso manual previo. Se requiere contratar una **cuenta Twilio de uso
> comercial** (o proveedor SMS equivalente) para que este canal sirva a la
> plataforma completa — decisión de compra/presupuesto de Gerencia, no de
> código: `backend/src/notify/sms_client.hpp` ya apunta a las mismas
> variables de entorno y no necesita cambios para usar una cuenta comercial.

**Status**: implemented, verificado E2E en vivo para 2/4 canales (2026-09-02); WhatsApp/SMS siguen bloqueados por infraestructura externa, no por código

**Fecha**: 2026-08-29

**Autores**: EC

**Ámbito**: reports, plataforma

> **Actualización 2026-09-02**: `POST /api/reports/{id}/share` probado en
> vivo contra `beemetry-api`/`beemetry-db` reales (informe real de Beemetry,
> destinatario `demo_beemetry_gerente`). Resultado real, por canal (`GET`
> directo a `notification_dispatch_log` después, no solo la respuesta HTTP):
> - **`in_app`**: `status=sent`, `log_id=13`, `recipient=<uuid del usuario>`.
>   Canal confirmado funcionando de punta a punta.
> - **`email`**: `status=sent`, `detail="smtp smtp.gmail.com:587"` — **había
>   SMTP real configurado en este entorno**, más de lo que se esperaba al
>   planificar esta verificación (se asumía bloqueado como WhatsApp/SMS).
>   Enviado a `demo_beemetry_gerente@example.invalid` (dominio reservado
>   RFC 2606, no resuelve a un destinatario real — sin riesgo de spam a una
>   persona real) — confirma que el código llega hasta el relay SMTP real y
>   lo acepta, no que un buzón real lo recibió (no verificable sin una
>   cuenta de correo real de prueba).
> - **`whatsapp`**: `status=failed`, `detail="sin_telefono"` — el usuario
>   demo usado no tiene teléfono cargado. Es un hallazgo de **dato faltante
>   en el seed**, no necesariamente de credenciales — no se confirmó si el
>   código llegaría a intentar la llamada real a la API de Meta (que sí
>   seguiría bloqueada por falta de credenciales de producción, ver
>   ADR-112/113).
> - **`sms`**: `status=failed`, `detail="sin_movil"` en esta prueba;
>   confirmado además con una fila histórica del log (`log_id=4`,
>   2026-08-29, un usuario que SÍ tenía teléfono) con
>   `detail="sms_no_configurado"` — a diferencia de WhatsApp, este SÍ está
>   confirmado como genuinamente sin proveedor configurado, no solo dato
>   faltante.
>
> Sube de "0/4 verificado" a "2/4 verificado en vivo, 1 con causa de
> infraestructura confirmada (sms), 1 con causa de dato de prueba, no de
> infraestructura (whatsapp)". El pendiente de `/api/notifications/send`
> filtrando por `company_name` en vez de `tenant_id` (ver texto original más
> abajo) sigue sin resolverse — fuera de alcance de esta verificación.

**Relación**: extiende ADR-079 (RBAC de workflow de informes), ADR-039 (tenant_id
como clave de aislamiento), ADR-112/113/114 (infraestructura WhatsApp ya
existente); antecede una futura ADR de "notificaciones fuera de la
plataforma" si se decide aceptar destinatarios no registrados.

> Encontrado durante esta auditoría (2026-08-30, a pedido explícito del
> developer de cerrar ADR pendientes de generación): el código ya llevaba el
> comentario `// ADR pendiente` en `report_routes.cpp` señalando su propia
> falta de decisión formal. Este ADR la formaliza — no es trabajo nuevo de
> esta sesión, es documentación retroactiva de una feature ya implementada,
> commiteable y verificada por build el 2026-08-29.

## Contexto

`ShareReportModal.tsx` existía en el frontend desde antes, pero
`shareReportAsync()` (`reportsStorage.ts`) era un mock puro: un
`setTimeout` que devolvía `true` sin tocar el backend, sin persistir nada y
sin notificar a nadie. La tabla `report_shares` (`db_scripts/05_reports_admin.sql`)
llevaba tiempo existiendo sin ningún endpoint que la usara.

De paso, al instrumentar `report_service.cpp` para esta feature se encontró
un bug real independiente: `reports.created_by`/`last_modified_by`/
`reviewed_by` (columnas de `05_reports_admin.sql`) nunca se llenaban ni se
leían en las consultas (`listReportsPg`/`getReportByIdPg`). Como
`ReportsAdminModal.tsx::canEdit()` compara `report.createdBy` contra
`session.username`, el propio autor de un borrador **nunca** podía
reabrirlo para editar — solo un usuario con `informes.sign` (permiso de
aprobación/firma, no de autoría) podía. Cerrado en el mismo cambio que lo
detectó (mismo criterio que ADR-063/079/093 de este log).

## Decisión

### 1. `notify/` — servicio de notificación multi-canal reutilizable

Módulo nuevo (`backend/src/notify/notify_service.{hpp,cpp}`,
`notify_routes.{hpp,cpp}`), no acoplado a informes: `notify::dispatch()`
recibe un `NotifyRequest` (destinatario resuelto a `auth_users.id`, título,
cuerpo, lista de canales) y despacha por `in_app`/`email`/`whatsapp`/`sms`.
Cada canal es independiente y best-effort (uno caído no bloquea los demás
— mismo criterio que `mining_iot::dispatch` de alarmas). El canal `email`
reutiliza `alarm_notifier.cpp::sendEmail` (expuesto ahora como
`sendPlainEmail()`) en vez de duplicar la lógica SMTP. Todo intento (éxito
o fallo) se traza en `notification_dispatch_log`
(`db_scripts/86_report_notifications_dispatch.sql`), tabla separada de
`notification_log` de alarmas porque esa exige `alarm_id` y esta no tiene
alarma detrás.

### 2. `POST /api/notifications/send` — API genérica

Ruta pública para cualquier app de la empresa (otro frontend, una app
móvil), misma convención de auth que el resto de integradores externos
(`docs/integration/EXTERNAL_FRONTEND_AUTH.md`) — sin API-key nueva. Gateada
por el permiso nuevo `notificaciones.send`. **El destinatario SIEMPRE se
resuelve server-side contra `auth_users` por `user_id`** — el body nunca
puede traer un email/teléfono arbitrario, exactamente para no convertir la
ruta en un relay de spam.

### 3. `POST /api/reports/{id}/share` — primer consumidor real

Reemplaza el mock: valida `informes.share`, resuelve el informe por
`getReportByIdPg` (ya con guardia de tenant), inserta en `report_shares` y
llama a `notify::dispatch()` con `sourceApp="reports"`,
`relatedType="report"`. Mensaje limitado a 2000 bytes (margen UTF-8 sobre
el límite de 500 caracteres del textarea del cliente) — se **rechaza** en
vez de truncar a ciegas, porque cortar un `std::string` en un byte
arbitrario puede caer en medio de un carácter multibyte y producir bytes
inválidos que Postgres rechaza en el `INSERT`.

### 4. Permisos nuevos

`informes.share` y `notificaciones.send`, seedeados a
`admin`/`manager`/`supervisor`/`geologist`/`safety`/`operator` (mismo
criterio que `informes.view`/`informes.edit`: todo rol que puede VER
informes puede compartirlos, salvo `viewer`, de solo lectura).

### 5. Fix de bug real: `created_by`/`reviewed_by`/`last_modified_by` en reports

`createReportPg`/`updateReportPg` ahora sí escriben esas columnas;
`listReportsPg`/`getReportByIdPg` las leen con `LEFT JOIN auth_users` para
resolver nombre completo. Backfill (`db_scripts/86`, sección 1) reconstruye
el autor real de informes preexistentes desde
`report_content_revision.created_by` de la versión 1 (única fuente que sí
registró autoría desde el principio) — sin el backfill, los informes ya
existentes seguirían bloqueados para su dueño real después de desplegar
el fix.

## Consecuencias

### Positivas
- El botón "Compartir" del editor deja de ser un mock — persiste y notifica
  de verdad, con traza completa por canal en `notification_dispatch_log`.
- `notify::dispatch()` es reutilizable por cualquier módulo futuro que
  necesite notificar (no quedó acoplado a informes).
- El bug de `canEdit()` bloqueando al propio autor queda cerrado, con
  backfill para no dejar informes preexistentes huérfanos de autoría.

### Negativas / Trade-offs
- 4 canales, 0 probados end-to-end contra un proveedor real en esta sesión
  (SMTP/WhatsApp/SMS todavía dependen de credenciales de entorno que no se
  ejercitaron aquí) — ver Verificación.
- Acoplar el canal `sms` a `recipientMobileE164` con fallback a
  `recipientPhoneE164` asume que todo usuario con teléfono puede recibir
  SMS igual que WhatsApp; no hay proveedor SMS real integrado todavía (el
  canal existe en el contrato de `dispatch()`, no necesariamente en una
  integración operativa — no verificado en esta pasada).

## Pendiente (explícito, no asumido como cerrado)

1. **Guardia de aislamiento de `POST /api/notifications/send` usa
   `company_name`, no `tenant_id`** (`WHERE id = $1::uuid AND company_name =
   $2`, comparando contra `session->company`). ADR-039 estableció
   `tenant_id` como la única clave de aislamiento autoritativa y
   `company_name` como display legacy — usar `company_name` acá para un
   guardia de seguridad real (a quién se le puede notificar) es una
   posible divergencia de ese criterio. **No se resuelve unilateralmente
   en esta pasada** porque ADR-130 (acceso cruzado empresa
   minera/organización, 2026-08-23) acaba de introducir deliberadamente el
   caso donde un usuario pertenece a más de un tenant bajo la misma sesión
   — es plausible que restringir por `company_name` sea una elección
   consciente MÁS estricta que `tenant_id` para evitar que notificaciones
   crucen hacia usuarios con acceso cruzado que no son, en sentido
   estricto, "de la misma empresa". Requiere una decisión explícita de
   quien mantiene ADR-130/039, no una corrección de código a ciegas.
2. Prueba E2E real de los 4 canales contra proveedores configurados
   (SMTP real, WhatsApp Business API, un proveedor SMS todavía sin
   decidir).
3. `tts_from_notes` sin proveedor TTS integrado sigue siendo el mismo
   diferido ya declarado en ADR-084 — no es un pendiente nuevo de este ADR,
   se menciona en el código (`report_export_jobs.hpp`) por cercanía de
   dominio (narración de export), no por relación funcional con este.

## Verificación

- **Build**: `docker build -f backend/Dockerfile.verify -t
  beemetry-backend-verify backend` — compila limpio incluyendo
  `notify_service.cpp`, `notify_routes.cpp`, y los cambios de
  `report_service.cpp`/`report_routes.cpp`/`alarm_notifier.cpp`. CTest
  1/1 passed.
- **Migración**: `db_scripts/86_report_notifications_dispatch.sql` no
  verificada contra la base en ejecución en esta pasada (ver nota de
  memoria del proyecto: los scripts `db_scripts/` 30+ requieren aplicación
  manual vía `psql`, no se autoaplican al reiniciar el contenedor).
- No se probó `POST /api/reports/{id}/share` ni `POST
  /api/notifications/send` contra el stack real en esta pasada — la
  verificación se limitó a compilación y lectura de código; falta la
  prueba en vivo antes de anunciar la feature como lista para uso real.

## Alternativas descartadas

- **Acoplar el envío de informes directamente al canal WhatsApp existente
  de soporte (ADR-112)**: descartado — ese módulo es para conversaciones
  entrantes de clientes externos vía Meta Business API, un dominio
  completamente distinto de "notificar a un colega interno que le
  compartieron un informe".
- **Aceptar email/teléfono arbitrario en el body de `/notifications/send`**:
  descartado explícitamente por riesgo de relay de spam — ver código,
  comentario inline.

## Referencias

- `backend/src/notify/notify_service.{hpp,cpp}`, `notify_routes.{hpp,cpp}`
- `backend/src/reports/report_routes.cpp` (`POST /api/reports/{id}/share`)
- `backend/src/reports/report_service.cpp` (`created_by`/`reviewed_by`/`last_modified_by`)
- `backend/src/mining/alarm_notifier.cpp` (`sendPlainEmail`, reutilizado)
- `db_scripts/86_report_notifications_dispatch.sql`
- `frontend/src/components/ReportStudioV2/components/modals/ShareReportModal.tsx`
- `frontend/src/components/ReportStudioV2/lib/reportsStorage.ts` (`shareReportAsync`)
- ADR-039 (tenant_id como clave de aislamiento), ADR-079 (RBAC de workflow de informes), ADR-130 (acceso cruzado empresa minera/organización)
