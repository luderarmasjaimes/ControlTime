# Página de prueba — API de registro y validación biométrica

Tres páginas standalone (HTML/CSS/JS, sin dependencias externas, sin paso de build) para probar el
backend **desde un origen genuinamente externo** a la plataforma (no el frontend real, no el proxy
de Vite) — igual que lo haría la app de un tercero integrando contra este backend:

- [`external-api-test-page/index.html`](../../external-api-test-page/index.html) — login
  (contraseña/PIN o verificación facial, con selector país→empresa, multitenant/multiregión) **más**,
  una vez autenticado, una sección "Control de Accesos / Organización" (ADR-130) con empresas,
  matriz de permisos y acceso cruzado de organización (`/api/auth/org-access/*`) — ver
  [`ACCESS_CONTROL_API_GUIDE.md`](ACCESS_CONTROL_API_GUIDE.md) §7. Es la página de referencia para
  un integrador externo — ver también
  [`BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md`](BIOMETRIC_PASSWORD_AUTH_API_GUIDE.md) (documento
  autocontenido para ese público).
- [`external-api-test-page/api-test-harness.html`](../../external-api-test-page/api-test-harness.html) —
  harness completo de QA: además del login, `POST /api/auth/register`, captura biométrica
  endpoint-por-endpoint (`/api/process_frame`, `/api/status`, `/api/captured_images`),
  `/api/auth/permissions`, logout. Este documento describe **ese** archivo (§3).

Ambas páginas comparten servidor/puertos/certificado — ver §2. Contrato de referencia completo:
[`EXTERNAL_FRONTEND_AUTH.md`](EXTERNAL_FRONTEND_AUTH.md).

Una tercera página, agregada 2026-08-10, cubre la integración RP (catálogo de equipos replicado
desde TimeTelemetry/Odoo, ADR-103) para una aplicación externa **distinta** de esta plataforma:
[`external-api-test-page/rp-test-harness.html`](../../external-api-test-page/rp-test-harness.html)
— login, lista/detalle/sync-status, alta/edición asíncrona y el canal WebSocket en vivo. Mismo
servidor/puertos que las otras dos. Documento de referencia (contrato completo, audiencia
"integrador externo"): [`RP_TIMETELEMETRY_API_GUIDE.md`](RP_TIMETELEMETRY_API_GUIDE.md). Verificado
en vivo (2026-08-10) contra el backend real con un peer real de TimeTelemetry activo: login, check
de CORS, WebSocket recibiendo `rp_equipment_updated` real, lista y detalle — sin errores de consola.

## 0. Acceso desde otra PC de la red (LAN) {#acceso-lan}

**Sí está soportado**, pero con una arquitectura específica — analizado y probado el 2026-08-10.

**No se publica el backend (puerto 8082) al LAN.** `docker-compose.yml` (línea ~351) lo liga a
propósito solo a `127.0.0.1`: publicarlo al host completo "duplicaría el endpoint sin
CSP/headers/rate-limit de nginx" (comentario original del proyecto). Esa decisión de seguridad se
preserva sin cambios.

En su lugar, cuando esta página se abre desde otra PC por IP (no `localhost`), detecta
automáticamente el origen y apunta al **frontend nginx ya publicado en el puerto 5173**
(`0.0.0.0:5173`, contenedor `beemetry-web`), que proxifica `/api/` al backend interno conservando
sus cabeceras de seguridad (`frontend/nginx.conf`, `location /api/`). El campo "Backend base URL"
de la sección 0 se puede editar manualmente si se prefiere otro destino.

Verificado con el flujo completo (catálogos, registro, login por contraseña, login facial) desde
un origen `http://192.168.18.50:5190` real contra `http://192.168.18.50:5173`, con
`Access-Control-Allow-Origin` reflejando exactamente ese origen.

### Bug encontrado y corregido: `crypto.randomUUID()` en contexto no seguro

Los navegadores exponen `crypto.randomUUID()` y `navigator.mediaDevices.getUserMedia()`
únicamente en **contextos seguros** (`https://` o `http://localhost`) — **no** en
`http://<ip-lan>:5190`, que es exactamente el caso de otra PC abriendo esta página por IP. La
primera versión de esta página llamaba `crypto.randomUUID()` en la segunda línea del script sin
comprobar disponibilidad: en ese origen la excepción mataba **todo el script en silencio** (ningún
botón respondía, sin ningún error visible en pantalla).

Corregido con:
- Un generador de id de sesión con *fallback* a `crypto.getRandomValues` (sí disponible en
  contextos no seguros) o `Math.random()` — no se necesita aleatoriedad criptográfica para
  `X-Capture-Session-Id`, solo unicidad por pestaña.
- Un mensaje explícito si se pulsa "Iniciar cámara" en un origen no seguro, en vez de un error
  críptico: `getUserMedia` **no tiene fallback posible** sin HTTPS — desde otra PC use "subir
  imagen" o el `face_template` sintético (sección 3 de la página).

### Requisito de red

La otra PC debe estar en la misma red que reporta Windows para la interfaz Wi‑Fi
(`192.168.18.50` en esta máquina — confirmar con `ipconfig` si cambia). El firewall de Windows ya
permite el tráfico entrante necesario sin reglas adicionales: la regla existente "Docker Desktop
Backend" (perfil Público) cubre cualquier puerto publicado por Docker (mismo mecanismo que ya
permite el gateway minero en 8443), y "Vite Dev Server"/`python.exe` ya cubren 5180/5190/5443
respectivamente.

### HTTPS (puerto 5443) — necesario para cámara real desde otra PC

`getUserMedia` (cámara) exige "contexto seguro" (HTTPS o `localhost`) — por HTTP y por IP de LAN
el navegador ni siquiera expone `navigator.mediaDevices`, sin excepción posible (a diferencia del
fallback que sí existe para `crypto.randomUUID`, ver abajo). Para que la cámara real funcione
también desde otra PC, se agregó `external-api-test-page/serve_https.py` — servidor HTTPS con
certificado autofirmado (`external-api-test-page/certs/`, generado con SAN para
`localhost`/`127.0.0.1`/`192.168.18.50`, ver `certs/openssl-san.cnf`), puerto 5443. El navegador
mostrará una advertencia de conexión no segura la primera vez (autofirmado, no CA pública) —
aceptarla manualmente una vez.

#### Este servidor también es proxy inverso de `/api/*` — y por qué

El backend (puerto 8082) solo habla HTTP, sin variante HTTPS. La primera versión de
`serve_https.py` era un servidor estático puro con el campo "Backend base URL" apuntando a
`http://localhost:8082` — una página HTTPS llamando directo a ese destino HTTP es bloqueada por el
navegador como **mixed content**, reportado por el usuario como conectividad totalmente rota tras
cambiar a HTTPS (`TypeError: Failed to fetch`, exactamente el mismo síntoma genérico que un
problema de CORS — no hay forma de distinguirlos solo por el mensaje). Corregido: el servidor ahora
reenvía toda ruta `/api/*` al backend y devuelve la respuesta tal cual, para que la página y el API
queden en el mismo origen HTTPS; la página detecta que se abrió por `https:` y usa
`location.origin` como backend base URL en vez del default `http://localhost:8082`.

Ese mismo cambio introdujo dos bugs de rendimiento reales, encontrados con mediciones directas
(`curl -w "%{time_total}"`), no solo revisión de código:

| Síntoma reportado | Causa | Fix |
|---|---|---|
| Captura en vivo muy lenta, óvalo no sigue el rostro en tiempo real | `http.server.HTTPServer` atiende una sola conexión a la vez; con el proxy en el camino, cada petición de captura bloqueaba las demás | `http.server.ThreadingHTTPServer` |
| Cada petición proxeada tardaba ~2.3s (medido) vs 0.22s yendo directo al backend | El proxy resolvía el backend como `"localhost"` — en Windows eso intenta primero IPv6 (`::1`), espera el timeout, y recién cae a IPv4 | `BACKEND_PROXY_HOST` default cambiado a `127.0.0.1` explícito |

Después de ambos fixes, `/api/process_frame` a través del proxy HTTPS mide ~0.25s — prácticamente
igual que yendo directo al backend.

### `rp-test-harness.html` desde otra PC — WebSocket a través del mismo proxy

Aplica todo lo de arriba (detección automática de origen → `http://<ip-lan>:5173`, requisito de
red, HTTPS opcional) — **sin** las secciones de cámara/`crypto.randomUUID`, que no usa. Lo único
específico de esta página es que además abre un **WebSocket** (`GET /ws?auth_token=...`, §7 de
`RP_TIMETELEMETRY_API_GUIDE.md`), y ese canal necesita el mismo proxy que el resto de la API para
funcionar desde otra PC — no es automático solo por reusar el mismo backend base URL.

**Confirmado que funciona** (verificado 2026-08-11, abriendo la página como
`http://192.168.18.50:5190/rp-test-harness.html`, es decir simulando una segunda PC real): la
página detecta `http://192.168.18.50:5173` como backend, y con eso:
- `GET /api/rp/equipment` (REST) responde con los datos reales de la réplica.
- El WebSocket conecta contra `ws://192.168.18.50:5173/ws?auth_token=...` y funciona — porque
  `frontend/nginx.conf` ya tiene un bloque dedicado `location /ws { proxy_pass ...; proxy_set_header
  Upgrade $http_upgrade; proxy_set_header Connection "Upgrade"; ... }` (línea ~210), no solo
  `location /api/`. Sin ese bloque el fetch REST hubiera funcionado pero el WebSocket se hubiera
  quedado colgado o cerrado sin explicación — el mismo síntoma genérico de mixed content/CORS de la
  sección anterior, pero por una causa distinta (falta de soporte de upgrade HTTP en el proxy).
- Por HTTPS (`https://192.168.18.50:5443/rp-test-harness.html`) el WebSocket se abre como
  `wss://` — mismo criterio que el resto de la página (nunca mixed content, mismo origen que la
  página).

No se requirió ningún cambio de código para esto — `rp-test-harness.html` reusa el mismo mecanismo
de detección de origen que `api-test-harness.html`, y `nginx.conf` ya soportaba `/ws` de antes (lo
usa el resto de la plataforma, ver `frontend/src/lib/alarmStream.ts`).

## 1. Por qué necesita configuración de CORS

El frontend real de AURIXA nunca es "cross-origin" desde el punto de vista del navegador: en
desarrollo pasa por el proxy de Vite, y en producción queda detrás de nginx en el mismo origen que
el backend. Por eso el gap de CORS descrito abajo nunca se había notado.

Esta página de prueba, en cambio, se sirve deliberadamente en **su propio puerto (5190)** — un
origen distinto al del backend (`http://localhost:8082`) — para que las peticiones sean
cross-origin de verdad y ejerciten el mismo camino que usaría una integración externa real.

### Fix aplicado (2026-08-10)

`backend/src/http/http_utils.cpp` — la función `applyCorsHeaders()` fijaba
`Access-Control-Allow-Headers` a una lista estática (`content-type,authorization,x-csrf-token`)
que **no incluía `x-capture-session-id`**, el header que aísla el estado de captura biométrica
por pestaña (ADR-098). Cualquier app realmente cross-origin que llamara a `/api/process_frame` o
`/api/status` con ese header habría fallado el preflight `OPTIONS` — el navegador bloquea la
petición real antes de que llegue al backend. Se agregó `x-capture-session-id` a la allowlist.
Esto requirió recompilar el backend (cambio en C++, no solo configuración).

### Variable de entorno

```
BEEMETRY_CORS_ALLOWED_ORIGIN=http://localhost:5173,http://localhost:5180,http://localhost:5190,http://192.168.18.50:5190,https://localhost:5443,https://192.168.18.50:5443
```

Configurada en `.env` (raíz del repo, no se commitea). Lista separada por comas de orígenes
exactos (`protocolo://host:puerto`) permitidos; `router.cpp::applyCorsOriginOverride` refleja el
origen de la request únicamente si coincide exactamente con uno de la lista (ADR-081). Si sirve
esta página en otro puerto, agregue ese origen exacto aquí y reinicie el contenedor `web`:

```bash
docker compose up -d --no-deps web
```

(Es una variable de entorno en runtime — no requiere reconstruir la imagen, salvo por el fix de
código de la sección anterior, que sí lo requirió una vez.)

## 2. Cómo servirla

Debe servirse por HTTP o HTTPS (no abrir el `.html` con `file://`) para tener un origen real que
el navegador envíe en el header `Origin`. Ambos protocolos sirven **la misma carpeta** — `index.html`
(login) y `api-test-harness.html` (QA completo) están disponibles en los dos.

**HTTP, doble clic (Windows):**
[`external-api-test-page/iniciar-pagina-prueba.bat`](../../external-api-test-page/iniciar-pagina-prueba.bat)
— requiere Python 3 en el PATH, sirve la carpeta en `http://localhost:5190`.

**HTTPS, doble clic (Windows):**
[`external-api-test-page/iniciar-pagina-prueba-https.bat`](../../external-api-test-page/iniciar-pagina-prueba-https.bat)
— puerto 5443, certificado autofirmado (§0). Necesario para cámara real desde otra PC de la LAN.

**Manual:**
```bash
python -m http.server 5190 --directory external-api-test-page      # HTTP
python external-api-test-page/serve_https.py 5443                  # HTTPS
```

URLs resultantes:
```
http://localhost:5190/index.html               # login
http://localhost:5190/api-test-harness.html     # QA completo
http://localhost:5190/rp-test-harness.html      # API RP (TimeTelemetry/Odoo, ADR-103)
https://localhost:5443/index.html
https://localhost:5443/api-test-harness.html
https://localhost:5443/rp-test-harness.html
```
(sustituir `localhost` por la IP de LAN de la máquina que la sirve para usarla desde otra PC — §0).

## 3. Uso del harness completo (`api-test-harness.html`)

Secciones, en orden de uso típico:

0. **Configuración** — URL base del backend (`http://localhost:8082` por defecto). Botón
   "Probar conectividad + CORS": hace un `GET /api/platform/countries` sin autenticación; si falla
   con `status: 0` y `network_or_cors_error`, es casi siempre un origen faltante en
   `BEEMETRY_CORS_ALLOWED_ORIGIN` (el navegador nunca deja ver la respuesta real en ese caso).
1. **Catálogos** — carga países (`GET /api/platform/countries`) y empresas
   (`GET /api/auth/companies`) para poblar los selects/autocompletar usados más abajo.
2. **Validar identificador fiscal** — `GET /api/auth/validate-company?ruc=...&country=...`.
   Ejercita los validadores de checksum (Perú RUC, Brasil CNPJ, US/CA EIN/SSN, Ecuador RUC, Chile
   RUT, Costa Rica cédula jurídica, fallback genérico — ADR-102).
3. **Captura biométrica** — dos caminos:
   - **Cámara real**: "Iniciar cámara" → "Iniciar captura en vivo" envía frames cada ~700ms a
     `POST /api/process_frame` (bytes JPEG crudos en el body, no JSON) con el header
     `X-Capture-Session-Id`, y consulta `GET /api/status` tras cada frame para mostrar el checklist
     ICAO (ojos abiertos, boca cerrada, rostro frontal, sin lentes) y el óvalo facial detectado.
     Al llegar a 3 muestras válidas, se detiene sola y descarga las imágenes capturadas vía
     `GET /api/captured_images`.
   - **Sin cámara**: subir una imagen de rostro y enviarla como frame único, o marcar
     "usar `face_template` sintético" para probar el contrato de registro/login sin ninguna imagen
     real (un vector numérico determinístico de 512 posiciones — el backend acepta
     `face_template: number[]` como alternativa a `face_image_base64`).
   - "Reset captura" limpia el estado de la sesión (`GET /api/reset_capture`).
4. **Registro** — `POST /api/auth/register`. Usa la última imagen válida capturada o el
   `face_template` sintético, según lo que esté disponible/marcado en la sección 3. Botón
   "Autogenerar datos de prueba" rellena usuario/contraseña/DNI únicos por timestamp.
5. **Login por contraseña** — `POST /api/auth/login/password`.
6. **Login facial** — `POST /api/auth/login/face`, misma fuente biométrica que el registro.
7. **Sesión obtenida** — muestra el `access_token` recibido (registro o login), y permite probar
   `GET /api/auth/permissions` y `POST /api/auth/logout` con él.
8. **Log de peticiones/respuestas** — cada llamada queda registrada (método, ruta, status, latencia,
   cuerpo de respuesta con campos largos —imágenes base64, `face_template`— truncados para
   legibilidad). Útil para depurar contra el backend real igual que se hizo con los logs de
   Docker durante esta sesión.

Todas las peticiones usan `credentials: 'include'` (para que el navegador adjunte/reciba la cookie
`refresh_token` HttpOnly, ADR-082) y agregan automáticamente `Authorization: Bearer <token>` una
vez que hay una sesión activa.

## 4. Troubleshooting

| Síntoma | Causa probable |
|---|---|
| `status: 0`, `network_or_cors_error` en el log | Origen no está en `BEEMETRY_CORS_ALLOWED_ORIGIN`, o el backend no está corriendo/accesible en la URL configurada. |
| Preflight `OPTIONS` falla solo en `/api/process_frame` o `/api/status` | Backend corriendo con una imagen anterior al fix de `x-capture-session-id` en `Access-Control-Allow-Headers` (sección 1) — reconstruir. |
| `403 csrf_token_mismatch` | Solo debería ocurrir en `/api/auth/refresh` o `/api/auth/logout` si hay una cookie de sesión activa sin el header `X-CSRF-Token`; esta página no implementa refresh — para probarlo, agregar manualmente el header con el valor de la cookie `csrf_token_v2`. |
| Cámara no disponible / permiso denegado | Use la alternativa de subir imagen, o el `face_template` sintético. |
| `face not detected` en registro con imagen subida | La imagen no contiene un rostro reconocible por el pipeline (InsightFace/MediaPipe/Haar legacy) — pruebe con otra foto, o use `face_template` sintético para aislar si el problema es de detección facial vs. del resto del flujo de registro. |
| `409` / `error` de usuario duplicado en registro | El botón "Autogenerar datos de prueba" genera usuario/DNI únicos por timestamp — vuelva a generarlos antes de reintentar. |
| `TypeError: Failed to fetch` **solo** al usar `https://...:5443/` (funcionaba por HTTP) | Mixed content: la página HTTPS intentando llamar a `http://localhost:8082` directo. Confirme que "Backend base URL" muestre el mismo origen que la página (`https://<host>:5443`), no `http://localhost:8082` — ver §0. |
| Captura en vivo lenta / óvalo no sigue el rostro en tiempo real, solo en HTTPS | Regresión ya corregida (§0: `ThreadingHTTPServer` + `127.0.0.1` explícito en `serve_https.py`) — confirmar que el servidor HTTPS corre la versión actual del script (reiniciarlo tras cualquier cambio ahí). |

## 5. Seguridad

Herramienta de prueba, no un cliente de producción:
- No usar credenciales productivas reales.
- El `access_token` se guarda solo en memoria de la página (variable JS), no en localStorage.
- `BEEMETRY_CORS_ALLOWED_ORIGIN` debe contener únicamente orígenes de confianza; no usar `*` en
  ningún entorno con cookies de sesión (`Access-Control-Allow-Credentials: true` + wildcard origin
  es una combinación que los navegadores rechazan de todas formas, pero el backend tampoco lo
  ofrece — ADR-081/082).
