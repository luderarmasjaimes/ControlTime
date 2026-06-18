# 08 · Tareas / ClickUp

Fuente operativa de importación de tareas a **ClickUp**. Versión vigente: **v19** (junio 2026), sincronizada con el plan v36 (13 sprints S1–S13).

## Contenido vigente

| Documento | Para qué sirve |
|---|---|
| `Plataforma_Minera_ClickUp_v19.xlsx` | Workbook maestro de importación a ClickUp (hoja `Import_ClickUp`, 482 tareas con campo Sprint) |
| `Plataforma_Minera_ClickUp_v19_Import.csv` | CSV de importación directa |

## Notas
- Regenerar con: `python scripts/generate_clickup_import.py`.
- Detalle de importación y mapeo de columnas: hoja `11_Importar_ClickUp` de `01_Planificacion/Plan_Proyecto_Gerencia_Etapas_Sprints_v36.xlsx`.
- Los desgloses `SYS_Etapa1_*` (may-22) quedaron superados por v19 → `_temporal_depuracion/`.
