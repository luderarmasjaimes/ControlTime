# ADR-133 — Endurecimiento post red-team: CSP, cookie cross-site y validación de entrada

**Status**: implemented, verificado en vivo (build Docker real + re-ejecución exacta de los 5
ataques del red-team contra el stack corriendo — ver Verificación)
**Fecha**: 2026-08-26
**Autores**: EC
**Ámbito**: plataforma

> Continuación directa de un ejercicio de red-team real contra el stack en vivo (mismo día,
> ver hallazgos citados abajo), pedido explícitamente para forzar el robo del access token por
> varias técnicas y luego cerrar lo que se encontrara. Referencia [ADR-132](132-bearer-en-memoria-cookies-namespaced-aislamiento-multifrontend.md)
> (Bearer-en-memoria, cuyo trade-off de exposición a XSS motivó el ejercicio).

## Contexto

El red-team ejecutó 5 ataques reales contra el stack corriendo en Docker (no simulados):

1. Lectura directa de cookies HttpOnly vía `document.cookie` → bloqueado (funciona como debe).
2. Interceptación del Bearer token vía hook de `window.fetch`/`XMLHttpRequest.setRequestHeader`
   (simula un XSS activo) → **éxito**: se capturó el token real en texto plano. Confirma el
   trade-off ya documentado en ADR-132 (un XSS puede robar el access token interceptando la
   función que lo envía, no solo leyendo la variable privada).
3. XSS almacenado vía `<img src=x onerror=...>`/`"><script>...` en `first_name`/`last_name` de
   registro → bloqueado por el escapado por defecto de React en el panel de administración
   probado, **pero la API los aceptó sin validar** (sin rechazo, sin sanitizar).
4. Canales encubiertos de exfiltración vía la propia CSP: `fetch()` a un host externo fue
   bloqueado (`connect-src`), pero un `<img>` a `https://` externo y un `WebSocket` a `wss://`
   externo **no lo fueron** — ambos intentaron la conexión real sin disparar
   `securitypolicyviolation`.
5. Falsificación cross-origin real: una página servida en `http://localhost:9091` (puerto
   distinto) logró que `GET /api/auth/permissions` se resolviera **autenticado como la víctima**
   a nivel de servidor (200, con los datos reales) porque `localhost:9091` y `localhost:5173`
   cuentan como el mismo "site" para `SameSite=Strict` (el puerto no participa en esa definición).
   La escritura (`POST /api/auth/logout` sin CSRF) sí fue rechazada (403) — el patrón de
   doble-envío de CSRF funcionó como debía.

Este ADR cierra los hallazgos #3, #4 y #5 (accionables sin rediseño), deja #2 documentado como
trade-off ya aceptado en ADR-132, y enumera técnicas adicionales evaluadas y explícitamente
diferidas.

## Decisión

### 1. `connect-src`: se retiran los tokens `ws:`/`wss:` desnudos (cierra hallazgo #4, parcial)
`connect-src 'self' ws: wss:` → `connect-src 'self'`, en `backend/src/http/router.cpp` y las 3
ubicaciones de `frontend/nginx.conf` (`/index.html`, `/assets/`, `location /`; se deja intacta la
CSP separada del Service Worker `tile-cache-sw.js`, que necesita `https:` para los tiles WMS
gubernamentales). `'self'` ya cubre el equivalente `ws`/`wss` del propio origen — los tokens de
esquema desnudo no significaban "mismo origen", significaban "cualquier host con ese esquema",
que es exactamente el canal que el red-team usó para abrir un WebSocket a un host arbitrario sin
que la CSP lo bloqueara. El WebSocket real de la app (`MapViewer.tsx`, `alarmStream.ts`) siempre
apunta a `${protocol}//${location.host}/ws` — estrictamente same-origin — así que el cambio no
afecta ninguna funcionalidad.

**`img-src https:` se deja tal cual** (no es un hallazgo nuevo, es un trade-off ya documentado y
deliberado desde 2026-07-07): `MapViewer.tsx` tiene un campo real de "WMS personalizado (URL
manual)" que permite apuntar a cualquier GeoServer propio del cliente minero; restringir a un
allowlist de hosts rompería esa función para cualquier WMS privado no listado. Sigue siendo un
canal de exfiltración encubierta *si* alguna vez hay un XSS (hallazgo #4 no cerrado del todo),
pero cerrarlo hoy exigiría sacrificar una función real ya usada — se documenta como riesgo
residual aceptado, no como omisión.

### 2. `report-uri` + endpoint de reporte de violaciones CSP (nuevo, detección)
Se agregó `report-uri /api/security/csp-report` a la CSP (mismas 4 ubicaciones). Nuevo endpoint
`POST /api/security/csp-report` (`main.cpp::handleCspReport`, registrado en `router.cpp`):
público, sin sesión ni CSRF (lo llama el navegador por su cuenta ante una violación real, nunca
JS de la página), solo registra (`[CSP_VIOLATION] ip=... <reporte>` a stderr) y responde `204`
— un reporte de CSP jamás debe poder fallar ni afectar nada. Rate-limit dedicado
(`zone=csp_report`, 20r/m) en `frontend/nginx.conf` para que no sirva de vector de flood/log-spam
contra un endpoint público sin autenticación.

Sin esto, exactamente el intento del hallazgo #4 (o cualquier intento real futuro) pasaba en
silencio: el navegador descarta la violación localmente si no hay dónde reportarla.

### 3. Cookie de sesión rechazada en requests cross-site (cierra hallazgo #5)
Nueva guarda en `auth::extractAuthTokenFromRequest` (`auth_session.cpp`): la cookie
`beemetry_access_token` solo se acepta como fallback de autenticación cuando la cabecera
**`Sec-Fetch-Site`** (Fetch Metadata, enviada por todo navegador moderno, no falsificable desde
JS) vale `same-origin` o `none`, o está ausente (fail-open solo ante su ausencia, para no romper
clientes no-navegador que ya dependieran de este fallback). Si la cabecera indica
`same-site`/`cross-site` **y** la cookie de sesión estaba presente, se registra
`[CROSS_SITE_COOKIE_BLOCKED] ip=... target=...` (señal de ataque real, no ruido — solo se
dispara cuando había una víctima logueada de por medio) y la request sigue sin sesión.

Esto es la vía correcta porque `SameSite=Strict` **no** distingue puerto/subdominio dentro del
mismo dominio registrable — exactamente el hueco que explotó el hallazgo #5 — mientras que
`Sec-Fetch-Site` sí lo hace (`same-origin` exige esquema+host+puerto idénticos). El header
`Authorization: Bearer` (la vía preferente, ADR-132) **no se ve afectado** en absoluto: un
integrador cross-app legítimo nunca dependió de "site" para nada, así que esta guarda no le
resta ninguna capacidad, solo le quita al fallback de cookie una que nunca debió tener.

### 4. Validación de entrada en campos de nombre libre (cierra hallazgo #3 en el borde)
Nuevo `security::Validator::isValidDisplayName(s, maxLen)` (`validators.hpp`): rechaza vacío,
longitud > `config::auth::kDisplayNameMaxLength` (120; 180/200 para nombre de empresa) y los
caracteres `<`/`>` o de control (excepto tab). No prohíbe `'`/acentos — son parte normal de
nombres reales (O'Higgins, Muñoz, José María). Se aplica a:
- `POST /api/auth/register` (`main.cpp`) — `first_name`, `last_name`, `company`.
- Alta de usuario admin-driven (`auth_routes.cpp`) — `first_name`, `last_name`.
- Alta de empresa (`auth_routes.cpp`) — `name` (junto al límite de longitud ya existente).

No había XSS explotable en el punto probado (React escapa por defecto), pero la API aceptaba el
marcado HTML sin ningún rechazo — validar en el borde es defensa en profundidad barata ante
cualquier vista futura que renderice estos campos sin el mismo cuidado (export PDF/CSV, un panel
nuevo), y evita que nombres con marcado HTML queden guardados en BD/auditoría en primer lugar.

## Consecuencias

### Positivas
- Dos canales de exfiltración (`ws:`/`wss:` arbitrario) cerrados sin romper funcionalidad real.
- Violaciones de CSP futuras (incluyendo el propio `img-src https:` residual, punto 1) ahora se
  ven en los logs del backend en vez de perderse silenciosamente en el navegador de la víctima.
- El hueco de lectura cross-site (hallazgo #5, el más señalado por el ejercicio) queda cerrado a
  nivel de servidor, para toda la API, no endpoint por endpoint — y queda instrumentado como
  señal de detección.
- Cero regresión esperada: los 3 cambios se verificaron contra los flujos reales que podían
  romperse (WebSocket same-origin, integraciones Bearer, nombres con acentos/apóstrofes).

### Negativas / Trade-offs
- `img-src https:` (hallazgo #4, la mitad no cerrada) sigue siendo un canal de exfiltración
  encubierta condicionado a que exista un XSS — trade-off consciente por la función real de WMS
  personalizado, no una omisión.
- El fail-open de la guarda de `Sec-Fetch-Site` ante su ausencia significa que un cliente
  no-navegador que falsifique esa cabecera (algo que SÍ puede hacer curl, a diferencia de un
  navegador real) podría seguir colándose por el fallback de cookie. Esto es aceptable porque el
  fallback de cookie es, por diseño, para compatibilidad con navegadores reales — cualquier
  cliente no-navegador ya tiene la vía correcta (`Authorization: Bearer`), no depende de esto.

## Técnicas adicionales evaluadas y diferidas (no implementadas en esta entrega)

- **Trusted Types** (`require-trusted-types-for 'script'`): **intentado y revertido, ver
  ADR-134**. Se auditaron y envolvieron los 3 sinks reales de código propio
  (`MiningDashboard.tsx`, `ReadOnlyViewer.tsx`, `TableBlock.tsx` — `sanitizeHtml.ts`/
  `AlarmConfigView.tsx` no eran sinks reales, solo mencionados en comentarios) vía una política
  nombrada (`frontend/src/lib/trustedHtml.ts`), y se activó la directiva en vivo. Rompió
  ECharts (usado por el dashboard de minería): escribe `innerHTML` internamente sin pasar por
  ninguna política, y el navegador lo bloqueaba, tumbando el chart entero. Revertido; el
  wrapping de los 3 sinks propios queda en el código (no-op sin la directiva activa), listo para
  reactivarse si se resuelve la incompatibilidad con ECharts.
- **Self-hospedar Tailwind (quitar `cdn.tailwindcss.com` de `script-src`)**: eliminaría la única
  dependencia de script externo de la CSP (hoy un compromiso de esa CDN tendría `script-src`
  habilitado). Requiere migrar de Tailwind Play CDN a un build real vía PostCSS — cambio de
  pipeline de build, no de una línea; se recomienda como iniciativa aparte.
- **`Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy`**: aislamiento adicional a nivel
  de proceso del navegador. Se evaluó agregarlas junto con este ADR pero se difiere: no se
  verificó si algún flujo (reconocimiento facial, popups) depende de una relación cross-origin
  con una ventana/iframe que estos headers cortarían — necesita su propia prueba antes de
  activarse en producción.
- **Endurecer aún más `img-src`** (p.ej. exigir que la app enrutara los tiles WMS a través de un
  proxy propio del backend en vez de `<img>` directo al host externo): cerraría el hallazgo #4 por
  completo, pero es un cambio de arquitectura del visor de mapas, no de configuración — se anota
  como la vía correcta a mediano plazo si el riesgo de exfiltración vía imagen llega a pesar más
  que el costo de ese refactor.

## Verificación (2026-08-26, en vivo)

Con el stack reconstruido y recreado (`docker compose build web frontend` + `up -d
--force-recreate`), se repitieron en vivo los ataques del red-team que este ADR dice cerrar:

1. **CSP `connect-src`**: cabecera servida confirmada como `connect-src 'self';` (sin `ws:`/
   `wss:` desnudos) + `report-uri /api/security/csp-report`. Un `new WebSocket('wss://evil-...')`
   ahora dispara `securitypolicyviolation` (`connect-src`) y es bloqueado — antes se conectaba
   sin ninguna violación. Un `new WebSocket(proto+location.host+'/ws')` (el patrón real de
   `alarmStream.ts`/`MapViewer.tsx`) sigue abriendo con `state: "open"`, sin violación — cero
   regresión funcional.
2. **Endpoint de reporte**: `POST /api/security/csp-report` con un `csp-report` de ejemplo →
   `204 No Content`, y aparece en el log del backend: `[CSP_VIOLATION] ip=... {...}`.
3. **Guarda cross-site de la cookie de sesión**: se repitió EXACTAMENTE el ataque #5 original
   (página en `http://localhost:9091`, `fetch('http://localhost:5173/api/auth/permissions',
   {credentials:'include'})` con la víctima ya logueada en otra pestaña). Antes: `200`, 481
   bytes, datos reales de la víctima. Ahora: **`401`, 24 bytes** (`{"error":"unauthorized"}`), y
   el backend registra `[CROSS_SITE_COOKIE_BLOCKED] ip=... target=/api/auth/permissions` — la
   señal de detección funciona. La misma request hecha desde la propia pestaña de la víctima
   (same-origin) sigue devolviendo `200` con los datos reales, sin ningún cambio.
4. **Validación de nombres**: registro con `first_name="<img src=x onerror=alert(1)>"` →
   `400 Bad Request` (antes: `201 Created`, sin ningún rechazo). Registro con
   `first_name="José María"`, `last_name="O'Higgins Muñoz"` (acentos + apóstrofe, nombres reales)
   → `201 Created` sin problema — la validación no rompe nombres legítimos.

## Referencias
- `backend/src/http/router.cpp` (`kCspValue`)
- `frontend/nginx.conf` (3 bloques CSP + zona `csp_report` + location `/api/security/csp-report`)
- `backend/src/main.cpp` (`handleCspReport`, validación en `register`)
- `backend/src/auth/auth_routes.cpp` (validación en alta de usuario/empresa)
- `backend/src/auth/auth_session.cpp` (`isCrossSiteCookieRequest`, `extractAuthTokenFromRequest`)
- `backend/src/security/validators.hpp` (`isValidDisplayName`)
- `backend/src/config/constants.hpp` (`kDisplayNameMaxLength`)
- [ADR-132](132-bearer-en-memoria-cookies-namespaced-aislamiento-multifrontend.md) (Bearer-en-memoria, trade-off de XSS que motivó el ejercicio de red-team)
