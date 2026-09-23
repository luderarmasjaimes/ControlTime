# Informe de sesión — Administración de sensores + Motor de fórmulas en tiempo real (ADR-187)

**Fecha:** 2026-09-14
**Rama:** `2026-08-21`
**Propósito de este documento:** dejar registro completo de lo solicitado, decidido y construido en esta sesión de Claude Code, para que pueda retomarse desde otra cuenta/sesión en la misma PC y el mismo proyecto sin perder contexto. Es un resumen de *sesión*, no reemplaza al ADR-187 (que es la fuente técnica autoritativa y debe leerse antes de tocar cualquier cosa relacionada a sensores/fórmulas/parámetros).

> **Estado al cierre de la sesión:** todo lo descrito abajo está **construido, desplegado en los contenedores reales (`beemetry-api`, `beemetry-web`) y verificado en vivo**. Nada de esto está commiteado a git todavía — el usuario no lo pidió en ningún momento de la conversación. `git status` mostrará todos los archivos como modificados/nuevos sin stage.

---

## 1. Qué se pidió (cronología real, en palabras del usuario)

1. Pregunta inicial: cómo probar telemetría simulada usando un celular Android como sensor → se construyó `external-api-test-page/phone-sensor-test.html`.
2. Pedido de una **página de administración y registro de sensores** en la plataforma minera: registro, test de conexión, configuración de parámetros, fijación de umbrales warning/error, y visualización de resultados calculados. Pidió "el máximo análisis posible".
3. Ante la pregunta de si debía ser una pantalla nueva en la app real o algo más liviano, el usuario eligió explícitamente:
   > **"Nueva pantalla de administración en la app real (Recomendado)"**
4. Describió con sus propias palabras la arquitectura deseada: telemetría en tiempo real alimentando un módulo de fórmulas con parámetros configurables por dispositivo + umbrales, produciendo uno o más resultados calculados con estado warning/error.
5. Aprobó construir **todo junto**, no por partes:
   > **"Diseñar todo junto ahora, aunque sea una entrega grande"**
6. En ese momento, ante la pregunta de si activar la pestaña legada "Formula" (del catálogo demo desconectado `mineria_sensores`), respondió:
   > **"No, no lo habilito por ahora"**
7. Aprobó el plan completo (ExitPlanMode).
8. Pidió la entrega completa del motor de fórmulas, testeable, con ADRs actualizados y la interfaz de fórmulas visible:
   > **"quiero que lo construyas de una vez completo y me dejas todo listo para probar y me actualizas los ADRs nuevos y los actualizados. ademas necesito que esta visible la interface de las formulas y esta tenga todos los cambios que hemos implementado con el nuevo control de formulas avanzados.. necesito el maximo analisis posible.."**
9. Tras la primera entrega, reportó no ver la interfaz:
   > **"has subido todos los cambios o es que te falta algo para poner poder probar las formulas ya que aun no veo la interface de las formulas"**
10. Insistió, pidiendo que se revisara y activara personalmente:
    > **"nada no puedo aun ver la interface de las formulas... necesito que lo revices y lo actives tu mismo"**
11. Aclaró que en realidad se refería a la pestaña legada:
    > **"antes habia una interface fromtend de formulas que esta en los menus de la plataforma minera.. necesito que la habilites por que esta oculta..."**
12. Ante la pregunta de si quería (a) un menú nuevo para el motor real, (b) la pestaña legada tal cual, o (c) ambas, eligió:
    > **"Las dos cosas"**

Todo lo anterior quedó implementado. No hubo pedido de `git commit` en ningún momento.

---

## 2. Qué se construyó

### 2.1 Causa raíz de la confusión de los puntos 9-11

Hubo **dos problemas reales, no uno**:

- **Problema técnico real**: todo se había construido y probado contra un servidor Vite temporal (`preview_start`, puerto 5180), pero el contenedor que el usuario realmente usa (`beemetry-web`, puerto 5173) sirve un **build estático de nginx horneado en la imagen Docker** — no tiene hot-reload. Se corrigió con `docker compose up -d --no-deps --build frontend` (y luego junto con `web`), y se verificó grepeando el JS compilado dentro del contenedor.
- **Problema de interpretación**: cuando el usuario finalmente dijo "antes había una interfaz de fórmulas... necesito que la habilites porque está oculta", en realidad se refería a la **pestaña legada `Formula`/`Cálculo`** (el catálogo demo desconectado `mineria_sensores`, con su propio editor de diagramas en el sidecar `formula_engine/`), que el usuario había pedido explícitamente **no** habilitar en el punto 6. Se detectó la ambigüedad antes de actuar y se preguntó; el usuario respondió "Las dos cosas".

### 2.2 Entregable A — Pantalla de administración de sensores

Nueva vista real en producción: `SensorManagementView.tsx`, accesible en el menú "Gestión" (grupo `mantenimiento`) como pestaña **"Sensores"**.

- Registro, listado, edición de campos (`zone_id/lat/lng/label/serial_number/external_id`), revocación y **rotación de clave de dispositivo** (necesaria para poder re-probar un sensor cuya clave de un solo uso ya se perdió).
- **"Probar ahora"**: envía una lectura de prueba real vía `POST /api/mining/telemetry` usando `X-Device-Key`, con `credentials:'omit'` y sin header `Authorization` (ver gotcha de CSRF en la sección 4).
- Panel de detalle por sensor con caché de tendencia (`GET /api/mining/telemetry/wizard/query`).
- Enlace directo a `AlarmConfigView` (pestaña de umbrales de alarma, que ya existía pero estaba desconectada del menú — se reactivó también en esta sesión).

### 2.3 Entregable B — Motor de fórmulas en tiempo real

Este es el núcleo técnico de la entrega. Activa y extiende el esquema que estaba **dormido, nunca implementado**, en `db_scripts/17_telemetry_multivariate_sensor_specs.sql`.

**Esquema nuevo** (`db_scripts/93_sensor_formula_engine.sql`, aplicado manualmente vía `psql`, registrado en `schema_migrations`):
- `sensor_input_parameter_def` / `sensor_input_parameter_value` — parámetros numéricos/texto/booleanos/json/timestamp configurables por sensor, con valor por defecto y override por instancia.
- `sensor_output_channel_def` — forma/unidad del resultado calculado.
- `sensor_formula_def` — expresión + canal de salida + límites warning/error.
- `telemetry_multivariate.status` (`ok`/`warning`/`error`) — sumidero del resultado calculado.

**Evaluación de expresiones**: se vendorizó **tinyexpr** (`backend/third_party/tinyexpr/`, licencia zlib, sin I/O ni syscalls, verificado). Las expresiones se validan (`te_compile`) en el momento de guardar la fórmula — una expresión inválida nunca puede llegar al evaluador. El estado warning/error se calcula por comparación numérica separada contra los límites de la fórmula, no dentro de la expresión (no soporta comparaciones/ramas, solo aritmética).

**Motor de evaluación**: hilo de fondo nuevo (`sensor_formula_evaluator.cpp`), poller cada 10s (configurable por `BEEMETRY_FORMULA_EVAL_INTERVAL_MS`), mismo patrón que el motor de alarmas existente (reconexión automática, lectura acotada a los últimos 15 minutos de `telemetry_fact` para evitar el problema de rendimiento de ADR-186). **No** se enganchó al callback único de `TelemetryIngestor::setOnBatchCommitted` (ya reservado por el motor de alarmas) — queda documentado como fast-follow explícito en ADR-187 si se necesita latencia sub-segundo.

**API nueva** (`sensor_formula_routes.cpp`, despachada por sufijo de path dentro de los handlers existentes de `/api/mining/devices/`, porque el prefijo ya estaba tomado por otros verbos — ver sección 4):
- `GET/PUT /api/mining/devices/{id}/parameters`
- `GET/POST /api/mining/devices/{id}/formulas`, `PUT/DELETE /api/mining/devices/{id}/formulas/{formula_id}`
- `GET /api/mining/devices/{id}/formula-results`
- `GET /api/mining/formulas` — nuevo, vista **a nivel de todo el tenant** (todas las fórmulas de todos los sensores, con su último resultado vía `LATERAL JOIN`).

**Frontend**:
- Dentro de `SensorManagementView.tsx`: dos pestañas nuevas por sensor ("Parámetros de fórmula", "Fórmulas y resultados") con CRUD completo.
- **`FormulaOverviewView.tsx`** (nuevo, archivo completo en `frontend/src/components/ReportStudioV2/components/views/`): tabla de solo lectura con todas las fórmulas del tenant, búsqueda, filtro por estado (todas/ok/warning/error), contador resumen, botón "Administrar sensores" que navega a `SensorManagementView`.

### 2.4 Navegación (decisión final: "Las dos cosas")

En `frontend/src/components/UI/NavBar.tsx`:
- Pestaña legada **`Formula`** ("Cálculo", ícono `Sigma`) — **reactivada tal cual estaba**, sigue siendo el catálogo demo desconectado (`mineria_sensores`), sin relación con el motor real. Vive en el grupo `ingenieria` (sin gate de permisos, visible para cualquier usuario logueado), bajo el botón de área "Informes".
- Pestaña nueva **`FormulaOverview`** ("Fórmulas de Sensores", ícono `Calculator`, badge "Live") — es `FormulaOverviewView.tsx`, el motor real. Agregada al mismo grupo `ingenieria`.
- Pestaña **`AlarmConfig`** — reactivada (estaba comentada, ya construida).
- Pestaña nueva **`DeviceManagement`** ("Sensores", ícono `Unplug`) — agregada al grupo `mantenimiento`, gateada por `canMaintain` (que ahora también incluye el permiso `dispositivos.manage`).

**Importante para quien retome esto**: si en el futuro alguien reporta un "bug de fórmulas", hay que preguntar primero **cuál de las dos pantallas** usó — son sistemas completamente distintos que solo comparten la palabra "fórmula": esquema de datos, rutas de backend y datos, todo distinto.

---

## 3. Verificación realizada (todo contra el sistema real, no mocks)

- Rebuild de ambos contenedores juntos: `docker compose up -d --no-deps --build web frontend`, confirmados healthy.
- Verificación de código desplegado vía `docker exec beemetry-web sh -c "grep -rl '...' /usr/share/nginx/html/assets/"` — el código apareció en su propio chunk JS lazy-loaded (`SensorManagementView-BNAs7Yjw.js`), confirmando que el build estático realmente incluye los cambios.
- Recorrido en vivo en el Browser pane de Claude Code (pestaña real, puerto 5173, sesión logueada como usuario real "Luder Armas Jaimes"/Alpayana):
  - Informes → Cálculo → el editor legado renderiza correctamente (sidecar `formula_engine/`).
  - Informes → Fórmulas de Sensores → la vista nueva renderiza correctamente.
- Se creó un sensor demo real **intencionalmente dejado activo** como ejemplo funcionando: `demo-vib-01`, parámetro `factor_calibracion=1.15`, fórmula "Vibración calibrada" (`value * factor_calibracion → vib_calibrada`, warning_high=9, error_high=12). Se envió una lectura de prueba de `8.4`, se esperó un ciclo del evaluador, y se confirmó — tanto por `psql` directo como por captura de pantalla real de la UI — el resultado: **`8.4 × 1.15 = 9.66` → estado WARNING** (badge ámbar), y el resumen de la vista general mostrando "1 fórmulas · 0 OK · 1 warning · 0 error".
- Otros valores verificados end-to-end durante el desarrollo: `62.7 - 5 = 57.7` → ok; `62.7 > 50` → error.

---

## 4. Decisiones técnicas y "gotchas" que quien retome esto debe conocer

Estas también están guardadas como memoria persistente del asistente (`[[project_formula_engine_adr187]]`, `[[project_device_key_route_csrf_gotcha]]`, `[[project_telemetry_ingestor_sensor_cache_refresh]]`), pero se documentan aquí para quien no tenga acceso a esa memoria (otra cuenta):

1. **Router de un solo handler por prefijo**: `router::Router::get/post/put/del(path, handler)` registra automáticamente como ruta de PREFIJO cuando `path` termina en `/`. Solo puede haber **un** handler por par (verbo, prefijo). Los nuevos endpoints de fórmulas/parámetros no se registraron como rutas nuevas — se despacharon **por sufijo del path dentro de los handlers ya existentes** de `/api/mining/devices/` (`handleUpdateDevice`, `handleRevokeDevice`, etc.).
2. **CSRF falso-positivo en rutas de solo clave de dispositivo**: el gate CSRF (`router.cpp`) se dispara cuando detecta un token de sesión vía cookie, **sin importar si la ruta específica usa cookies o no**. Cualquier fetch a `/api/mining/telemetry` (y similares con `X-Device-Key`) debe usar `credentials:'omit'` y **no** enviar header `Authorization`, o recibirá un 403 `csrf_token_mismatch` falso si el navegador también tiene una cookie de sesión activa.
3. **Caché de sensores de `TelemetryIngestor` no se refrescaba**: un sensor recién registrado no podía ingerir datos hasta reiniciar el backend (`sensor_cache_` se cargaba una sola vez al arrancar). Se agregó `refreshSensorCache()` protegido con `std::shared_mutex` (patrón build-local-map-then-swap), llamado desde `handleRegisterDevice`. Cualquier futuro camino nuevo de INSERT de sensores debe llamar a este método.
4. **Consultas sobre `telemetry_fact` deben estar acotadas por tiempo**: hay ~10,900+ chunks de TimescaleDB; una query sin `WHERE captured_at > NOW() - INTERVAL '15 minutes'` (o similar) puede colgarse. El evaluador de fórmulas ya respeta este límite (igual que el motor de alarmas, ADR-186).
5. **El frontend de producción (`beemetry-web`) es un build estático**, no tiene hot-reload. Cualquier cambio de frontend requiere `docker compose up -d --no-deps --build frontend` para reflejarse en `localhost:5173`.

---

## 5. Archivos nuevos/modificados relevantes a esta entrega

**Backend:**
- `backend/src/mining/sensor_formula_evaluator.hpp` / `.cpp` (nuevo)
- `backend/src/mining/sensor_formula_routes.hpp` / `.cpp` (nuevo)
- `backend/third_party/tinyexpr/tinyexpr.h` / `.c` (nuevo, vendorizado)
- `backend/src/mining/device_alarm_routes.cpp` (extendido: `handleUpdateDevice`, rotación de clave, despacho por sufijo)
- `backend/src/mining/telemetry_ingest.hpp` / `.cpp` (`refreshSensorCache()` + `shared_mutex`)
- `backend/src/main.cpp` (arranque del evaluador + métricas `beemetry_formula_engine_*`)
- `backend/CMakeLists.txt` (lenguaje C agregado, nuevos módulos)
- `db_scripts/93_sensor_formula_engine.sql` (nuevo)

**Frontend:**
- `frontend/src/components/ReportStudioV2/components/views/SensorManagementView.tsx` (nuevo)
- `frontend/src/components/ReportStudioV2/components/views/FormulaOverviewView.tsx` (nuevo)
- `frontend/src/components/UI/NavBar.tsx` (pestañas reactivadas/agregadas)
- `frontend/src/App.tsx` (lazy imports, `canMaintain` extendido, bloques de render)

**Documentación:**
- `docs/decisions/187-administracion-sensores-motor-formulas-tiempo-real.md` — **ADR autoritativo**, con 3 bloques de "Actualización" fechados documentando la evolución completa (estado final: `implemented, verificado E2E en vivo`).
- `docs/decisions/README.md` — índice actualizado (ámbito `core-iot`, 11/11 implemented).

**Otros (de la sesión de testing con celular, previos a esta entrega):**
- `external-api-test-page/phone-sensor-test.html` (nuevo)
- `.claude/launch.json` (fix de configuración)

---

## 6. Cómo retomar / probar esto desde otra sesión

1. Leer primero **`docs/decisions/187-administracion-sensores-motor-formulas-tiempo-real.md`** completo — es la fuente técnica autoritativa, con la tabla completa de endpoints y las 3 actualizaciones fechadas.
2. Confirmar que los contenedores están corriendo: `docker compose ps` (servicios `web`/`beemetry-api` y `frontend`/`beemetry-web`).
3. Navegar a `http://localhost:5173`, iniciar sesión, ir a **Gestión → Sensores** (motor real, admin) o **Informes → Fórmulas de Sensores** (vista general de solo lectura) o **Informes → Cálculo** (pestaña legada, catálogo demo desconectado — no confundir).
4. El sensor demo `demo-vib-01` sigue activo como ejemplo funcionando (fórmula "Vibración calibrada", último estado WARNING con valor 9.66).
5. `git status` mostrará todo el trabajo sin commitear — **no se hizo ningún commit en esta sesión**, por decisión de no commitear sin pedido explícito del usuario.

---

## 7. Pendientes explícitamente diferidos (documentados en ADR-187, no urgentes)

- Ampliar `TelemetryIngestor::setOnBatchCommitted` de un solo callback a una lista, para latencia sub-segundo en el evaluador de fórmulas (hoy es un poller de 10s).
- Puente entre resultados warning/error del motor de fórmulas y `platform_alarms`, para reutilizar los canales de notificación (email/webhook) ya existentes del motor de alarmas.
- Soporte de múltiples canales de salida por fórmula (hoy: una fórmula → un canal de salida; múltiples salidas requieren múltiples filas de fórmula).

Ninguno de estos fue pedido por el usuario; quedan solo como fast-follows documentados si en el futuro se necesitan.
