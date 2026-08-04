# ADR-041 — Resiliencia de sesión en cliente: refresco automático de token para `fetch()` crudo

**Actualización 2026-07-13 (consolidación)**: cerrada la deuda de duplicación
señalada más abajo. `authFetch()` de `frontend/src/auth/authApi.ts` se exportó
(antes era privado, la razón original de la duplicación) y
`frontend/src/lib/fetchWithAuth.ts` pasó a ser un re-export de una línea —
`export { authFetch as fetchWithAuthRetry } from '../auth/authApi'` — en vez de
una segunda implementación. Los 3 call sites (`AdvancedSensors.tsx`,
`VideoDiagram.tsx`, `alarmStream.ts`) no cambiaron: siguen importando
`fetchWithAuthRetry` del mismo archivo, ahora sin lógica duplicada detrás.
Verificado con `tsc --noEmit` sin errores (sin ciclo de imports: `lib/` importa
de `auth/`, nunca al revés). Quedan **dos** implementaciones del patrón, no una
sola — arquitectónicamente justificado: el interceptor axios de
`ReportStudioV2/lib/api.ts` opera sobre un cliente HTTP distinto (axios vs.
`fetch()` nativo) y no es candidato real a fusión sin migrar ese módulo a
`fetch()`, un cambio de mayor alcance no solicitado.

**Status**: accepted (implementado y verificado end-to-end 2026-07-13, incluyendo
prueba de expiración simulada; consolidación de duplicados cerrada el mismo día)
**Fecha**: 2026-07-13
**Autores**: EC
**Ámbito**: plataforma

> El patrón de retry-tras-401 ya estaba **especificado** por ADR-029 ("interceptor de
> respuesta en `ReportStudioV2/lib/api.ts` (axios) con el mismo patrón de
> refresh-and-retry", "`authFetch()` con reintento automático tras 401" en
> `authApi.ts`) — este ADR documenta que ese patrón **no llegaba** a los componentes
> del dashboard que usan `fetch()` nativo, y por qué, con honestidad sobre la
> duplicación resultante.

## Contexto

El access token de sesión vive **15 minutos** (`gJwtAccessTtlMinutes`, ADR-029). Tres
componentes del dashboard (`AdvancedSensors.tsx` — Sensores de Mina,
`VideoDiagram.tsx` — Cámaras de Seguridad, `alarmStream.ts` — Centro de Alarmas)
llamaban a `fetch()` nativo directamente con una copia estática del token leída una
sola vez al montar el componente. Si el usuario dejaba el dashboard abierto más allá
de esos 15 minutos (un turno de operación real, no un caso extremo), toda request
posterior fallaba con `401 unauthorized` de forma **permanente** — sin ningún
mecanismo que intentara renovar el token, la única salida era recargar la página o
cerrar/reabrir sesión.

Esto se detectó primero como un síntoma distinto (`"Auth token required for
tenant-scoped requests"`, un 401 por header de autorización **ausente**, ADR real de
esa sesión de trabajo) y, tras corregir eso, el mismo error volvió a aparecer en una
verificación posterior — esta vez el header sí estaba presente, pero el token que
llevaba había expirado. El caso ilustra que dos causas distintas pueden producir el
mismo síntoma visible al usuario, y que verificar "el header se envía" no es
suficiente sin verificar también "el token sigue siendo válido".

El patrón correcto **ya existía** en la plataforma en dos lugares:
`ReportStudioV2/lib/api.ts` (interceptor axios) y una función `authFetch()` **privada,
no exportada** dentro de `frontend/src/auth/authApi.ts` — pero al no estar exportada,
ningún otro módulo podía reutilizarla.

## Decisión

Se crea `frontend/src/lib/fetchWithAuthRetry.ts`: un helper que envuelve `fetch()`
nativo, adjunta el token de sesión actual, y ante un `401` invoca
`refreshAccessToken()` (la misma función ya usada por `authApi.ts` y por el
interceptor de axios — deduplica refrescos concurrentes) y reintenta **una sola vez**
con el token renovado.

Se reemplazan los `fetch()` crudos + `authHeaders()` locales de `AdvancedSensors.tsx`,
`VideoDiagram.tsx` y `alarmStream.ts` (carga inicial de alarmas y `ack`) por este
helper.

### Reglas duras
- Ningún componente nuevo que llame a un endpoint autenticado vía `fetch()` nativo
  debe adjuntar el token manualmente sin pasar por un helper con reintento — o bien
  `fetchWithAuthRetry` (lib compartida) o el patrón axios de `ReportStudioV2/lib/api.ts`
  si el componente ya usa ese cliente.
- El WebSocket de alarmas en tiempo real (`alarmStream.ts::connect`) sigue autenticando
  por query param (`?auth_token=...`) al momento de abrir la conexión — no aplica el
  mismo patrón de retry (un WS no tiene un ciclo request/response 401 que interceptar);
  si la conexión se cae por token vencido, el backoff de reconexión ya existente
  reabre con un token fresco en el siguiente intento.

## Consecuencias

### Positivas
- Verificado end-to-end con una prueba de expiración simulada real: se corrompió el
  access token almacenado (dejando el refresh token real intacto), se confirmó en el
  log de red la secuencia exacta `401 → refresh → 200 OK` sin mostrar ningún error al
  usuario, y se confirmó que el token corrompido fue reemplazado por uno nuevo válido
  en `localStorage` tras el refresco.
- Un turno de operación de más de 15 minutos con el dashboard abierto (el caso de uso
  real de una plataforma de monitoreo minero) ya no produce errores de sesión
  visibles al usuario.

### Negativas / Trade-offs — deuda de consolidación explícita
- **La plataforma tiene ahora tres implementaciones paralelas del mismo patrón**
  refresh-and-retry: el interceptor axios de `ReportStudioV2/lib/api.ts`, la función
  privada `authFetch()` de `auth/authApi.ts`, y este nuevo `fetchWithAuthRetry` de
  `lib/`. Las tres hacen esencialmente lo mismo (detectar 401, llamar
  `refreshAccessToken()`, reintentar una vez) con implementaciones ligeramente
  distintas. Esto ocurrió porque la segunda (`authFetch`) no estaba exportada cuando se
  construyó la tercera — un caso concreto de cómo la falta de visibilidad de una
  utilidad ya existente lleva a reimplementarla. **Se documenta aquí en vez de
  ocultarlo**: la recomendación correcta es exportar `authFetch()` de `authApi.ts` (o
  promover `fetchWithAuthRetry` como la única implementación) y hacer que los tres
  puntos de consumo converjan en una sola función, en una sesión de refactor dedicada
  — no se hace en esta misma sesión para no mezclar una corrección de bug urgente
  (sesión expirada rompiendo el dashboard en producción) con un refactor de
  consolidación de menor urgencia.

### Neutras
- No cambia el modelo de tokens de ADR-029 (TTLs, rotación de refresh token,
  denylist de `jti`) — solo agrega un consumidor más del mismo `refreshAccessToken()`
  ya existente.

## Alternativas descartadas

### Alargar el TTL del access token para que el problema aparezca con menos frecuencia
Reduce la frecuencia del síntoma sin corregir la causa (ningún componente con `fetch()`
crudo se recupera de un 401), y debilita la superficie de seguridad que ADR-029
diseñó deliberadamente acotada (revocación efectiva en ≤15 min). Rechazado.

### Exportar y reutilizar `authFetch()` de `authApi.ts` directamente en esta sesión
Habría sido la solución más limpia (cero duplicación), pero `authApi.ts` tiene
dependencias/contexto propio (`backendBaseUrl()`, manejo de errores específico de ese
módulo) que habría requerido revisar con más cuidado del que esta corrección urgente
ameritaba. Se prefirió un helper nuevo, pequeño y con una sola responsabilidad, dejando
la consolidación como trabajo futuro explícito (ver "Negativas" arriba) en vez de
mezclar un refactor más amplio con un fix de producción.

## Referencias
- `frontend/src/lib/fetchWithAuth.ts` (`fetchWithAuthRetry`)
- `frontend/src/auth/authApi.ts` (`authFetch` privado, `refreshAccessToken`)
- `frontend/src/components/ReportStudioV2/lib/api.ts` (interceptor axios equivalente)
- `frontend/src/components/Dashboard/AdvancedSensors.tsx`,
  `frontend/src/components/Special/VideoDiagram.tsx`, `frontend/src/lib/alarmStream.ts`
- ADR-029 (JWT híbrido, TTLs, patrón de refresh-and-retry ya especificado)
