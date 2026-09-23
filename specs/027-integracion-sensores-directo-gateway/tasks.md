# TASKS 027 — Cierre de integración de sensores (directo + gateway)

| Campo | Valor |
|---|---|
| **Plan** | `specs/027-integracion-sensores-directo-gateway/plan.md` |
| **Sprint** | Sin ventana formal — orden de ejecución = orden de prioridad |

> Leyenda de **Automatización**: 🤖 = ejecutable ahora sin intervención humana
> adicional (solo lectura o cambio aditivo reversible). 🔒 = requiere una
> decisión, dato o acceso que solo puede dar el developer/Steven/Gerencia
> antes de poder avanzar (bloqueado, no evitable con más código).

## Fase 0 — Auditoría e inventario base

| # | Tarea | Cubre CA | Automatización | Estado | Evidencia |
|---|---|---|---|---|---|
| T1 | Confirmar aplicación real de `db_scripts/95` y `/96` en el ambiente | CA-1 | 🤖 | ✅ | Verificado 2026-09-16 vía `psql`: las 6 tablas del catálogo de plantillas + `sensor_input_channel_def` existen en `sensors_db` |
| T2 | Contar sensores reales vs. sintéticos/semilla en `sensors` | CA-1 | 🤖 | ✅ | 78,780 filas totales; **3** con `device_api_key_hash` real; 78,777 sintéticas (`BENCH25K-*`/`SYNC60-*`/`LOADTEST-*`, ADR-108); resto son filas semilla/demo sin credencial (`ACEL-02` x12, `CO2-02`) |
| T3 | Listar los 3 sensores reales con su config actual | CA-1 | 🤖 | ✅ | `PZ-VW-02` (piezómetro, verificado E2E), `demo-vib-01` (http_push), `RT-TEST-01` (legacy_tls, nunca recibió telemetría real — `connection_status='unknown'`) |
| T4 | Construir vista SQL `v_sensor_traceability` (sensor → tipo → protocolo → canales → fórmulas → reglas de alarma → última lectura), excluyendo sintéticos | CA-1 | 🤖 | ✅ | `db_scripts/103_v_sensor_traceability.sql` aplicada vía psql (2026-09-16). `SELECT * FROM v_sensor_traceability` devuelve exactamente 3 filas (PZ-VW-02 con 2 canales/3 fórmulas, RT-TEST-01, demo-vib-01 con 1 fórmula) — coincide con lo esperado en ADR-192. No escanea `telemetry_fact` (usa `sensors.last_seen_at`/`connection_status`). |
| T5 | Endpoint `GET /api/mining/devices/traceability` sobre esa vista | CA-1 | 🤖 | ✅ | `handleDeviceTraceability` en `device_alarm_routes.cpp` (sesión + `dispositivos.manage`, tenant acotado a `session->tenantId`). `docker build -f backend/Dockerfile.verify --no-cache backend` (2026-09-16) compiló limpio (100% CXX objects, `Linking CXX executable beemetry_backend`, `[100%] Built target`) y `ctest`: **100% tests passed, 0 failed** (`backend_unit_tests ... Passed`). Redeploy real (`docker compose build web && docker compose up -d web`) → `beemetry-api` arrancó sano (logs sin errores, `sensors_cached=27788`). E2E de humo contra el contenedor vivo: `curl http://127.0.0.1:8082/api/mining/devices/traceability` (sin sesión) → `HTTP 401 {"error":"unauthorized"}` -- confirma que la ruta EXACTA nueva se resuelve antes que el prefijo GET `/api/mining/devices/` de `sensor_formula_routes.cpp` y no quedó 404. |
| T6 | **Inventario de sensores físicos reales de campo** (marca/modelo/protocolo/directo-o-gateway) — los que existen hoy fuera de la base de datos de desarrollo | CA-1 | 🔒 | ☐ | Requiere que el developer o Steven provean el listado real; no derivable del código ni de la BD de desarrollo, que solo tiene datos de prueba |

## Fase 1 — Metadatos de conexión directo/gateway (sin rediseñar el modelo)

| # | Tarea | Cubre CA | Automatización | Estado | Evidencia |
|---|---|---|---|---|---|
| T7 | Migración `db_scripts/102_sensor_connection_mode.sql`: columnas `connection_mode` (`'direct'\|'gateway'`, nullable) y `gateway_label` (texto libre, nullable) en `sensors` — aditivo, sin default obligatorio, no rompe las 78,780 filas existentes | CA-4 | 🤖 | ✅ | Aplicada vía `docker exec -i beemetry-db psql ... < db_scripts/102_sensor_connection_mode.sql` (2026-09-16). Verificado con `\d sensors`: ambas columnas presentes, `sensors_connection_mode_check` activo (`direct`\|`gateway`). |
| T8 | Extender `PUT /api/mining/devices/{id}` para aceptar ambos campos (patrón COALESCE ya usado para `zone_id`/`label`) | CA-4 | 🤖 | ✅ | `handleUpdateDevice` en `device_alarm_routes.cpp` — mismo patrón COALESCE que `zone_id`/`label`/`serial_number`; `connection_mode` se valida en C++ contra `{direct,gateway}` (400 `connection_mode_invalido`) antes del UPDATE. Mismo build/ctest limpio que T5 (ver evidencia ahí) + redeploy real. E2E de humo: `curl -X PUT .../devices/<uuid> -d '{"connection_mode":"bogus"}'` sin sesión → `HTTP 401` (gate de sesión corre antes que la validación de body, como está codeado). No se pudo probar el camino 200/400 autenticado de punta a punta (requeriría credenciales reales de un usuario `dispositivos.manage` de alguno de los 3 tenants con sensor real -- no se crearon usuarios/contraseñas nuevos para no tocar `auth_users` fuera de alcance); el UPDATE en sí se verificó a nivel SQL (mismo patrón COALESCE ya probado en producción por `zone_id`/`label`) y a nivel de compilación. |
| T9 | Anotar `connection_mode`/`gateway_label` en los 3 sensores reales existentes | CA-4 | 🔒 | ☐ | Depende de T6 (saber cuáles son directos y cuáles van por gateway) |
| T10 | Reflejar `connection_mode`/`gateway_label` en `SensorManagementView.tsx` (campo opcional en el formulario de alta/edición) | CA-4 | 🤖 | ✅ | Select "Modo de conexión" (Directo/Por gateway) + input "Etiqueta del gateway" (deshabilitado salvo `connection_mode='gateway'`) agregados a la pestaña "Datos y conexión" del panel de edición, mismo patrón de estado que zona/label/serie. `npx tsc --noEmit` limpio (2026-09-16). |

## Fase 2 — Catálogo de tipos de sensor en frontend (cierra pendiente de ADR-188)

| # | Tarea | Cubre CA | Automatización | Estado | Evidencia |
|---|---|---|---|---|---|
| T11 | `SensorManagementView.tsx`: reemplazar el input de texto libre de `sensor_type` por un selector contra `GET /api/mining/sensor-types` (`sensor_type_def`, ya existe desde ADR-188) | CA-2 | 🤖 | ✅ | El selector de alta ahora se puebla desde `GET /api/mining/sensor-types` (cargado en `loadAll`); se quitó la lista fija `SENSOR_TYPES` (7 valores hardcodeados). Si el valor actual no está en el catálogo real se agrega igual como opción (dato legado, no se pierde). `npx tsc --noEmit` limpio. |
| T12 | Backfill: confirmar que los `sensor_type` de sensores reales (los 3 de T3) tienen fila correspondiente en `sensor_type_def`; crear las que falten | CA-2 | 🤖 | ✅ | Query real ejecutada (2026-09-16): `SELECT DISTINCT s.sensor_type FROM sensors s WHERE device_api_key_hash IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sensor_type_def t WHERE t.type_code = s.sensor_type)` → **0 filas**. Los 3 sensores reales (`piezometer_vw`, `temperature`, `vibration`) ya están cubiertos por los 63 tipos existentes — cobertura 100%, no hizo falta migración nueva. |

## Fase 3 — Verificación de plantillas de fórmula (ADR-189)

| # | Tarea | Cubre CA | Automatización | Estado | Evidencia |
|---|---|---|---|---|---|
| T13 | Listar veredicto actual de las 27 plantillas: verificado / pendiente / no aplica | CA-3 | 🤖 | ✅ | **2026-09-16**: cruce fila por fila completo, ver tabla de veredicto debajo de esta sección. **20/27 coinciden limpio**, **2/27 coinciden con salvedad operativa no verificable del todo** (posible post-proceso ×1000 no confirmable sin el grafo de conexiones), **2/27 con discrepancia menor confirmada** (canal informativo `MPA`, no afecta `MCA`/`ALT`), **1/27 con discrepancia real confirmada de impacto numérico alto** (`linear_settlement_cell` — ver HALLAZGO CRÍTICO), **2/27 con la misma salvedad operativa que 23/24 sin el hallazgo adicional** (`polynomial_geokon_kpa`/`polynomial_rst_kpa`, ya contados arriba). Total 27. |
| T14 | Para cada plantilla sin sensor real disponible: validación algebraica contra el JS legado ya transcrito (sin datos en vivo) — deja constancia de que es validación de código, no de campo | CA-3 | 🤖 | ✅ | **2026-09-16**: completada — cruce algebraico (signos, factores KPA/MPA/PSI, orden offset/conversión, ramas por unidad) de las 27 plantillas contra los 27 scripts JS verbatim relevantes (`evidence/thingsboard_piezometer_rc_v2_full_verbatim.js`). **Esto sigue siendo validación de código, no de campo** — no reemplaza T15 (comparación numérica con datos reales de más sensores), que queda pendiente y separada, sin cerrarse aquí. Metodología: se comparó cada `expression` real de `sensor_formula_template_output` (leída en vivo de `sensors_db`, confirmada idéntica a `db_scripts/95_sensor_formula_template_catalog.sql`) contra el álgebra de su nodo JS correspondiente, verificando explícitamente signo de `freq`/`freqIni`, factor de conversión exacto por unidad, si el offset se suma antes o después del factor, y si la bifurcación `_kpa`/`_mpa` refleja una rama estructuralmente distinta (no solo *1000) del legado. |
| T15 | Para plantillas con sensor real disponible o dataset de referencia del ThingsBoard legado: comparación numérica salida vieja vs. nueva con el mismo dato crudo | CA-3 | 🔓 desbloqueada | 🟡 parcial | **2026-09-16**: acceso obtenido — el developer inició sesión él mismo en `board.beemetry.com` (nunca se manejó la contraseña), extracción de solo lectura vía `fetch()` autenticado en el navegador contra `GET /api/ruleChain/{id}/metadata`. Se extrajo el texto **verbatim** de los 29 nodos de cálculo de `PiezometerRC-V2` (79 nodos/107 conexiones reales, no 78/100 como se citaba) — ver `evidence/thingsboard_piezometer_rc_v2_full_verbatim.js` y `evidence/thingsboard_piezometer_rc_v2_switch_and_transforms.json`. Confirmado contra el legado real: **3 excepciones por dispositivo** (no 2 como asumía ADR-189) — Boroo Misquichilca (`BM.*`), GF.PZ VW-1703 (temp fija 10.98189), y una **nueva no documentada antes**: `YR.PZ-05R*` (Yaros) en la familia `polinomial_a2`. `polinomial_a1`/`polinomial_comp` confirmadas muertas por comentario propio del legado (13-08-2024). Tabla de densidad de agua piecewise de `linear_d` confirmada real. Pendiente real: comparación numérica campo-a-campo contra `sensor_formula_template_def` (27 filas) — la extracción algebraica está lista, falta el cruce fila por fila (ver nota de cierre) |
| T16 | Mecanismo de override por nombre de dispositivo legado (Boroo Misquichilca, GF.PZ VW-1703, Yauricocha) — dejar el campo/tabla lista, sin poblarla todavía | CA-3 | 🤖 | ☐ | **Ampliar alcance**: agregar también `YR.PZ-05R*` (Yaros, hallazgo nuevo de T15) a la lista de overrides a prever — no eran 3 excepciones conocidas, son al menos 4 |

**Tabla de veredicto T13/T14 (2026-09-16) — cruce fila por fila, 27/27 plantillas.**
Fuente legado: `evidence/thingsboard_piezometer_rc_v2_full_verbatim.js` (29 nodos
verbatim). Fuente plantillas: `sensor_formula_template_output` real en
`sensors_db` (SELECT ejecutado 2026-09-16, idéntico a
`db_scripts/95_sensor_formula_template_catalog.sql`).

| # | `template_code` | Nodo JS legado | Veredicto | Nota |
|---|---|---|---|---|
| 1 | `linear` | "Linear" (#16) | ✅ Coincide | Signo, factor KPA (0.101972) y clamp a positivo vía `(x+abs(x))/2` correctos |
| 2 | `linear_settlement_cell` | rama `settlement-cell` de #16/#10/#20/#23/#24 (parcial) | 🔴 **Discrepancia real** | Ver HALLAZGO CRÍTICO 1 abajo |
| 3 | `linear_gf` | "Linear_GF" (#28) | ✅ Coincide | Excepción GF.PZ VW-1703 ya conocida/documentada, no nueva |
| 4 | `linear_a` | "Linear A" (#10) | 🟡 Discrepancia menor | Ver HALLAZGO 2 abajo (canal `MPA`, no afecta `MCA`/`ALT`) |
| 5 | `linear_b` | "Linear B" (#4) | 🟡 Discrepancia menor | Mismo patrón que `linear_a` (canal `MPA` sin `factor_unidad` de 0.001 en KPA) |
| 6 | `linear_c` | "Linear C" (#7) | ✅ Coincide | Offset sumado a `MPA` antes del factor — igual que el legado |
| 7 | `linear_c1` | "Linear C1" (#13) | ✅ Coincide | Signo de `Freq-FreqIni` invertido respecto a `linear_c`, igual que el legado |
| 8 | `linear_d` | "Linear D" (#17) | ✅ Coincide | Simplificación de densidad piecewise→constante ya documentada en ADR-189 (<1%) |
| 9 | `linear_e` | "Linear E" (#8) | ✅ Coincide | Corrección barométrica `(pres_bar_ini-pres_bar)*0.0001` idéntica |
| 10 | `linear_geokon` | "Linear Geokon" (#3) | ✅ Coincide | Offset sumado **después** del factor (`*factor+offset`), igual que el legado. Excepción BM.* ya conocida |
| 11 | `linear_geokon_negated` | #3 con `criteria==='negatedCf'` | ✅ Coincide | Solo signo de `Freq` invertido, resto idéntico |
| 12 | `linear_geokon_psi` | "Linear Geokon PSI" (#24) | ✅ Coincide | Requiere `psi_conv_factor=145.038` si la unidad real es MPA (rama resuelta por parámetro) |
| 13 | `linear_psi_geokon` | "Linear Geokon PSI a KPA-MPA" (#29) | ✅ Coincide | `unit_conv_factor`/`factor_conv_up_to_mca` documentados con ambos valores KPA/MPA en la descripción |
| 14 | `linear_rst_psi` | "Linear RST PSI" (#23) | ✅ Coincide | Mismo caveat de unidad que #12 |
| 15 | `linear_soil_instruments` | "Linear Soil Instruments" (#12) | ✅ Coincide | Sin término de temperatura, igual que el legado |
| 16 | `polynomial_a` | "Polynomial A" (#5) | ✅ Coincide | Offset después del factor, igual que el legado |
| 17 | `polynomial_a2_kpa` | "Polynomial A2" (#2), rama KPA | ✅ Coincide | `NF` usa `MCA` sin clampear (igual que el legado, que usa `newMsg.MCA` crudo, no `mca`). Excepción Yaros ya conocida |
| 18 | `polynomial_a2_mpa` | "Polynomial A2" (#2), rama MPA | ✅ Coincide | División `/1000` aplicada solo al término de temperatura, exactamente como el legado (bifurcación estructural real, no `*1000` simple) |
| 19 | `polynomial_casagrande` | "Polynomial CasaGrande" (#15) | ✅ Coincide | Correctamente **sin** clamp a positivo en `NF`/`ALT` — el legado tampoco clampea aquí (a diferencia de la mayoría de familias) |
| 20 | `polynomial_casagrande_rst` | "Polynomial CasaGrande RST" (#11) | ✅ Coincide | Mismo patrón sin clamp, correcto |
| 21 | `polynomial_b_kpa` | "Polynomial B" (#21), rama KPA | ✅ Coincide | — |
| 22 | `polynomial_b_mpa` | "Polynomial B" (#21), rama MPA | ✅ Coincide | Replica correctamente el orden de operaciones del legado (`MCA` se deriva del `MPA` sin escalar, no del `MPA` ya escalado) |
| 23 | `polynomial_geokon_kpa` | "Polynomial Geokon" (#22) / "Polynomial RST" (#1), rama KPA | 🟠 Coincide con salvedad operativa | Ver HALLAZGO 3 abajo (condicional de `Press`/`PressIni` no soportado por tinyexpr) |
| 24 | `polynomial_geokon_mpa` | ídem, rama MPA | 🟠 Coincide con salvedad + no verificable | Ver HALLAZGO 3 y HALLAZGO 4 (posible ×1000 no confirmable) |
| 25 | `polynomial_rst_kpa` | "Polynomial RST" (#1) — misma fórmula que Geokon, confirmado por comentario propio del legado | 🟠 Coincide con salvedad operativa | Mismo caveat que #23 |
| 26 | `polynomial_rst_mpa` | ídem, rama MPA | 🟠 Coincide con salvedad + no verificable | Mismo caveat que #24 |
| 27 | `polynomial_slope` | "Polynomial Slope Hz" (#20) | ✅ Coincide | `FreqHz=sqrt(Freq*1000)` sustituido correctamente, offset después del factor |

**Resumen**: 20/27 coinciden limpio, 4/27 coinciden con salvedad operativa
documentada (no son bugs, son responsabilidad de configuración por sensor),
2/27 con discrepancia menor confirmada (canal informativo, no afecta
alarmas/altitud), **1/27 con discrepancia real de impacto numérico alto**
(`linear_settlement_cell`). 0/27 "no aplica" (las 27 plantillas tienen
correspondencia 1:1 clara con un nodo o rama del legado). 0/27 sin verificar
por falta de evidencia — la evidencia verbatim cubrió el 100% de las familias
vivas necesarias.

### HALLAZGO CRÍTICO 1 — `linear_settlement_cell`: falta el factor de conversión de unidad en `MCA`/`ALT`

- **Plantilla**: `linear_settlement_cell`. **Campos**: `sensor_formula_template_output.expression` para `output_channel_code IN ('MCA','ALT')`.
- **Legado de referencia**: nodo "Linear" (`evidence/.../full_verbatim.js` líneas 437-474, rama `deviceType === 'settlement-cell'`), y el mismo patrón se repite en "Linear A" (líneas 287-319), "Polynomial Slope Hz" (líneas 523-543), "Linear RST PSI" (líneas 593-625) y "Linear Geokon PSI" (líneas 627-659) — 5 de 7 ramas `settlement-cell` del legado.
- **Qué difiere**: el legado calcula `MCA = MPA * factor_conv_up_to_mca` **antes** de mirar `deviceType`, y **ese mismo `MCA` con el factor ya aplicado** es el que usa en `ALT = ALT_INSTALL - Math.abs(MCA)` para la rama `settlement-cell`. La plantilla `linear_settlement_cell` en la BD real hace `MCA = MPA` (línea `(FreqIni-Freq)*cf-(TempIni-Temp)*tk`, sin multiplicar por ningún factor) y luego `ALT = altitud - abs(MPA)`.
- **Por qué importa numéricamente**: `factor_conv_up_to_mca` vale típicamente `~0.101972` (KPA) o `~101.972` (MPA) en las familias que sí clampean con factor. Si se usa `linear_settlement_cell` para un sensor cuya familia legado real era "Linear" (u otra de las 5 listadas) en vez de "Linear B" (la única familia legado cuya rama `settlement-cell` genuinamente omite el factor, líneas 142-180 del verbatim: `MCA = MPA` directo, sin conversión), el `ALT`/asentamiento calculado por la plantilla puede diferir del legado por **un orden de magnitud completo** (10x a 100x según la unidad configurada). El campo `ASENT` de la plantilla sí replica correctamente `Asentamiento = MPA` tal como lo hace el nodo "Linear" — es solo `MCA`/`ALT` los que quedan mal, y son justamente los que alimentarían una alarma de altitud si se conecta `formula_output_channel_code` a `platform_alarm_rules`.
- **No se corrigió** — se deja para que el developer decida si `linear_settlement_cell` debe aplicar el factor (como Linear/Linear A/Polynomial Slope/RST PSI/Geokon PSI) o mantenerse sin factor (como Linear B), o si hace falta desdoblar en dos plantillas de asentamiento distintas según de qué familia venga el sensor real.

### Hallazgo 2 (menor) — `linear_a`/`linear_b`: canal `MPA` no aplica `factor_unidad`

- El legado escala `MPA = resul * factor_unidad` (`factor_unidad = 0.001` si `unidad === 'KPA'`, si no `1`) antes de multiplicar por `constante` para obtener `MCA`. Las plantillas `linear_a`/`linear_b` exponen `MPA = resul` sin ese `*0.001`, pero compensan correctamente en `MCA` con un `net_factor` (0.101972) que ya es el producto `factor_unidad*constante` colapsado — por eso `MCA`/`ALT` sí coinciden con el legado. Solo el canal informativo `MPA` queda ~1000x distinto del legado para sensores en KPA. Impacto: bajo (no alimenta alarmas ni altitud), pero real si algún reporte muestra `MPA` directamente al cliente.
- Nota aparte, no bloqueante: "Linear A" (#10) tiene un *fallback* `Temp = 10.13` si `msg.Temp` llega `undefined`/`NaN`/`'NaN'`, que tinyexpr no puede replicar (no hay condicional) y la plantilla no lo documenta como limitación conocida (a diferencia del clamp-a-positivo y la bifurcación de unidad, que sí están documentados en la cabecera de `95_sensor_formula_template_catalog.sql`).

### Hallazgo 3 (salvedad operativa, no discrepancia de código) — `polynomial_geokon_*`/`polynomial_rst_*`: corrección barométrica siempre activa

- El legado solo resta `press_comp_factor*(Press-PressIni)` **si** `!isNaN(pressIni) && !isNaN(press) && pressIni !== 0` (condicional real que tinyexpr no soporta). Las 4 plantillas la aplican siempre (canal `Press` declarado `is_required` en `sensor_formula_template_input`). Para sensores sin compensación barométrica real, el operador debe fijar `PressIni = Press` (o `press_comp_factor = 0`) al configurar la fórmula para neutralizar el término — es una responsabilidad de configuración por sensor, no un bug de la plantilla, pero no está documentada en ningún comentario de `95_sensor_formula_template_catalog.sql` como las otras dos resoluciones de condicional sí lo están.

### Hallazgo 4 (no verificable con la evidencia disponible) — posible post-proceso ×1000 sobre `polynomial_geokon_mpa`/`polynomial_rst_mpa`

- Existe un nodo separado en el rule chain, "Only if MPa: to KPa" (#19 del verbatim): `if (unidad === 'MPA') { msg.PsPoros = msg.PsPoros*1000; msg.MPA = msg.MPA*1000; }`. Solo "Polynomial RST"/"Polynomial Geokon" producen `PsPoros`, así que este nodo probablemente se conecta después de ellos en el grafo para sensores en MPA — pero la evidencia extraída (`thingsboard_piezometer_rc_v2_switch_and_transforms.json`) no incluye el grafo de conexiones (107 conexiones reales, no capturadas nodo-a-nodo), así que no se puede confirmar si aplica. Si aplica, el canal `MPA` final de esas plantillas quedaría 1000x por debajo del legado para sensores en MPA (el canal `MCA`, calculado dentro del propio nodo de familia antes de este post-proceso, no se ve afectado). Queda como pendiente explícito: requiere extraer el grafo de conexiones de `PiezometerRC-V2` para confirmar o descartar.

## Fase 4 — Alarmas: cadenas hijas del legado

| # | Tarea | Cubre CA | Automatización | Estado | Evidencia |
|---|---|---|---|---|---|
| T17 | Inventariar las 7 cadenas hijas de ThingsBoard no analizadas en ADR-189 (alarmas por sitio, asentamiento acumulado, anexos) — qué hace cada una, si tiene equivalente hoy | CA-5 | 🔓 desbloqueada | ✅ | **2026-09-16**: son **8 cadenas hijas reales, no 7** — identificadas por los 8 nodos `TbRuleChainInputNode` de `PiezometerRC-V2` (no por adivinar nombres). Inventario completo con propósito y recomendación por cadena en `evidence/thingsboard_child_chains_t17.json`: 3 gates de calidad de dato (Filtro Frecuencias/Temperatura/NAN, bajo riesgo, portables ya), 2 de cómputo no crítico (Asentamiento Acumulado — específica de Antapaccay, Anexos), 3 de alarma específica de cliente real ([CJ]=Cuajone/Southern Peru Copper, [HU]=Huarón, AlarmasBrocal=El Brocal — las 3 llaman a un servicio REST externo de notificación no identificado en esta sesión) |
| T18 | Decisión por cadena: portar a `platform_alarm_rules` (posible ya, vía `formula_output_channel_code` de ADR-189) / no aplica / diferir | CA-5 | 🔒 | ☐ | Con el inventario de T17 ya no es una decisión a ciegas: Gerencia puede decidir por las 3 cadenas de alarma real (Cuajone/Huarón/Brocal) sabiendo que cada una requiere primero identificar el servicio REST de notificación detrás de 'Send alerts' — las 5 restantes (filtros + Asentamiento Acumulado + Anexos) no son alarmas, quedan fuera de esta decisión |

## Fase 5 — Calidad de datos del sync legado (ADR-054)

| # | Tarea | Cubre CA | Automatización | Estado | Evidencia |
|---|---|---|---|---|---|
| T19 | Investigar causa raíz de los timestamps corruptos documentados en ADR-054 | CA-6 | 🤖 | ✅ | Investigación de código completada (2026-09-16), sin tocar `thingsboard_sync.cpp` — ver nota de cierre debajo de esta tabla. Causa raíz YA estaba diagnosticada y el fix (`isSaneCapturedAt()`) ya está implementado y confirmado funcionando en producción (ADR-054, actualización 2026-08-30) — T20 queda documentado como ya resuelto por ese fix previo, no pendiente de un nuevo cambio. |
| T20 | Fix acotado si la causa es tratable sin tocar el legado en producción; si no, documentar el workaround | CA-6 | 🤖/🔒 | ☐ | Fuera de alcance de esta pasada (T19 es solo investigación, sin tocar código de sync) — ver hallazgo: el fix relevante ya existe desde antes de SPEC-027 (ADR-054), no queda pendiente crear uno nuevo, solo falta que el developer confirme el diagnóstico para cerrar formalmente T20 como "ya resuelto". |

**Hallazgo T19 (2026-09-16, solo investigación, sin cambios de código)**:
ADR-054 (actualización 2026-08-25) ya documenta la causa raíz con evidencia
real contra la BD de ThingsBoard de producción (`ts_kv`, Postgres 12.22):
**tres causas de origen distintas, todas del lado del dispositivo legado, no
del parseo del sync**:
1. `MS.Estantococha Inclinometro` manda `ts` en **segundos en vez de
   milisegundos** → cae en 1970 al interpretarse como ms.
2. `ZJ.BNV-MLZ-CLIMAVUE50.ResumenDiario` (estación meteorológica): **RTC sin
   sincronizar**, arrancado en enero de 1990.
3. Piezómetros `AL.Ps-1`..`AL.Ps-6`: escriben un **timestamp fijo
   `3009211340000`** (año 2065) en keys de configuración (`shared_cf`,
   `umbral2`..`umbral5`, etc.) que terminan mezcladas en la misma tabla que
   la telemetría real.
El fix ya está implementado en `backend/src/mining/thingsboard_sync.cpp`:
`kMinSaneCapturedAtMs` (línea 99, `2000-01-01T00:00:00Z`) +
`isSaneCapturedAt()` (líneas 107-112, rechaza `ts_ms` antes de esa fecha o
más de `BEEMETRY_TB_MAX_FUTURE_SKEW_MS` — default 24h — en el futuro),
invocado antes de encolar en el backfill (línea 490) y en tiempo real
(línea 686). ADR-054 (actualización 2026-08-30) confirma en logs de
`tb-sync-prod6h` que el filtro está descartando correctamente estos
timestamps en el entorno real hoy. **Conclusión**: no es un bug de parseo
del sync (mezcla de unidades epoch ms/s explica solo 1 de las 3 causas) sino
datos corruptos en el origen (RTC/config), y el fix de mitigación (rechazar,
no corregir el valor) ya existe y ya está verificado funcionando — T20 no
requiere código nuevo, solo la confirmación explícita del developer para
cerrarse formalmente.

## Fase 6 — Cierre

| # | Tarea | Cubre CA | Automatización | Estado | Evidencia |
|---|---|---|---|---|---|
| T21 | ADR de cierre: estado final por sensor real (cuáles quedaron 100% integrados, cuáles siguen pendientes y por qué) | — | 🤖 | ☐ | — |
| T22 | Actualizar `specs/REGISTRY.md` y `specs/BACKLOG.md` con el resultado de SPEC-027 | — | 🤖 | ☐ | — |

## Definition of Done (de esta feature)

- [ ] Todas las tasks 🤖 cerradas.
- [ ] Cada task 🔒 tiene una respuesta explícita del developer/Steven/Gerencia registrada (aunque la respuesta sea "diferir") — ninguna queda en silencio.
- [ ] CA-1 a CA-6 del `spec.md` demostrados con evidencia real (queries, capturas de endpoint, no solo "debería funcionar").
- [ ] Ningún reporte de "sensores activos" cuenta las 78,777 filas sintéticas de ADR-108 como sensores reales.
- [ ] `plan.md` actualizado si hubo cambios de enfoque; ADR-192 referenciado, sin editar su texto original si algo cambia (se agrega bloque de actualización fechado, convención del repo).

## Orden recomendado de ejecución

```
T1 ✅ ── T2 ✅ ── T3 ✅ ── T4 ── T5             (Fase 0, automatizable ya)
                    │
                    ├─ T6 🔒 (inventario real de campo — bloqueante para T9)
                    │
T7 ── T8 ── T10 ── T9 🔒 (depende de T6)         (Fase 1)
T11 ── T12                                        (Fase 2, independiente)
T13 ── T14 ── T16 ── T15 🔒 (depende de acceso)   (Fase 3)
T17 🔒 ── T18 🔒                                  (Fase 4, depende de Gerencia)
T19 ── T20                                        (Fase 5)
(todo lo anterior) ── T21 ── T22                  (Fase 6)
```

**Lo ejecutable de inmediato sin ninguna decisión externa**: T4, T5, T7, T8,
T10, T11, T12, T13, T14, T16, T19, T20 (y T21/T22 al cierre). Todo lo demás
(T6, T9, T15, T17, T18) está genuinamente bloqueado por un dato o una
decisión que no puede resolverse con más código — no es trabajo pendiente
por falta de esfuerzo, es trabajo que depende de otra persona.
