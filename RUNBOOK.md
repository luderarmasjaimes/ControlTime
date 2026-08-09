# Runbook de despliegue — Beemetry / AURIXA v0.1 (borrador)

Insumo para que el equipo decida fecha/alcance de GO-LIVE — no es una
autorización de release. Ver `CHANGELOG.md` para el detalle de cambios y
`GAP_ANALYSIS_2026-07-04.md` para la evidencia de cada fix.

## 1. Estado de los hallazgos originales

| # | Hallazgo | Estado |
|---|---|---|
| 1 | Serializar cover/toc a JSON | ✅ Resuelto y verificado |
| 2 | Persistir layout Konva (x/y/width/height) | ✅ Ya existía, confirmado |
| 3 | Alinear workflow states | ✅ Resuelto y verificado (SQL+backend+frontend+E2E) |
| 4 | IDOR en endpoints de auditoría/mantenimiento de usuarios | ✅ Resuelto y verificado (ataque real) |
| 5 | Activar hypertables TimescaleDB | ✅ Resuelto y verificado (integridad byte a byte) |
| 6 | Auditoría 100% append-only | ✅ Resuelto y verificado (hash chain) |

## 2. Deuda técnica — estado actual

| Ítem | Estado |
|---|---|
| Memory safety RAII | ✅ 11/11 archivos |
| Doxygen (headers de negocio) | ✅ Completo |
| ADR-015 (versionado server-side) | ✅ Resuelto y verificado |
| ADR-016 (export PDF server-side) | ✅ Resuelto y verificado |
| React.memo en componentes de alto re-render | ✅ 54/60 componentes evaluados y memoizados; 6 exclusiones deliberadas documentadas |
| TypeScript | ✅ Código productivo migrado; ADR-069 y validaciones verdes |

## 3. Lo que este agente NO puede decidir por el equipo

- **Pentest de caja negra por un tercero.** Los checks automatizables
  (headers de seguridad, rate limiting, inyección SQL/comandos, IDOR) están
  cubiertos — ver sección 4. Un pentest formal externo requiere contratación
  y alcance definido por el equipo de seguridad.
- **Fecha y alcance de GO-LIVE.** Decisión de negocio.
- **QA manual de flujos de usuario final** (más allá de lo verificado vía
  API/navegador en esta sesión).
- **Comunicación a usuarios / changelog público.**

## 4. Checklist de seguridad automatizable — resultados

| Check | Resultado |
|---|---|
| SQL injection (parametrización) | ✅ 0 usos de `pqEscapeLiteral`/concatenación en todo el backend |
| Command injection | ✅ `shellQuote()` en los 4 puntos que invocan `std::system()` |
| IDOR en gestión de usuarios | ✅ Corregido, verificado con ataque cruzado real |
| IDOR en informes (lectura/revisiones/export PDF) | ✅ Verificado: cross-tenant devuelve 404/vacío antes de tocar datos |
| Rate limiting de login | ✅ Confirmado: 429 tras 6 intentos fallidos rápidos |
| Headers de seguridad HTTP | ✅ `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` en toda respuesta |
| CSP (Content-Security-Policy) | ✅ Implementado 2026-07-07 en `router.cpp::applySecurityHeaders` (API) y `nginx.conf` (estático). Auditados todos los orígenes reales: Google Fonts, Tailwind Play CDN. `img-src` permite `https:` sin allowlist de host porque `MapViewer.tsx` tiene un campo real de "WMS personalizado (URL manual)" — un allowlist fijo rompería esa función. Verificado con rebuild+redeploy real: headers presentes sin duplicación en `/`, `/assets/`, `/api/`; ningún origen externo servido fuera de la política (confirmado por grep de `index.html` servido) |
| Auditoría append-only + integridad forense | ✅ Hash chain verificado, 0 filas rotas |
| CORS | 🟡 `Access-Control-Allow-Origin: *` — aceptable dado que la app usa Bearer token (no cookies), pero es una política permisiva; endurecer a un allowlist de orígenes si se expone públicamente |

## 5. Pasos de despliegue (producción)

1. `docker compose build web frontend pdf_export`
2. Aplicar migraciones SQL nuevas en orden si no se aplicaron ya:
   `db_scripts/33_workflow_states_migration.sql`, `34_report_signature.sql`
   (33 y 34 son idempotentes, seguras de re-ejecutar).
3. `docker compose up -d web frontend pdf_export`
4. Verificar healthchecks: `docker ps` — `beemetry-api`, `beemetry-web`,
   `beemetry-pdf-export` deben quedar `healthy` (ADR-000/033: contenedores
   renombrados de `aurixa-*` a `beemetry-*` 2026-07-07; los nombres de
   servicio en `docker-compose.yml` (`web`, `frontend`, `pdf_export`, etc.)
   y el alias de red interno `backend` no cambiaron — solo `container_name`,
   así que nada del enrutamiento/proxy se ve afectado).
5. Smoke test mínimo post-deploy:
   - `GET /api/auth/companies` → 200 con lista de empresas.
   - Login real (usuario de prueba) → token válido.
   - Crear informe → transición de workflow → verificar en
     `platform_audit_log` que la entrada aparece con hash correcto.
   - `GET /api/reports/{id}/export/pdf` → 200, `Content-Type: application/pdf`.
6. Confirmar `fn_audit_log_verify_chain()` → 0 filas rotas antes y después
   del despliegue (detecta si algo tocó el log de auditoría durante la
   ventana de deploy).

## 6. Rollback

- Backend/frontend: `docker compose up -d <servicio>` con el tag de imagen
  anterior (mantener las imágenes previas sin `docker image prune` hasta
  confirmar estabilidad del release).
- SQL: las migraciones 33/34 son aditivas (nuevas columnas/constraint) — un
  rollback de código no requiere revertir el esquema; los datos migrados
  (`published`→`archived`) no tienen camino de reversión automática (no se
  guardó el valor original) — si esto es un problema, coordinar antes del
  release, no después.

## 7. Riesgo de proceso pendiente (no técnico)

Todo el trabajo de esta sesión sigue sin commitear en git. Antes de
cualquier release real, commitear y revisar el diff completo.

## 8-bis. Seguridad — auditoría de accesos indebidos (2026-08-02)

Revisión centrada en control de acceso, secretos y superficie remota. Las
correcciones ya están aplicadas en el código; lo que sigue son las acciones
**operativas** que el equipo debe ejecutar además.

### Material TLS — rotado el 2026-08-02
`certs/server.key` (clave privada del mining gateway, puerto 8443) **seguía
trackeada en git**. La sección 8 de abajo la da por corregida el 2026-07-10,
pero el `git rm --cached` nunca llegó a commitearse: el único commit que toca
`certs/` es `4818805` (2026-03-31), que la añadió. La clave EN DISCO sí se había
regenerado el 10-jul, así que la desplegada no era la comprometida — pero seguía
como modificación pendiente de un fichero trackeado, a un `git add .` de acabar
publicada.

Hecho ahora: destrackeada (`git rm --cached`) y **par regenerado** (RSA 4096, CN
`mining-gateway.local`, válido hasta 2027-08-02). El anterior queda respaldado en
`tmp/cert-backup-20260802/` (gitignored) por si hay que revertir.

**Despliegue en la VPS — `scripts/deploy-mining-gateway-cert.sh`.** Ejecutar por
SSH desde la raíz del repo desplegado:

```bash
./scripts/deploy-mining-gateway-cert.sh --check    # diagnóstico, no toca nada
./scripts/deploy-mining-gateway-cert.sh            # despliega y verifica
./scripts/deploy-mining-gateway-cert.sh --rollback # vuelve al backup anterior
```

No son tres comandos sueltos a propósito: rotar este certificado es
irreversible en la práctica y a medio camino deja el gateway sin TLS válido. El
script comprueba **antes** que clave y certificado son el mismo par (el modo de
fallo que ya se dio una vez), guarda el anterior, recrea el servicio y
**verifica por TLS real que el :8443 sirve la huella nueva** — el paso que se
suele omitir y por el que uno se entera del fallo cuando llama el cliente.

Verificado en local el 2026-08-02: `--check` confirma que el `:8443` sirve la
huella `AC:DD:A2:...:44:70`, idéntica a la del fichero.

Queda pendiente del equipo:
1. Ejecutar el script en la VPS (requiere acceso SSH que no está en el repo).
2. Reconfigurar los sensores/gateways externos que fijen (pin) el certificado
   anterior — **hasta hacerlo dejarán de conectar**.
3. Decidir aparte si se purga el historial (`git filter-repo`): reescribe SHAs y
   hay que coordinarlo con todos los clones.

También se corrigió `scripts/gen-mining-gateway-cert.sh`: en Git Bash, MSYS
reescribía el argumento `/CN=...` como una ruta y `openssl req` abortaba
**después** de haber escrito la clave nueva, dejando clave y certificado
desparejados (y el gateway TLS sin negociar). Ahora usa `MSYS_NO_PATHCONV=1` y
verifica que ambos sean el mismo par antes de salir.

### Secretos que ya no tienen default — definidos el 2026-08-02
Tres secretos caían silenciosamente a valores publicados en este repositorio.
Ahora fallan de forma explícita en vez de fingir que protegen algo:

| Variable | Si falta |
|---|---|
| `BEEMETRY_REPORT_EXPORT_KEY` | export/import `.mreport` devuelve `export_key_not_configured` |
| `PDF_OWNER_PASSWORD_SECRET` | el servicio `pdf_export` no arranca |
| `BEEMETRY_API_KEYS` | `ApiKeyAuth` queda activa y rechaza todo (antes: se desactivaba sola) |

`BEEMETRY_REPORT_EXPORT_KEY` y `PDF_OWNER_PASSWORD_SECRET` ya están generados
(256 bits aleatorios) en el `.env` local. **Hay que replicarlos en el `.env` de
la VPS** — no están en git, a propósito.

Para desarrollo local existen escotillas explícitas —
`BEEMETRY_ALLOW_DEV_SECRETS`, `PDF_ALLOW_DEV_SECRETS`,
`BEEMETRY_API_AUTH_OPTIONAL`. **Deben quedar vacías en cualquier entorno real.**

Los `.mreport` y PDF exportados ANTES de esto hay que considerarlos no
confidenciales: se descifran con datos que están en el repo.

### Corregido en código
- **Fail-open en `ApiKeyAuth`** (`backend/src/security/api_auth.cpp`): sin API
  keys configuradas, la autenticación se desactivaba entera. Un typo en el
  nombre de la variable o un secreto no montado abría la API. Ahora es
  fail-closed. También se eliminó la aceptación de la key por `?api_key=`
  (quedaba en el access log de nginx, el historial y el `Referer`) y la
  comparación pasa a ser en tiempo constante.
- **Access token JWT aceptado por query string en toda ruta**
  (`backend/src/auth/auth_session.cpp`): `?auth_token=` queda restringido al
  handshake WebSocket, que es el único sitio donde el navegador no puede
  mandar headers. La descarga del CSV de auditoría se pasó a `fetch` + Blob
  con `Authorization` en header (`frontend/src/auth/authApi.ts`).
- **Login biométrico sin límite de intentos** (`backend/src/main.cpp`):
  `/api/auth/login/face` acepta un `face_template` numérico arbitrario y lo
  compara por similitud coseno; sin contador de fallos era iterable hasta
  cruzar el umbral. Ahora comparte el limitador de cuenta con el login por
  contraseña (cupo separado) mediante un guard RAII que cuenta el intento como
  fallido salvo en el camino de éxito, para que ninguna salida por error futura
  quede sin cubrir.
- **DoS de memoria en el limitador de login**: el mapa se indexaba por
  `company|username` (texto del atacante) y solo se purgaba en login correcto.
  Ahora se purga por ventana y tiene techo de entradas.
- **SSRF en canales de notificación** (`backend/src/mining/alarm_notifier.cpp`,
  `notification_routes.cpp`): un admin de tenant podía registrar un webhook
  apuntando a `169.254.169.254` (credenciales IAM de la instancia), a servicios
  internos de la red Docker o a loopback, y el backend lo solicitaba en cada
  alarma. Se bloquean destinos loopback/RFC1918/link-local/CGNAT y nombres
  internos, y ahora se valida en el **alta** del canal, no solo al enviar.
- **Bypass del sanitizador XSS** (`frontend/.../lib/sanitizeHtml.ts`): el
  patrón de esquema peligroso solo toleraba espacios *delante*, así que
  `java&#9;script:` lo esquivaba — el navegador elimina esos caracteres antes
  de resolver la URL y el enlace ejecutaba. Se normaliza la URI antes de
  comparar. Cubierto por `sanitizeHtml.test.ts`.

### Verificado sin hallazgos
SQL parametrizado en todo el backend (`PQexecParams`); aislamiento multi-tenant
de informes (ADR-039/079); autenticación de dispositivos de telemetría por hash
de clave; construcción de comandos de `gdal_translate`/snapshot con allowlist y
quoting; JWT con `alg` fijado a HS256 y comparación en tiempo constante.

### ADR-082 — access token en cookie HttpOnly (implementado 2026-08-02)

El access token ya no se guarda en `localStorage`: viaja en la cookie
`access_token` (HttpOnly, `Secure`, `SameSite=Strict`, `Path=/`, TTL = el del
JWT). Un XSS en la SPA sigue pudiendo actuar mientras la pestaña está abierta,
pero ya no puede LEER la credencial ni exfiltrarla para reutilizar la sesión
desde fuera — que es lo que convertía un fallo puntual de sanitización en una
toma de cuenta persistente.

Consecuencia directa: **CSRF pasa a ser relevante**, porque el navegador
adjunta la cookie también en peticiones originadas por terceros. Se exige el
double-submit token (`X-CSRF-Token` == cookie `csrf_token_v2`) en toda petición
que mute estado y que se haya autenticado por cookie. La comprobación está en
`router::Router::dispatch` — único punto por el que pasan las 97 rutas, así que
una ruta nueva queda protegida por omisión.

Lo que NO cambia: `Authorization: Bearer` sigue funcionando para clientes de
API e integraciones, y esas peticiones no requieren CSRF (ese header no lo
adjunta un navegador por su cuenta).

Puntos que hubo que adaptar y conviene vigilar en pruebas de regresión:
- **WebSocket de alarmas**: ya no manda `?auth_token=` — el handshake al mismo
  origen lleva la cookie. Verificar que las alarmas en vivo siguen llegando.
- **Export PDF** (`print-report/main.tsx`): el Chromium headless del sidecar no
  tiene las cookies del usuario, así que sigue usando el token de la URL, pero
  ahora se instala en memoria del módulo (`setExplicitBearerToken`) en vez de
  escribirse en el `localStorage` del contenedor de export.
- **Cambio de tenant** (`/api/auth/tenants/switch`): reemite la cookie, o el
  navegador seguiría mandando el token del tenant anterior.
- `BEEMETRY_AUTH_COOKIE_SECURE` debe ser `true` en producción (el compose lo
  fuerza a `false` para desarrollo sobre HTTP).

### Migración de credenciales a Argon2id (completada 2026-08-02)

El esquema legado era `std::hash<std::string>(salt + "::" + password)`: 64 bits,
**no criptográfico**, sin estiramiento de clave y con salt FIJO compartido por
todas las cuentas. Un volcado de `auth_users` con esos hashes equivalía a tener
las contraseñas en claro.

No se puede convertir a Argon2id real sin la contraseña, que el servidor no
tiene. Lo que sí se hace, y para todas las filas a la vez, es dejar de almacenar
el valor débil: se guarda `Argon2id(hash_legado)` con prefijo `legacy1:`. La
migración corre sola al arrancar el backend (`migrateLegacyPasswordHashesPg` /
`...File`), es idempotente y no expulsa a nadie. Cada credencial converge a un
Argon2id auténtico en el siguiente login correcto de su usuario.

Verificar la convergencia (tras aplicar `db_scripts/49`):

```bash
docker compose exec db psql -U sensors -d sensors_db -c "SELECT * FROM auth_password_algo_status;"
```

`algo='legacy'` debe ser **0** desde el primer arranque. `wrapped` baja a medida
que la gente entra; cuando llegue a 0 se puede quitar
`BEEMETRY_AUTH_LEGACY_PASSWORD_SALT` y borrar `legacyHashPassword`.

Matiz honesto: la envoltura protege el dato **en reposo**, que es el riesgo
grave. Mientras una credencial siga en `wrapped`, la verificación sigue pasando
por el hash de 64 bits, así que un atacante que ya conozca la contraseña real
(por reutilización en otro sitio) no encuentra más obstáculo del que había. Solo
el rehash real —o forzar un cambio de contraseña— cierra eso del todo.

### Verificación ejecutada (2026-08-02, stack local)

| Qué | Resultado |
|---|---|
| Build backend C++ (`docker compose build web`) | OK |
| Tests unitarios C++ (`ctest`, incluye Argon2id) | 1/1 `Passed` |
| Frontend `tsc --noEmit` | 0 errores |
| Tests frontend (`vitest`) | 32/32 |
| Migración Argon2id tras reinicio | **0 `legacy`**, 14 `argon2id`, 40 `wrapped` |
| Constraint anti-regresión validado | Bloquea reintroducir un hash legado |
| Cert TLS en `:8443` | Huella en disco == huella servida |

Gate CSRF probado contra el backend real (`127.0.0.1:8082`, `POST /api/reports`):

| Caso | Esperado | Obtenido |
|---|---|---|
| Cookie, sin `X-CSRF-Token` | 403 | 403 `csrf_token_mismatch` |
| Cookie + CSRF que coincide | pasa CSRF → 401 auth | 401 `unauthorized` |
| Cookie + CSRF que no coincide | 403 | 403 `csrf_token_mismatch` |
| `Authorization: Bearer` (API) | exento → 401 auth | 401 `unauthorized` |
| `GET` con cookie, sin CSRF | método seguro, no bloquea | 401 auth |
| `?auth_token=` en ruta HTTP | ya no autentica | 401 `unauthorized` |

### CRUD de empresas y RBAC granular (ADR-085/086/087/088, 2026-08-05)

`db_scripts/50` y `51` siguen el mismo patrón manual que los scripts
30-49 (no se montan en `docker-compose.yml:154-179`, que solo aplica
01-29 automáticamente vía `docker-entrypoint-initdb.d`):

```bash
# 50: obligatorio — esquema CRUD de empresas + permisos empresas.view/manage
docker compose exec -T db psql -U sensors -d sensors_db < db_scripts/50_companies_crud_rbac.sql

# 51: SOLO demo/QA — TimeTelemetry, Beemetry, 4 distribuidoras (RUC sintético
# marcado como tal, ver advertencia en el propio script) y 24 usuarios de
# prueba. NO correr en producción.
docker compose exec -T db psql -U sensors -d sensors_db < db_scripts/51_seed_companies_distribuidores_demo.sql
```

Verificar la migración 50:

```bash
docker compose exec db psql -U sensors -d sensors_db -c "SELECT code FROM platform_permissions WHERE module='empresas';"
docker compose exec db psql -U sensors -d sensors_db -c "SELECT role, permission_code FROM role_permissions WHERE permission_code LIKE 'empresas.%' AND tenant_id IS NULL;"
```

Debe devolver 2 códigos (`empresas.view`, `empresas.manage`) y 3 filas en
la matriz default (`admin`×2 + `manager`×1).

La consulta externa opcional a un verificador de RUC (ADR-087) sigue
apagada por defecto — activarla requiere contratar un proveedor
(peruapi.com/apis.net.pe/otro) y setear `BEEMETRY_TAX_REGISTRY_ENABLED=true`
+ `_HOST`/`_PATH_TEMPLATE`/`_TOKEN` en `.env`; sin eso, `GET
/api/auth/validate-company` sigue devolviendo solo el resultado del
checksum local (`registry: "disabled"`), igual que hoy.

**Efecto colateral conocido**: si `db_scripts/06_seed_users_raura.sql` se
vuelve a ejecutar en un entorno donde ya corrió `db_scripts/49` (CHECK de
`password_hash_algo`), fallará — ese seed antiguo inserta hashes con el
formato legado previo a la migración Argon2id. No es una regresión de
este cambio, es una interacción preexistente entre dos scripts de fechas
distintas; se documenta acá porque el nuevo `51` sí sigue el patrón
Argon2id correcto y puede usarse como referencia si `06` necesita
actualizarse.

`Set-Cookie` emitido: `access_token=; Path=/; Max-Age=0; SameSite=Strict;
HttpOnly` (sin `Secure` porque el compose local fuerza
`BEEMETRY_AUTH_COOKIE_SECURE=false`; **en producción debe ser `true`**).

No se probó un login completo de extremo a extremo: no hay credenciales de
demo en el repo y no procede usar cuentas reales de la base.

### WhatsApp — el token caduca, no es un problema de configuración

`BEEMETRY_WHATSAPP_ACCESS_TOKEN` se actualizó el 2026-08-03 y se validó contra
Meta con una llamada **de solo lectura** (`GET /{phone_number_id}`, no envía
mensajes): HTTP 200, número `+1 555-658-6228` (`verified_name: "Test Number"`).

Pero `GET /debug_token` revela el problema de fondo:

```
type       : USER          ← token temporal del Graph API Explorer
expires_at : 2026-08-03 22:00 UTC   ← ~1 h de vida
scopes     : whatsapp_business_management, whatsapp_business_messaging
```

El token anterior ya estaba caducado (`OAuthException 190/463`). Sustituir un
token temporal por otro temporal repite el fallo cada pocas horas — el
escalamiento a soporte responderá `whatsapp_not_configured` sin aviso previo.

**Lo que hay que hacer una vez:** generar un token de **System User** en
Business Manager (Configuración del negocio → Usuarios del sistema → Generar
token, con `whatsapp_business_messaging` + `whatsapp_business_management`).
Esos no caducan y `debug_token` los muestra como `type: SYSTEM_USER`,
`expires_at: 0`.

Además, `+1 555-658-6228` es el **número de pruebas** que Meta asigna por
defecto: solo entrega a destinatarios registrados en la lista de prueba de la
app. Para producción hay que verificar el número real de la minera.

Comprobar el token vigente en cualquier momento:

```bash
curl -s "https://graph.facebook.com/v22.0/debug_token?input_token=$TOKEN" -H "Authorization: Bearer $TOKEN"
```

---

## 8. Seguridad — hardening de infraestructura (2026-07-10)

Auditoría de ciberseguridad completa (capa de aplicación + infraestructura
Docker/VPS). La capa de aplicación (SQL injection, IDOR, rate limiting de
login, headers HTTP/CSP) ya estaba auditada y corregida en sesiones previas
(secciones 1-6 arriba, `GAP_ANALYSIS_2026-07-04.md`) — sin hallazgos nuevos
ahí. Lo nuevo es infraestructura:

### Corregido en esta sesión
- **Credenciales hardcodeadas en git** (`docker-compose.yml`,
  `docker-compose.prod.yml`): DB, MinIO, formula_db/engine y el fallback de
  `BEEMETRY_JWT_SECRET` movidos a variables de entorno obligatorias
  (`${VAR:?...}` — el compose falla explícito si no están definidas). Ver
  `.env.example` para la lista completa. Valores nuevos generados y puestos
  en `.env` local (gitignored) el 2026-07-10.
- **Puertos admin expuestos directo al host** (bypaseaban nginx): MinIO
  9000/9001 y backend 8082 ahora bindeados a `127.0.0.1` (acceso solo vía
  túnel SSH); formula_engine 18020 quitado por completo (ya proxificado en
  `/formula-api/`). `8443` (mining gateway TLS, sensores externos) se
  mantiene público — es el único puerto que necesita alcance desde internet
  además de 80/443.
- **Clave TLS privada commiteada en git** (`certs/server.key`): regenerada,
  destrackeada (`git rm --cached`), agregada a `.gitignore`. Regenerar con
  `scripts/gen-mining-gateway-cert.sh`. La clave vieja sigue en el historial
  de git — si el repo se compartió/fue público en algún momento, purgar el
  historial (`git filter-repo`) es una decisión aparte, coordinada con quien
  tenga clones del repo (reescribe SHAs).
- **CORS wildcard innecesario** en el SSE de KPIs en vivo
  (`backend/src/main.cpp::handleLiveKpiSse`) — el endpoint es same-origin vía
  nginx, el `Access-Control-Allow-Origin: *` no cumplía ninguna función.
- **Rate limiting a nivel nginx** (`frontend/nginx.conf`): `limit_req`/
  `limit_conn` por IP en `/api/` (general) y `/api/auth/login/` (más
  estricto) — complementa el limitador de cuenta ya existente en el backend,
  que no cubre flood HTTP genérico ni credential stuffing distribuido.
- **`autoindex on` en `/data/`** (nginx) — desactivado; el frontend siempre
  referencia rutas exactas, listar el árbol completo no aportaba nada.

### Entregado, pendiente de ejecución del equipo
- `scripts/backup_db.sh`: backup lógico (`pg_dump`) de `sensors_db` +
  `formula` con rotación local. Programar por cron en la VPS. El destino
  offsite (rclone/S3) requiere que el equipo configure su propio remote —
  sin backup fuera del VPS, un ransomware que cifre el disco también cifra
  los backups locales.
- `scripts/harden-vps.sh`: firewall (`ufw` default-deny entrante, solo
  22/80/443 + los puertos extra que se pasen), `fail2ban` para sshd,
  actualizaciones de seguridad automáticas. Ejecutar **en la VPS Linux por
  SSH**, no en la máquina de desarrollo. Requiere `sudo`. Incluye un paso
  manual (deshabilitar login SSH por contraseña) deliberadamente no
  automatizado para no arriesgar dejar al equipo fuera del servidor.
- Sin terminación TLS/HTTPS pública en `docker-compose.yml` por defecto (solo
  puerto 80). Si hay un dominio apuntando a la VPS, agregar Certbot/Let's
  Encrypt o Caddy delante de nginx; `docker-compose.scale.yml` ya tiene un
  ejemplo funcional con Traefik (`websecure` en `:443`) reutilizable como
  referencia.

### Procedimiento de rotación sobre despliegue existente (IMPORTANTE)
`POSTGRES_PASSWORD` solo se aplica en el initdb del **primer** arranque del
volumen — cambiar el `.env` y recrear contenedores sobre un `db_data`
existente NO cambia el password real dentro de Postgres, y el backend
empezaría a fallar auth. Orden correcto sobre una VPS ya desplegada:

1. Editar `.env` con los valores nuevos (ver `.env.example`).
2. `./scripts/apply-credential-rotation.sh` — ejecuta `ALTER USER` en las BD
   vivas (`sensors` y `formula`) leyendo el `.env`. MinIO no necesita este
   paso (sus credenciales root son 100% de entorno).
3. Re-sincronizar la réplica — su `primary_conninfo` (escrito por
   `pg_basebackup -R` dentro del volumen) guarda el password viejo y el
   streaming quedaría roto tras la rotación:
   `docker compose rm -sf db_replica && docker volume rm informecliente_db_replica_data`
   (la réplica es 100% derivada; el re-basebackup es automático al arrancar).
4. `docker compose up -d` — recrea todos los servicios cuya config cambió
   (pgbouncer, web, minio, minio_init, formula_engine, db_replica...).
5. Smoke test: login en la SPA + `GET /health` + un dashboard con datos.

En un despliegue **desde cero** (volúmenes nuevos) basta el `.env` — initdb
toma los valores directamente.

### Rol dashboard_ro (mínimo privilegio para el SSE) — resuelto
El rol Postgres `dashboard_ro` (usado por `BEEMETRY_REPLICA_DATABASE_URL`
para el SSE de KPIs) no existía en ningún `db_scripts/*.sql` — la conexión a
la réplica fallaba siempre y `handleLiveKpiSse` caía de vuelta al primario
con las credenciales completas de `sensors`. Corregido:
- `db_scripts/40_dashboard_ro_role.sql`: crea el rol con LOGIN + SELECT solo
  sobre `mining_runtime_kpis` (nada más del esquema), y
  `default_transaction_read_only = on` como defensa extra. Idempotente. El
  password no vive en el SQL (se pasa por `psql -v` desde el `.env`).
- `scripts/provision-dashboard-ro.sh`: lo aplica al primario (el rol se
  propaga solo a la réplica vía streaming replication) y verifica el login
  de lectura contra `db_replica`. Ejecutar una vez en la VPS; luego
  `docker compose up -d --force-recreate web`.
