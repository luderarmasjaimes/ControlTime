# ADR-211 — Saneamiento del ledger de migraciones: versión 81 duplicada, versiones sin registrar y aislamiento de seeds de desarrollo

**Status**: accepted (2026-09-23); implementación **pendiente** (tarea A2 de ADR-212, sprint S9). Sin cambios de código ni de BD aplicados por este ADR.

**Fecha**: 2026-09-23

**Autores**: Luder Armas (responsable de la decisión) con Claude Code (análisis)

**Ámbito**: datos / operación

**Relación**: extiende ADR-131 (runner versionado `scripts/apply_migrations.sh` + tabla `schema_migrations`); origen en los hallazgos H1 y H2 de ADR-210; interactúa con ADR-111 (portabilidad) y SPEC-023 T9 (restore en host limpio).

## Contexto

ADR-131 introdujo un runner que recorre `db_scripts/*.sql` por prefijo numérico, calcula SHA-256 y aborta si un script ya registrado cambió. La auditoría del 2026-09-23 (ADR-210) encontró, con lecturas sobre `sensors_db` y el directorio:

| Hecho | Evidencia |
|---|---|
| Dos scripts con prefijo **81**: `81_mfa_totp.sql` (registrado) y `81_seed_alpayana_massive_sensor_expansion.sql` (sin registrar) | listado de `db_scripts/`; `schema_migrations.version` es `INTEGER PRIMARY KEY` |
| El runner **aborta con `exit 1`** al llegar al segundo 81 (versión registrada con otro checksum) | lectura de `apply_migrations.sh`, rama `applied_checksum != checksum` |
| Sin registrar en el ledger: **82-92, 95-99, 115, 116** (96 versiones registradas, máxima 114, 116 archivos) | `SELECT` sobre `schema_migrations` |
| 82-92 y 95-96 existen físicamente (`telemetry_fact_calc`, `report_pdf_share_links`, `avatar_animation_job`, `fotocheck_share_links`, `sensor_input_channel_def`, 28 plantillas de fórmula) | consultas a `information_schema`/tablas |
| **115 y 116 no están aplicados** aunque el backend ya usa su columna/permiso | ADR-210 H1 |
| Los scripts 80-85 son seeds de demostración/TRUNCATE+reseed (datos Alpayana) mezclados con migraciones de esquema | cabeceras de los scripts, ADR-131 (nota de "TRUNCATE+reseed") |

Consecuencia: un despliegue nuevo con `docker compose --profile migrate run db-migrate` (ADR-131) falla en 81, y un intento de "arreglarlo" reejecutando en modo normal correría seeds destructivos sobre una BD con datos reales.

## Decisión

1. **No se renumera ni se edita ningún script ya aplicado** (regla de ADR-131 vigente). Nada de esto toca lo que corre en producción.
2. **Aplicar 115 y 116** en cada entorno donde falten (son aditivos e idempotentes) y registrarlos con checksum en `schema_migrations`.
3. **Baseline explícito en modo `--record-only`** para 82-92 y 95-99 en los entornos donde el estado físico ya fue verificado (consulta por objeto, como en ADR-210). Nunca ejecutar esos scripts en modo normal sobre una BD con datos.
4. **Separar seeds de desarrollo de migraciones**: mover los seeds de demostración (`80_seed_*`, `81_seed_*`, `82_seed_*`, `83_seed_*`, `84_fix_*`, `85_alpayana_*`, y los seeds 51/55/56/57 si el inventario los confirma como solo-demo) a `db_scripts/seeds_dev/`, con `README` que indica "solo desarrollo, destructivos, fuera del runner". `81_mfa_totp.sql` conserva su lugar y su versión 81. Los seeds movidos se documentan como `dev-only`; el ledger conserva su registro histórico (el runner solo itera archivos existentes).
5. **Endurecer el runner**: (a) rechazar al inicio, con mensaje claro, cualquier prefijo numérico duplicado en el directorio antes de tocar la BD; (b) opción `--baseline-through N` que registre sin ejecutar hasta N; (c) salida final con conteo de "pendientes reales".
6. **Guardia de CI**: agregar a `adr-spec-validation.yml` (o `ci.yml`) una verificación que falle si `db_scripts/` tiene prefijos duplicados o si un script nuevo omite el número siguiente disponible.

## Consecuencias

### Positivas
- El despliegue desde cero y el restore en host limpio (SPEC-023 T9) dejan de depender de conocimiento tácito sobre qué scripts no ejecutar.
- Se elimina el riesgo de que un seed destructivo corra por accidente en producción.
- El ledger vuelve a ser fuente de verdad verificable y auditable.

### Negativas / trade-offs
- Mover seeds cambia rutas referenciadas en documentos históricos (`docs/`, ADR antiguos); se mitiga con una nota en el `README` de `seeds_dev/` y sin editar ADR viejos.
- El baseline `--record-only` confía en que el objeto físico existe; por eso se exige verificación por objeto antes de registrar.
- Añade trabajo (≈ 0,5 día) en S9, previo a cualquier ensayo de restore o de despliegue.

## Alternativas descartadas
- **Renumerar el segundo 81 a un número libre** (p. ej. 117): haría que el runner lo trate como migración nueva y ejecute un seed destructivo en cualquier BD existente.
- **Cambiar la clave del ledger a `filename`**: correcta a largo plazo pero exige migrar una tabla en producción y reescribir el runner; no aporta frente a separar los seeds.
- **Borrar los seeds**: pierden reproducibilidad de los datos de demostración usados en QA y en presentaciones.

## Verificación (criterios de cierre)
- `apply_migrations.sh` termina con código 0 sobre una copia de la BD y sobre un volumen vacío (host limpio).
- `SELECT max(version), count(*) FROM schema_migrations` coincide con el número de scripts de esquema en `db_scripts/`.
- La guardia de CI falla en una rama de prueba con un prefijo duplicado.

## Referencias
- ADR-131, ADR-111, ADR-210, ADR-212; `scripts/apply_migrations.sh`; `db_scripts/79_schema_migrations_bootstrap.sql`.
