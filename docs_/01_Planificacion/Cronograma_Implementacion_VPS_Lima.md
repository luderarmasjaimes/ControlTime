# Cronograma de Implementación — Infraestructura VPS Lima

## Proyecto AURIXA · Arquitectura Soberana sobre VPS Linux (Lima)

**Versión:** sincronizada con el SOW Maestro v3.0 y el Plan v36
**Calendario:** 1 de junio – 30 de noviembre de 2026
**Responsable principal:** SYS (Infraestructura) · Apoyo: ARQ, BE3 (DBA/Recovery), BE2 (Seguridad)
**Excel asociado:** `Cronograma_Implementacion_VPS_Lima.xlsx`

> Define cómo y cuándo se levanta la infraestructura: desde el desarrollo local en laptops hasta la producción soberana en Lima, con seguridad, recuperación ante desastres y Go-Live gobernados por sprint.

---

## 1. Principio de arquitectura

- La nueva plataforma **no se implementa en AWS**: corre sobre VPS Linux en Lima.
- La plataforma actual en AWS se mantiene como **fuente externa de datos**, integrada de forma controlada.
- Estrategia de ambientes progresiva: desarrollo local → VPS desarrollo → staging → producción soberana.
- **Arquitectura de datos v36.1:** TimescaleDB primario (solo escritura) + réplica de lectura (dashboards/KPIs) + cola durable Redpanda (ingesta sin pérdida) + PgBouncer (pooling 10k clientes) + tier frío MinIO/S3 para datos > 1 año. Ciclo de vida hot → warm → cold gobernado por sprint.

---

## 2. Hallazgo clave de optimización (aprobado)

**SYS arranca en el mes 2 (julio), no en junio.** Durante el mes 1 el equipo trabaja con **laptops + `docker compose` local** (diseño, arquitectura, prototipos), sin necesidad de VPS. Esto evita carga ociosa de infraestructura y ahorra costo de servidor en el primer mes.

| Mes | Carga SYS | Ambiente activo |
|---|---|---|
| Junio | 0% (sin tareas) | Desarrollo local (laptops + docker compose) |
| Julio | ~92% | VPS de desarrollo |
| Agosto | ~94% | VPS desarrollo + staging |
| Septiembre | ~100% | Staging + preparación UAT |
| Octubre | ~100% | Infraestructura productiva + DR |
| Noviembre | ~100% | Producción Lima + monitoreo 24/7 |

---

## 3. Línea de tiempo de ambientes

| Ambiente | Inicio | Propósito |
|---|---|---|
| Desarrollo local | Junio (S1) | Laptops + docker compose; arquitectura y prototipos, sin VPS |
| VPS Desarrollo | Julio (S3–S4) | Primer servidor Linux para integración continua y telemetría |
| Staging | Agosto–Septiembre (S5–S8) | Ambiente espejo para QA, integración e2e y UAT preparatorio |
| Producción Lima | Octubre–Noviembre (S10–S13) | Clúster soberano endurecido; blue/green y Go-Live |

---

## 4. Tareas de infraestructura por sprint

| Sprint | Mes | Tareas SYS / Infra | Apoyo |
|---|---|---|---|
| S1–S2 | Junio | Definición de topología, sizing VPS, plan de red y seguridad base (diseño) | ARQ |
| S3 | Julio | Aprovisionar VPS desarrollo, Docker, secrets, healthchecks; **stack de datos: TimescaleDB + PgBouncer + Redpanda** | BE3 |
| S4 | Julio | Pipeline CI/CD base, registry de imágenes, despliegue automatizado a dev; **réplica de lectura (streaming replication) operativa** | ARQ, BE3 |
| S5 | Agosto | Prometheus + Grafana (incl. `/api/metrics` de ingesta), alertas operativas, tuning Nginx (cache/compresión) | — |
| S6 | Agosto | Ambiente staging, integración de telemetría a escala (chunks 6h + compresión columnar), backups iniciales | BE3 |
| S7 | Septiembre | Ambiente UAT en infra, simulacros de failover, optimización VPS | QA |
| S8 | Septiembre | Cierre de QA del core sobre staging; checklist de paso a Etapa 2 | QA, ARQ |
| S9 | Octubre | Red de datacenter, segmentación, WireGuard/Nginx, pentest OWASP (apoyo) | BE2 |
| S10 | Octubre | **Simulacro DR** (sistema + BD) con objetivo de restauración < 15 min, apoyado en réplica de lectura; **tier frío MinIO/S3 (archivado Parquet ZSTD > 1 año)** | BE3, ARQ |
| S11 | Octubre | Hardening Zero-Trust de infra, cache offline-sync edge, escalamiento | BE2 |
| S12 | Noviembre | **Load test 10k sensores**, blue/green deployment, DNS de producción | BE1, QA |
| S13 | Noviembre | Monitoreo 24/7 post Go-Live, runbooks de infra, handover de credenciales | ARQ |

---

## 5. Hitos de infraestructura

| Hito | Sprint | Fecha | Criterio |
|---|---|---|---|
| VPS desarrollo operativo | S3–S4 | Julio | Despliegue automatizado a dev funcionando (parte de Gate R2) |
| Stack de datos productivo (ingesta durable + pooling + réplica) | S3–S4 | Julio | Redpanda + PgBouncer + réplica de lectura en línea; `/api/metrics` reportando ingesta (parte de Gate R2) |
| Tier frío de datos operativo | S10 | Octubre | Archivado automático > 1 año a MinIO/S3 (Parquet ZSTD) + `drop_chunks`; datos consultables con DuckDB |
| Staging + monitoreo | S5–S6 | Agosto | Prometheus/Grafana + ambiente espejo (Gate R3) |
| DR demostrado | S10 | Octubre | Recuperación sistema + BD < 15 min (Gate parcial R5) |
| Infra productiva lista | S11 | 31 oct | Hardening + Zero-Trust + escalamiento (Gate R5) |
| Go-Live producción Lima | S13 | 30 nov | Blue/green + DNS + 24/7 + handover de llaves (Gate R6) |

---

## 6. Entrega de soberanía

Al cierre (S13), todas las **llaves maestras y credenciales** de los servidores en Lima se transfieren formalmente a la Gerencia de TI del cliente, con runbooks de recovery y documentación de operación, conforme a la sección de Propiedad Intelectual del SOW.
