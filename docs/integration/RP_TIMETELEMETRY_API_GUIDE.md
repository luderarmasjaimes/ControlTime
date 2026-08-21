# Guía de integración — API RP (catálogo de equipos, TimeTelemetry/Odoo)

> **Audiencia**: equipo de integración de una aplicación externa (otro proyecto, otro repo) que
> necesita leer y/o escribir el catálogo de equipos mineros replicado desde TimeTelemetry (Odoo 17)
> a través de este backend — **nunca directo contra TimeTelemetry ni contra ninguna base de datos**
> (ver ADR-103 para el porqué).
>
> Este documento es autocontenido: no asume acceso al código fuente de la plataforma. Todo el
> contrato (endpoints, JSON, códigos de error, WebSocket) está descrito acá con ejemplos completos.
>
> Página de referencia funcional, con las seis peticiones documentadas ya implementadas y
> probadas contra un backend real:
> [`external-api-test-page/rp-test-harness.html`](../../external-api-test-page/rp-test-harness.html)
> — ver §8.

---

## 1. Qué expone esta API

Este backend mantiene una **réplica local** (Postgres) del catálogo `maintenance.equipment` de
TimeTelemetry, sincronizada por backfill + polling incremental. Su aplicación:

- **Lee** esa réplica — respuesta local, sin depender de la disponibilidad ni la latencia de
  TimeTelemetry en cada request.
- **Escribe** de forma **asíncrona**: un `POST`/`PUT` queda confirmado localmente en milisegundos
  (`202 Accepted`) y se propaga a TimeTelemetry en segundo plano vía XML-RPC — su aplicación debe
  sondear o escuchar (§6, §7) para saber cuándo el cambio quedó reflejado realmente en Odoo.

```
Su app (otro origen)                    Este backend                    TimeTelemetry/Odoo
       │  Bearer JWT                         │                                 │
       │──── GET /api/rp/equipment ─────────►│── lee réplica local (rápido) ───┤ (no se toca)
       │──── POST /api/rp/equipment ────────►│── ack local 202 + cola ─────────►│ create/write XML-RPC
       │◄──── WS rp_equipment_updated ────────│◄── confirmación asíncrona ──────│ (background)
```

Ninguno de estos endpoints requiere que su aplicación conozca XML-RPC, Odoo, ni tenga
credenciales de TimeTelemetry — eso lo administra exclusivamente este backend.

---

## 2. Requisito previo: origen permitido (CORS) y sesión

Igual que el resto de la plataforma (ver
[`EXTERNAL_FRONTEND_AUTH.md`](EXTERNAL_FRONTEND_AUTH.md), contrato completo de auth/RBAC):

1. El origen exacto de su aplicación (`esquema://host:puerto`) debe estar en
   `BEEMETRY_CORS_ALLOWED_ORIGIN` del backend — comuníquelo al equipo de plataforma antes de
   integrar. Sin esto verá `TypeError: Failed to fetch` sin información útil.
2. Necesita una sesión (`POST /api/auth/login/password`, ver §3) con un usuario que tenga los
   permisos `rp.equipment.view` y/o `rp.equipment.edit` en su tenant — pídalos al equipo de
   plataforma si su usuario de integración no los tiene (§4).
3. **El canal WebSocket (§7) no pasa por la allowlist de CORS** — solo necesita un token válido en
   la URL de conexión. No hace falta registrar el origen para ese camino específicamente, pero sí
   para el resto de esta API (REST).

---

## 3. Autenticación (resumen — contrato completo en `EXTERNAL_FRONTEND_AUTH.md`)

```
POST /api/auth/login/password
Content-Type: application/json

{"company": "Nombre exacto del tenant", "username": "...", "password": "..."}
```

→ `200 OK`, `{"status":"authenticated","user":{"access_token":"<JWT>","expires_in":900,"tenant_id":"...","role":"...", ...}}`

Reenvíe `access_token` en cada petición REST de esta guía como header
`Authorization: Bearer <access_token>` (vence en 900s / 15min — renueve con
`POST /api/auth/refresh`, ver `EXTERNAL_FRONTEND_AUTH.md` §2). Todas las peticiones deben usar
`credentials: 'include'` (o equivalente) igual que el resto de la plataforma.

---

## 4. Permisos requeridos (RBAC)

| Permiso | Requerido para |
|---|---|
| `rp.equipment.view` | `GET /api/rp/equipment`, `GET /api/rp/equipment/{id}`, `GET .../sync-status` |
| `rp.equipment.edit` | `POST /api/rp/equipment`, `PUT /api/rp/equipment/{id}` |

Por defecto (`db_scripts/52`) los roles `admin` y `manager` tienen `rp.equipment.view`, y solo
`admin` tiene `rp.equipment.edit`. Si el usuario de su integración usa otro rol, pida al equipo de
plataforma que le otorgue el permiso vía `role_permissions` (mismo mecanismo que cualquier otro
módulo — ver `GET /api/auth/permissions` para verificar qué tiene su sesión activa).

Sin el permiso correspondiente: `403 Forbidden`, `{"error":"forbidden","need":"rp.equipment.edit"}`.
Sin sesión válida: `401 Unauthorized`, `{"error":"unauthorized"}`.

---

## 5. Endpoints de lectura

### 5.1 Lista

```
GET /api/rp/equipment?codigo=...&state=...&limit=50&offset=0
Authorization: Bearer <token>
```

Todos los parámetros son opcionales. `limit` máx. 500 (default 50), `offset` default 0.
`codigo`/`state` filtran por coincidencia exacta.

```jsonc
// 200 OK
{
  "items": [ /* ver §6.1, forma resumida (sin "raw") */ ],
  "limit": 50,
  "offset": 0
}
```

### 5.2 Detalle

```
GET /api/rp/equipment/{equipment_id}
Authorization: Bearer <token>
```

→ `200 OK` (ver §6.1, incluye además `"raw"`: el registro completo devuelto por Odoo, para
cualquier campo que este backend no promueva a columna propia) · `404 Not Found` si no existe o no
pertenece a su tenant.

### 5.3 Estado de sincronización

```
GET /api/rp/equipment/{equipment_id}/sync-status
Authorization: Bearer <token>
```

```jsonc
// 200 OK
{"sync_status": "synced", "last_sync_error": ""}
```

Úselo tras un `POST`/`PUT` (§6) para saber cuándo el cambio quedó confirmado en TimeTelemetry — o
suscríbase al WebSocket (§7) en vez de sondear.

---

## 6. Endpoints de escritura (asíncronos)

### 6.1 Crear

```
POST /api/rp/equipment
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "...",        // recomendado: name o codigo (al menos uno)
  "codigo": "...",
  "category_id": 5,     // id numérico de la categoría en Odoo, no el nombre
  "project_id": 289,    // id numérico del proyecto en Odoo
  "state": "...",
  "serial_no": "...",
  "location": "...",
  "latitude": -12.05,
  "longitude": -77.03
}
```

Solo estos 9 campos se aceptan (lista blanca) — cualquier otra clave del body se ignora
silenciosamente. `category_id`/`project_id` son los **id numéricos** de Odoo, no nombres — si no
los conoce, consúltelos en un registro existente vía §5.2 (`category_id`/`project_id` en la
respuesta) o pida el catálogo al equipo de plataforma.

> **Verificado en vivo (2026-08-11)**: `maintenance.equipment` en la instancia real de
> TimeTelemetry **no tiene un campo llamado `state`** — un `write` con esa clave lo acepta Odoo
> sin error (el ORM ignora claves desconocidas en `write()`/`create()` en vez de rechazarlas), pero
> no persiste nada. No use `state` hasta que el equipo de plataforma confirme el nombre real del
> campo de estado en esta instancia (si existe). El resto de los 8 campos sí se verificaron
> escribiendo un registro real (`codigo`, `name` —aunque Odoo puede sobreescribirlo con un valor
> calculado propio, ver nota abajo—, `serial_no`, `category_id`/`project_id`, `latitude`/
> `longitude`) y confirmando por XML-RPC que el valor llegó a TimeTelemetry.
>
> También se observó que Odoo **recalculó `name`** a partir de `codigo` en el `create` de prueba,
> aunque se envió un `name` distinto — es una regla de negocio propia de esta instancia (probable
> compute/onchange que fuerza nombre = código), no un comportamiento de esta API: lo que quede en
> Odoo después de esa lógica es exactamente lo que este backend replica.

```jsonc
// 202 Accepted -- confirmado LOCALMENTE, aún no en TimeTelemetry
{"equipment_id": "uuid-local", "sync_status": "pending_push"}
```

`503 Service Unavailable`, `{"error":"rp_not_configured"}` si su tenant no tiene un peer de
TimeTelemetry activo (contacte al equipo de plataforma).

### 6.2 Actualizar

```
PUT /api/rp/equipment/{equipment_id}
Authorization: Bearer <token>
Content-Type: application/json

{"state": "maintenance"}   // mismos 9 campos de §6.1, solo los que cambian
```

→ `202 Accepted` (mismo shape que crear) · `404 Not Found` si el `equipment_id` no existe/no es
suyo · **`409 Conflict`**, `{"error":"not_yet_synced"}` si el registro fue creado por usted mismo
hace poco y **todavía no tiene un `external_id` real de Odoo** — espere a que `sync-status` (§5.3)
indique `synced` antes de poder editarlo.

### 6.3 Qué significa cada `sync_status`

| Valor | Significado |
|---|---|
| `pending_push` | Encolado, esperando que el hilo de escritura lo envíe a TimeTelemetry (normalmente segundos) |
| `synced` | Confirmado en TimeTelemetry — el registro tiene `external_id` real |
| `push_failed` | El último intento falló (`last_sync_error` trae el motivo) — se sigue reintentando con backoff creciente hasta un máximo de intentos; si lo supera, queda **permanentemente fallido** y requiere intervención del equipo de plataforma (contáctelos con el `equipment_id`) |

---

## 7. Tiempo real (WebSocket)

En vez de sondear `sync-status` repetidamente, conéctese al canal de push del backend:

```
wss://<host>/ws?auth_token=<access_token>          // producción (TLS)
ws://<host>/ws?auth_token=<access_token>            // solo desarrollo local
```

- `auth_token` en la **query string** es válido **únicamente** en el handshake WebSocket (nunca lo
  use así en una petición REST normal — ahí se requiere el header `Authorization`). Es así porque
  `new WebSocket(url)` del navegador no admite headers custom.
- La conexión queda suscrita automáticamente al **tenant de la sesión** — nunca recibe datos de
  otro tenant, y no hay forma de pedir uno distinto desde el cliente.
- Sin token válido, la conexión se acepta pero no recibe ningún evento (falla cerrado, nunca
  suscribe "por defecto").

Cada cambio aplicado a `rp_equipment` (alta confirmada, edición confirmada, o sincronización
periódica que trae un cambio hecho directo en Odoo) llega como un frame de texto:

```jsonc
{"channel": "rp", "type": "rp_equipment_updated", "equipment_id": "uuid-local"}
```

El frame **no** trae los campos del equipo — es una señal de "algo cambió, volvé a pedir
`GET /api/rp/equipment/{equipment_id}` (§5.2) si te interesa ese registro". Otros canales de la
plataforma pueden compartir la misma conexión con un `channel` distinto — filtre por
`channel === "rp"` antes de procesar.

No hay reconexión automática del lado del servidor — implemente backoff+retry en su cliente ante
`onclose`/`onerror` (mismo patrón que `frontend/src/lib/alarmStream.ts` de esta plataforma, si
quiere una referencia).

---

## 8. Página de referencia funcional

[`external-api-test-page/rp-test-harness.html`](../../external-api-test-page/rp-test-harness.html)
— página standalone (sin build, sin dependencias) que ejercita **las seis peticiones de esta
guía** (login, lista, detalle, sync-status, crear, actualizar) más el canal WebSocket en vivo,
desde un origen genuinamente cross-origin (mismo mecanismo que `api-test-harness.html`, ver
[`EXTERNAL_API_TEST_PAGE.md`](EXTERNAL_API_TEST_PAGE.md) para cómo servirla — mismo servidor,
mismos puertos 5190/5443, ya autorizados en CORS).

```
http://localhost:5190/rp-test-harness.html
https://localhost:5443/rp-test-harness.html
```

Cada llamada real queda en el log de peticiones/respuestas de la página — útil para comparar
contra los ejemplos de este documento byte a byte durante su integración.

### 8.1 Abrirla desde otra PC de la misma red (LAN)

Soportado y verificado en vivo (2026-08-11). En la máquina que sirve la página (la misma que corre
el backend con Docker):

1. `external-api-test-page/iniciar-pagina-prueba.bat` (HTTP, puerto 5190) y/o
   `iniciar-pagina-prueba-https.bat` (HTTPS, puerto 5443 — necesario si además van a probar algo
   que requiera contexto seguro del navegador).
2. Averigüe la IP de esa máquina en la red local (`ipconfig` en Windows — la interfaz
   Wi-Fi/Ethernet real, ej. `192.168.18.50`).
3. Desde la otra PC: `http://<esa-IP>:5190/rp-test-harness.html` o
   `https://<esa-IP>:5443/rp-test-harness.html`.

La página **detecta sola** que se abrió por IP de LAN (no `localhost`) y aunta el "Backend base
URL" al **frontend nginx publicado en el puerto 5173** de esa misma máquina — el backend crudo
(puerto 8082) nunca se expone directo a la LAN, por diseño (ver `docker-compose.yml`). Ese proxy ya
soporta tanto REST (`/api/...`) como el **WebSocket** (`/ws`, §7) — confirmado end-to-end abriendo
la página como `http://192.168.18.50:5190/rp-test-harness.html`: login, `GET /api/rp/equipment` con
los 2 100+ equipos reales, y el WebSocket conectando y quedando `conectado` contra
`ws://192.168.18.50:5173/ws?auth_token=...`, sin ningún cambio de código.

**Requisito del lado de la plataforma**: el origen exacto que use la otra PC
(`http://<esa-IP>:5190` y/o `https://<esa-IP>:5443`) debe estar en `BEEMETRY_CORS_ALLOWED_ORIGIN`
del backend (§2) — si no, verá errores de red en la sección REST aunque la página cargue bien (el
WebSocket no depende de CORS, solo del token). Detalle completo, incluyendo el bloque de
`nginx.conf` que habilita el proxy de `/ws`:
[`EXTERNAL_API_TEST_PAGE.md`](EXTERNAL_API_TEST_PAGE.md#acceso-lan).

---

## 9. Ejemplo de flujo completo

```js
// 1. Login
const login = await fetch(`${BASE}/api/auth/login/password`, {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ company: 'Alpayana', username: 'juanp', password: '...' }),
}).then(r => r.json());
const token = login.user.access_token;

// 2. Crear un equipo
const created = await fetch(`${BASE}/api/rp/equipment`, {
  method: 'POST', credentials: 'include',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Sensor de prueba', codigo: 'INT-001' }),
}).then(r => r.json());   // { equipment_id, sync_status: "pending_push" }

// 3. Escuchar confirmación por WebSocket (recomendado sobre sondear)
const ws = new WebSocket(`wss://${HOST}/ws?auth_token=${token}`);
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.channel === 'rp' && msg.equipment_id === created.equipment_id) {
    // volver a pedir GET /api/rp/equipment/{equipment_id} para ver sync_status: "synced"
  }
};
```

---

## 10. Errores comunes

| Síntoma | Causa probable |
|---|---|
| `401 unauthorized` en cualquier `/api/rp/*` | Sesión vencida (15 min) o falta el header `Authorization` |
| `403 forbidden`, `need: "rp.equipment.view\|edit"` | Su usuario de integración no tiene el permiso — ver §4 |
| `503 rp_not_configured` al crear | El tenant no tiene un peer de TimeTelemetry activo configurado por el equipo de plataforma |
| `409 not_yet_synced` al editar | Está editando un registro que usted mismo creó hace segundos y aún no tiene `external_id` real — espere a `sync_status: "synced"` |
| El WebSocket conecta pero nunca llegan eventos | `auth_token` inválido/vencido en la query string, o no hay cambios en su tenant todavía |
| `TypeError: Failed to fetch` en peticiones REST | Origen no está en `BEEMETRY_CORS_ALLOWED_ORIGIN` (§2) |

---

## 11. Contacto

Para solicitar el alta de un origen CORS, permisos `rp.equipment.*` para su usuario de
integración, o el peer de TimeTelemetry de su tenant, contactar al equipo de plataforma AURIXA /
Beemetry. Ver también [ADR-103](../decisions/103-integracion-rp-timetelemetry-replica-xmlrpc.md)
para el diseño completo (por qué es asíncrono, por qué no hay acceso directo a TimeTelemetry).
