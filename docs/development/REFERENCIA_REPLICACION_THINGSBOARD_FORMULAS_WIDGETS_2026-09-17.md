# Referencia para replicación: fórmulas, alarmas y widgets de ThingsBoard (ambiente dev)

**Fuente:** `beemetrydb` en `10.244.49.159` (ambiente de **desarrollo**, VPN `Beemetry_VPN_Dev` — ver [INVESTIGACION_REPLICA_BD_PRODUCCION_THINGSBOARD_2026-09-16.md](../INVESTIGACION_REPLICA_BD_PRODUCCION_THINGSBOARD_2026-09-16.md) para el contexto completo de esta base).
**Propósito:** documentar cómo ThingsBoard gestiona hoy telemetría, calibración de sensores, alarmas y visualización, como referencia para la nueva plataforma — **sin que esta dependa de ThingsBoard**.

## 1. Motor de reglas (Rule Engine) — donde vive la lógica de calibración

ThingsBoard no calcula las fórmulas en el dispositivo ni en la base de datos: las aplica un **Rule Chain** (cadena de nodos) cada vez que llega un dato crudo, ANTES de guardarlo en `ts_kv`. Se identificaron **70 rule chains**, en su mayoría uno por tipo de instrumento (`PiezometerRC-V1/V2`, `PrismRC`, `TiltmeterRC`, `TiltmeterInPlaceRC`, `ExtensometerRC`, `CasagrandeRC`, `AccelerographRC`, `HydrometricRC`, `WeatherstationRC`, `LevelRC`, `SettlementCellRC`, `BuoyRC`, `ManualLoggerRC`) más variantes específicas por cliente (`[CJ] ...` = Cuajone, `[HU] ...`, `GoldFields Alarmas`, `Marcobre Alarmas ...`, `Centinela Camposol Alarmas`, `Coimolache Correccion`, `PH Tantahuay Alarmas`, `Piezometros Brocal Alarmas`, `Celdas_Cuajone`).

### Anatomía típica de una cadena (ejemplo: `PiezometerRC-V2`, 79 nodos)
Patrón repetido por cada fabricante/modelo de sensor:
1. **`"<Modelo>" Attrs`** (`TbGetAttributesNode`) — carga constantes de calibración guardadas como *shared attributes* del dispositivo: `shared_FreqIni`, `shared_TempIni`, `shared_tk`, `shared_cf`, `shared_altitud`, `shared_offset`, `shared_criteria`, `shared_unidad`, `shared_factor_conv_up_to_mca`.
2. **`"<Modelo>" Equation`** (`TbTransformMsgNode`) — script JS que aplica la fórmula de calibración (lineal o polinómica) usando esas constantes + el dato crudo (`Freq`, `Temp`).
3. Filtros de sanidad: `Filtro NAN`, `Battery Validation`, `Freq and Temp Validation`, `Filtro Freq Alta - Baja`, `Filtro Temp Alta - Baja` (`TbJsFilterNode`/`TbJsSwitchNode`) — descartan lecturas fuera de rango antes de persistir.
4. **`Savepoint N`** (`TbMsgTimeseriesNode`) — punto donde el resultado calculado se guarda como telemetría nueva (ej. `MCA`, `MPA`, `ALT`, `PsPoros`, `MtColAgua`).
5. Nodos `Go To <Cadena de Alarmas>` (`TbRuleChainInputNode`) — delega la evaluación de umbrales a una sub-cadena de alarmas específica del cliente/sitio.

### Modelos/fabricantes de calibración identificados (relevante para ADR-189)
Dentro de `PiezometerRC-V2` hay una variante de fórmula **por fabricante**, cada una con su propia constante y unidad de conversión:
`Linear`, `Linear A/B/C/C1/D/E`, `Linear Geokon`, `Linear Geokon PSI`, `Linear Geokon PSI a KPA-MPA`, `Linear RST PSI`, `Linear Soil Instruments`, `Linear_GF`, `Polynomial A/A2/B`, `Polynomial CasaGrande`, `Polynomial CasaGrande RST`, `Polynomial Geokon`, `Polynomial RST`, `Polynomial Slope`, `Polynomial Slope Hz`.

Esto **cruza directamente** con el catálogo de 27 plantillas de calibración geotécnica ya implementado en tinyexpr (ADR-189, `sensor_formula_def` / `sensor_input_channel_def`) — vale la pena comparar nombre por nombre que los fabricantes/modelos de ADR-189 cubran (o superen) esta lista real de producción, y no al revés.

**Ejemplo real extraído (piezómetro Geokon, unidad lineal, corrección por temperatura):**
```js
// "Linear Geokon" Equation
var factorConvUpToMca = 1;
newMsg.MPA = ((freq - freqIni) * cf) + ((temp - tempIni) * tk);
if (criteria === 'negatedCf') {
    newMsg.MPA = ((freqIni - freq) * cf) + ((temp - tempIni) * tk);
}
// factorConvUpToMca según unidad: KPA=0.1019744, MPA=101.9744, PSI=0.703546663
newMsg.MCA = newMsg.MPA * factorConvUpToMca + offset;
newMsg.ALT = altitud + mca;  // cota final = altitud de instalación + columna de agua
```
Esta es la fórmula estándar de piezómetro de cuerda vibrante (vibrating wire): `presión = (freq_actual² - freq_inicial²) × factor_calibración + corrección_térmica`, simplificada aquí a forma lineal.

**Las 175 fórmulas de transformación + 84 filtros JS completos están exportados en:** [`thingsboard_formulas_export_2026-09-17.psv`](thingsboard_formulas_export_2026-09-17.psv) (formato `cadena|nodo|tipo|codigo_js`, ~7,300 líneas — el pipe `|` separa columnas, el código JS conserva saltos de línea).

## 2. Alarmas — el umbral vive en el filtro, no en el nodo de alarma

`TbCreateAlarmNode`/`TbClearAlarmNode` (22 nodos, exportados en [`thingsboard_alarm_rules_export_2026-09-17.psv`](thingsboard_alarm_rules_export_2026-09-17.psv)) solo definen **severidad, tipo de alarma y el JSON de detalle** (`alarmDetailsBuildJs`) — la condición numérica que dispara la alarma (ej. "MCA > umbral_critico") vive en el `TbJsFilterNode`/`TbJsSwitchNode` que precede al nodo de alarma dentro de la misma cadena (ver `Filter Equation`, `MCA < 0 & Umbrales`, `Add Umbrals` en `PiezometerRC-V2`). Para replicar una alarma específica hay que leer el filtro Y el nodo de alarma juntos — están en el mismo archivo exportado, agrupados por cadena.

## 3. Catálogo de widgets (tipos de "diagramas")

**292 tipos de widget** definidos, desglose por categoría ThingsBoard:

| Categoría | Cantidad | Uso típico |
|---|---|---|
| `timeseries` | 122 | gráficos de línea/barra en el tiempo — el grueso de la visualización de sensores |
| `latest` | 120 | tarjetas de último valor, tablas, indicadores |
| `rpc` | 25 | controles/actuadores (switches, sliders) |
| `static` | 19 | navegación, controles de dashboard |
| `alarm` | 6 | tablas/series de alarmas |

**Catálogo completo (nombre + categoría) exportado en:** [`thingsboard_widget_catalog_2026-09-17.psv`](thingsboard_widget_catalog_2026-09-17.psv).

Los más relevantes para replicar (widgets **custom**, no genéricos de ThingsBoard, hechos a medida para monitoreo geotécnico — nombres literales encontrados):
- `Corte con Lineas`, `Corte con Puntos`, `Corte DP1 02 Puntos Desarrollo` — cortes/secciones transversales de talud.
- `Desplzamiento` (sic), `Displacement`, `Acumulado Eje A/B` — vectores/series de desplazamiento (prismas, extensómetros).
- `Balance Total`, `Balance Total V1` — balance hídrico (piezómetros/caudal).
- `3dLine`, `3d_line_acu` — series 3D acumuladas (probablemente inclinómetros).
- `Detalle de sismos` — detalle de eventos sísmicos (acelerógrafos).
- `Bar TimeSeries Pluviometros` — barras de precipitación.

Estos son los que realmente diferencian esta plataforma de un ThingsBoard genérico — vale la pena revisarlos primero en la UI (`board.beemetry.com`, sección Widget Library) para capturar diseño/interacción antes de diseñar sus equivalentes nuevos.

## 4. Catálogo de claves de telemetría

**7,792 nombres de key distintos** en `ts_kv_dictionary` (histórico completo desde 2022). Es un número inflado por años de nombres ad-hoc/pruebas de distintos técnicos — **no recomendable copiarlo tal cual**; mejor usarlo como diccionario de búsqueda puntual (ej. confirmar el nombre exacto de una key antes de mapearla) que como catálogo a migrar en bloque. Exportado en: [`thingsboard_telemetry_keys_2026-09-17.psv`](thingsboard_telemetry_keys_2026-09-17.psv).

## 6. Recorrido visual en `board.beemetry.com` (producción real, 2026-09-17)

Con la cuenta de Luder ya autenticada en el navegador de esta sesión, se confirmó visualmente lo hallado por SQL:

- **`PiezometerRC-V2` en el editor visual de cadenas de reglas** confirma exactamente el flujo documentado en la sección 1: `Input → Is estado in message? → Filtro NAN (subcadena) → Battery Validation → Generate Freq/Temp Unit → Convert Frequency/Temperature → Freq and Temp Validation → Filter Equation (switch)`. El nodo `Filter Equation` es un **switch** con una rama por fabricante — los nombres de rama visibles (`linear_psi_geokon`, `linear_GF`, `linearGeokon`, `linearGeokonPsi`, `linearRSTPsi`, `linearSoilInstruments`, `linear`, `linear_a`, `linear_b`, ...) son literalmente los valores que debe tener el atributo de calibración del dispositivo (`shared_criteria` o similar) para enrutar a cada fórmula — dato clave para mapear el selector de "tipo de ecuación" en el nuevo motor.

- **Biblioteca de Widgets** organizada en 33 paquetes (`Paquete de Widgets`), uno por instrumento/propósito: `Beemetry Acelerografos`, `Beemetry Desarrollo`, `Beemetry Inclinometros`, `Beemetry Mapas`, `Beemetry Medio Ambiente`, `Beemetry Piezometros`, `Beemetry Libreria Widgets 2022-1/2`, más `Alarm widgets`/`Analogue gauges` (bundles de sistema).

- **Hallazgo importante — deuda técnica visible en producción real ahora mismo**: una cantidad significativa de widgets personalizados de series de tiempo (ejes X/Y/Z de acelerógrafos, "Multiple Axis", desplazamientos "Long"/"Vert"/"Tran" de extensómetros/prismas) muestran **`Widget Error: TypeError: $(...).highcharts is not a function`** — la integración jQuery+Highcharts de esos widgets legados ya no carga en esta versión de la plataforma. Esto **no es un problema de datos ni de la investigación**, es un widget roto en la UI real que el cliente probablemente ya no puede ver correctamente. Para la nueva plataforma: evitar el mismo patrón de dependencia (jQuery plugin wrapper sobre una librería de gráficos) que se vuelve fragil entre actualizaciones.

- El bundle `Beemetry Acelerografos` tiene widgets de acción (no solo visualización): **"Trae valores"** y **"Corrección Línea Base"** — botones que disparan procesamiento server-side (probablemente RPC a un rule chain que recalcula/corrige la señal sísmica). Vale la pena replicar este patrón de "acción manual disparada desde el dashboard" para casos similares (recalibración, reproceso de un rango de fechas).

- **Actualización**: se completó el recorrido de los 17 bundles propios — ver sección 6bis para el detalle completo por instrumento. El código fuente completo (HTML + JS del controlador) de los widgets `Corte con Puntos`/`Corte con Líneas` (rotos visualmente pero con definición íntegra en la BD) se extrajo a [`thingsboard_widget_corte_html_2026-09-17.txt`](thingsboard_widget_corte_html_2026-09-17.txt) y [`thingsboard_widget_corte_js_2026-09-17.txt`](thingsboard_widget_corte_js_2026-09-17.txt) — confirma que es un gráfico de dispersión (piezómetros) + spline (perfil del terreno) sobre eje X=distancia de corte, eje Y=elevación.

## 6bis. Recorrido exhaustivo de los 17 paquetes de widgets propios (2026-09-17)

Se recorrieron los **17 paquetes de widgets propios de Beemetry** (excluyendo los 16 paquetes de sistema de ThingsBoard: Alarm widgets, Cards, Charts, Maps genérico, etc.). Resumen por paquete:

| Paquete | Instrumento/dominio | Contenido clave |
|---|---|---|
| **Beemetry Acelerografos** | Acelerógrafos (sismógrafos) | Soporta **2 marcas de fábrica distintas**: **Kinemetrics** (canales CH0/CH1/CH2) y **Guralp** (canales CH0/CH1/CH2, ejes N-S/E-O/Z). Series derivadas **SeismicACC/SeismicVEL/SeismicDIS** (aceleración→velocidad→desplazamiento, procesamiento sismológico estándar). Flujo de "Detalle de sismos": botones **Trae valores → Corrección Línea Base → Original** (workflow de corrección manual de eventos sísmicos). Botones de exportación por marca ("Download Guralp X", "Download Kinemetrics"). |
| **Beemetry Desarrollo** | Sandbox de prototipos (todos los instrumentos) | **Carga manual de archivo `.IDFW`** (formato nativo de acelerógrafo) y **carga de CSV genérico** — ingesta manual de datos como respaldo del pipeline automático. Contadores de excedencias (Excedencias1-4, por eje Long/Vert/Tran). Widgets MAX_MIN. **"MAPA" (Mapbox) y "Rosa Plotly" (Plotly) — funcionan correctamente**, a diferencia de todo lo basado en Highcharts. "Corte DP1 02 Puntos" (otro prototipo de corte, roto). "Formulas SOIL CARD" (tarjeta de resultado de fórmula). |
| **Beemetry Inclinometros** | Inclinómetros | Patrón **Incremental vs. Acumulado** por eje (A/B, X/Y). Variantes "InPlace" (inclinómetro fijo) con series 3D (`3dLine`, `3d_line_acu`) — **el gráfico 3D no muestra error de Highcharts** (usa otra librería), con control de filtro **"Profundidad: Min/Max"** (relevante: los inclinómetros miden por segmentos de profundidad, no un solo punto). |
| **Inclinometros** (2025, bundle nuevo separado) | Inclinómetros | Solo 1 widget ("Colores" — referencia de leyenda de colores), en construcción. |
| **Beemetry Piezometros** | Piezómetros | **`Corte con Puntos` / `Corte con Líneas`** — gráfico de dispersión+spline (Highcharts) que grafica cada piezómetro en un corte geológico: eje X = `distancia_corte`, eje Y = elevación (`ALT`), tooltip con MCA/MPA/temp/freq/fecha de última lectura. Código fuente completo extraído (ver sección 6). Reportes mensual/diario/CSV. Roto por el mismo error de Highcharts. |
| **Prismas** (2025) | Prismas topográficos | Mismo patrón Incremental/Acumulado, con variante "Incremental 24h". |
| **Beemetry Medio Ambiente** | Hidrología/ambiental | Dominio completo aparte: **perfil de humedad de suelo (SoilVue) a 9 profundidades (5cm a 100cm)**, balance hídrico (`Balance Total`), **escorrentía/infiltración/precipitación** (l/h), **Rosa de Viento**, nivel de pozo/embalse (`Pozo v2`, `Medio-Ambiente-Pozo`), widget `Formula SOIL` (resultado de fórmula específico de suelo). |
| **Beemetry Reportes** | Transversal (todos) | **`Elimina Registros`**: formulario para **editar manualmente Freq/Temp de un dispositivo en una fecha específica** + botón "Sync" — herramienta de corrección manual de telemetría, crítica de replicar. Reporte diario con filtro Año/Mes + buscar. Tablas alarmas tiempo real. |
| **Controles** | Transversal | Widgets RPC genéricos + `Controles/EditarEsteNorte` (edición de coordenadas UTM Este/Norte del dispositivo). |
| **DevelopmentZone** | Tiltmeters + sandbox | `Tiltmeter Table/Date Acumulado/Incremental`, `Tiltmeters 3D Graph (in testing)`, `Displacement`, `Timeseries Custom Thresholds` (bandas de umbral personalizadas sobre el gráfico), `Timeseries validation table` (tabla de validación de datos), `Annexes Editable Form` (formulario editable de anexos/adjuntos). |
| **Sismografos** (2025) | Sismógrafos | Solo "Frecuencias" (en construcción). |
| **Tilmiters** | Tiltmeters | Solo `Desplzamiento` (desplazamiento, sic — typo original). |
| **zone_svc** (2026, el más reciente) | Transversal | `comentario_widget` (anotaciones sobre datos), `Timeserie_tooltip_descarga` (tooltip con descarga de datos), `Tiltmeters 2D Graph svc`, `Annexes Editable Form`. |
| **Series Analysis** | Transversal | Mayormente widgets marcados "ELIMINAR" (obsoletos) o rotos — sin valor de referencia. |
| **Beemetry Libreria Widgets 2022-1/2** | Genéricos | Gauges, sliders, switches, termostatos — controles RPC de stock, sin lógica de dominio minero. Dependen de un CDN externo caído (`sre-solutions.com`) — otra dependencia externa rota a evitar. |
| **Beemetry Mapas** | Mapas | Ambos widgets (mapa con leyenda, Google Maps) rotos: `TbMapWidgetV2.settingsSchema is not a function` — API de mapas de una versión vieja de ThingsBoard, incompatible con la versión actual del servidor. |

### Conclusión técnica clave para la nueva plataforma
Se confirmó un patrón consistente de **qué tecnología de visualización sobrevivió la actualización de ThingsBoard y cuál no**:
- ❌ **Roto**: todo lo construido sobre **jQuery + Highcharts** (`$(...).highcharts is not a function`) — la mayoría de gráficos de series de tiempo custom, incluyendo los dos cortes geológicos de piezómetros.
- ❌ **Roto**: el widget de mapa nativo de ThingsBoard v2 (`TbMapWidgetV2`) — API cambiada entre versiones.
- ❌ **Roto**: recursos cargados desde el CDN externo `sre-solutions.com` (dominio ya no disponible).
- ✅ **Funciona**: widgets basados en **Mapbox** (mapa) y **Plotly** (rosa de vientos, gráfico 3D de inclinómetros) — no dependen de la integración jQuery legada.

**Recomendación directa para la nueva plataforma**: usar una librería de gráficos con API estable y sin wrapper jQuery intermedio (evitar el patrón "Highcharts vía jQuery plugin"), y Mapbox/Plotly (o equivalentes modernos) para mapas y visualizaciones 3D — son las únicas piezas de la plataforma legada que siguen funcionando hoy sin mantenimiento.

## 7. Siguientes pasos sugeridos

1. Comparar el catálogo de fórmulas real (sección 1) contra las 27 plantillas de ADR-189 — identificar gaps (fabricantes/modelos que existen en producción real pero no en el nuevo motor).
2. Con la UI de `board.beemetry.com` abierta (cuenta ya activada), revisar visualmente los widgets custom listados en la sección 3 para documentar su diseño antes de construir equivalentes.
3. Decidir con el equipo qué alarmas (sección 2) son universales (aplican a cualquier tenant/sitio) vs. cuáles son reglas puntuales de un solo cliente que no vale la pena generalizar.
