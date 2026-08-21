# ADR-109 — Catálogo por zonas y analítica multiserie de sensores

> **Actualización 2026-08-20 (auditoría de trazabilidad ADR-103/106/112-120,
> ver `README.md`)**: dos correcciones de exactitud, no de decisión — el
> texto original de este ADR no se edita, ver abajo.
> 1. La sección "Evidencia de código" citaba `backend/src/reports/sensor_telemetry_wizard.*`.
>    Esa ruta no existe en el árbol real: el archivo vive en
>    **`backend/src/mining/sensor_telemetry_wizard.*`** (verificado por
>    lectura directa). El módulo `reports` de este repo no tiene carpeta
>    `backend/src/reports/`.
> 2. **Resuelto el mismo día (2026-08-20, segunda pasada)**: el rango
>    `db_scripts/54_sensor_zones_and_grouping.sql` a
>    `57_seed_rich_sensor_telemetry_test_data.sql` citado abajo era ambiguo
>    porque existían **dos** archivos numerados `54` (este script y
>    `54_deepface_silentface_provider_comment.sql`, sin relación con
>    zonas/catálogo) y **dos** numerados `56`
>    (`56_seed_realistic_sensor_catalog_all_tenants.sql`, de este ADR, y
>    `56_telemetry_25k_hardening.sql`, conceptualmente de ADR-108). Se
>    resolvió renumerando los dos archivos ajenos a este ADR — mismo criterio
>    que ADR-089 usó para su propia colisión —: `54_deepface_silentface_provider_comment.sql`
>    → **`66_deepface_silentface_provider_comment.sql`** y
>    `56_telemetry_25k_hardening.sql` → **`67_telemetry_25k_hardening.sql`**
>    (con su línea de montaje en `docker-compose.yml` actualizada). Los dos
>    archivos de este ADR (`54_sensor_zones_and_grouping.sql`,
>    `56_seed_realistic_sensor_catalog_all_tenants.sql`) **conservan su
>    número original** — el rango citado en "Evidencia de código" abajo ya
>    es exacto y sin ambigüedad.

**Status**: implemented en código; verificación integrada pendiente

**Fecha**: 2026-08-18

**Ámbito**: reports, realtime, datos

**Relación**: SPEC-002, SPEC-007, SPEC-009, SPEC-021; complementa ADR-057.

## Contexto

ReportStudio permitía gráficos y el producto ya incluía dashboard, mapa,
heatmap y visor 3D, pero no existía una decisión para seleccionar varios
sensores por zona/dispositivo, consultar sus series con una política temporal
uniforme e insertar comparaciones avanzadas en un informe. El código nuevo
incluye catálogo jerárquico, zonas por tenant y un widget multigráfico.

## Decisión

1. `sensor_zones` es un catálogo multitenant. Cada sensor puede asociarse a
   una zona y se mantiene un grupo `SIN-ZONA` para datos incompletos.
2. El catálogo se presenta por tipo, zona y dispositivo físico. La identidad
   preferente del dispositivo es `serial_number`, luego `external_id` y
   finalmente `sensor_code`; no se fusionan equipos entre tenants.
3. `/wizard/query` acepta sensores, rango ISO y agregación `raw`, `hourly` o
   `daily`; limita el rango a 90 días y degrada automáticamente `raw` a
   `hourly` al superar 7 días. Las consultas históricas usan la réplica y
   validan pertenencia del sensor al tenant para prevenir IDOR.
4. ReportStudio soporta línea, barras, área, dispersión, escalonado, radar,
   torta, donut, heatmap y boxplot. La vista 3D existente es un módulo
   especializado independiente: no se declara todavía exportación 3D dentro
   del documento.
5. Seeds realistas sirven para desarrollo/demostración y deben estar
   identificados como sintéticos; no constituyen telemetría productiva.
6. El estado «implementado» no equivale a aceptación final hasta completar
   build backend, contrato API, prueba anti-IDOR, render de cada tipo y
   exportación PDF/PPTX con datos reales.

## Consecuencias

- La selección y visualización queda trazable y reusable en reportabilidad.
- Los límites de rango evitan consultas crudas costosas.
- Radar de taludes (tipo de sensor) y gráfico radar (visualización) son
  conceptos diferentes y deben etiquetarse así en UI y documentación.

## Evidencia de código

- `backend/src/reports/sensor_telemetry_wizard.*`
- `frontend/src/components/ReportStudioV2/components/layout/ZoneSensorPicker.tsx`
- `frontend/src/components/ReportStudioV2/components/document/SensorMultiChartWidget.tsx`
- `db_scripts/54_sensor_zones_and_grouping.sql` a `57_seed_rich_sensor_telemetry_test_data.sql`

## Alternativas descartadas

- Consultar telemetría productiva desde el navegador: rompe RBAC y aislamiento.
- Permitir rangos crudos ilimitados: riesgo de degradación de TimescaleDB.
- Tratar cada magnitud de un equipo como dispositivo independiente: pierde la
  semántica física necesaria para mantenimiento y análisis.
