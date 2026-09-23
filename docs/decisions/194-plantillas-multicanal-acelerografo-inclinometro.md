# ADR-194 — Plantillas de fórmula para acelerógrafos triaxiales e inclinómetros/prismas (incremental vs. acumulado)

**Status**: partially implemented (2026-09-17) — Parte A implementada, Parte B sigue `proposed`/bloqueada. Ver "Actualización 2026-09-17" al final

**Fecha**: 2026-09-17

**Autores**: Luder Armas (decisión de arquitectura pendiente), con Claude Code

**Ámbito**: mining / IoT (motor de fórmulas)

**Relación**: extiende [ADR-187](187-administracion-sensores-motor-formulas-tiempo-real.md)
(motor `tinyexpr`) y [ADR-189](189-catalogo-plantillas-formula-calibracion-geotecnica.md)
(catálogo de 27 plantillas). **No solapa** con SPEC-027/ADR-192: ese trabajo
verificó exhaustivamente (`tasks.md` Fase 3, T13-T16) las 27 plantillas
existentes contra `PiezometerRC-V2` — **piezómetros exclusivamente**. Los
bundles de widgets `Beemetry Acelerografos`, `Beemetry Inclinometros` y
`Prismas` (documentados en
[REFERENCIA_REPLICACION_THINGSBOARD_FORMULAS_WIDGETS_2026-09-17.md](../development/REFERENCIA_REPLICACION_THINGSBOARD_FORMULAS_WIDGETS_2026-09-17.md))
corresponden a **rule chains de ThingsBoard distintas** (`AccelerographRC`,
`TiltmeterInPlaceRC`, `PrismRC`, `CasagrandeRC`, `ExtensometerRC`) que ni
ADR-189 ni SPEC-027 analizaron — son una familia de instrumentos separada,
sin plantilla ni verificación todavía.

## Contexto

El recorrido de la UI real de `board.beemetry.com` (misma referencia de
arriba, secciones 6bis) confirmó dos patrones de dominio recurrentes que hoy
la plomería genérica de canales nombrados (`sensor_input_channel_def`,
ADR-189) no resuelve con una plantilla lista:

1. **Acelerógrafos triaxiales**: dos marcas en uso real (Kinemetrics,
   Guralp), cada una con 3 canales (X/Y/Z o N-S/E-O/Z), y series derivadas
   `SeismicACC → SeismicVEL → SeismicDIS` (aceleración → velocidad →
   desplazamiento) mediante un flujo de **corrección de línea base +
   integración numérica**, no una fórmula algebraica simple.
2. **Inclinómetros/prismas/tiltmeters**: patrón `Incremental` vs.
   `Acumulado` por eje — el valor acumulado es una **suma corrida en el
   tiempo** respecto a una lectura base, no una función pura de la lectura
   actual + constantes (que es todo lo que las 27 plantillas de ADR-189
   necesitan, y por eso `tinyexpr` les alcanza).

**Limitación real del motor actual** (confirmada leyendo
`sensor_formula_evaluator.cpp`): evalúa una expresión `tinyexpr` (puramente
aritmética, sin estado) contra la **última lectura** de cada canal declarado,
en una ventana de 15 minutos. No existe ningún mecanismo para que una fórmula
lea "el valor calculado anterior de esta misma serie" ni para integrar una
señal en el tiempo. Esto significa que **el patrón 2 (incremental→acumulado)
y la integración del patrón 1 (ACC→VEL→DIS) no son solo "una plantilla más"
— requieren una capacidad que el motor no tiene hoy.**

## Decisión (propuesta — requiere confirmación antes de codear)

Separar el trabajo en dos partes de complejidad muy distinta:

### Parte A — Combinación triaxial pura (sin estado, YA construible con el motor actual)
Agregar plantillas de **magnitud vectorial** que combinan los 3 canales
CRUDOS actuales sin necesitar historial, ej.:
```
PGA = sqrt(X^2 + Y^2 + Z^2)   -- aceleración pico resultante, un instante
```
Esto es una función pura de 3 valores actuales — cabe perfecto en el modelo
existente de `sensor_input_channel_def` + `tinyexpr`, mismo mecanismo que las
27 plantillas de ADR-189. **Sin cambios de arquitectura, solo catálogo
nuevo** (mismo patrón que `95_sensor_formula_template_catalog.sql`).

### Parte B — Estado temporal (acumulado, integración ACC→VEL→DIS): requiere extender el motor, o resolverlo fuera de él
Dos caminos posibles, **sin decidir cuál aún**:
- **(b1) Acumulado por suma corrida**: es expresable en **SQL puro** con una
  función ventana (`SUM(...) OVER (PARTITION BY sensor_id, channel_id ORDER
  BY captured_at)`) sobre `telemetry_fact`/`telemetry_multivariate` — no
  requiere tocar `tinyexpr` en absoluto. Candidato más simple y de menor
  riesgo: una vista materializada o un job periódico, no una "fórmula".
- **(b2) Integración ACC→VEL→DIS con corrección de línea base**: es
  procesamiento de señal real (la corrección de línea base del legado —
  botón "Trae valores → Corrección Línea Base → Original" en
  `Beemetry Acelerografos` — es un paso manual disparado por el usuario, NO
  un cálculo automático continuo). Se propone **dejar esto explícitamente
  fuera del motor de fórmulas** (que es para calibración instantánea, no
  para DSP) y, si se necesita, tratarlo como un módulo de procesamiento
  sísmico aparte (job bajo demanda, replicando el patrón manual del legado)
  — no inventar aquí una solución de integración numérica sin que el
  developer confirme que hace falta reproducirla (los acelerógrafos podrían
  no ser prioritarios si el cliente ya no usa esa instrumentación
  activamente; no se pudo confirmar en esta sesión).

## Consecuencias

- **Positivas**: la Parte A entrega valor real de inmediato (fórmulas de
  magnitud triaxial) sin ningún riesgo arquitectónico, siguiendo exactamente
  el patrón ya probado de ADR-189.
- **Riesgo de NO decidir la Parte B explícitamente**: si se intenta forzar el
  patrón incremental→acumulado dentro de `tinyexpr` sin la extensión de
  estado, el resultado sería incorrecto de forma silenciosa (cada evaluación
  vería solo la lectura actual, nunca la suma acumulada real) — mejor
  declararlo pendiente que implementarlo mal.
- Impacto en esfuerzo: Parte A es pequeña (plantillas nuevas, incluso codear
  ahora). Parte B(b1) es mediana (vista/job SQL nuevo, sin tocar C++ de
  fórmulas). Parte B(b2) es alta y **no se debe estimar sin que el developer
  confirme que hay acelerógrafos reales en uso** que lo requieran.

## Alternativas descartadas

- **Extender `tinyexpr` para soportar una variable `prev_value`**: descartado
  por ahora — mezclaría estado mutable dentro de un motor diseñado
  deliberadamente sin estado (ADR-187), y el problema de acumulado (b1) ya
  tiene una solución más simple y nativa de TimescaleDB (función ventana)
  sin tocar el motor en absoluto.
- **Reproducir la integración ACC→VEL→DIS automáticamente sin confirmar
  necesidad real**: descartado — sería construir procesamiento de señal
  complejo de forma especulativa; el propio legado lo trata como acción
  manual bajo demanda, no como pipeline automático.

## Referencias

- `docs/development/REFERENCIA_REPLICACION_THINGSBOARD_FORMULAS_WIDGETS_2026-09-17.md` (secciones 6, 6bis)
- `docs/development/PLAN_IMPLEMENTACION_TELEMETRIA_SENSORES_GATEWAYS_2026-09-17.md` (Fase 5)
- `backend/src/mining/sensor_formula_evaluator.cpp`
- `docs/decisions/187-administracion-sensores-motor-formulas-tiempo-real.md`
- `docs/decisions/189-catalogo-plantillas-formula-calibracion-geotecnica.md`
- `docs/decisions/192-auditoria-integracion-sensores-directo-gateway-cierre-spec027.md`

## Actualización 2026-09-17 — Parte A implementada, Parte B queda deliberadamente sin codear

**Parte A (magnitud triaxial pura) — implementada**:
- `db_scripts/105_formula_template_triaxial_pga.sql` — plantilla
  `triaxial_pga` (`PGA = sqrt(accel_x²+accel_y²+accel_z²)`), 3 canales de
  entrada, sin parámetros de calibración (es una combinación pura de
  lecturas crudas). Aplicada y verificada en `sensors_db` local.
- Requirió extender el `CHECK` de `output_unit` en
  `sensor_formula_template_def` (antes solo `KPA/MPA/PSI`, dominio de
  presión de ADR-189) para aceptar `'G'` (gravedad, convención estándar de
  PGA en sismología) — una familia física nueva, no un ajuste de las 27
  plantillas existentes.
- **Sin cambios de C++**: verificado que `sensor_formula_template_routes.cpp`
  es genérico (lee `template_code` por parámetro, sin lista hardcodeada) —
  la plantilla nueva funciona a través de la API de aplicar-plantilla-a-sensor
  existente sin tocar código.
- **Advertencia de verificación explícita, igual rigor que SPEC-027**: a
  diferencia de las 27 plantillas de piezómetro (verificadas fila por fila
  contra el JS legado real), esta plantilla **no tiene sensor acelerógrafo
  real ni rule chain legado transcrito para validar** (ADR-192 confirma 0
  sensores de este tipo en `sensors_db` hoy). La unidad `G` es una
  convención razonable, no una confirmación. Ver comentario completo en el
  propio script de migración.

**Parte B (acumulado con estado, integración ACC→VEL→DIS) — sigue sin
codear, a propósito**: esta parte requería una decisión de arquitectura
(SQL con función ventana vs. extender el motor) y, para la integración
sísmica en particular, confirmación de que hay acelerógrafos reales en uso
antes de invertir en procesamiento de señal — ninguna de las dos condiciones
se resolvió en esta pasada de implementación. Implementarla ahora habría
significado exactamente lo que este ADR advertía evitar: forzar una solución
sin la decisión ni la confirmación de necesidad real. Queda pendiente,
bloqueada por developer, no por trabajo de ingeniería restante.
