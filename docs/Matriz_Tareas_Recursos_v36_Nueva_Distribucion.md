# Matriz de Tareas y Carga Laboral — Nueva Distribución v36
## Proyecto AURIXA · 6 meses · Meta: 90–100% en meses activos

**Fecha:** Mayo 2026  
**Fuente de verdad:** `scripts/generate_clickup_import.py` → `Plataforma_Minera_ClickUp_v19.xlsx`  
**Modelo de capacidad:** 8,5 h/día × días netos Perú 2026 (feriados excluidos). Tope **100%** mensual.

---

## Carga mensual por recurso (% meses activos)

> FE2, SYS, QA e IA no tienen carga en junio (mes 1) por diseño. El **promedio activos** es la métrica de validación PMO.

| Recurso | Rol | Jun | Jul | Ago | Sep | Oct | Nov | Prom. activos | Total h |
|---------|-----|-----|-----|-----|-----|-----|-----|---------------|---------|
| **BE1** | BACKEND 1 — DBA / Arq. Datos y Core | 97.9% | 100.0% | 97.1% | 95.9% | 92.4% | 93.7% | **96.2%** | 1021h |
| **BE2** | BACKEND 2 — Ciberseguridad Backend (JWT/ | 95.9% | 93.1% | 90.0% | 95.6% | 98.4% | 96.0% | **94.8%** | 1008h |
| **BE3** | BACKEND 3 — Integraciones | 92.8% | 100.0% | 96.0% | 100.0% | 97.9% | 90.0% | **96.1%** | 1021h |
| **FE1** | FRONTEND 1 — Interfaces (mes 1 al 6) | 90.0% | 98.5% | 99.4% | 100.0% | 98.8% | 98.7% | **97.6%** | 1037h |
| **FE2** | FRONTEND 2 — UX y Soporte (desde mes 2) | — | 90.9% | 90.0% | 90.0% | 90.0% | 92.8% | **90.7%** | 802h |
| **ARQ** | ARQ-Arquitecto TI / PMO | 97.1% | 96.2% | 98.4% | 94.8% | 99.2% | 95.1% | **96.8%** | 1028h |
| **SYS** | SYS-Infraestructura | — | 91.9% | 90.0% | 100.0% | 100.0% | 100.0% | **96.4%** | 853h |
| **QA** | QA-Calidad (desde mes 2) | — | 90.3% | 90.0% | 90.0% | 99.9% | 100.0% | **94.0%** | 832h |
| **IA** | IA-ML — Modelos e Inteligencia Artificia | — | 90.7% | 90.0% | 90.0% | 90.0% | 90.0% | **90.1%** | 797h |
| **PAF** | Soporte PMO — Analista Funcional y Docum | 96.9% | 90.0% | 94.1% | 93.0% | 91.9% | 90.0% | **92.6%** | 985h |

**Validación cronograma:** 406 tareas técnicas + 60 indicadores CAP. Estado: LISTO PARA IMPORTAR ClickUp (v19).

## Regeneración

```powershell
python scripts/generate_clickup_import.py
python scripts/generate_reportes_mensuales_y_convocatorias.py
python scripts/generate_documento_gerencia_recursos.py
```
