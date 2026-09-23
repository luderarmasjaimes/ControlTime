# Investigación — Motor de cálculo legado (ThingsBoard/Board) para instrumentación geotécnica (piezómetros y afines)

**Fecha:** 2026-09-14
**Rama:** `2026-08-21`
**Propósito de este documento:** dejar registro técnico completo del análisis de la cadena de reglas `PiezometerRC-V2` de la plataforma ThingsBoard-legado ("BEEMETRY" en `board.beemetry.com`, ver [ADR-054](decisions/054-sync-thingsboard-legacy-aws.md)), como paso previo a decidir CÓMO reproducir su funcionalidad en la plataforma nueva (motor real, [ADR-187](decisions/187-administracion-sensores-motor-formulas-tiempo-real.md) / [ADR-188](decisions/188-reconstruccion-tab-calculo-motor-real.md)). Este documento es investigación, no decisión: no crea ni cambia código. La decisión de arquitectura queda pendiente de confirmación del developer (ver sección 7).

**Fuentes analizadas:**
- Exportación JSON de la cadena de reglas `PiezometerRC-V2` (`piezometerrc_v2.json`, 78 nodos + 100 conexiones), provista por el usuario.
- Capturas de pantalla del editor de cadenas de reglas de ThingsBoard: paleta de nodos (Enriquecimiento/Transformación/Acción/Analítica/Externo/Flujo), el diagrama completo renderizado, y el editor real en `board.beemetry.com` con la sesión de "STEVEN JEANPIERS VERA CARRANZA — Administrador Propietario".
- No se tuvo acceso en vivo a la plataforma en esta pasada (la extensión "Claude in Chrome" no estaba conectada); el análisis es 100% sobre el JSON exportado y las capturas.

---

## 1. Qué es realmente esto (y qué NO es)

`PiezometerRC-V2` **no es un editor de fórmulas de usuario** en el sentido en que lo es el motor real ADR-187 (una expresión libre tipo `tinyexpr` por sensor). Es una **cadena de reglas de ThingsBoard con un `switch` central de 23 ramas fijas**, cada una un fragmento de JavaScript hardcodeado con la física de calibración de una familia de instrumento geotécnico distinta (Geokon, RST, Soil Instruments, Slope Indicator, celdas de asentamiento, etc.), seleccionada por un atributo de dispositivo llamado `shared_equation`.

En otras palabras: donde el motor nuevo dice *"el usuario escribe la fórmula"*, el motor legado dice *"el catálogo de fórmulas ya viene programado en 23 variantes; el técnico de campo solo elige cuál aplica a su sensor y llena las constantes de calibración (`cf`, `tk`, `FreqIni`, `TempIni`, `param_a/b/c`, etc.) como atributos compartidos del dispositivo en ThingsBoard"*.

Esto cambia por completo el enfoque de "cómo reproducir la misma funcionalidad": no hace falta un editor de fórmulas libre para esto — hace falta un **catálogo de plantillas de fórmula por tipo de instrumento**, con parámetros de calibración por sensor. Ver sección 6.

---

## 2. Flujo completo de la cadena (mapeado nodo a nodo desde el JSON)

```
[Input]
  └─ Is estado in message? (msg.estado === 'borrado')
       ├─ True  → Savepoint 1 (guarda tal cual, NO calcula nada más — registro de "borrado")
       └─ False → Copy of Original Data (guarda oriFreq/oriTemp antes de cualquier corrección)
            ├─ (rama paralela) → Filtro NAN  [sub rule-chain aparte, no incluida en este export]
            └─ Generate Freq Unit (shared_unidad_freq)
                 ├─ Failure → Battery Validation (sin conversión de frecuencia)
                 └─ Success → Convert Frequency if exist
                      (si unidad_freq=='hertz': Freq = Freq² / 1000 — conversión "dígitos→Hz" típica de cuerda vibrante)
                      ├─ (rama paralela) → Filtro Freq Alta - Baja [sub rule-chain aparte]
                      └─ Generate Temp Unit (shared_unidad_temp) → Convert Temperature if exist
                           (si unidad_temp=='ohm': Temp = Steinhart-Hart(R) → °C, coeficientes fijos C0/C1/C3)
                           ├─ (rama paralela) → Filtro Temp Alta - Baja [sub rule-chain aparte]
                           └─ Savepoint 2 (guarda Freq/Temp ya normalizados)
                                └─ Generate Global Attrs (shared_equation, FreqIni, TempIni, unidad)
                                     └─ Freq and Temp Validation (rechaza si Freq/Temp resultó "NaN" string)
                                          └─ True → FILTER EQUATION (switch de 23 ramas por shared_equation)
                                                        │
                                     ┌──────────────────┴───────────────────────────────┐
                                     │   23 pares (Attrs → Equation), ver tabla §3       │
                                     └──────────────────┬───────────────────────────────┘
                                                         ▼
                                              Savepoint 3 (guarda ALT/MCA/MPA calculados)
                                                         │
                        ┌────────────┬───────────┬───────┴───────┬──────────────┬─────────────┐
                        ▼            ▼           ▼               ▼              ▼             ▼
                 Generate umbrals  Go to      Go to [CJ]     Go to [HU]      Brocal      Go to Anexos
                 (server umbral1-5) Asentam.  Piezometer     Piezometer   [sub-chain]   [sub-chain]
                        │           Acumulado  Alarms          Alarms
                        ▼           [sub-chain][sub-chain]   [sub-chain]
                 Add Umbrals
                        ▼
                 Savepoint 4 (guarda umbral1-5 como serie temporal propia, para graficar líneas de umbral)
```

**5 cadenas de reglas hijas están referenciadas por UUID pero NO incluidas en este export** (`Filtro NAN`, `Filtro Freq Alta - Baja`, `Filtro Temp Alta - Baja`, `Go to Asentamiento Acumulado`, `Go to Anexos`, `Go To [CJ] Piezometer Alarms`, `Go to [HU] Piezometer Alarms`, `Brocal`). Esta cadena SOLO cubre la etapa de **cálculo**; la etapa de **alarmas/notificación** vive en esas cadenas hijas, no analizadas aquí. Para réplica end-to-end completa habría que exportarlas también (ver §7, pregunta pendiente).

---

## 3. Catálogo de las 23 familias de ecuación (`shared_equation`)

| Código `shared_equation` | Instrumento / caso | Parámetros de calibración (atributos compartidos) | Fórmula (resumen) |
|---|---|---|---|
| `linear` | Genérico lineal, con selector de unidad KPA/MPA/PSI | cf, tk, altitud, factor_conv_up_to_mca | `MPA=(FreqIni-Freq)*cf - (TempIni-Temp)*tk`; MCA=MPA×factor; rama especial `settlement-cell` calcula `Asentamiento` |
| `linear_GF` | Variante "GF" (geotecnia, activos M.A.) | + cota_superficie | Igual a `linear`, agrega `NF=cota_superficie-ALT`; **excepción hardcodeada**: dispositivo `GF.PZ VW-1703` fuerza `temp=10.98189` |
| `linear_a` | Lineal A: `G(R0-Ri)+K(Ti-T0)` | cf, tk, altitud, offset | Signo de frecuencia invertido vs. `linear_b`; si `Temp` es NaN usa `10.13` fijo |
| `linear_b` | Lineal B: `G(Ri-R0)+K(Ti-T0)` | cf, tk, altitud, offset, offset_bunits | Permite offset de unidades crudas antes de calcular |
| `linear_c` | Lineal C | cf, tk, altitud, offset, factor_conv_up_to_mca | `resul_freq=(FreqIni-Freq)*cf` |
| `linear_c1` | Lineal C1 | igual que C | `resul_freq=(Freq-FreqIni)*cf` (signo invertido vs. C — mismo nombre de familia, comportamiento distinto) |
| `linear_d` | Lineal D — corrección por densidad del agua | cf, tk, altitud | Tabla de densidad del agua por rango de temperatura (999.87→993.68 kg/m³); `MCA = presión / densidad` |
| `linear_e` | Lineal E — corrección barométrica | + pres_bar_ini, pres_bar | Igual a C, agrega término `(pres_bar_ini - pres_bar) * 0.0001` |
| `linearGeokon` | Piezómetro Geokon estándar | cf, tk, altitud, offset, criteria, inputTemp, inputTempCorreccion | `MPA=(Freq-FreqIni)*cf+(Temp-TempIni)*tk` (o negado si `criteria='negatedCf'`); **excepción hardcodeada**: dispositivos `BM.*` (Boroo Misquichilca) fuerzan temperatura fija/mínima; enruta después por relación de activo ("¿es 2ª fase Boroo?") para un ×1000 MPa→KPa adicional |
| `linearGeokonPsi` | Geokon con salida en PSI | cf, tk, altitud | Dirección de frecuencia invertida vs. `linearGeokon`; soporta PSI (factor 0.703546663) |
| `linear_psi_geokon` | Geokon calculado en PSI y convertido a KPA/MPA final | cf, tk, altitud, unidadFin | Calcula en PSI puro, luego convierte a `unidadFin` con constantes `psi_to_kpa=6.894757` / `psi_to_mpa=0.006894757` |
| `linearRSTPsi` | Instrumento RST con salida PSI | cf, tk, altitud, factor_conv_up_to_mca | Similar a Geokon PSI pero constantes `kpa_to_psi=0.145038` / `mpa_to_psi=145.038` |
| `linearSoilInstruments` | Soil Instruments (solo celdas de asentamiento) | cf, altitud, factor_conv_up_to_mca | **Sin término de temperatura**: `MPA = cf*(FreqIni-Freq)` |
| `polinomial_a` | Polinomial A | param_a/b/c, tk, offset, altitud, factor_conv_up_to_mca | `MPA=a·Freq²+b·Freq+c+tk·(Temp-TempIni)`; enruta por "¿es dispositivo Brocal?" → aplica umbral especial "MCA≤0 → ALT='Seco'" |
| `polinomial_a2` | Polinomial A2 — instalación inclinada | + param_D, incli, stickup, cota_superficie, prof_install | Geometría de sondaje inclinado: `NF=profInstall-MCA`, `ALT=cotaSuperficie-((NF-stickup)*sin(incli))`; **excepción hardcodeada** por nombre para 4 dispositivos `YR.PZ-05R*` (Yauricocha) |
| `polinomial_casagrande` | Piezómetro Casagrande | param_a/b/c, incli, stickup, cota_superficie, prof_install, offset_pp | Misma geometría inclinada que A2, sin término de temperatura |
| `polinomial_casagrande_rst` | Casagrande + RST | + tk | Igual a Casagrande, agrega compensación de temperatura |
| `polynomialB` | Polinomial B | tk, cf, param_a/b/c0, altitud | `MPA=a·Freq²+b·Freq+c0`; comparte el gate "¿es dispositivo Brocal?" con Polinomial A |
| `polynomialGeokon` | Geokon polinomial con compensación barométrica | param_a/b/c, tk, offset, PressIni | Compensa presión barométrica real (`Press`/`PressIni` en hPa) si están presentes |
| `polynomialRST` | RST polinomial | idéntico a `polynomialGeokon` | Mismo código, duplicado bajo otro nombre de marca de instrumento |
| `polynomialSlope` | Slope Indicator / "Hz" | param_a/b/c, offset, altitud | `FreqHz = sqrt(Freq*1000)` (conversión "dígitos crudos"→Hz²), luego polinomio sobre `FreqHz` |
| `polinomial_a1` | *(sin sensor real usándolo — confirmado por comentario del código "13-08-2024")* | — | Rama muerta: cae en el mega-script catch-all `Unknown Equation`, con compensación barométrica adicional (`PressKpa`) |
| `polinomial_comp` | *(sin sensor real usándolo)* | c0..c5 | Rama estructuralmente huérfana (sin conexión de salida en el propio grafo) — polinomio cuadrático en Freq y Temp simultáneamente |

**Nota sobre las dos ramas "sin sensor real"**: el propio código legado las marca con comentarios explícitos como no usadas en producción a la fecha de esa revisión. El mega-script `Unknown Equation` que ambas comparten **además reimplementa su propia lógica de alarmas por 5 bandas de color** (`alarmcolor`/`alarmname`/`alarmlevel` según `umbral1..5`), lo cual sugiere que en algún momento esa lógica de alarma vivió ahí antes de moverse a las cadenas hijas de alarma. No se recomienda portar estas dos ramas — son código muerto confirmado.

---

## 4. Comportamientos que NO son "una fórmula" (y por qué importan para el diseño)

1. **Selector de unidad de salida** (`KPA`/`MPA`/`PSI`/`METRO`) cambia qué constante multiplicar — es una rama condicional por sensor, no una constante fija.
2. **Excepciones por nombre literal de dispositivo** (`BM.*`, `GF.PZ VW-1703`, `YR.PZ-05R*`) — hardcodeadas en el JS, específicas de un cliente/mina real. Esto es la parte más frágil del sistema legado: cualquier motor nuevo que las reproduzca 1:1 como código está copiando deuda técnica, no una buena práctica.
3. **Enrutamiento por relación de activo** (`Is Brocal device?`, `IsBoroo2ndPhrase?`) — usa el grafo de relaciones ASSET→DEVICE de ThingsBoard (`TbCheckRelationNode`, `direction: FROM`, `relationType: Contains` contra un `entityId` fijo). Equivale a "¿este sensor pertenece a esta mina/zona/fase específica?" — en la plataforma nueva esto ya existe como jerarquía real de `zones`/tenant, pero con una forma de datos distinta.
4. **Geometría de instalación inclinada** (`incli`, `stickup`, `cota_superficie`, `prof_install`) — usada en 3 de las 23 familias para convertir MCA en nivel freático (NF) y cota (ALT) vía trigonometría, cuando el piezómetro no está instalado verticalmente. Hoy el catálogo `sensor_type_parameter_def` (ADR-188) no tiene estos campos geométricos.
5. **Alarmas multibanda** (`umbral1..5` + color, `ss_umbral_base_on` = COTA/MPA/KPA) — sistema de 5 niveles con color, no 2 (warning/error) como el motor real actual (`sensor_formula_def`, según memoria del proyecto).
6. **Filtros de rango como alarmas separadas** (`Filtro Freq Alta - Baja`, `Filtro Temp Alta - Baja`) — validación de rango de la señal cruda, independiente del cálculo, en cadenas hijas no exportadas.
7. **Publicación paralela de umbrales como serie temporal** (`Savepoint 4`) — para que el frontend pueda graficar líneas de umbral superpuestas al valor medido a lo largo del tiempo, sin tener que volver a consultar la configuración.
8. **Corrección barométrica** (`polynomialGeokon`/`polynomialRST`/`linear_e`) — compensación por presión atmosférica real medida en el mismo sensor o uno de referencia (`Press`/`PressIni`, `pres_bar`/`pres_bar_ini`).
9. **Conversión de unidad de entrada** (`unidad_freq=='hertz'`, `unidad_temp=='ohm'`) — el propio sensor puede reportar en "dígitos crudos" o en resistencia (ohmios) en vez de Hz/°C directos; hay una etapa de normalización previa a cualquier fórmula.

Ninguno de estos 9 puntos es "una expresión matemática por sensor" — son reglas de negocio/infraestructura alrededor del cálculo. Importa nombrarlos aparte porque cualquier intento de meter todo esto dentro de una sola expresión `tinyexpr` sería forzado; varios de estos puntos pertenecen a otras partes ya existentes de la plataforma nueva (catálogo de tipos, sistema de alarmas, jerarquía de zonas), no al motor de fórmulas en sí.

---

## 5. Comparación contra lo que ya existe en la plataforma nueva

| | Legado (ThingsBoard, `PiezometerRC-V2`) | Nuevo (ADR-187/188) |
|---|---|---|
| Forma del cálculo | Catálogo fijo de 23 fórmulas hardcodeadas en JS, seleccionadas por atributo `shared_equation` | Una expresión libre por sensor (`tinyexpr`), sin catálogo de plantillas |
| Parámetros de calibración | Atributos compartidos de dispositivo en ThingsBoard (`cf`, `tk`, `param_a`, etc.) | `sensor_input_parameter_def` por sensor, habilitados por tipo (`sensor_type_parameter_def`, ADR-188) |
| Condicionales (unidad, tipo de dispositivo) | Ramas `if` dentro del JS | No soportado hoy — `tinyexpr` evalúa una expresión aritmética, sin lógica condicional nativa |
| Geometría de instalación inclinada | Atributos `incli`/`stickup`/`cota_superficie`/`prof_install` | No existe en el catálogo actual |
| Alarmas por umbral | 5 bandas con color (`umbral1..5`) + alarmas de rango en cadenas separadas | 2 niveles (warning/error) en `sensor_formula_def` |
| Enrutamiento por activo/zona | Relaciones ASSET→DEVICE de ThingsBoard, hardcodeadas por UUID | Jerarquía real de `zones`/tenant ya existente en el modelo de datos, pero no conectada al motor de fórmulas |
| Excepciones por dispositivo específico | Hardcodeadas por nombre en el JS (mala práctica, pero real y en producción) | No existe (y no debería copiarse tal cual — ver §7) |

**Conclusión de la comparación**: el motor nuevo (ADR-187) es la pieza de evaluación correcta a reutilizar (ya es real, verificado, con poller de 10s), pero **falta una capa completa de "catálogo de plantillas de fórmula por tipo de instrumento"** encima de él para llegar a paridad funcional con el legado. No es un bug ni un error de ADR-187 — es un alcance que nunca se pidió hasta ahora.

---

## 6. Brechas concretas a cerrar ("las cosas faltantes")

1. **Catálogo de plantillas de fórmula por familia de instrumento** — no existe hoy. Necesita una tabla nueva (p. ej. `sensor_formula_template_def`) con: código de plantilla, nombre visible, expresión `tinyexpr` parametrizada, y lista de parámetros de calibración requeridos (para autocompletar el editor cuando el admin elige una plantilla).
2. **Soporte de condicional por unidad de salida (KPA/MPA/PSI)** — `tinyexpr` puro no tiene `if`. Hay que decidir: (a) generar 3 variantes de expresión pre-resueltas por unidad al momento de guardar la plantilla, o (b) extender el evaluador con una función condicional mínima. Impacta a casi todas las 23 familias.
3. **Parámetros geométricos de instalación inclinada** (`incli`, `stickup`, `cota_superficie`, `prof_install`) — agregar al catálogo de parámetros por tipo de sensor (ADR-188), hoy no contemplados.
4. **Alarmas multibanda (5 niveles + color)** — decidir si se extiende `sensor_formula_def` (hoy 2 niveles) o se delega al sistema de alarmas real ya existente (`device_alarm_routes.cpp`), que puede ser el lugar correcto en vez de duplicar lógica de alarmas dentro del motor de fórmulas.
5. **Enrutamiento por pertenencia a activo/zona/cliente específico** (Brocal, Boroo 2ª fase) — mapear contra la jerarquía real de `zones`/tenant en vez de relaciones ASSET de ThingsBoard.
6. **Excepciones por dispositivo específico** — **no portar tal cual** (ver recomendación en §7): deben convertirse en atributos de override por sensor (dato de configuración), nunca en `if (deviceName == '...')` dentro de código nuevo.
7. **Filtros de rango de señal cruda (Freq/Temp fuera de rango, batería baja)** — verificar si ya existe un mecanismo equivalente de alarma de rango por sensor en la plataforma nueva; si no, es una brecha aparte del motor de fórmulas.
8. **Corrección barométrica con sensor de referencia** (`Press`/`PressIni`) — requiere que el sensor tenga acceso al valor de otro sensor (uno barométrico) en el mismo cálculo; hoy no está claro si el motor real soporta referenciar telemetría de OTRO sensor dentro de una fórmula (a confirmar contra `sensor_formula_evaluator.cpp`).
9. **Conversión de unidad de entrada cruda** (dígitos→Hz, ohm→°C) — etapa de normalización previa a la fórmula; hoy no hay un lugar definido para esto en el pipeline de ingesta real (`telemetry_ingest.cpp`) — a confirmar si conviene ahí o como "pre-fórmula" dentro del propio `sensor_formula_def`.
10. **Las 7 cadenas hijas no exportadas** (alarmas de rango, alarmas de piezómetro por sitio, cálculo de asentamiento acumulado, anexos) — fuera del alcance de este JSON; se necesitaría exportarlas para tener el cuadro completo de "misma funcionalidad" en la etapa de alertas, no solo en la de cálculo.

---

## 6bis. Hallazgo crítico posterior (2026-09-14, tras revisar el código del motor real): entrada de telemetría de un solo canal

Al revisar `backend/src/mining/sensor_formula_evaluator.cpp` y `db_scripts/93_sensor_formula_engine.sql` para diseñar el catálogo de plantillas (decisión ya tomada por el developer, ver §7), se confirmó un límite estructural más profundo que las 10 brechas de §6:

- `loadLatestTelemetryValue()` liga **una sola variable de telemetría** a la fórmula, siempre nombrada `value`, siempre leída de `telemetry_fact` con `channel_id = 0`.
- `dim_channel` documenta ese canal 0 como `'PRIMARY'` — *"Lectura escalar única — compat con telemetry_raw/mineria_lecturas/mining_sensor_history"*. Es decir: el modelo de ingesta real fue diseñado, a propósito, para un escalar por sensor.
- Confirmado hasta el protocolo de cable: `telemetry_ingest.cpp` recibe `"<sensor_code>,<value_numeric>[,<quality_code>]"` — un solo número por mensaje, para cualquier sensor de la plataforma hoy.
- **Las 23 familias de §3 necesitan mínimo 2 entradas crudas variables en el tiempo (Freq, Temp), y 4 de ellas una tercera (Press/PressIni o pres_bar/pres_bar_ini)**. Esto no es una entrada de calibración (`sensor_input_parameter_def` ya soporta N de esas, son constantes), es telemetría cruda que cambia con cada lectura del sensor.

**Conclusión**: antes de construir el catálogo de plantillas, hay que extender el modelo de ingesta/evaluación para soportar múltiples canales de entrada crudos por sensor. Es un cambio de mayor alcance que las 10 brechas anteriores porque toca el contrato de ingesta de TODA la plataforma, no solo de piezómetros. Tres caminos posibles, con trade-offs muy distintos (ver pregunta en §7):

1. **Extender el protocolo de ingesta a múltiples canales nombrados por mensaje** (p. ej. `sensor_code,channel_code,value` o payload JSON con varias claves). Máximo alcance: cualquier sensor futuro puede tener N entradas. Mayor riesgo: toca el `COPY` binario a Postgres, el conector Kafka/Redpanda, y cualquier integración externa que ya envíe el formato de 1 valor.
2. **Modelar Freq/Temp/Press como sensores separados** que una fórmula pueda referenciar entre sí (requiere que el evaluador soporte leer telemetría de OTRO `sensor_id`, no solo el propio). No toca el protocolo de ingesta de un sensor individual, pero no refleja cómo el instrumento físico realmente reporta (un piezómetro de cuerda vibrante manda Freq+Temp juntos en una sola trama), y typosquatting entre sensor lógicos añade una capa de indirección nueva.
3. **Extensión acotada solo para sensores multivariados** (los que hoy ya usan `sensor_input_parameter_def`/`sensor_output_channel_def`, ADR-187): agregar una tabla `sensor_input_channel_def` (canales de ENTRADA nombrados, paralela a la de salida que ya existe) + una ruta de ingesta alternativa que acepte 2-3 valores nombrados en un solo mensaje para esos sensores puntuales, sin tocar el camino de ingesta de 1-valor que sigue usando el resto de la plataforma. Menor alcance y menor riesgo de regresión en sensores existentes; el motor evaluador (`sensor_formula_evaluator.cpp`) se extiende para leer N canales de `telemetry_fact`/`telemetry_multivariate` del MISMO sensor en vez de solo `channel_id=0`.

---

## 7. Puntos que requieren decisión del developer antes de construir

Esto es instrumentación de **seguridad geotécnica real** (piezómetros miden presión de poros en taludes/relaves — una mala lectura o alarma puede significar no detectar a tiempo una condición de falla). Por eso, antes de escribir una sola línea de C++/SQL para esto, hay 3 decisiones que no me corresponde tomar solo:

1. **¿Portar literal (1:1, incluyendo las excepciones hardcodeadas por nombre de dispositivo) o rediseñar como catálogo de plantillas parametrizadas?** Recomiendo lo segundo (ver §5-6), pero implica que las excepciones por nombre de dispositivo (Boroo, GF.PZ VW-1703, Yauricocha) se conviertan en atributos de configuración explícitos por sensor — es más trabajo de migración de datos, pero elimina una fuente conocida de errores silenciosos.
2. **¿Alcance completo (23 familias) de una vez, o solo las familias con sensores reales activos hoy?** El JSON ya me dice que 2 de las 23 no tienen ningún sensor real (`polinomial_a1`, `polinomial_comp`) — esas se pueden excluir directamente. Para el resto, no tengo forma de saber desde el JSON cuáles están realmente en uso en producción sin consultar la plataforma en vivo (atributo `shared_equation` real de cada dispositivo).
3. **¿Dónde vive la lógica de alarmas multibanda y de rango?** — ¿se extiende el motor de fórmulas, o se conecta con el sistema de alarmas ya real de la plataforma nueva?

**Sobre el acceso a la plataforma que ofreciste**: la extensión "Claude in Chrome" no está conectada en este momento en esta sesión, así que no pude navegar `board.beemetry.com` en modo lectura para confirmar qué `shared_equation` tiene realmente configurado `PIEZOMETERRC-V2` ni ver la pantalla de atributos del dispositivo. Si querés que revise eso, se puede: (a) conectar la extensión (Chrome Web Store + iniciar sesión con la misma cuenta), o (b) exportar/copiar los valores de atributos compartidos de ese dispositivo específico (screenshot de la pestaña "Atributos" del dispositivo en ThingsBoard) — con eso puedo armar un caso de prueba real de punta a punta (mismos Freq/Temp crudos → comparar salida legado vs. motor nuevo) antes de dar por buena cualquier implementación.

No voy a iniciar sesión yo mismo en ningún sistema con contraseñas — eso sigue siendo una restricción dura, sin excepción, independientemente del acceso que se ofrezca.

---

## 8. Decisiones tomadas por el developer (2026-09-14) — cierra este documento de investigación

1. **Arquitectura de las 23 fórmulas**: catálogo de plantillas parametrizadas sobre `tinyexpr` (no portar literal el JS, no arrastrar las excepciones hardcodeadas por nombre de dispositivo — se convierten en atributos de override por sensor).
2. **Alcance**: las 23 familias completas de una vez (no incremental por uso real detectado).
3. **Alarmas multibanda**: viven en el sistema de alarmas real ya existente (`device_alarm_routes.cpp`, que ya soporta reglas con `operator`/`threshold`/`severity` — se extiende, no se duplica dentro del motor de fórmulas).
4. **Ingesta multicanal**: extensión acotada solo para sensores multivariados (nueva tabla de canales de entrada nombrados + ruta de ingesta alterna de 2-3 valores por mensaje, exclusiva de sensores que ya usan el modelo ADR-187; el resto de la plataforma sigue con el formato de 1 valor sin cambios).

Este documento pasa de "investigación abierta" a "insumo cerrado" para el ADR-189 que documentará el diseño e implementación concreta.

---

## Referencias
- [ADR-054](decisions/054-sync-thingsboard-legacy-aws.md) (bridge de sincronización con `board.beemetry.com`)
- [ADR-187](decisions/187-administracion-sensores-motor-formulas-tiempo-real.md) (motor real de fórmulas, tinyexpr)
- [ADR-188](decisions/188-reconstruccion-tab-calculo-motor-real.md) (catálogo de tipos/parámetros por sensor)
- `piezometerrc_v2.json` (exportación de la cadena de reglas, provista por el usuario 2026-09-14)
