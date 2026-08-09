# ADR-006 — TimescaleDB: hypertables + políticas de retención/compresión + continuous aggregates

**Hallazgo de riesgo real (auditoría 2026-07-13)**: verificado en vivo contra
`beemetry-db` (`timescaledb_information.jobs`), la política nativa de retención de
`telemetry_raw` tiene `drop_after = 90 días` — pero el job de archivado a Parquet/MinIO
de ADR-009 usa un umbral de **180 días** (`BEEMETRY_ARCHIVE_RETENTION_DAYS`). Los dos
valores se configuraron por separado, en sesiones distintas, sin conciliarlos: **toda
fila de `telemetry_raw` entre 90 y 180 días de antigüedad será borrada de forma nativa
por TimescaleDB antes de que el job de archivado de ADR-009 (que solo mira filas
>180 días) tenga oportunidad de moverla a Parquet** — pérdida de dato real y
silenciosa, no un riesgo teórico. Hoy no se ha materializado (la telemetría real en
producción tiene semanas de antigüedad, no meses), pero se materializará
automáticamente en cuanto los datos reales alcancen 90 días si no se corrige antes.
**Corrección recomendada** (no aplicada en esta auditoría — es un cambio de
configuración operativa, no de código, y amerita decidir cuál de los dos números es
el correcto antes de tocarlo): alinear `drop_after` de la política nativa de
`telemetry_raw` a un valor **igual o mayor** que `BEEMETRY_ARCHIVE_RETENTION_DAYS`
(180 días), o reducir el umbral de archivado por debajo de 90 días — cualquiera de
las dos cierra la ventana de pérdida; la primera opción es la coherente con la
intención original de este ADR ("post-retención → rollup a Parquet").

**Status**: implemented (completado 2026-07-07). Cerrado en dos pasos:
1. **`mining_sensor_history` migrada a hypertable + compresión** (`db_scripts/35_adr006_continuous_aggregates_sensor_history.sql`) — era la única tabla nombrada explícitamente en las reglas duras de este ADR que `32_mineria_lecturas_hypertable.sql` no había cubierto. Aplicado y verificado en vivo contra `aurixa-db`: `timescaledb_information.hypertables` confirma `mineria_lecturas`, `mining_sensor_history`, `telemetry_multivariate`, `telemetry_raw` como hypertables.
2. **Continuous aggregates hora/día** creados sobre `mining_sensor_history` y `telemetry_raw` (mismo script). Verificación de rendimiento real: refresco manual de `telemetry_raw_hourly` sobre **10.8M filas** de `telemetry_raw` tomó 2.6s y produjo 20,000 buckets; una consulta agregada contra el aggregate ya materializado corre en <0.5s. A escala actual la diferencia contra un scan crudo no es dramática (el dataset de prueba aún cabe cómodamente), pero la infraestructura escala correctamente para el histórico de 2-7 años que este ADR exige — el costo de agregación ya no crece con el volumen histórico total, solo con los datos nuevos desde el último refresco.
3. **Hallazgo adicional**: se descubrió `telemetry_kpi_1m`, un continuous aggregate de 1 minuto sobre `telemetry_raw` que **ya existía en la base de datos en vivo** pero no tenía ningún script en `db_scripts/` — drift de esquema no versionado. Documentado ahora en `db_scripts/36_telemetry_kpi_1m_documentacion_drift.sql` (idempotente, no cambia nada en la BD actual; asegura que un despliegue nuevo desde cero reproduzca el mismo objeto).

Nota de alcance: la regla dura "los KPIs de dashboard leen de continuous aggregates, no de la tabla cruda" queda como infraestructura lista pero sin consumidor todavía — ninguna query actual del backend hace agregación hora/día sobre telemetría (el gráfico en vivo de `sensor_service.cpp` lee ventana reciente sin agregar, correctamente). Cuando se agregue una vista de tendencia histórica, debe leer de estos aggregates.
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: datos

## Contexto

`sensors_db` debe sostener 10k sensores/seg y conservar histórico 2-7 años sin degradar consultas. El análisis del modelo de datos v36 detectó un gap concreto: hoy existen hypertables, pero `mineria_lecturas` y `mining_sensor_history` son **tablas planas** (no hypertables), y **no hay políticas de retención, compresión ni continuous aggregates**. Sin esto, el almacenamiento crece sin techo y los dashboards escanean datos crudos.

## Decisión

Estandarizamos `sensors_db` sobre **hypertables de TimescaleDB con políticas explícitas**, según el objetivo v36:

| Política | Valor |
|---|---|
| Plano HOT (retención) | 30–45 días; lecturas recientes 24–72 h |
| Compresión | chunks > 7 días (`telemetry_*`); `mineria_lecturas` > 30 días |
| Intervalo de chunk | 7 días |
| Post-retención | rollup → Parquet en MinIO (plano HISTÓRICO, 2–7 años; ver ADR-009) |
| Agregados | continuous aggregates hora/día para KPIs sub-segundo |

### Reglas duras
- Toda tabla de telemetría nueva se crea como hypertable, nunca como tabla plana.
- `mineria_lecturas` y `mining_sensor_history` se migran a hypertables (tarea de Sprint, BE3).
- Los KPIs de dashboard leen de continuous aggregates, no de la tabla cruda.

## Consecuencias

### Positivas
- −90% de almacenamiento estimado por compresión; consultas de dashboard sub-segundo.
- Histórico largo sin penalizar el hot path.

### Negativas / Trade-offs
- Migrar tablas planas a hypertables requiere ventana de mantenimiento y backfill — se planifica (S9-S11).
- Los continuous aggregates agregan complejidad de refresh — mitigado con políticas de refresh estándar.

### Neutras
- La implementación es tarea de sprint (no decisión abierta): el objetivo ya está definido en v36.

## Alternativas descartadas

### Dejar tablas planas + purgado manual
Simple a corto plazo, pero no escala a 2-7 años ni a 10k/seg; los dashboards se vuelven lentos. Es el estado-problema actual.

### Particionado nativo de PostgreSQL (sin Timescale)
Funciona, pero reimplementa a mano lo que Timescale da con políticas declarativas (compresión, retención, caggs). Innecesario teniendo la extensión.

## Referencias
- `Referencias/docs/02_Arquitectura/Modelo_Datos_AURIXA_v36.md` § 1-2, 5-6
- `Referencias/docs/02_Arquitectura/sql/30_timescale_policies.sql`
- ADR-005 (dos DBs), ADR-032 (instancias ingesta/lectura), ADR-009 (MinIO/Parquet), `plan.md` § 4 (Sprint de datos)
