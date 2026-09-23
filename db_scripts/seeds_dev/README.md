# Seeds de desarrollo (fuera del runner)

**ADR-211.** Estos scripts son **destructivos o de demostración**. El runner
`scripts/apply_migrations.sh` **no** los ejecuta: solo recorre `db_scripts/*.sql`
en la raíz.

Usarlos únicamente en copias de QA/demo, nunca contra una BD con datos reales.

```bash
# Ejemplo (entorno local vacío o de QA):
psql -v ON_ERROR_STOP=1 -f db_scripts/seeds_dev/51_seed_companies_distribuidores_demo.sql
```

Inventario movido desde `db_scripts/` el 2026-09-23:

| Archivo | Motivo |
|---|---|
| `51_seed_companies_distribuidores_demo.sql` | Seed demo (ADR-088); TRUNCATE no, pero datos sintéticos + hash de demo |
| `55_seed_realistic_sensor_catalog.sql` | Catálogo sintético |
| `56_seed_realistic_sensor_catalog_all_tenants.sql` | Catálogo sintético multi-tenant |
| `57_seed_rich_sensor_telemetry_test_data.sql` | Telemetría de prueba |
| `80_seed_alpayana_*.sql` | Expansión demo Alpayana |
| `81_seed_alpayana_massive_sensor_expansion.sql` | **Era el segundo prefijo 81**; bloqueaba el runner |
| `82_seed_alpayana_multi_zone_diversification.sql` | Seed |
| `83_seed_alpayana_refresh_recent_telemetry.sql` | Refresh destructivo de ventana |
| `84_fix_alpayana_dense_window_contamination.sql` | Fix de seed |
| `85_alpayana_full_clean_regenerate.sql` | TRUNCATE+reseed |

`81_mfa_totp.sql` permanece en `db_scripts/` (esquema MFA, versión 81 canónica).
Los documentos históricos que citan la ruta antigua no se reescriben.
