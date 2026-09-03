# ADR-135 — MFA/TOTP, alertas de seguridad y RUC obligatorio en bootstrap de admin

**Status**: implemented, verificado en vivo de punta a punta (API + navegador real, ver Verificación)
**Fecha**: 2026-08-27
**Autores**: EC
**Ámbito**: plataforma

> Continuación directa de [ADR-133](133-endurecimiento-post-red-team-csp-cookie-cross-site-validacion-entrada.md)/[ADR-134](134-fix-critico-escalada-privilegios-autoregistro-empresa-existente.md).
> Aquellos ADR cerraron el **robo/uso indebido de una sesión ya emitida** y la
> **toma de control de un tenant existente sin invitación**. Este ADR ataca un
> tercer ángulo, pedido explícitamente por el usuario ("máximo nivel de
> seguridad... sin forma que alguien tome el control de la plataforma"): la
> **toma de control de una cuenta legítima cuya contraseña se filtró, se
> adivinó o se robó por fuera de esta plataforma** (reutilización de
> contraseña, phishing, credential stuffing) — nada de lo hecho hasta ahora
> defendía contra ese escenario, porque contraseña correcta + cuenta real
> siempre bastaba para loguearse.

## Decisión

### 1. MFA/TOTP (RFC 6238) para cualquier cuenta, disponible opt-in

Nuevo módulo `backend/src/auth/totp.{hpp,cpp}`: HOTP/TOTP estándar
(HMAC-SHA1, 6 dígitos, ventana de 30s, tolerancia ±1 ventana por desfase de
reloj) — el mismo algoritmo que usa TODO authenticator app real (Google
Authenticator, Authy, Microsoft Authenticator, 1Password, Bitwarden...). Se
descartó deliberadamente cualquier variante propia (más dígitos, HMAC-SHA256)
porque rompería esa interoperabilidad sin ganar nada real a cambio.

**Columnas nuevas** (`db_scripts/81_mfa_totp.sql` + espejo en
`ensureAuthSchemaPg`): `auth_users.totp_secret` (Base32, en claro —
intrínseco al algoritmo, el servidor debe poder recomputar el código en cada
verificación), `totp_enabled` (bool, default false), `totp_enrolled_at`.

**Flujo de enrolamiento** (`backend/src/auth/mfa_routes.cpp`, autenticado,
opera solo sobre la cuenta propia):
- `POST /api/auth/mfa/enroll` — genera un secreto nuevo, lo guarda
  **pendiente** (`totp_enabled` sigue `false`), devuelve el secreto + la URI
  `otpauth://` para que el usuario lo ingrese en su authenticator (manual o
  vía QR que el frontend genere localmente a partir de esa URI).
- `POST /api/auth/mfa/verify-enroll` — el usuario manda el primer código real
  de su app; solo si es válido se marca `totp_enabled=true`. Sin este paso,
  un enrolamiento a medias (usuario cierra la pestaña antes de escanear)
  nunca deja la cuenta con un secreto "activo" que el usuario ni siquiera
  llegó a guardar — se habría bloqueado a sí mismo del login.
- `POST /api/auth/mfa/disable` — exige el código VIGENTE (prueba de posesión
  del segundo factor) antes de quitarlo. No basta con estar logueado: una
  sesión robada (ventana de 15 min, ADR-132) no debe poder desactivar el MFA
  de la víctima sin tener también su celular.
- `GET /api/auth/mfa/status` — consulta simple, para que el frontend sepa si
  mostrar "activar MFA" o "desactivar MFA".

**Gate de login** (`handleLoginPassword`/`handleLoginFace`, `main.cpp`): si
la cuenta tiene `totp_enabled`, el login NO emite sesión todavía tras
password/biometría correctos — devuelve `{"status":"mfa_required",
"mfa_token": "..."}`. El cliente completa con
`POST /api/auth/login/mfa {mfa_token, code}`.

**`mfa_token` es deliberadamente NO un JWT**: es un token opaco (32 bytes
aleatorios) en un mapa en memoria completamente separado del de sesiones
reales (`auth_session.cpp::gMfaPendingTokens`), TTL 5 minutos, uso único real
(se invalida solo tras un código CORRECTO — un typo en el código no fuerza
un re-login completo). Aunque alguien lo capturara, no hay forma de que
`resolveAuthSession`/`jwt::verify` lo acepten en ningún endpoint normal: su
único uso posible es ese único endpoint de segundo factor. Rate-limit propio
por `mfa_token` (no por cuenta) en `/api/auth/login/mfa`, y por `userId` en
`/enroll`/`disable` (5 intentos / 5 min, mismo criterio ya calibrado para
login por contraseña/biometría en este proyecto) — un código de 6 dígitos
(1 en 1,000,000 por ventana) necesita esta fricción o queda expuesto a
fuerza bruta apenas alguien ya tiene la contraseña.

**Deliberadamente OPT-IN, no obligatorio, en esta entrega**: forzar MFA de
inmediato habría bloqueado a TODO admin ya existente que no se enroló antes
del despliegue — una regresión de producción real, no una mejora de
seguridad. Queda como trabajo futuro (fuera de esta entrega) un flag tipo
`BEEMETRY_REQUIRE_MFA_FOR_ADMIN` que rechace el login de una cuenta admin sin
MFA activo, con aviso previo a los admins existentes antes de activarlo.

**Solo cubre el modo Postgres**: el modo File (dev/offline, sin Postgres) no
se extendió — es el fallback de desarrollo documentado en todo el proyecto,
nunca la ruta de producción real.

### 2. Alertas de seguridad (webhook genérico)

Nuevo `backend/src/security/security_alerts.{hpp,cpp}`:
`sendSecurityAlert(eventType, detail)` — si
`BEEMETRY_SECURITY_ALERT_WEBHOOK_URL` está configurada, hace un `POST` JSON
`{source, event, detail, timestamp}` a esa URL en un hilo separado
(fire-and-forget, timeout 5s) — un webhook lento o caído nunca agrega
latencia ni puede fallar la request real que disparó la alerta. Sin
configurar (default), es un no-op silencioso: no requiere credenciales para
desplegar el resto de este ADR.

Reutiliza `http_client::request` (ADR-103, ya usado para RP/TimeTelemetry),
en vez de un cuarto cliente HTTP propio.

Cableado en los 3 puntos de detección de ADR-133/134 que antes solo escribían
a `docker logs` — `[CSP_VIOLATION]`, `[CROSS_SITE_COOKIE_BLOCKED]`,
`[AUTH_REGISTER_ROLE_DOWNGRADED]` — más uno nuevo de este ADR,
`mfa_disabled` (cambio de postura de seguridad de una cuenta, vale la pena
que alguien se entere en el momento). Cualquier receptor HTTP simple sirve
como destino: un canal de Slack/Discord con webhook entrante, un bot de
Telegram con un bridge HTTP delante, o un endpoint propio.

### 3. RUC obligatorio para el bootstrap de admin de empresa NUEVA

El fix de ADR-134 fuerza `role: "viewer"` cuando la empresa YA tiene
usuarios, pero el bootstrap de admin de una empresa **nueva** seguía siendo
libre — legítimo (alguien tiene que ser el primer admin), pero "empresa
nueva" se decide por **igualdad exacta** de `company_name` (ADR-066):
`"Minera Raura "` (espacio) o una variante de mayúsculas/acentos cuenta como
"nueva" y permitía bootstrap de admin sobre lo que a simple vista parece la
misma empresa real — riesgo de typosquatting ya documentado como pendiente
en ADR-134.

Ahora, ese bootstrap de admin (`role: "admin"` + empresa genuinamente nueva)
exige además un `ruc` con dígito verificador matemáticamente válido para el
país declarado (`country`, nuevo campo opcional en el payload de registro,
default `"PE"`) — reutiliza `validateTaxIdChecksum`/`normalizeTaxId`
(`tax_id.hpp`), ya usado en el alta de empresa admin-driven, ahora también en
el autoregistro público. No es verificación contra un padrón fiscal real
(eso sigue sin existir para el autoregistro, ADR-102) — sube el costo de
"cualquier nombre parecido + cualquier dato" a "un RUC matemáticamente
válido", que ya no es trivial de teclear al azar.

## Consecuencias

### Positivas
- Cierra el escenario de "contraseña robada por fuera de la plataforma" para
  cualquier cuenta que active MFA — el más importante de los 4 frentes
  pedidos por el usuario en cuanto a "que nadie tome el control".
- Los 4 puntos de detección construidos en ADR-133/134/este ADR ahora pueden
  avisar a un humano en el momento, no solo quedar en un log que nadie mira.
- El bootstrap de admin de empresa nueva sube su costo de explotación sin
  romper el caso de uso legítimo (empresa real con RUC real).

### Negativas / Trade-offs
- MFA opt-in significa que una cuenta admin que NUNCA se enrola sigue
  exactamente igual de expuesta que antes de este ADR — es una mejora
  disponible, no una garantía automática. Requiere que el negocio decida
  cuándo (y si) forzarlo.
- El webhook de alertas depende de que alguien configure
  `BEEMETRY_SECURITY_ALERT_WEBHOOK_URL` — sin eso, los 4 eventos siguen solo
  en `docker logs`, exactamente como antes de este ADR.
- El RUC obligatorio en bootstrap sigue sin verificar contra un padrón fiscal
  real — un atacante con paciencia para calcular un RUC matemáticamente
  válido (no es difícil, el algoritmo es público) igual puede bootstrapear
  con un nombre parecido. Sube el costo, no lo elimina.

## Verificación (2026-08-27, en vivo)

Contra el stack real reconstruido y redesplegado:

1. **MFA end-to-end**: enrolado en una cuenta admin real (`beartest1554`) vía
   `/api/auth/mfa/enroll` + `/verify-enroll` con un código calculado
   localmente (HMAC-SHA1/RFC 6238, script Python independiente de la
   implementación del backend). Login posterior con password correcta →
   `{"status":"mfa_required","mfa_token":"..."}` (ya no autentica solo con
   password). Código incorrecto → `401`, mismo `mfa_token` sigue usable.
   Código correcto → sesión completa (`method:"password_mfa"`). **Repetido
   en el navegador real** (no solo curl): el modal de código apareció tras
   enviar el formulario de login, y `/api/auth/permissions` post-verificación
   devolvió la sesión real autenticada. `disable` con código incorrecto →
   `401`; con código correcto → `{"status":"disabled"}`, y el login
   siguiente vuelve a autenticar directo, sin pedir MFA.
2. **RUC en bootstrap**: empresa nueva + `role:"admin"` sin `ruc` → `400
   ruc_valido_requerido_para_admin_de_empresa_nueva`. Mismo caso con un RUC
   peruano matemáticamente válido (`20123456786`, dígito verificador
   calculado con el algoritmo módulo-11 de `tax_id.cpp`) → `201`, `role:
   "admin"` sin cambios.
3. **Webhook de alertas**: configurado contra un receptor HTTP local de
   prueba. Un registro que disparó `AUTH_REGISTER_ROLE_DOWNGRADED` y una
   desactivación de MFA llegaron al receptor con el payload JSON esperado
   (`source`, `event`, `detail`, `timestamp`) en ambos casos, sin agregar
   latencia perceptible a la respuesta real (fire-and-forget confirmado).

## Referencias
- `backend/src/auth/totp.{hpp,cpp}`, `mfa_routes.{hpp,cpp}`
- `backend/src/auth/auth_session.{hpp,cpp}` (`createMfaPendingToken`, `consumeMfaPendingToken`, `invalidateMfaPendingToken`)
- `backend/src/auth/auth_storage_pg.{hpp,cpp}` (`setPendingTotpSecretPg`, `getTotpStatusPg`, `enableTotpPg`, `disableTotpPg`)
- `backend/src/main.cpp` (`handleLoginMfa`, gates en `handleLoginPassword`/`handleLoginFace`, RUC en `POST /api/auth/register`)
- `backend/src/security/security_alerts.{hpp,cpp}`
- `db_scripts/81_mfa_totp.sql`
- [ADR-133](133-endurecimiento-post-red-team-csp-cookie-cross-site-validacion-entrada.md) / [ADR-134](134-fix-critico-escalada-privilegios-autoregistro-empresa-existente.md) (mismo ejercicio de endurecimiento)
- ADR-102 (validación de forma de identificadores tributarios, sin padrón real), ADR-103 (cliente HTTP compartido)
