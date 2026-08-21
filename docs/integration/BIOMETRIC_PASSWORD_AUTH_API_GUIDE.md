# Guía de integración — API de autenticación (contraseña/PIN + biometría facial) con soporte multitenant

> **Audiencia**: equipo de integración de un sistema externo (aplicación o servicio de otro
> proyecto) que necesita autenticar usuarios contra esta plataforma, usando **cualquiera de las
> dos vías admitidas** — contraseña (PIN) o verificación biométrica facial — con soporte de
> **multi-tenant** (un usuario puede pertenecer a más de una empresa/tenant).
>
> Este documento es autocontenido: no asume acceso al código fuente de la plataforma. Todo el
> contrato (endpoints, JSON, códigos de error) está descrito acá con ejemplos completos.
>
> Página de referencia funcional, con las dos vías implementadas y probadas:
> [`external-api-test-page/index.html`](../../external-api-test-page/index.html) — ver §6.

---

## 1. Resumen del modelo de autenticación

| Vía | Endpoint | Credencial |
|---|---|---|
| **Contraseña / PIN** | `POST /api/auth/login/password` | usuario + contraseña (texto) |
| **Biometría facial** | `POST /api/auth/login/face` | usuario + imagen de rostro (o template numérico) |

Ambas vías devuelven exactamente el **mismo objeto de sesión** (`user`, §3) — desde la perspectiva
de la integración, son intercambiables: la app cliente elige cuál ofrecer al usuario final (o
ambas), y el backend no distingue el origen de la sesión resultante para efectos de permisos o
multitenancy.

No existe un endpoint separado de "PIN" — si su sistema usa el término PIN para una credencial
corta tipo contraseña, use `login/password` con ese valor tal cual (el backend no impone un
formato específico salvo longitud mínima, ver §4.1).

---

## 2. Requisito previo: origen permitido (CORS)

El backend solo acepta peticiones cross-origin desde orígenes explícitamente autorizados
(`BEEMETRY_CORS_ALLOWED_ORIGIN` del lado de la plataforma, separado por comas). **Antes de
integrar**, comunique al equipo de la plataforma el origen exacto (esquema + host + puerto) desde
donde su aplicación hará las peticiones — por ejemplo `https://integracion.suempresa.com` o, en
pruebas locales, `http://localhost:PUERTO`. Sin ese paso, el navegador bloquea toda petición sin
importar si las credenciales son correctas (verá `TypeError: Failed to fetch` en el cliente, con
cero información útil en el propio error — es indicativo de este problema, no de un fallo de red).

Todas las peticiones autenticadas deben usar `fetch(..., { credentials: 'include' })` (o
equivalente) para que el navegador adjunte las cookies de sesión (§3.2), incluso si el token de
acceso viaja además en un header.

---

## 3. Autenticación

### 3.1 Login por contraseña / PIN

```
POST /api/auth/login/password
Content-Type: application/json

{
  "company": "Nombre exacto de la empresa (tenant)",
  "username": "usuario",
  "password": "contraseña o PIN",
  "location": { /* opcional -- ver §3.1.1 */ }
}
```

**Éxito** — `200 OK`:
```jsonc
{
  "status": "authenticated",
  "method": "password",
  "user": { /* ver §3.3 */ }
}
```

**Errores** — todos `401 Unauthorized` salvo el de bloqueo por intentos:
| `code` | Causa |
|---|---|
| `user_not_found` | no existe ese usuario en esa `company` |
| `ambiguous_identity` | el identificador coincide con más de un usuario (raro; reportar) |
| `wrong_password` | contraseña incorrecta |

`429 Too Many Requests` con `{"error":"too_many_failed_attempts"}` tras **5 intentos fallidos en
5 minutos** para el mismo par empresa+usuario (protección de fuerza bruta; el contador se reinicia
al primer login exitoso).

#### 3.1.1 Campo `location` (opcional, ambas vías — agregado 2026-08-17, ADR-107)

Ubicación geográfica (latitud/longitud) de la **PC, laptop o smartphone del usuario que hace el
login** — nunca la del servidor, y nunca inferida por IP. Es responsabilidad exclusiva del
**cliente** obtenerla (típicamente vía la API estándar `navigator.geolocation` del navegador, con
el diálogo de permiso nativo) y enviarla en el body de `login/password` o `login/face`:

```jsonc
"location": {
  "latitude": -12.0463731,      // grados decimales, -90..90
  "longitude": -77.0427934,     // grados decimales, -180..180
  "accuracy": 35.2,             // metros, opcional (radio de confianza del sensor)
  "captured_at": "2026-08-17T14:32:10.123Z"  // ISO-8601, opcional
}
```

- **Campo opcional en todo momento**: si el objeto falta, algún campo no es numérico, o
  `latitude`/`longitude` caen fuera de su rango válido, el backend lo **ignora en silencio** — la
  autenticación sigue su curso normal, con o sin ubicación. Nunca causa un `400` ni condiciona el
  resultado del login de ninguna forma.
- **Best-effort del lado del cliente**: si el usuario niega el permiso de ubicación, el dispositivo
  no tiene servicio de geolocalización, o el navegador tarda demasiado en resolver, simplemente
  omita el campo `location` (o mándelo como `null`) — no bloquee el login esperando la respuesta del
  SO/navegador.
- **Dónde queda guardado** (actualizado 2026-08-18): además del texto legible en el `detail` de la
  fila de auditoría (`auth_audit_logs`) del intento **exitoso**, las coordenadas quedan también en
  columnas dedicadas — `latitude`, `longitude`, `accuracy_m` (`double precision`, `NULL` si no se
  envió) — para poder filtrar/agregar por ubicación sin parsear texto (ver `db_scripts/58`,
  ADR-107). No participan en la decisión de autenticar ni se validan contra ninguna geocerca.
  Filas insertadas **antes** de esa migración quedan con esas columnas en `NULL` (la tabla es
  append-only — ver nota de privacidad abajo — así que no se pudieron backfillear
  retroactivamente); su dato de ubicación sigue disponible como siempre en el texto de `detail`.
- **Privacidad**: la ubicación geográfica es un dato personal sensible — más aún combinada con
  biometría facial en `login/face`. No la capture ni la envíe sin que el usuario haya dado su
  consentimiento explícito vía el diálogo nativo del navegador/SO (nunca intente omitir ese
  diálogo). Si su integración no tiene un caso de uso concreto para esto, simplemente no envíe el
  campo — es 100% opcional.

### 3.2 Login biométrico facial

```
POST /api/auth/login/face
Content-Type: application/json

{
  "company": "Nombre exacto de la empresa (tenant)",
  "identity_login": "usuario, DNI o RUC del usuario a autenticar",
  "face_image_base64": "<jpeg en base64, sin el prefijo data:image/...>",
  "location": { /* opcional -- mismo contrato que §3.1.1 */ }
}
```

El campo `face_image_base64` puede reemplazarse por `face_template: number[]` **solo** si su
sistema ya calcula embeddings faciales con la misma dimensionalidad que el backend (poco práctico
para una integración nueva — use `face_image_base64` salvo que ya tenga esa infraestructura).

**Cómo obtener el JPEG**: capture un frame de cámara (`getUserMedia` + `<canvas>` en el navegador,
o el mecanismo equivalente de su plataforma), codifíquelo como JPEG y conviértalo a base64. El
backend hace todo el trabajo pesado (extracción de embedding y comparación contra el template
guardado) — su cliente no necesita ningún modelo de IA local.

Opcionalmente, antes del login definitivo, puede llamar `POST /api/process_frame` en vivo con cada
frame capturado para dar feedback de calidad al usuario (ojos abiertos, rostro frontal, sin
anteojos) — ver §5 (esto es lo que usa el flujo de **registro**, no es obligatorio para el login).

**Éxito** — `200 OK`:
```jsonc
{
  "status": "authenticated",
  "method": "face",
  "biometric_provider": "insightface_onnx" /* o "legacy" / "client_embedding" */,
  "score": 0.87,
  "user": { /* ver §3.3, idéntico al de login por contraseña */ }
}
```

**Errores** (todos `401` salvo el de bloqueo) — mensajes en español, pensados para mostrarse
directo al usuario final:
| Causa | Ejemplo de mensaje |
|---|---|
| Falta `company` o `identity_login` | `"Indique usuario, DNI o RUC..."` |
| Usuario no existe en esa empresa | mensaje genérico de "no encontrado" |
| Identificador ambiguo | `"El identificador coincide con más de un registro..."` |
| Usuario sin biometría registrada | `"...no tiene biometría facial registrada de forma completa..."` |
| Rostro no coincide (score bajo umbral) | `"La biometría facial no coincide con el usuario indicado..."` |

`429 Too Many Requests` tras **5 intentos fallidos en 5 minutos** — contador **independiente** del
de contraseña (agotar los intentos faciales no bloquea el login por contraseña del mismo usuario,
y viceversa).

> **Nota de seguridad**: el score de similitud y el umbral de aceptación son responsabilidad del
> backend; no se documentan como parte del contrato porque pueden recalibrarse. No infiera nada de
> negocio a partir del valor numérico de `score` más allá de "por encima del umbral = aceptado".

### 3.3 Objeto `user` (idéntico en ambas vías de login, y en registro)

```jsonc
{
  "id": "6e97efb3-7020-3cba-d15b-c5836f93a259",
  "company": "Nombre de la empresa",
  "username": "usuario",
  "role": "admin | manager | supervisor | geologist | safety | operator | viewer",
  "access_token": "<JWT>",
  "expires_in": 900,
  "token_type": "Bearer",
  "full_name": "Nombre Apellido",
  "tenant_id": "uuid-del-tenant-activo",
  "avatar_cartoon_base64": "..."  // opcional
}
```

- **`access_token`**: JWT, vence en `expires_in` segundos (900 = 15 min). Reenvíelo en cada
  petición autenticada como header `Authorization: Bearer <access_token>`.
- **`tenant_id`**: el tenant **activo** de esta sesión — todas las operaciones subsecuentes quedan
  acotadas a él server-side (nunca confíe en un `tenant_id` que su propio cliente calcule; el
  backend lo resuelve e ignora cualquier valor de tenant que no sea el de la sesión).
- El **refresh token** (para renovar la sesión sin volver a pedir credenciales) **no** viaja en
  este JSON — llega en una cookie `HttpOnly` (`refresh_token`) que el navegador adjunta solo a
  peticiones bajo `/api/auth/*` de este mismo origen backend. Su código nunca necesita leerla.

### 3.4 Renovar sesión y cerrar sesión

```
POST /api/auth/refresh      # sin body; requiere la cookie refresh_token + header X-CSRF-Token
POST /api/auth/logout       # requiere Authorization: Bearer; + X-CSRF-Token si hay cookie activa
```

El valor de `X-CSRF-Token` se lee de la cookie `csrf_token_v2` (legible por JavaScript,
`document.cookie`) y se repite tal cual en el header. Patrón recomendado: al recibir `401` en
cualquier petición autenticada, llamar `refresh`, reintentar la petición original una vez; si
`refresh` también falla, tratar como sesión expirada.

---

## 4. Registro de usuario (si su integración también da de alta usuarios)

```
POST /api/auth/register
Content-Type: application/json

{
  "company": "...", "first_name": "...", "last_name": "...", "dni": "...",
  "username": "...", "password": "...",
  "role": "operator",              // opcional
  "ruc": "...", "phone": "...", "mobile": "...", "email": "...",  // opcionales
  "face_image_base64": "..."       // o face_template: number[]
}
```

Éxito → `200 OK`, `{"status":"registered", "user": {...}}` (mismo shape que login).

### 4.1 Validaciones y errores (`400 Bad Request` salvo donde se indique)

| Campo | Regla |
|---|---|
| `company`, `first_name`, `last_name`, `dni`, `username`, `password` | obligatorios |
| `dni` | solo numérico |
| `username` | mínimo 4 caracteres |
| `password` | mínimo 6 caracteres |
| biometría | requiere `face_image_base64` **o** `face_template` (uno de los dos) |

Si el rostro no puede procesarse (`"error": "face not detected"`), la respuesta incluye además
`provider` e `issues[]` (lista de motivos: pose no frontal, ojos cerrados, etc.) — útil para
mostrarle al usuario qué corregir y reintentar.

`409 Conflict` si el usuario/empresa ya existe (mensaje de la base de datos incluido en `error`).

---

## 5. Captura biométrica en vivo (opcional, solo si construye su propia UI de cámara)

Si su cliente implementa su propia interfaz de captura (en vez de un solo `POST` con la foto
final), estos tres endpoints dan feedback en vivo — todos requieren el header
**`X-Capture-Session-Id`** (un identificador único por sesión de captura, generado por su cliente;
aísla el estado de esta captura del de cualquier otro usuario concurrente):

| Método | Ruta | Body | Devuelve |
|---|---|---|---|
| POST | `/api/process_frame` | bytes JPEG crudos (no JSON) | `{"ok": true, "state": N}` |
| GET | `/api/status` | — | estado ICAO en vivo (ver abajo) + progreso de captura |
| GET | `/api/captured_images` | — | array de hasta 3 JPEGs (`data:image/jpeg;base64,...`) ya capturados y válidos |
| GET | `/api/reset_capture` | — | limpia el estado de esa sesión de captura |

Respuesta de `GET /api/status`:
```jsonc
{
  "state": 7, "state_name": "...",
  "capture_count": 3,       // 0-3; al llegar a 3 la captura está completa
  "icao": {"eyes_open": true, "mouth_closed": true, "face_straight": true, "no_glasses": true},
  "face_oval": {"cx": 240, "cy": 180, "w": 220, "h": 260, "angle_deg": 0},  // o null
  "liveness_score": 100
}
```

Flujo típico: capturar un frame cada ~700ms → `POST /api/process_frame` → `GET /api/status` →
mostrar el checklist ICAO al usuario → al llegar a `capture_count: 3`, llamar
`GET /api/captured_images` y usar la última imagen como `face_image_base64` en el registro o
login.

Este flujo es **opcional** — si su cliente ya tiene una foto de rostro por otro medio (documento
capturado previamente, etc.), puede saltarse todo esto y mandarla directo en `face_image_base64`.

---

## 6. Multitenancy

Un mismo usuario puede pertenecer a **más de una empresa (tenant)**. El login resuelve el tenant
activo automáticamente a partir de `company`; para cambiar de tenant dentro de la misma sesión sin
volver a pedir credenciales:

```
GET  /api/auth/tenants                       # requiere sesión (Bearer)
→ {"tenants": [{"tenant_id": "...", "tenant_name": "...", "role": "...",
                "is_default": true, "active": true}, ...]}

POST /api/auth/tenants/switch                # requiere sesión (Bearer)
     {"tenant_id": "uuid-de-uno-de-los-tenants-listados-arriba"}
→ {"ok": true, "access_token": "<nuevo JWT>", "expires_in": 900,
   "tenant_id": "...", "role": "..."}
```

- El backend **verifica membresía real** antes de emitir el nuevo token — no es posible pedir un
  `tenant_id` al que el usuario no pertenezca (se responde `403 no_pertenece_al_tenant`).
- El `access_token` cambia tras un switch (incluye el `tenant_id` nuevo en sus claims) — descarte
  el anterior y use el nuevo en adelante.
- El `role` también puede cambiar entre tenants (un usuario puede ser `admin` en un tenant y
  `operator` en otro).

Para consultar permisos efectivos del tenant activo:
```
GET /api/auth/permissions        # requiere sesión
→ {"role": "...", "tenant_id": "...", "is_admin": false, "permissions": ["informes.view", ...]}
```

---

## 7. Catálogos auxiliares (sin autenticación)

```
GET /api/auth/companies                    → {"companies": ["Empresa A", "Empresa B", ...]}
GET /api/auth/companies?country=EC         → mismo shape, filtrado por country_code (ver 7.1)
GET /api/auth/validate-company?ruc=...&country=PE
    → {"valid": true, "company_known": true, "ruc_matches_company": false}
GET /api/platform/countries                → catálogo de países (para selects de UI)
GET /api/platform/ui-languages             → catálogo de idiomas soportados
```

`validate-company` valida el checksum del identificador fiscal según el país (`country`, ISO2):
Perú (RUC), Brasil (CNPJ), Ecuador (RUC), Chile (RUT), EE.UU./Canadá (EIN/SSN estructural), Costa
Rica (cédula jurídica, validación estructural), y un fallback estructural genérico para el resto
del catálogo. No requiere sesión.

### 7.1 Selector país → empresa (soporte multiregión)

`?country=XX` (ISO2, agregado 2026-08-10) filtra el catálogo de empresas por el `country_code`
guardado en cada empresa — flujo recomendado para una UI de login con selector de país: elegir
país → cargar `GET /api/auth/companies?country=XX` → poblar el selector de empresa con ese
resultado → usar el nombre elegido como `company` en el login (§3). El parámetro es opcional y
retrocompatible: sin él, el comportamiento es idéntico al de antes (todas las empresas activas).

> **Estado real de los datos (2026-08-10)**: hoy **todas** las empresas del catálogo tienen
> `country_code = 'PE'` (incluido el valor por defecto de la columna) — el resto de países del
> catálogo (`GET /api/platform/countries`) devuelven una lista de empresas **vacía**, no un error.
> Esto es correcto dado el estado actual de los datos, no una limitación del endpoint: para que un
> integrador de otro país (Ecuador, Chile, Brasil, etc.) aparezca en el selector, su empresa debe
> darse de alta con el `country_code` real vía `POST /api/auth/companies` (requiere sesión con el
> permiso correspondiente) — o pedir al equipo de plataforma que la registre.

---

## 8. Multitenant + verificación biométrica/contraseña — página de login

**URL** (reemplace `<HOST>` por `localhost` en la misma máquina, o la IP de LAN de quien la sirve
para usarla desde otra PC — ver §8.2):

```
http://<HOST>:5190/           # HTTP
https://<HOST>:5443/          # HTTPS (certificado autofirmado, ver nota abajo)
```

Ejemplo con la IP de LAN actual de esta máquina (`192.168.18.50` — confirmar con `ipconfig` si
cambia):

```
http://localhost:5190/                https://localhost:5443/
http://192.168.18.50:5190/            https://192.168.18.50:5443/
```

[`external-api-test-page/index.html`](../../external-api-test-page/index.html) es la página de
login de referencia: **solo** hace login (no registro, no debug de endpoints) — exactamente las
dos vías de este documento, más el selector país→empresa de §7.1:

1. **País y empresa** — selects poblados desde la base de datos (§7, §7.1); la empresa elegida es
   el `company` de la sesión (multitenant).
2. **Contraseña / PIN** — pestaña "Contraseña / PIN": usuario + contraseña → §3.1.
3. **Verificación facial** — pestaña "Verificación facial": usuario + cámara (o imagen subida, o
   `face_template` sintético si no hay cámara) → §3.2.
4. **Sesión activa** — tras login exitoso, tarjeta con nombre, empresa, rol, tenant y vía usada;
   botón para cerrar sesión (§3.4).
5. **Log de peticiones/respuestas** — cada llamada real, para comparar contra los ejemplos de este
   documento durante su integración.

**Ubicación del cliente** (agregado 2026-08-17, ADR-107): al cargar la página se solicita, una sola
vez, la ubicación del dispositivo vía `navigator.geolocation` (mismo diálogo nativo de permiso del
navegador) — el badge junto a "Iniciar sesión" muestra el resultado (`solicitando…` /
coordenadas + precisión / `no disponible`). Si se obtiene, viaja en `location` (§3.1.1) tanto en el
login por contraseña como en el facial; si el usuario niega el permiso o el dispositivo no tiene
servicio de ubicación, el login sigue funcionando igual, sin ese campo. Click en el badge para
reintentar la solicitud (útil si se negó el permiso por error y luego se concede desde el candado
del navegador).

**Confirmación de captura y errores** (agregado 2026-08-10):
- Al completar las 3 muestras faciales válidas consecutivas (`capture_count: 3`, §5), aparece un
  popup modal de "Validación completada" — se dispara una sola vez por sesión de captura.
- Cualquier error (login rechazado, cámara no disponible, falta de país/empresa, fallo de red/CORS)
  se muestra en un banner rojo fijo arriba del formulario con el mensaje legible del backend (no
  solo el JSON crudo, que sigue disponible en el log de la sección 5 para depuración).

Para probar endpoints adicionales (registro, captura biométrica en vivo endpoint-por-endpoint,
`/api/auth/permissions`, etc. — no parte del flujo de login final) use el harness de QA completo:
[`external-api-test-page/api-test-harness.html`](../../external-api-test-page/api-test-harness.html)
(mismo servidor, mismos puertos, sufijo de ruta distinto).

### 8.1 Arquitectura: por qué `serve_http.py`/`serve_https.py` proxean `/api/*` (ambos, no solo HTTPS)

`https://<HOST>:5443/` usa un certificado **autofirmado** (`external-api-test-page/certs/`, SAN
para `localhost`/`127.0.0.1`/las IPs de LAN de la máquina que lo sirve — regenerar si la máquina
cambia de red, ver §8.3) — el navegador mostrará una advertencia de conexión no segura la primera
vez; es esperado, acéptela manualmente una vez por navegador. No es un certificado de una autoridad
pública — no reutilizar en producción.

**Ambos** protocolos sirven la página **y** proxean `/api/*` hacia el backend real
(`_proxy_common.py`, compartido por `serve_http.py` y `serve_https.py`), conectándose por
`127.0.0.1:8082` (loopback, siempre alcanzable desde el propio host). Los motivos:

1. **Cámara real** (`getUserMedia`): solo funciona en "contextos seguros" (HTTPS o `localhost`) —
   abrir la página por HTTP desde una IP de LAN deshabilita la cámara por restricción del propio
   navegador, sin excepción posible. Para eso existe la variante HTTPS.
2. **Mixed content (HTTPS)**: el backend real (puerto 8082) solo habla HTTP, sin variante HTTPS. Una
   página cargada por HTTPS que intentara llamar directo a ese backend HTTP sería bloqueada por el
   navegador como *"mixed content"* — un `TypeError: Failed to fetch` genérico, indistinguible a
   simple vista de un problema de CORS (diagnosticado en la sesión del 2026-08-10).
3. **Docker Desktop en Windows no publica puertos hacia la LAN (HTTP)** — hallazgo confirmado en la
   sesión del 2026-08-18: `docker ps` muestra los puertos de los contenedores como
   `0.0.0.0:5173->80/tcp`, pero eso **solo es alcanzable desde `localhost`/`127.0.0.1` de esa misma
   máquina** (backend WSL2 de Docker Desktop) — no hay ningún socket real escuchando en la interfaz
   de LAN (confirmable con `netstat -ano` en la máquina que sirve la página: no aparece ninguna línea
   `LISTENING` en `0.0.0.0:5173` pese a que `docker ps` lo reporta). Cualquier estrategia que
   dependiera de que otra PC llame directo a un puerto publicado por Docker (el frontend nginx en
   `:5173`, en una versión anterior de esta página) **nunca funcionaba** desde una segunda máquina —
   se manifestaba, otra vez, como el mismo `TypeError: Failed to fetch` genérico. Por eso
   `serve_http.py` (puerto 5190, sin TLS) proxea también — es un proceso Python nativo de Windows con
   un socket real en `0.0.0.0`, sí alcanzable desde la LAN, a diferencia de cualquier puerto
   publicado por Docker Desktop.

La página detecta su propio origen (`location.origin`) y lo usa siempre como "Backend base URL" —
sin importar protocolo, ni si se abrió por `localhost` o por una IP de LAN: el proxy de arriba hace
que ese origen sea siempre el destino correcto.

**Bugs de rendimiento encontrados y corregidos en el proxy** (por si alguien más lo toca):
- `http.server.HTTPServer` es de una sola conexión a la vez — con el proxy en el camino, cada
  petición de captura bloqueaba todas las demás. Corregido con `ThreadingHTTPServer`.
- El proxy resolvía el backend como `"localhost"`; en Windows eso intenta primero IPv6 (`::1`) y
  espera el timeout antes de caer a IPv4, agregando **~2 segundos fijos** a cada petición (medido:
  0.22s directo al backend vs 2.3s por el proxy). Corregido usando `127.0.0.1` explícito
  (`BACKEND_PROXY_HOST` si se necesita otro valor).

### 8.2 Ejecutarla desde otra computadora en la misma red local

1. En la máquina que sirve la página: `external-api-test-page/iniciar-pagina-prueba.bat` (HTTP,
   puerto 5190) y/o `iniciar-pagina-prueba-https.bat` (HTTPS, puerto 5443).
2. Averigüe la IP de esa máquina en su red local (`ipconfig` en Windows — la interfaz Wi-Fi/Ethernet
   real, no VPN/virtuales).
3. Desde la otra PC: `http://<esa-IP>:5190/` o `https://<esa-IP>:5443/` (recomendado si se quiere
   probar con cámara real desde esa otra PC — ver §8.1).

**Requisito de su lado**: el equipo de la plataforma debe haber agregado el origen exacto que use
la otra PC (`http://<esa-IP>:5190` y/o `https://<esa-IP>:5443`) a la allowlist de CORS del backend
(§2). Con el proxy de §8.1 esto ya no es estrictamente necesario para que la página funcione (la
llamada a `/api/*` queda same-origin, sin CORS de por medio) — pero sigue siendo defensa en
profundidad recomendada, y **sí** sigue siendo necesario para cualquier integración que llame al
backend directo desde otro origen (no a través de esta página de prueba).

### 8.3 Si la máquina que sirve la página cambia de red (IP de LAN nueva)

La IP de LAN de una laptop cambia con frecuencia (DHCP, o directamente otra red Wi-Fi). Cuando eso
pasa, dos cosas quedan desactualizadas y hay que corregirlas — **no es un defecto del código**, es
configuración dependiente de la red.

**Forma recomendada**: ejecutar `external-api-test-page/Actualizar-Red-LAN.cmd` (doble click) o
`actualizar-red-lan.ps1` — detecta la IP activa, hace los dos pasos de abajo, recrea el contenedor
del backend, reinicia los dos servidores de la página de prueba, y **verifica con peticiones reales**
que todo responde antes de imprimir las URLs listas para usar. Ver el detalle de qué corrige y los
bugs de PowerShell encontrados al construirlo en la "Actualización 2026-08-18 (2)" de ADR-107.

Los pasos manuales que ese script automatiza, por si hace falta entender o repetir alguno a mano:

1. **`BEEMETRY_CORS_ALLOWED_ORIGIN`** (`.env` de la plataforma): agregue el origen nuevo
   (`http://<IP-nueva>:5190`, `https://<IP-nueva>:5443`) sin necesariamente quitar los viejos, y
   recree el contenedor del backend (`docker compose up -d --no-deps web`) para que tome el `.env`
   actualizado.
2. **Certificado autofirmado** (`external-api-test-page/certs/`): su SAN lista IPs fijas
   (`openssl-san.cnf`). Agregue la IP nueva ahí y regenere con
   `openssl req -x509 -newkey rsa:2048 -nodes -keyout server.key -out server.crt -days 825 -config
   openssl-san.cnf -extensions v3_req`, luego reinicie `serve_https.py` (carga el certificado una
   sola vez, al arrancar).

Confirme siempre la IP activa con `ipconfig` / `Get-NetIPAddress` antes de asumir que algo se rompió
en el código — ver la "Nota operativa" de ADR-107 para el caso real que motivó esta sección.

---

## 9. Contacto

Ante cualquier duda sobre este contrato, o para solicitar el alta de un nuevo origen CORS,
contactar al equipo de plataforma AURIXA / Beemetry.
