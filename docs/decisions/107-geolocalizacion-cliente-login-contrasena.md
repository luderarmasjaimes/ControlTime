# ADR-107 — Geolocalización del dispositivo cliente extendida al login por contraseña/PIN

**Status**: implemented (2026-08-17)
**Fecha**: 2026-08-17
**Autores**: EC
**Ámbito**: plataforma
**Relación**: unifica el contrato ya usado por `login/face` (agregado sin ADR propio en una sesión
anterior — ver "Estado previo" abajo) con `login/password`; referenciado desde
`docs/integration/BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md` §3.1.1/§3.2.

## Contexto

El usuario pidió que el LOGIN de la plataforma reciba dos parámetros adicionales — latitud y
longitud — correspondientes a la ubicación geográfica de la **terminal cliente** (PC, laptop o
smartphone donde corre el frontend), explícitamente **no** la ubicación del servidor.

### Estado previo (auditoría de código antes de tocar nada)

Al revisar el código se encontró que este requisito **ya estaba implementado, pero solo a medias**:

- `frontend/src/auth/geolocation.ts` ya existía completo: captura best-effort vía
  `navigator.geolocation.getCurrentPosition` (API estándar del navegador, nunca IP ni nada del
  servidor), con caché de 5 minutos en `sessionStorage` y timeout de 4s.
- `POST /api/auth/login/face` (`backend/src/main.cpp`, `handleLoginFace`) ya aceptaba un objeto
  `location` (`latitude`/`longitude`/`accuracy`) en el body, lo validaba (rango -90..90 / -180..180)
  y lo anexaba como texto al `detail` de la fila de auditoría del login exitoso
  (`loginFaceTargetedPg`, parámetro `auditDetailSuffix`).
- `frontend/src/components/Auth/AuthGateway.tsx` ya llamaba `getBestEffortLocation()` al abrir la
  cámara de login facial y pasaba el resultado a `loginWithFace()`.
- **`POST /api/auth/login/password` no tenía nada de esto** — ni el backend leía un campo
  `location`, ni `loginWithPassword()` en el frontend lo aceptaba, ni `handlePasswordLogin` en
  `AuthGateway.tsx` lo capturaba. Un usuario que inicia sesión con contraseña (la vía más común,
  sin cámara) no dejaba ningún rastro de ubicación en la auditoría — a diferencia de uno que usa
  biometría facial.
- Ninguna de las dos rutas está documentada en la guía de integración externa
  (`docs/integration/BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md`), y no existía un ADR que dejara constancia
  de la decisión original (probablemente se implementó junto con la biometría facial sin registrarlo
  aparte).
- La página de referencia (`external-api-test-page/index.html`, servida por HTTP en `:5190` y HTTPS
  en `:5443` — ver §8 de la guía) tampoco solicitaba ni enviaba ubicación en ninguna de las dos vías.

Es decir: el pedido del usuario no era una funcionalidad nueva desde cero, sino **cerrar una
inconsistencia real** entre las dos vías de login y dejarla documentada y probable de punta a punta.

## Decisión

1. **Backend — paridad `login/password` con `login/face`**:
   - Se extrajo la lógica de parseo/validación de `location` (antes solo inline dentro de
     `handleLoginFace`) a una función compartida `extractGeoAuditSuffix(const json::object&)` en
     `backend/src/main.cpp`, reutilizada por ambos handlers — evita divergencia futura entre las dos
     rutas.
   - `handleLoginPassword` ahora también extrae `location` del body y lo pasa a `loginPasswordPg`
     (nuevo parámetro `auditDetailSuffix`, mismo patrón que ya tenía `loginFaceTargetedPg`) y al
     `appendAuthAuditLog` del modo sin Postgres (filesystem).
   - Mismas reglas de validación y mismo destino que ya regían para `login/face`: rango
     `-90..90`/`-180..180`, ignorado en silencio si falta o es inválido, **nunca** condiciona si el
     login se acepta o rechaza, solo se anexa al `detail` de la auditoría del intento **exitoso**.
2. **Frontend — captura y envío en el login por contraseña**:
   - `loginWithPassword()` (`frontend/src/auth/authApi.ts`) acepta ahora un `location` opcional con
     el mismo shape que `loginWithFace()` ya usaba.
   - `AuthGateway.tsx`: se agrega `pendingPasswordLocationRef`, poblado por un `useEffect` que pide
     la ubicación apenas se muestra el formulario de contraseña (`mode==='login' &&
     !loginBiometricSession`) — mismo patrón que el prefetch ya existente para el flujo facial (se
     pide al abrir la pantalla, no en el submit, para que la resolución del permiso del navegador no
     agregue latencia perceptible al confirmar el login).
3. **Página de prueba HTTP/HTTPS** (`external-api-test-page/index.html`, la referenciada en §8 de la
   guía de integración): se agrega un badge "ubicación: …" junto al encabezado "Iniciar sesión" que
   solicita la posición una sola vez al cargar la página (clickeable para reintentar) y la adjunta al
   body de **ambas** rutas de login (`login/password` y `login/face`) si se obtuvo. Reimplementado en
   JS plano (esta página no tiene build step) con el mismo contrato que `geolocation.ts`.
4. **Documentación**: `docs/integration/BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md` se actualiza — nueva
   §3.1.1 documenta el campo `location` con su shape completo, semántica best-effort y nota de
   privacidad; se referencia desde §3.1 y §3.2 (antes ninguna de las dos lo mencionaba, pese a que
   `login/face` ya lo aceptaba en producción); §8 documenta el badge de la página de prueba.

## Verificación

- `npx tsc --noEmit` sobre el árbol de frontend: sin errores nuevos en `authApi.ts` ni
  `AuthGateway.tsx`.
- `external-api-test-page/index.html` servida localmente (`python -m http.server 5190`) y verificada
  en navegador real (Browser pane): badge de ubicación se actualiza a "no disponible" cuando el
  entorno de prueba no concede el permiso (comportamiento esperado, best-effort), sin errores de
  consola; el cambio de pestaña Contraseña/PIN ↔ Verificación facial sigue funcionando sin romperse.
- **End-to-end contra la base de datos real (2026-08-17/18)**: `docker compose build web` (imagen
  `informecliente-web`, Catch2 `100% tests passed`) + `docker compose up -d --no-deps web` para que
  el contenedor `beemetry-api` corriera el binario con este cambio (antes servía una imagen anterior
  a esta sesión — motivo por el que una verificación manual del usuario no veía nada nuevo en la
  tabla). Con un usuario de prueba desechable insertado directo en `auth_users` (`QA_TEST_ADR107`,
  eliminado al terminar), se ejecutó un `POST /api/auth/login/password` real con `location` en el
  body contra `http://localhost:8082`. Resultado confirmado por SQL directo sobre `auth_audit_logs`:
  ```
  event_action=login_password  success=t
  detail = "ok geo=-12.046373,-77.042793 geo_accuracy_m=22.500000"
  ```
  Confirma que el dato de ubicación queda persistido en la fila de auditoría del login por
  contraseña, con el mismo formato que ya regía para `login_face`. Nota adicional relevante para la
  trazabilidad: `auth_audit_logs` es **append-only** (trigger `trg_fn_auth_audit_logs_block_mutation`,
  hash-chain de ADR-030) — ni siquiera un `DELETE` directo con el rol de la aplicación pudo borrar la
  fila de prueba (el usuario de prueba sí se eliminó de `auth_users`, la fila de auditoría quedó,
  como debe ser).

## Consecuencias

- Ambas vías de login (contraseña y facial) quedan con el mismo contrato opcional de ubicación —ya
  no es una asimetría accidental entre ellas.
- La auditoría de logins por contraseña gana un dato adicional (ubicación aproximada del cliente,
  cuando el usuario lo consintió) sin afectar el flujo de autenticación ni agregar un nuevo `400`
  posible.
- La guía de integración externa queda alineada con lo que el backend realmente acepta — antes
  cualquier integrador que leyera solo la guía no se enteraba de que `login/face` ya soportaba este
  campo.
- ~~No se agregan columnas estructuradas...~~ **Superado por la actualización 2026-08-18 (3)
  abajo**: sí se agregaron (`latitude`, `longitude`, `accuracy_m`), a pedido explícito, tras
  verificar con evidencia real que el texto en `detail` era insuficiente para cualquier consulta
  que no sea leer fila por fila.

## Alternativas descartadas

- **Geolocalización por IP del lado del servidor**: descartada explícitamente — el usuario pidió la
  ubicación de la **terminal cliente**, no la del servidor ni la inferida por la IP de origen de la
  petición (que además sería la del proxy/NAT corporativo o del ISP, no la del dispositivo real, y en
  redes móviles puede estar a cientos de km de distancia). La única fuente confiable de la posición
  real del dispositivo es su propio sensor de ubicación, expuesto al navegador vía
  `navigator.geolocation` con consentimiento explícito.
- **Hacer `location` obligatorio (bloquear el login sin él)**: descartado — rompería el login para
  cualquier usuario que niegue el permiso de ubicación (su derecho), use un navegador/dispositivo sin
  soporte de geolocalización, o integre vía la API REST directa sin pasar por un navegador (ver guía
  de integración, audiencia explícita de sistemas externos). Mantener el campo 100% opcional y
  best-effort es coherente con cómo ya funcionaba `login/face` desde antes de este ADR.
- ~~Columnas estructuradas en `auth_audit_logs` desde ahora~~: inicialmente evaluado y diferido
  (el texto libre en `detail` resolvía el pedido concreto sin migración de esquema) — **revertido
  en la actualización 2026-08-18 (3)** tras un pedido explícito de columnas dedicadas.
- **Pedir la ubicación en cada submit en vez de al abrir la pantalla**: descartado por UX — agregaría
  la latencia de resolución del diálogo de permiso del navegador (hasta el timeout de 4s) al momento
  de confirmar el login. Se prefiere el mismo patrón de prefetch que ya usaba el flujo facial.

## Nota operativa: diagnóstico de "Failed to fetch" al probar desde otra PC (2026-08-17)

Durante la verificación de este ADR, el usuario reportó `TypeError: Failed to fetch` al probar
`http://localhost:5190/index.html` en su navegador real (fuera del entorno de esta sesión), pese a
que la misma página funcionaba correctamente probada dentro de esta sesión. Diagnóstico:

- **Backend y CORS para `http://localhost:5190` estaban correctos** — confirmado por `curl` con
  header `Origin: http://localhost:5190` (responde `Access-Control-Allow-Origin` correcto) y por una
  prueba en un navegador real (Browser pane de esta sesión) contra la misma URL exacta: "Probar
  conectividad" devolvió `{"ok": true}`. No se pudo reproducir la falla — el caso puntual del
  screenshot del usuario queda sin causa confirmada (candidatos: contenedores aún no saludables en
  ese instante, extensión del navegador, antivirus/EDR corporativo interceptando el puerto 8082). Si
  vuelve a ocurrir: abrir DevTools → Network, repetir la petición y mirar el error exacto (no solo el
  mensaje genérico) — `ERR_BLOCKED_BY_CLIENT` apunta a una extensión; `ERR_CONNECTION_REFUSED` a que
  el backend no estaba arriba; un error de CORS explícito en la consola (no "Failed to fetch" a
  secas) apunta al origen faltante en la allowlist.
- **Hallazgo real y confirmado**: la IP de LAN de esta máquina cambió de `192.168.18.50` (con la que
  se armó `BEEMETRY_CORS_ALLOWED_ORIGIN` el 2026-08-10) a `192.168.18.172` (renovación de DHCP,
  detectado con `Get-NetIPAddress`/`ipconfig`). Cualquier intento de abrir la página desde **otra PC**
  de la red usando la IP vieja, o cualquier llamada desde la IP nueva contra el backend, habría
  fallado por CORS real (no solo aparente). Corregido: `.env` ahora incluye ambas IPs
  (`http://192.168.18.172:5190`, `https://192.168.18.172:5443`, más las viejas por si el DHCP
  revierte) y el contenedor `beemetry-api` se recreó para tomar el `.env` nuevo. El certificado
  autofirmado de `external-api-test-page/certs/` se regeneró con la IP nueva en el SAN
  (`openssl-san.cnf`) para que HTTPS no agregue una advertencia de certificado adicional a la ya
  esperada de "autofirmado".
- **Verificado con Windows Firewall**: el perfil de red de la interfaz Wi-Fi de esta máquina es
  `Public`, y ya existe una regla `Allow` para `python.exe` en el perfil `Public` — el tráfico
  entrante a los puertos 5190/5443 (servidos por `python -m http.server` / `serve_https.py`) no
  debería estar bloqueado por el firewall local. No se pudo verificar el alcance real desde una
  segunda máquina física dentro de esta sesión.
- **Recordatorio operativo**: la IP de LAN puede volver a cambiar con cada renovación de DHCP. Si el
  acceso desde otra PC vuelve a fallar, lo primero a revisar es `ipconfig` en esta máquina vs. la IP
  que efectivamente configura `BEEMETRY_CORS_ALLOWED_ORIGIN` en `.env` — no asumir que el código
  tiene un defecto nuevo.

### Actualización 2026-08-18: la máquina cambió de red completa, y apareció la causa raíz real

El usuario reportó que, tras cambiar de red Wi-Fi (no solo renovar DHCP en la misma red — subred
nueva `192.168.100.0/24`, nada que ver con la `192.168.18.0/24` anterior), el acceso seguía sin
funcionar bien pese a haber actualizado la IP en `BEEMETRY_CORS_ALLOWED_ORIGIN`. Repetir el mismo
diagnóstico (`ipconfig`, actualizar `.env`, recrear el contenedor, regenerar el certificado con la
IP nueva en el SAN) corrigió el acceso por `localhost`, pero **el acceso HTTP desde otra PC seguía
roto** — y ahí apareció la causa raíz real, más profunda que un simple desfase de IP:

**Docker Desktop en Windows (backend WSL2) no publica los puertos de sus contenedores hacia la IP de
LAN del host.** `docker ps` reporta `0.0.0.0:5173->80/tcp` (el frontend nginx), pero `netstat -ano`
en la máquina que corre Docker **no muestra ningún socket `LISTENING` real en esa dirección** — solo
existe hacia `localhost`/`127.0.0.1` de esa misma máquina. La estrategia que tenía la página de
prueba para el caso "HTTP desde otra PC" (apuntar `backendUrl` a
`http://<IP-de-LAN>:5173`, confiando en que el puerto publicado por Docker fuera alcanzable desde la
LAN) **nunca funcionaba**, ni con la IP vieja ni con la nueva — se manifestaba como el mismo
`TypeError: Failed to fetch` genérico, indistinguible del problema de CORS que sí se había corregido.
Confirmado con evidencia directa: `curl` a `http://<IP-LAN>:5173/` devuelve timeout (`000`) mientras
que `curl` a `http://127.0.0.1:5173/` responde `200` sin problema, en la misma máquina, en el mismo
instante.

**Fix (no requiere tocar configuración de Docker Desktop, que sería más disruptivo)**: se extendió a
HTTP el mismo patrón que `serve_https.py` ya usaba para HTTPS desde el 2026-08-10 — un proceso Python
nativo de Windows (no un puerto publicado por Docker) que sirve la página **y** proxea `/api/*`
conectándose al backend por loopback (`127.0.0.1:8082`, siempre alcanzable desde el host sin importar
la red). Al ser un socket real en `0.0.0.0` (confirmado con `netstat`), sí es alcanzable desde otra
PC de la LAN.

- Lógica de proxy extraída a `external-api-test-page/_proxy_common.py` (antes solo vivía duplicable
  dentro de `serve_https.py`), reutilizada por el nuevo `serve_http.py` (puerto 5190, sin TLS) y por
  `serve_https.py` (sin cambio de comportamiento, solo importa el módulo compartido).
  `iniciar-pagina-prueba.bat` actualizado para lanzar `serve_http.py` en vez de
  `python -m http.server` (que era solo estático, sin proxy).
- `index.html`, `api-test-harness.html` y `rp-test-harness.html`: la detección de "Backend base URL"
  se simplificó a usar siempre `location.origin` — ya no hay una rama especial para "HTTP desde IP de
  LAN" que apuntara a `:5173` (esa rama era la que estaba rota).
- Certificado HTTPS regenerado de nuevo con la IP de la red nueva en el SAN.
- **Verificado end-to-end con evidencia real** (no solo `curl`, también un navegador real vía el
  Browser pane apuntado a `http://192.168.100.178:5190/index.html`, IP de LAN real de la sesión):
  `Probar conectividad` → `{"ok": true, "note": "CORS y conectividad correctas."}`, con la petición
  confirmada en el log de red como `GET http://192.168.100.178:5190/api/platform/countries → 200 OK`
  (mismo origen, vía el proxy — no directo a Docker). HTTPS confirmado equivalente por `curl -k`
  (verificación visual en navegador con certificado autofirmado requiere aceptar la advertencia
  manualmente, no automatizable desde este entorno).
- Guía de integración (`docs/integration/BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md`) actualizada: §8.1
  reescrita con la causa raíz real y evidencia; nueva §8.2 con el requisito de CORS ya relajado
  (defensa en profundidad, no bloqueante, gracias al proxy); nueva §8.3 con el procedimiento a
  repetir la próxima vez que la máquina cambie de red.

**Conclusión para quien retome esto**: si en el futuro "otra PC en la LAN" no puede llegar a un
puerto publicado por Docker Desktop en Windows, **no asuma que es alcanzable solo porque `docker ps`
lo muestra como `0.0.0.0:puerto`** — confirme con `netstat -ano` en la máquina que corre Docker si
existe un socket `LISTENING` real en esa dirección. La solución robusta de este ADR (proxy nativo de
Windows con loopback al backend) es reutilizable para cualquier otro caso similar sin depender de
reconfigurar Docker Desktop.

### Actualización 2026-08-18 (2): automatización de los pasos manuales — `actualizar-red-lan.ps1`

La máquina volvió a cambiar de red dentro de la misma sesión (a `192.168.255.158`), confirmando que
repetir manualmente los pasos de la nota anterior en cada cambio de red no escala. Se creó
`external-api-test-page/actualizar-red-lan.ps1` (+ `Actualizar-Red-LAN.cmd` para doble click) que
automatiza el procedimiento completo: detecta la IP de LAN activa, agrega el origen a
`BEEMETRY_CORS_ALLOWED_ORIGIN` en `.env` (idempotente — no duplica si ya está), agrega la IP al SAN
del certificado autofirmado y lo regenera, recrea el contenedor del backend, reinicia
`serve_http.py`/`serve_https.py`, y **verifica con peticiones reales** (no solo "el proceso arrancó")
que la página y el proxy `/api/*` responden `200` por HTTP y HTTPS vía esa IP — termina imprimiendo
las dos URLs listas para copiar/pegar en otra PC.

Tres bugs reales encontrados y corregidos construyendo este script (documentados por si alguien más
escribe automatización similar sobre este mismo stack):

1. **Slicing de array con el operador `..` de PowerShell puede duplicar contenido**: insertar una
   línea nueva después de la última coincidencia en un array armando
   `$arr[0..$i] + $nueva + $arr[($i+1)..($arr.Count-1)]` duplicaba la última línea cuando esa línea
   coincidente era también la última del archivo — el rango `($i+1)..($count-1)` queda invertido
   (principio > fin) y PowerShell lo interpreta como una secuencia **descendente** en vez de vacía.
   Corregido usando `[System.Collections.Generic.List[string]]::Insert()`, que no tiene ese caso
   borde.
2. **Un `.ps1` ejecutado con `powershell -File` (Windows PowerShell 5.1) no es lo mismo que con
   `pwsh -File` (PowerShell 7+)**, aunque ambos binarios se llamen parecido y coexistan en el mismo
   `PATH` — confirmado con `$PSVersionTable.PSVersion` distinto entre ambos. Con
   `$ErrorActionPreference='Stop'`, cualquier escritura a **stderr** de un proceso nativo (los puntos
   de progreso de `openssl req -newkey` generando la clave RSA, o las líneas de estado de
   `docker compose up`) se envuelve en un `NativeCommandError` **terminante**, aunque el proceso
   externo termine con éxito real (`exit 0`) — ni `2>$null` ni `2>&1 | Out-Null` lo evitan de forma
   confiable bajo `-File`. Corregido envolviendo esas llamadas en `try/catch` (ignorando la
   excepción a propósito) y verificando el resultado real por otro medio — el *contenido* del
   certificado regenerado (`openssl x509 ... | Select-String $ip`), y el estado real de
   `docker ps` — en vez de confiar en que la llamada no haya lanzado una excepción.
3. **`Invoke-WebRequest -SkipCertificateCheck` no existe en Windows PowerShell 5.1** (parámetro
   agregado en PowerShell 7) — si el script se invoca por error con `powershell` en vez de `pwsh`
   (p. ej. desde un `.cmd` de doble click sin cuidar cuál usa), esa verificación falla con un error
   de parámetro inexistente pese a que el servidor SÍ responde bien. Corregido usando `curl.exe`
   (nativo de Windows 10/11, no el alias de PowerShell) con `-k` para el certificado autofirmado —
   se comporta igual sin importar qué versión de PowerShell ejecuta el script.

Verificado end-to-end tras los tres fixes: corrida completa del script imprimiendo `TODO FUNCIONANDO`
con las 4 verificaciones en `200`, más una confirmación adicional en un navegador real (Browser pane)
apuntado directo a `http://192.168.255.158:5190/index.html` — "Probar conectividad" devolvió
`{"ok": true}` con la petición confirmada en el log de red.

### Actualización 2026-08-18 (3): columnas dedicadas `latitude`/`longitude`/`accuracy_m`

Tras verificar con evidencia real (login de prueba + `SELECT` directo) que la ubicación sí quedaba
guardada, el usuario pidió explícitamente columnas dedicadas de latitud/longitud/precisión en vez de
depender del texto libre de `detail` — necesario para poder filtrar/agregar por coordenadas más
adelante (la alternativa de "Alternativas descartadas" que este ADR había diferido inicialmente).

**Decisión**: `db_scripts/58_geolocation_columns_auth_audit_logs.sql` agrega
`latitude`/`longitude`/`accuracy_m` (`DOUBLE PRECISION`, `NULL`able) a `auth_audit_logs`.
Deliberadamente **fuera** de la fórmula del hash-chain (`trg_fn_auth_audit_logs_hash_chain`, script
37/ADR-030) — mismo precedente que ya tenía `source_ip` (existe en la tabla, no participa del
digest). La garantía de integridad de estas columnas nuevas es la misma que ya tenía `source_ip`:
el trigger `trg_auth_audit_logs_block_mutation` bloquea cualquier `UPDATE`/`DELETE` sobre la fila
completa después del `INSERT`, sin excepción de columna — no hace falta que también estén en el
digest para que no puedan alterarse después.

**Intentar backfillear las filas históricas confirmó la garantía de integridad funcionando en la
práctica, no solo en la documentación**: el primer intento de esta migración incluía un `UPDATE`
para copiar lat/lon desde el texto ya presente en `detail` de filas anteriores a esta migración —
el propio trigger de bloqueo lo rechazó (`"auth_audit_logs es append-only: UPDATE no está
permitido"`), exactamente la misma protección que ya había bloqueado un intento de `DELETE` sobre
una fila de prueba en la verificación anterior de este ADR. Se quitó el backfill de la migración:
las filas insertadas antes de este script quedan con las columnas nuevas en `NULL` (su dato de
ubicación sigue disponible como siempre en el texto de `detail`); solo las filas nuevas, insertadas
después del rebuild del backend, llegan con las columnas pobladas.

**Backend**: `appendAuthAuditLogPg` (auth_storage_pg.{hpp,cpp}) gana tres parámetros opcionales
(`std::optional<double> latitude/longitude/accuracyMeters`, default `std::nullopt`) — todos los
`~15` call sites existentes que no tienen ubicación (registro, cambios de empresa, exportación de
reportes, etc.) siguen compilando sin tocarlos. `loginPasswordPg` y `loginFaceTargetedPg` reciben
los mismos tres parámetros y los reenvían en su llamada de éxito. En `main.cpp`, el helper
`extractGeoAuditSuffix()` se convirtió en `extractGeoAuditInfo()`, que devuelve un `GeoAuditInfo`
(texto para `detail` + los tres `double` sueltos) en vez de un `std::string` a secas — usado por
ambos handlers (`login/password`, `login/face`).

**Verificación end-to-end** (usuario de prueba desechable, mismo patrón que la verificación
anterior): login real vía `POST /api/auth/login/password` con
`location: {latitude: -16.409047, longitude: -71.537451, accuracy: 15.8}` → `SELECT` directo sobre
`auth_audit_logs` confirmó la fila con `latitude = -16.409047`, `longitude = -71.537451`,
`accuracy_m = 15.8` en las columnas nuevas, además del texto de siempre en `detail`.

## Referencias

- `frontend/src/auth/geolocation.ts` (captura, sin cambios en este ADR)
- `frontend/src/auth/authApi.ts` (`loginWithPassword`, `loginWithFace`)
- `frontend/src/components/Auth/AuthGateway.tsx` (`handlePasswordLogin`, `handleFaceLogin`,
  `pendingPasswordLocationRef`, `pendingLocationRef`)
- `backend/src/main.cpp` (`extractGeoAuditSuffix`, `handleLoginPassword`, `handleLoginFace`)
- `backend/src/auth/auth_storage_pg.{hpp,cpp}` (`loginPasswordPg`, `loginFaceTargetedPg`)
- `docs/integration/BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md` §3.1.1, §3.2, §8
- `external-api-test-page/index.html`, `api-test-harness.html`, `rp-test-harness.html` (páginas de
  prueba HTTP `:5190` / HTTPS `:5443`)
- `external-api-test-page/_proxy_common.py` (proxy inverso compartido), `serve_http.py` (nuevo),
  `serve_https.py` (refactorizado sobre el módulo compartido)
- `external-api-test-page/certs/openssl-san.cnf` (SAN del certificado autofirmado — regenerar si la
  máquina cambia de red, ver §8.3 de la guía de integración)
- `.env` (`BEEMETRY_CORS_ALLOWED_ORIGIN`)
- `external-api-test-page/actualizar-red-lan.ps1`, `Actualizar-Red-LAN.cmd` (automatiza los pasos de
  este ADR cada vez que la máquina cambia de red)
