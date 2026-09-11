# BACKLOG DE SPECS · Plataforma Minera Beemetry

> Corte auditado: **2026-08-18**. Catálogo canónico: 23 SPEC; para métricas se
> excluyen los dos directorios alias de SPEC-004 y SPEC-005.

| ID | Capacidad | Gate | Ejecución normalizada | Estado verificable |
|---|---|---|---:|---|
| 001 | Ingesta durable | R2 | 4/4 · 100% | Implementada |
| 002 | Dashboard realtime | R3 | 10/10 · 100% | Implementada |
| 003 | Tier frío | R5 | 6/12 · 50% | Parcial |
| 004 | Réplica/HA | R5 | 7/12 · 58% | Parcial |
| 005 | Push realtime | R3 | 5/9 · 56% | Parcial |
| 006 | Auth/RBAC/multitenant | R2 | 6/7 · 86% | Código y pruebas; cierre operativo pendiente |
| 007 | ReportStudio/export | R3-R4 | 3/5 · 60% | Código amplio; regresión/aceptación pendiente |
| 008 | Biometría | R3-R5 | 4/5 · 80% | Código; calibración/certificación pendiente |
| 009 | GIS/mapas | R3 | 3/5 · 60% | Parcial |
| 010 | Fórmulas | R3 | 7/7 · 100% | Implementada |
| 011 | IA texto | R3-R5 | 3/6 · 50% | Parcial |
| 012 | GDAL | R4 | 3/4 · 75% | Implementada; aceptación final pendiente |
| 013 | CCTV | R4 | 5/8 · 63% | Parcial |
| 014 | Offline/reconciliación | R4 | 0/10 · 0% | No implementada integralmente |
| 015 | DR/continuidad | R5 | 0/11 · 0% | No aceptada |
| 016 | Alertas | R4 | 0/5 · 0% | Backlog |
| 017 | Visión EPP | R5 | 0/5 · 0% | Deferred por ADR-025 |
| 018 | Dictado STT | R5 | 0/7 · 0% | Parcial en código, sin tareas aceptadas |
| 019 | RP/Odoo | R4 | 19/20 · 95% | Falta escritura productiva autorizada |
| 020 | Telemetría 25k/s | R3 | 9/9 · 100% | Aceptada a 25k; no a 100k |
| 021 | Zonas/multiserie | R3-R4 | 6/10 · 60% | Código; pruebas/export pendientes |
| 022 | Operaciones de campo | Rebaseline | 0/14 · 0% | **Aprobado como proyecto derivado (2026-09-11)** — propio PO/presupuesto, fuera de v36.1, etapas posteriores; arquitectura: reutilizar backend Beemetry vía servicios web |
| 023 | Portabilidad/restore/CI-CD | R5-R6 | 6/11 · 55% | Utilidad; restore y despliegue no aceptados |
| 025 | Soporte/WhatsApp | Sin sprint asignado | Sin tasks.md · N/A | **Aprobado al alcance contractual (2026-09-11, ADR-168)** — 9 ADR ya implementados (112-118, 122, 129); canal SMS pendiente de cuenta Twilio comercial |

## Métrica consolidada

- **Tareas normalizadas:** 106 completadas de 196 = **54,1%**.
- La cifra mide ejecución documentada, no aceptación productiva ni horas.
- SPEC-019 y SPEC-020 usan tablas; sus estados se normalizaron en el conteo.
- Una tarea solo se considera completa cuando `tasks.md` aporta estado/evidencia.

## Prioridad de cierre

1. R4: offline integral (014), alertas (016), regresión/export de 007/013/021.
2. Integraciones: ventana autorizada CA-4 de SPEC-019 y contrato AWS real.
3. R5: DR/failover/restore (003/004/015), pentest y hardening.
4. Campo: aprobar ADR-110, reprogramar SPEC-022 y no mezclarlo con el R6 actual.
5. IA crítica: calibración biométrica; EPP continúa deferred hasta decisión.

## Nota sobre avance

No se usa «número de ADR escritos» como avance. Los ADR miden cobertura y
coherencia de decisiones; el porcentaje se obtiene de tareas y se acompaña de
readiness por evidencia en el informe de estado del 2026-08-18.
