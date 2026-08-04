# BACKLOG DE SPECS · Plataforma Minera AURIXA

> Catálogo maestro de especificaciones SDD, **grounded en el SOW v4** (KPIs O1-O7,
> SLAs, cronograma S1-S13 / R1-R6) y en los **endpoints reales del código**.
> Cada feature del producto = un spec. Se sincroniza con `docs/01_Planificacion/`
> (cronograma) y `docs/08_Tareas_ClickUp/`.

## Catálogo completo (18 specs)

| ID | Feature | KPI/SLA SOW | Sprint·Release | Estado código | Spec |
|---|---|---|---|---|---|
| **001** | Ingesta telemetría durable (Kafka) | O4, 0% pérdida | S3-S4·R2 | ✅ Implementado+probado | ✅ spec·plan·tasks |
| **002** | Dashboards tiempo real | O1 (<20ms) | S6·R3 | ✅ Implementado+probado | ✅ spec·plan·tasks |
| **003** | Tier frío histórico >1 año (S3) | O5 | E2 | ✅ Implementado+probado | ✅ spec·plan·tasks |
| **004** | Réplica lectura + alta disponibilidad | O5 (99.9%) | S10·R5 | ✅ Implementado+probado | ✅ spec·plan·tasks |
| **005** | Push tiempo real (SSE) | O1 | S6·R3 | ✅ Implementado+probado | ✅ spec·plan·tasks |
| **006** | Auth + RBAC + multitenant + auditoría | O7 (100%) | S3-S4·R2 | 🟢 En código | ✅ spec·plan·tasks |
| **007** | Editor informes ReportStudio + export | O2(<0.5s),O3(<5s) | S5,S7·R3-R4 | 🟢 En código | ✅ spec·plan·tasks |
| **008** | Biometría facial (login operación) | IA local | S6,S11·R3,R5 | 🟢 En código | ✅ spec·plan·tasks |
| **009** | GIS mapas + cumplimiento territorial | offline | S5-S6·R3 | 🟢 En código | ✅ spec·plan·tasks |
| **010** | Motor de fórmulas (cálculos sensores) | — | S5-S6·R3 | 🟢 En código | ✅ spec·plan·tasks |
| **011** | IA de texto local (corrección/redacción) | O6 (<1s) | S6,S11 | 🟢 En código | ✅ spec·plan·tasks |
| **012** | Conversión geoespacial (GDAL) | — | S5-S7 | 🟢 En código | ✅ spec·plan·tasks |
| **013** | Videovigilancia (muro CCTV) | seguridad | E2 | 🟢 En código | ✅ spec·plan·tasks |
| **014** | Modo offline + reconciliación | 0% pérdida | S8·R4 | ⚪ A construir | ✅ spec·plan·tasks |
| **015** | DR + respaldo geográfico + continuidad | O5, RTO<15min | S10·R5 | ⚪ A construir | ✅ spec·plan·tasks |
| **016** | Alertas y umbrales por sensor | O1, seguridad | E2 | ⚪ A construir | ✅ spec·plan·tasks |
| **017** | Visión IA: detección de EPP | IA, seguridad | S11·R5 | ⚪ A construir | ✅ spec·plan·tasks |
| **018** | Dictado por voz (STT) | O6, IA local | S6,S11 | ⚪ A construir | ✅ spec·plan·tasks |

**Leyenda estado código:** ✅ construido y probado · 🟢 existe en código (spec
refleja lo implementado) · ⚪ a construir (spec *forward-looking*, antes del código).

## Cobertura de KPIs del SOW
| KPI | Meta | Spec(s) que lo cumplen |
|---|---|---|
| O1 | Retraso < 20 ms | 002, 005, 007, 009 |
| O2 | Auto-guardado < 0.5 s | 007 |
| O3 | Export < 5 s | 007 |
| O4 | 10.000 sensores | 001, 002 |
| O5 | Uptime > 99.9% | 003, 004, 015 |
| O6 | IA < 1 s | 011, 018 |
| O7 | 100% auditado | 006 |
| SLA 0% pérdida | Zero Data Loss | 001, 014, 015 |

## Próximos pasos (orden recomendado)
1. ~~**Completar `plan.md` + `tasks.md`** de 002-005~~ — ✅ COMPLETADO (2026-06-24)
2. ~~**Completar `plan.md` + `tasks.md`** de 006-013 y 016-018~~ — ✅ COMPLETADO (2026-06-24)
3. **SIGUIENTE: Implementar spec 016** (alertas) — primer feature de Etapa 2 sin código.
4. **SIGUIENTE: Implementar spec 014** (offline) — crítico para gate R4.
5. Sincronizar este backlog con el cronograma y ClickUp en cada planning de sprint.

## Trazabilidad
Cada spec referencia su **Sprint·Release del SOW** y los **artículos de la
Constitución** que cumple → trazabilidad 100% requisito→spec→código→evidencia,
exigida por el modelo de gates (R1-R6) del SOW §10.
