# ADR-190 — Auditoría de coordenadas GPS oficiales de la mina + fix del marcador invisible (Administración de Empresas)

**Status**: implemented (2026-09-15)

**Fecha**: 2026-09-15

**Ámbito**: mapas, auth, administración de empresas

## Contexto

En la pantalla "Administración de empresas" (`CompanyManagementView.tsx`), el
picker de ubicación de la mina (`CompanyLocationPicker.tsx`, introducido en
ADR-121) presentaba dos problemas reportados por el usuario:

1. **Marcador invisible/confuso**: `CompanyLocationPicker.tsx` usaba
   `L.marker(...)` con el icono por defecto de Leaflet
   (`marker-icon.png`/`marker-shadow.png`). Ese icono se rompe al empaquetar
   con Vite — las rutas relativas del CSS de Leaflet no resuelven contra los
   assets procesados por el bundler — dejando el marcador invisible o como un
   ícono roto sobre el satelital. `GeocatminWorkbench.tsx` ya había resuelto
   el mismo problema con un `L.divIcon` propio; `CompanyLocationPicker.tsx`
   nunca adoptó ese patrón.
2. **Coordenadas imprecisas**: revisando `auth_companies`, 51 de las 52
   empresas ya tenían latitude/longitud cargadas (solo quedaba vacía una fila
   de prueba QA), pero varias eran aproximaciones redondeadas (ej.
   `-14.85,-73.65`, `-10.45,-76.75`) — visualmente el marcador caía lejos del
   yacimiento real, o incluso en la región/provincia equivocada.

ADR-121 es explícito en que no se debe usar IA para inventar/inferir
coordenadas GPS ("un LLM puede alucinar una ubicación, y una coordenada de
mina equivocada tiene consecuencias operativas reales") y que "no hay fuente
confiable para inferirlas retroactivamente". Este ADR documenta cómo se
abordó la corrección de coordenadas sin violar ese principio: cada valor
propuesto está atado a una fuente citada (documento oficial, informe técnico
regulatorio, o geocodificación exacta de una dirección ya registrada), nunca
a una inferencia libre del modelo. Donde no se encontró una fuente
verificable mejor que el valor ya cargado, se dejó explícitamente sin tocar
en vez de "completar" el dato.

## Decisión

### 1. Fix del marcador (`CompanyLocationPicker.tsx`)

Mismo patrón que `GeocatminWorkbench.tsx`: un pin propio vía `L.divIcon`
(gota índigo con borde blanco y halo), en vez del icono roto por defecto de
Leaflet. Aplica tanto al marcador inicial como al que se coloca por clic o
resultado de búsqueda.

### 2. Auditoría de coordenadas (`db_scripts/97_company_mine_coordinates_audit.sql`)

Se investigaron las 51 empresas reales contra fuentes oficiales o
razonablemente confiables, en este orden de preferencia:

1. Resoluciones MINEM/DGAAM, SENACE (EIA/MEIA) — coordenadas UTM citadas
   textualmente en el documento oficial, convertidas a decimal WGS84.
2. Informes técnicos regulatorios de la propia empresa (ej. NI 43-101 de
   Hudbay para Constancia, informe técnico de Gold Fields para Cerro Corona).
3. OSINERGMIN / documentos técnicos indexados académicamente, cuando eran
   internamente consistentes (coordenada geográfica y UTM convertida
   coinciden entre sí).
4. Para empresas NO mineras (proveedores de maquinaria, oficinas
   corporativas/SaaS sin una "mina" propia): geocodificación exacta de la
   dirección de sede ya registrada en `domicilio_fiscal`.

**Resultado**: 35 de 52 empresas corregidas, 17 dejadas sin cambio (ver
tabla). Ningún valor fue inventado — donde la única fuente disponible era de
nivel "distrito/localidad" y no mejoraba sobre el dato ya cargado, o donde no
se encontró ninguna fuente verificable, se mantuvo el valor existente.

### 3. Reconciliación de duplicados

El catálogo tiene pares de empresas que representan el mismo yacimiento real
bajo nombres/tenants distintos (mismo patrón que ya traían las coordenadas
originales de ADR-121 para varios de estos pares):

- `Compania Minera Antamina` / `Minera Antamina` → mismo tajo Antamina.
- `Compania Minera Raura` / `Minera Raura` → misma mina Raura.
- `Compania Minera Poderosa` / `Minera Poderosa` → mismo yacimiento (sin
  cambio, no se encontró fuente confiable — ver tabla).
- `El Brocal` / `Sociedad Minera El Brocal` → mismo yacimiento Colquijirca
  (confirmado, no corregido — el valor ya cargado coincidía con la fuente
  oficial).
- `Ares` / `Compania Minera Ares` → mismo yacimiento (sin cambio).
- **Hallazgo nuevo**: `Sierra Metals Yauricocha` y `Minera Corona` también
  son el mismo yacimiento real (mina Yauricocha, distrito Alis/Laraos,
  Yauyos) — la coordenada original de `Minera Corona` apuntaba a Corihuarmi,
  que en realidad opera Minera IRL, no Corona. Se corrigieron ambas filas al
  mismo valor.

## Empresas corregidas (35)

| Empresa | Antes | Después | Fuente (resumen) |
|---|---|---|---|
| Anglo American Quellaveco | -17.112,-70.625 | -17.084,-70.632 | EIA exploración, UTM 19S |
| Compania Minera Antamina / Minera Antamina | -9.549,-77.054 | -9.540,-77.064 | RD 0303-2023/MINEM-DGAAM, tajo abierto |
| Las Bambas | -14.167,-72.333 | -14.096,-72.291 | Tercera MEIA (SENACE), junto al tajo Ferrobamba |
| Minera Cerro Verde | -16.536,-71.583 | -16.526,-71.583 | MINEM, Plan de Cierre de Minas |
| Chinalco Peru | -11.595,-76.195 | -11.608,-76.141 | MEIA Toromocho |
| Yanacocha | -6.983,-78.508 | -6.977,-78.505 | Documento técnico UTM 17S |
| Hudbay Peru | -14.12,-71.75 | -14.45,-71.783 | Informe técnico regulatorio NI 43-101 (Constancia) |
| Minsur | -14.28,-70.28 | -14.229,-70.318 | Dos fuentes académicas independientes (San Rafael) |
| Gold Fields La Cima | -6.72,-78.42 | -6.7600,-78.6189 | Informe técnico oficial Gold Fields plc |
| Hochschild Mining Peru | -14.7,-73.35 | -14.9553,-73.2428 | Documento técnico Inmaculada (geo+UTM consistentes) |
| Marcobre | -15.05,-75.15 | -15.1590,-75.0620 | EIA Mina Justa vía SENACE/prensa especializada |
| Nexa Resources Peru | -13.5,-76.05 | -13.0779,-75.9921 | UTM prensa gremial + Mindat (Cerro Lindo) |
| Sierra Metals Yauricocha / Minera Corona | -12.3,-75.85 / -12.28,-75.83 | -12.3106,-75.7077 | Mismo yacimiento real (Yauricocha), no Corihuarmi |
| Bear Creek Mining | -14.15,-69.75 | -13.8753,-70.6081 | Corrige error de >100km (Corani, Puno) |
| Catalina Huanca | -13.9,-74.05 | -13.98191429,-73.93421052 | GPS publicado + distrito INGEMMET |
| Compania Minera Raura / Minera Raura | -10.45,-76.75 | -10.4417,-76.7417 | Documento técnico (confirma, refina) |
| Minera Bateas | -15.19,-71.77 | -15.20419,-71.86280 | Mindat + sitio oficial Fortuna Mining (Caylloma) |
| Minera Boroo Misquichilca | -6.95,-78.45 | -7.94223,-78.24620 | Corrige región: opera Lagunas Norte (La Libertad), no Cajamarca |
| Minera Caraveli | -15.77,-73.35 | -15.6426,-74.0793 | POI verificado + sitio corporativo |
| Minera Condestable | -12.68,-76.4 | -12.6937,-76.5916 | POI exacto + MEIA consistente |
| Minera IRL | -13.8,-70.5 | -13.7951,-70.4717 | Refinamiento (Ollachea) |
| Minera Los Quenuales | -10.9,-76.7 | -10.7653,-76.7429 | POI exacto "Unidad Minera Iscaycruz" |
| Compania Minera Volcan | -10.68,-76.25 | -10.6719,-76.2646 | POI exacto, confirma unidad Cerro de Pasco |
| DOE Run Peru | -11.53,-75.9 | -11.5243,-75.8975 | POI exacto complejo metalúrgico La Oroya |
| Summa Gold | -7.6,-78.15 | -7.8268,-78.0079 | Corrige unidad: opera El Toro/Isabelita, no Shahuindo (esa es de Pan American Silver) |
| Buenaventura, Activos Mineros, Komatsu-Mitsui, Motored, Volvo Perú, Beemetry, TimeTelemetry (7 empresas no mineras) | — | — | Geocodificación exacta de la dirección de sede ya registrada |

## Empresas dejadas sin cambio (17)

`Minera Antapaccay` (única fuente hallada era una instalación puntual, no el
tajo), `Southern Peru Copper Corporation` (valor ya cargado coincide con la
fuente oficial), `Compania Minera Poderosa`/`Minera Poderosa`, `Consorcio
Minero Horizonte`, `Shougang Hierro Peru`, `El Brocal`/`Sociedad Minera El
Brocal` (ya correctas), `Pan American Silver Peru`, `Alpayana`, `Ares`/
`Compania Minera Ares`, `Dynacor`, `Jinzhao Mining Peru`, `Ferreyros S.A.A.`
(conflicto entre dirección declarada y sede oficial del sitio web — requiere
verificación adicional, ej. SUNAT), y la fila de prueba QA.

**Caso especial — `Compania Minera San Ignacio de Morococha` (SIMSA)**: la
investigación determinó que el nombre es engañoso — su unidad activa real es
"San Vicente" (distrito Vítoc, Chanchamayo, Junín), no Morococha (donde
apunta la coordenada actual) ni Yauricocha. No se encontró una coordenada de
San Vicente verificable dentro del tiempo de búsqueda, así que la fila queda
sin corregir pese a saberse que el valor actual está en la región
equivocada. Pendiente de una investigación puntual futura.

## Consecuencias

- Ningún valor se generó por inferencia libre de un LLM — cada corrección
  está atada a una fuente citada; ver el detalle completo (URLs, cifras UTM
  citadas textualmente, notas de confianza alta/media/baja) en las
  transcripciones de la investigación conservadas en este PR/commit.
- Persisten datos imprecisos conocidos y documentados: SIMSA (región
  equivocada, sin reemplazo verificable) y Ferreyros (sede ambigua). Quedan
  para una siguiente iteración.
- Se detectó (fuera de alcance de este ADR, no corregido aquí) mojibake en
  los nombres `Komatsu-Mitsui Maquinarias PerÃº S.A.` y `Volvo PerÃº S.A.`
  (encoding UTF-8 mal decodificado) — ver tarea separada.
- El fix del marcador (`divIcon`) beneficia a las 52 empresas por igual,
  independientemente de la precisión de sus coordenadas.

## Addendum (2026-09-15, misma sesión) — domicilio_fiscal, cruce Ares/Inmaculada, y rediseño del picker

El usuario señaló, correctamente, que la corrección debía alcanzar también al
**texto** de `domicilio_fiscal` (no solo a la coordenada), y pidió mejoras de
interfaz en `CompanyLocationPicker.tsx`. Se aplicó `db_scripts/98`:

- **Minera Boroo Misquichilca**, **Minera Corona**: `domicilio_fiscal`
  corregido para reflejar la unidad real ya usada para su coordenada
  (Lagunas Norte / Yauricocha respectivamente).
- **Ares / Compania Minera Ares**: al investigar en paralelo, el Grupo C
  determinó que la unidad activa real de esta empresa es **Inmaculada**, la
  misma que el Grupo B ya había corregido para `Hochschild Mining Peru`
  (mismo grupo corporativo). Como los dos grupos de investigación no se
  comunicaban entre sí, esta coincidencia no se cruzó en el primer pase —
  corregido ahora: se reutiliza la coordenada de Inmaculada
  (`-14.9553,-73.2428`) también para estas dos filas, y el texto pasa a
  "Unidad Inmaculada, Páucar del Sara Sara, Ayacucho".
- **Compania Minera San Ignacio de Morococha (SIMSA)**: se corrige el texto a
  "Unidad San Vicente, Chanchamayo, Junín" (evidencia sólida de prensa
  especializada), pero **la coordenada queda sin corregir** — no se encontró
  un punto verificable de San Vicente. Queda una inconsistencia conocida
  entre el texto (correcto) y el pin del mapa (todavía en la zona de
  Morococha) hasta la próxima iteración.

### Rediseño de `CompanyLocationPicker.tsx`

- **Icono del marcador**: reemplazado el pin genérico por una gota con glifo
  de montaña (SVG, gradiente índigo/violeta) + halo pulsante, más
  reconocible como "marcador de mina".
- **Campos de Latitud/Longitud visibles**: nuevos inputs en pantalla,
  sincronizados en ambas direcciones — escribir un par de coordenadas
  válidas mueve el marcador y confirma el cambio de inmediato; arrastrar o
  hacer clic en el mapa actualiza los campos en tiempo real (evento `drag`
  de Leaflet, no solo `dragend`).
- **Selector Satélite/Plano**: ambas capas via Google (`lyrs=s` / `lyrs=m`),
  intercambiables sin recrear el mapa ni perder el marcador.
- **Modo solo lectura**: usuarios con `empresas.view` pero sin
  `empresas.manage` ahora también ven el mapa y las coordenadas de la mina
  en `CompanyManagementView.tsx` (antes el picker completo estaba oculto
  para ellos) — sin buscador, sin arrastre, campos no editables.

## Addendum 2 (2026-09-15, misma sesión) — RUC real verificado contra SUNAT

El usuario reportó que la pantalla no mostraba los cambios (`CompanyManagementView`), y que además el domicilio fiscal debía ser el registrado en SUNAT según el RUC de cada empresa.

### Causa de "no se ven los cambios"

El frontend se sirve desde una imagen Docker (`beemetry-web`) compilada en un build previo — nunca se había reconstruido con los cambios de esta sesión. Además, esa build vieja tenía un bug real (no encontrado en el código fuente actual): al cambiar de empresa seleccionada, el formulario de detalle no siempre refrescaba `ruc`/`domicilio_fiscal`, mostrando datos de la empresa seleccionada anteriormente. Se reconstruyó y redesplegó `beemetry-web` (`docker compose build/up frontend`).

### RUC sintético → RUC real verificado

Se encontró que `auth_companies.ruc` era sintético por diseño (ADR-088: checksum válido, pero no el RUC real de la empresa nombrada). Se encontró además que la integración real con un verificador de RUC (ADR-087, proveedor `api.chequea.pe`, `backend/src/auth/tax_registry_client.cpp`) **ya estaba configurada y activa** (`BEEMETRY_TAX_REGISTRY_ENABLED=true` en `.env`, con token real) — la nota de una actualización anterior de este registro que la daba por "no configurada" estaba desactualizada.

El endpoint `GET /api/auth/validate-company` consultaba ese proveedor pero descartaba el domicilio fiscal de la respuesta — se extendió (`auth_routes.cpp`) para exponerlo (`registry_domicilio_fiscal`, `registry_condicion`), y se intentó (sin éxito, el proveedor no expone esos campos por separado para estos RUC) enriquecerlo con distrito/provincia/departamento en `tax_registry_client.cpp`. Requirió dos rebuilds del backend.

Proceso seguido (mismo criterio que la auditoría de coordenadas — nunca inventar):
1. 4 agentes de investigación (paralelo) buscaron el RUC real de cada empresa vía fuentes públicas (sitio oficial, SMV, OSCE/ANA, MINEM, directorios que reflejan SUNAT).
2. **Cada candidato se verificó EN VIVO** contra la integración real (`/api/auth/validate-company?ruc=<candidato>`), comparando la razón social devuelta contra la esperada — no se confió ciegamente en la investigación web.
3. Resultado: 42 de 43 candidatos coincidieron exactamente. **Uno falló la verificación**: el RUC candidato de "Alpayana" (20100108292, indexado en directorios bajo su nombre histórico "Cía. Minera Casapalca S.A.") resolvió en SUNAT real a **"SOBREANDES S.A.C."**, una empresa sin relación — se descartó por completo, Alpayana queda con su RUC sintético hasta encontrar una fuente confiable.
4. Se aplicó RUC real + domicilio fiscal real (`db_scripts/99`) a 48 de 52 empresas. `domicilio_fiscal` ahora es la dirección legal registrada en SUNAT (casi siempre una oficina en Lima) — un concepto DISTINTO de `latitude`/`longitude` (ubicación física de la mina), que quedan correctamente separados por primera vez.

### Casos sin resolver / fuera de alcance

- **Alpayana**: sin RUC real verificado (ver arriba). Pendiente.
- **Beemetry, TimeTelemetry**: a pedido explícito posterior, sí se investigaron y verificaron igual que el resto (`db_scripts/100`) — Beemetry S.A.C. (RUC 20610559345, Chorrillos, Lima) y Time Telemetry S.A.C. (RUC 20601669316, Miraflores, Lima), ambas confirmadas en vivo contra SUNAT (razón social exacta, ACTIVO/HABIDO).
- **Restricción `ux_auth_companies_ruc` (UNIQUE)**: 6 pares de empresas duplicadas en el catálogo representan el mismo yacimiento/empresa real bajo dos tenants demo distintos (Antamina, Poderosa, Raura, El Brocal, Ares, Corona/Yauricocha). Un RUC real solo puede asignarse a UNA fila por restricción de unicidad — se aplicó al nombre que más se acerca a la razón social real encontrada; la fila hermana recibió el domicilio_fiscal real pero conserva su RUC sintético anterior (documentado en cada UPDATE de `db_scripts/99`).
- **Hochschild Mining Peru / Ares**, **Minera IRL**, **Bear Creek Mining**: cada una tenía más de un RUC real candidato (holding vs. subsidiaria operadora). Se eligió la entidad más coherente con el nombre/contexto ya registrado en el sistema — ver comentarios en `db_scripts/99` para el razonamiento de cada caso.

## Referencias

- `frontend/src/components/Special/CompanyLocationPicker.tsx` (fix del icono)
- `frontend/src/components/Special/GeocatminWorkbench.tsx` (patrón `divIcon` ya existente, replicado aquí)
- `db_scripts/97_company_mine_coordinates_audit.sql`
- ADR-121 — decisión original que creó `latitude`/`longitude`/`location_zoom` y descartó la geocodificación por IA
