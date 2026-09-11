# ADR-058 — Auditoría de seguridad integral interna/externa (jul-2026)

> **Actualización 2026-09-11 — el pentest externo ya tiene ADR propio.**
> Ver **ADR-169** (`pentest-externo-seguridad-requisito-obligatorio-produccion`):
> alcance, metodología, entregables y criterio de cierre formalizados.
> Sigue **PENDIENTE de ejecución** — sin proveedor ni fecha.

**Status**: implemented, parcial por diseño (2026-07-19) — ver desglose
CERRADO / VERIFICADO SANO / PENDIENTE abajo; el status "parcial" refleja que
el ítem más severo del bloque PENDIENTE (refresh token en localStorage) se
mantuvo abierto deliberadamente en esta pasada de auditoría por ser un
cambio arquitectónico, y **se cerró después**, el mismo día, con su propio
ADR — ver "Actualización 2026-07-19" en ADR-029.
**Fecha**: 2026-07-19
**Autores**: EC
**Ámbito**: plataforma

## Contexto

Segunda pasada de auditoría de seguridad sobre el stack real corriendo
(contenedores levantados, pruebas en vivo — no solo análisis estático de
código), continuando el trabajo de endurecimiento pre-pentest de ADR-043
(2026-07-13). El pentest externo de caja negra formal sigue sin agendar
(backlog operativo, ver `docs/decisions/README.md` § "Progreso del proyecto
de reportabilidad"); esta auditoría interna busca cerrar de antemano todo lo
automatizable/verificable sin depender de ese pentest.

## Decisión

Auditoría con tres resultados posibles por hallazgo: **CERRADO** (corregido
y verificado en vivo esta misma pasada), **VERIFICADO SANO** (revisado, sin
cambios necesarios) o **PENDIENTE** (documentado, requiere decisión o
esfuerzo de mayor alcance que una pasada de auditoría).

### CERRADO (corregido + verificado en vivo)

- **XSS almacenado en celdas de tabla del editor de informes** (alto). Las
  celdas de `TableBlock.tsx` son `contentEditable` que guardaban HTML crudo
  (`onChange(innerHTML)`) y se re-sembraban con `el.innerHTML = value`. Un
  editor podía pegar `<img onerror>`/`<svg onload>`/`<script>` en una
  celda; al abrir OTRO editor/revisor el informe en modo edición, el
  payload ejecutaba en su navegador — y como (en ese momento) tanto el
  access token como el refresh token vivían en `localStorage`, un XSS ahí
  equivalía a robo de sesión persistente (ver ítem PENDIENTE de abajo, y su
  cierre posterior en ADR-029). Fix: sanitizador allowlist sin dependencias
  externas (`frontend/src/lib/sanitizeHtml.ts`, basado en `DOMParser`)
  aplicado tanto al renderizar como al guardar. Verificado: neutraliza
  todos los vectores probados y conserva el formato legítimo
  (`<span style="color;font-weight">` intacto). `ReadOnlyViewer` y el
  export PDF ya eran seguros de por sí (React escapa `{cell}`).
- **IDOR horizontal + fuga sin autenticación en `/api/sensors/data`**
  (alto). Dos problemas en el mismo endpoint: (a) sin `tenant_id` en la
  query devolvía el inventario **global** de sensores de todos los tenants
  sin siquiera exigir una sesión; (b) con `tenant_id` presente, solo
  verificaba que existiera una sesión válida, no que ese tenant
  perteneciera realmente a esa sesión — un usuario del tenant A podía leer
  los sensores del tenant B simplemente pasando su UUID. Fix
  (`sensor_service.cpp`): sesión obligatoria + tenant efectivo derivado
  siempre de la sesión vía `resolveAllowedSensorTenant` (mismo criterio
  IDOR-proof ya usado en `reports`/`surveillance`, ver ADR-039 y ADR-043).
  Verificado: request sin token → 401 (antes: 200 con datos de todos los
  tenants). El mismo blindaje se aplicó al nuevo endpoint
  `/api/mining/telemetry/summary`.
- **Dependencias con CVEs altas**: `axios` 1.13.6 → 1.18.1 (cierra SSRF por
  bypass de `NO_PROXY`, prototype-pollution con auth-bypass, e inyección
  CRLF/null-byte), más `form-data` y `linkify-it` (ReDoS). `npm audit`: 3
  altas → 0.
- **HSTS** (`Strict-Transport-Security`) añadido a las 4 `location` estáticas
  de `nginx.conf` — defensa en profundidad; el proxy TLS externo ya lo
  reenviaba, pero nginx no lo emitía por sí mismo.
- **`dangerouslySetInnerHTML` innecesarios** eliminados de
  `AlarmConfigView` (se usaban solo para inyectar entidades HTML de
  símbolos `≥`/`≤` — reemplazados por los caracteres Unicode reales,
  eliminando el `dangerouslySetInnerHTML` por completo en ese componente).

### VERIFICADO SANO (revisado, sin cambios necesarios)

- Inyección SQL: todos los `WHERE` dinámicos revisados usan placeholders
  `$N` vía `PQexecParams`; los nombres de columna que sí se interpolan
  provienen siempre de una whitelist fija en código, nunca de input del
  usuario. Limpio.
- Endpoints sensibles (KPIs, markers de mapa, alarmas, cámaras, reports,
  métricas de dashboard) ya devolvían 401 sin token antes de esta pasada.
- Secretos: todos gestionados vía `${...}`/`.env` (gitignoreado); sin
  secretos en texto plano dentro de los archivos de compose versionados.
- Contenedores: límites de recursos (memoria+CPU) definidos por servicio;
  el backend HTTP solo escucha en loopback en producción (nginx es el
  único ingress real); la ingesta IoT en el puerto 8443 autentica por
  `device_api_key_hash`. 17/17 contenedores healthy al momento de la
  auditoría.

### PENDIENTE (documentado — decisión o esfuerzo de mayor alcance)

- **Refresh token en `localStorage`** (alto). Tanto el access token como el
  refresh token vivían en `localStorage` (`authStorage.ts`), robables por
  cualquier XSS futuro — no solo por el ya cerrado arriba — lo que
  equivaldría a toma de cuenta persistente (hasta `JWT_REFRESH_TTL_DAYS`,
  7 días por defecto), no solo el robo de una sesión de ~15 minutos. El
  propio ADR-029 describía el diseño como "server-side" en su título, pero
  no documentaba que el **cliente** igual lo almacenaba en un store legible
  por JS. Remediación recomendada en el momento de esta auditoría: mover el
  refresh token a cookie `HttpOnly; Secure; SameSite=Strict` + protección
  CSRF explícita (hacerlo sin la protección CSRF simplemente cambia una
  clase de vulnerabilidad, robo por XSS, por otra, falsificación de
  solicitud entre sitios). Marcado como **cambio arquitectónico**, no
  cerrable en la misma pasada de auditoría.
  **Cerrado el mismo día** (2026-07-19), después de esta auditoría, con su
  propio trabajo de implementación — ver "Actualización 2026-07-19" en
  ADR-029 para el diseño final (cookie `HttpOnly` + `csrf_token_v2` de doble
  envío) y su implementación real en `http_utils.{hpp,cpp}`,
  `auth_session.cpp`, `main.cpp`, `auth_routes.cpp` y
  `frontend/src/auth/{authStorage,authApi}.ts`.
- **Seguimiento 2026-07-27:** ADR-076 implementa CSPRNG para identificadores y
  secretos; ADR-077 implementa Argon2id con rehash oportunista del legado.
  Ambos tienen build, pruebas y E2E, pero no sustituyen el pentest externo.
- **Pentest externo de caja negra** (ya es la tarea #9 del backlog
  operativo de reportabilidad, ver `docs/decisions/README.md`): los checks
  automatizables de esta plataforma están cubiertos por esta auditoría y
  las anteriores (ADR-043); un pentest formal requiere contratación y
  alcance por un equipo de seguridad externo — sigue sin agendar a la
  fecha de este ADR.
- **`echarts@6` cerrado 2026-07-27:** migrado a 6.1.x; TypeScript, Vitest
  25/25 y build productivo aprobaron. `npm audit --omit=dev`: 0
  vulnerabilidades productivas.
- **Menores** (aceptados, sin plan de cierre inmediato): `db_replica` corre
  como `user: root` dentro de su contenedor (solo de uso interno, sin
  puerto publicado al host); el compose de DEV expone mailpit/mqtt/tiles
  al host (el de PROD no); otros proyectos ajenos a esta plataforma
  comparten el mismo host Docker (superficie de movimiento lateral que no
  depende de este código).

## Consecuencias

### Positivas
- Dos hallazgos altos reales (XSS almacenado, IDOR+fuga sin auth) cerrados
  y verificados en vivo antes de cualquier pentest externo, reduciendo la
  superficie de hallazgos esperables en ese pentest.
- El bloque PENDIENTE queda documentado con severidad y remediación
  recomendada explícitas, en vez de perderse como conocimiento tácito de la
  sesión — el ítem más severo (refresh token) ya se cerró el mismo día,
  con trazabilidad completa entre ambos ADR.
- El patrón "CERRADO / VERIFICADO SANO / PENDIENTE" deja explícito qué SÍ
  se revisó y resultó limpio (inyección SQL, secretos, límites de
  contenedor) en vez de que su ausencia de la lista de hallazgos se lea
  como "no se revisó".

### Negativas / Trade-offs
- Esta auditoría interna no reemplaza al pentest externo de caja negra
  contractual — reduce su superficie esperada de hallazgos, pero el
  backlog sigue exigiendo que se agende y ejecute igual.
- `echarts@6` queda como deuda de seguridad conocida (1 CVE moderada) hasta
  que se planifique la migración semver-major — trade-off aceptado
  explícitamente para no forzar una migración de alto riesgo de regresión
  visual dentro de una auditoría de seguridad.

## Alternativas descartadas

### Forzar el cierre del refresh token en localStorage dentro de esta misma auditoría
Se evaluó cerrarlo de inmediato, pero el cambio de mecanismo de sesión
(cookie + CSRF) toca el flujo de login/refresh/logout completo en backend
y frontend — se prefirió documentarlo como pendiente explícito con
remediación clara y priorizarlo como su propio trabajo, en vez de apurar un
cambio de esa superficie dentro del tiempo de una pasada de auditoría. En
la práctica se cerró el mismo día como trabajo separado (ver ADR-029).

### Migrar `echarts` de inmediato para cerrar su CVE moderada
Descartado por el riesgo de regresión visual de un salto semver-major sin
ventana de pruebas dedicada — se prioriza como migración deliberada futura,
no como parte de esta auditoría.

## Referencias
- `frontend/src/lib/sanitizeHtml.ts`,
  `frontend/src/components/ReportStudioV2/components/document/TableBlock.tsx`
- `backend/src/mining/sensor_service.cpp` (`resolveAllowedSensorTenant`)
- `frontend/nginx.conf` (HSTS)
- `frontend/src/components/Dashboard/AlarmConfigView.tsx`
- ADR-029 ("Actualización 2026-07-19" — cierre del ítem PENDIENTE de
  refresh token de este ADR)
- ADR-039, ADR-043 (mismo criterio IDOR-proof reutilizado; auditoría de
  seguridad previa que esta continúa)
- `docs/decisions/README.md` § "Progreso del proyecto de reportabilidad"
  (backlog del pentest externo)
