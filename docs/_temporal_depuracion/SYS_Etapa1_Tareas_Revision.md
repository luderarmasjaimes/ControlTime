# Tareas SYS — Etapa 1 (Plataforma Reportabilidad)

**Fuente:** `Nueva_Plataforma_Minera_IA_ClickUp.xlsx` (hoja Import_ClickUp)
**Periodo etapa:** Jun–Nov 2026
**Total tareas con SYS:** 58 (18 solo SYS, 40 compartidas)
**Horas estimadas:** 1632 h (solo SYS: 452 h)

---

## DevOps_Infra (5 tareas, 152 h)

| ID | Tarea | Inicio | Fin | h | Asignacion | Prioridad |
|---|---|---|---|---:|---|---|
| DEV-001 | Organizar repositorios Git y reglas de trabajo del codigo | 2026-07-06 | 2026-07-17 | 16 | SYS | High |
| DEV-002 | Empaquetar todos los servicios en contenedores Docker | 2026-07-13 | 2026-07-31 | 40 | BACKEND 3, SYS | High |
| DEV-003 | Contratar e instalar VPS de DESARROLLO compartido para el equipo | 2026-07-27 | 2026-08-07 | 32 | SYS | High |
| DEV-004 | Instalar VPS de PRUEBAS / CERTIFICACION (staging) | 2026-08-03 | 2026-08-28 | 32 | SYS, QA | High |
| DEV-005 | Instalar VPS de PRODUCCION en datacenter Lima (usuarios reales) | 2026-09-21 | 2026-10-02 | 32 | ARQ-Arquitecto TI / PMO, SYS | Urgent |

## MES2_JULIO_Core_Seguridad (3 tareas, 112 h)

| ID | Tarea | Inicio | Fin | h | Asignacion | Prioridad |
|---|---|---|---|---:|---|---|
| IA-M03 | Preparar servidor de Inteligencia Artificial (GPU + MLflow) | 2026-07-27 | 2026-07-31 | 48 | BACKEND 3, SYS, IA-ML | High |
| SYS-I01 | Automatizar instalacion de servidores (Ansible) | 2026-07-27 | 2026-07-31 | 32 | BACKEND 3, SYS | High |
| SYS-I02 | Centralizar logs del sistema (Loki + Grafana) | 2026-07-27 | 2026-07-31 | 32 | BACKEND 3, SYS | High |

## MES3_AGOSTO_UX_Sensores (3 tareas, 88 h)

| ID | Tarea | Inicio | Fin | h | Asignacion | Prioridad |
|---|---|---|---|---:|---|---|
| SYS-I03 | Configurar dominios y DNS de la plataforma | 2026-08-03 | 2026-08-07 | 12 | SYS | Normal |
| SYS-I04 | Gestionar parches de seguridad del sistema operativo | 2026-08-03 | 2026-09-04 | 32 | SYS | High |
| SYS-I05 | Mantenimiento semanal de bases de datos | 2026-08-03 | 2026-09-04 | 44 | BACKEND 1, BACKEND 3, ARQ-Arquitecto TI / PMO, SYS | High |

## MES4_SEPTIEMBRE_Integracion_QA (4 tareas, 112 h)

| ID | Tarea | Inicio | Fin | h | Asignacion | Prioridad |
|---|---|---|---|---:|---|---|
| P1-M4-004 | Instalar cola de mensajes Redpanda/Kafka en datacenter | 2026-08-24 | 2026-09-04 | 24 | BACKEND 3, SYS | High |
| SYS-I06 | Probar que los backups se pueden restaurar | 2026-08-24 | 2026-10-02 | 32 | SYS | High |
| SYS-I07 | Documentar infraestructura y red (diagramas) | 2026-08-24 | 2026-09-18 | 24 | ARQ-Arquitecto TI / PMO, SYS | Normal |
| SYS-I08 | Igualar ambientes dev, staging y produccion | 2026-08-24 | 2026-10-02 | 32 | BACKEND 3, SYS | High |

## MES5_OCTUBRE_Optimizacion (31 tareas, 792 h)

| ID | Tarea | Inicio | Fin | h | Asignacion | Prioridad |
|---|---|---|---|---:|---|---|
| P2-M5-001 | Disenar red del datacenter Lima y enlace con minas | 2026-09-21 | 2026-10-02 | 40 | BACKEND 3, ARQ-Arquitecto TI / PMO, SYS | Urgent |
| P2-M5-002 | Configurar red privada y segmentos en datacenter Lima | 2026-09-28 | 2026-10-02 | 32 | SYS | Urgent |
| P2-M5-003 | Instalar servidores VPS Linux en datacenter Tier III Lima | 2026-09-28 | 2026-10-02 | 32 | SYS | Urgent |
| P2-M5-004 | Crear estructura de usuarios, permisos y politicas de acceso al servidor | 2026-09-28 | 2026-10-02 | 24 | BACKEND 2, SYS | High |
| P2-M5-005 | Instalar y configurar orquestador de contenedores (Docker Swarm / K3s) | 2026-09-28 | 2026-10-09 | 40 | BACKEND 3, SYS | Urgent |
| P2-M5-006 | Blindaje de seguridad de servidores: firewall, bloqueo de accesos no autorizados | 2026-09-28 | 2026-10-09 | 32 | BACKEND 2, SYS | Urgent |
| P2-M5-007 | Instalar certificados SSL dinámicos (Let's Encrypt / Wildcard) | 2026-09-28 | 2026-10-02 | 16 | SYS | High |
| P2-M5-009 | Configurar volumenes de disco dedicados para bases de datos y archivos | 2026-09-28 | 2026-10-09 | 16 | SYS | High |
| P2-M5-010 | Instalar base de datos PostgreSQL con replica y alta disponibilidad | 2026-09-28 | 2026-10-09 | 32 | BACKEND 1, ARQ-Arquitecto TI / PMO, SYS | Urgent |
| SYS-I09 | Optimizar red mina ↔ datacenter Lima | 2026-09-28 | 2026-10-02 | 24 | SYS | High |
| SYS-I10 | Configurar firewall y segmentacion de red | 2026-09-28 | 2026-10-09 | 32 | SYS | High |
| SYS-I11 | Acelerar carga web con Nginx (cache y compresion) | 2026-09-28 | 2026-10-09 | 16 | FRONTEND 1, SYS | Normal |
| SYS-I12 | Alertas de vencimiento de certificados SSL | 2026-09-28 | 2026-10-09 | 16 | SYS | Normal |
| VPS-001 | Instalar MinIO — almacenamiento de archivos (reportes, imagenes) | 2026-09-28 | 2026-10-02 | 24 | SYS | High |
| VPS-002 | Instalar QuestDB — base de datos de sensores en tiempo real | 2026-09-28 | 2026-10-02 | 32 | SYS | Urgent |
| VPS-003 | Configurar VPN WireGuard para acceso seguro desde mina | 2026-09-28 | 2026-10-09 | 24 | BACKEND 2, SYS | High |
| VPS-004 | Provisionar servidor VPS de respaldo (arquitectura Activo-Pasivo) | 2026-09-28 | 2026-10-09 | 32 | ARQ-Arquitecto TI / PMO, SYS | Urgent |
| VPS-005 | Plan de conectividad operador-agnostica para clientes mineros (Claro, Movistar, Bitel, Entel) | 2026-09-28 | 2026-10-02 | 24 | ARQ-Arquitecto TI / PMO, SYS | High |
| P2-M5-008 | Automatizar proceso de compilacion, pruebas y despliegue del sistema | 2026-10-05 | 2026-10-09 | 32 | BACKEND 1, ARQ-Arquitecto TI / PMO, SYS | High |
| P2-M5-011 | Configurar copias de seguridad continuas de la base de datos | 2026-10-05 | 2026-10-16 | 24 | BACKEND 1, ARQ-Arquitecto TI / PMO, SYS | High |
| P2-M5-013 | Plan de recuperacion ante desastres (DRP): que hacer si todo falla | 2026-10-05 | 2026-10-16 | 32 | ARQ-Arquitecto TI / PMO, SYS | Urgent |
| P2-M5-014 | Crear procesos automaticos de limpieza y mantenimiento de la base de datos | 2026-10-05 | 2026-10-16 | 16 | BACKEND 1, ARQ-Arquitecto TI / PMO, SYS | Normal |
| P2-M5-015 | Instalar sistema de monitoreo de servidores y servicios (Prometheus + Grafana) | 2026-10-05 | 2026-10-16 | 32 | SYS | High |
| VPS-006 | Instalar WAF (Web Application Firewall) para proteger la plataforma web | 2026-10-05 | 2026-10-09 | 24 | BACKEND 2, SYS | High |
| VPS-007 | Instalar Redis en Docker: cache de datos y sesiones de usuarios | 2026-10-05 | 2026-10-16 | 16 | SYS | High |
| VPS-008 | Configurar replicacion automatica de datos al servidor de respaldo | 2026-10-05 | 2026-10-16 | 32 | BACKEND 3, SYS | Urgent |
| VPS-009 | Documentar arquitectura completa VPS datacenter Lima (diagrama tecnico y gerencial) | 2026-10-05 | 2026-10-16 | 24 | ARQ-Arquitecto TI / PMO, SYS | High |
| P2-M5-012 | Documentar procedimiento de recuperacion de base de datos ante fallos | 2026-10-12 | 2026-10-16 | 16 | SYS | High |
| P2-M5-016 | Simulacro de falla: verificar que el sistema se recupera automaticamente | 2026-10-12 | 2026-10-16 | 24 | SYS, QA | High |
| P2-M5-019 | Milestone: Infraestructura Productiva Lista | 2026-10-12 | 2026-10-16 | 8 | ARQ-Arquitecto TI / PMO, SYS | Urgent |
| SYS-I13 | Plan de capacidad y escalamiento (1 ano) | 2026-10-12 | 2026-10-16 | 24 | ARQ-Arquitecto TI / PMO, SYS | High |

## MES6_NOVIEMBRE_GoLive (10 tareas, 312 h)

| ID | Tarea | Inicio | Fin | h | Asignacion | Prioridad |
|---|---|---|---|---:|---|---|
| P2-M6-001 | Pruebas de estrés: 10,000 sensores simultáneos | 2026-11-02 | 2026-11-06 | 40 | BACKEND 1, ARQ-Arquitecto TI / PMO, SYS, QA | Urgent |
| P2-M6-003 | Simulacros de fallo y recuperación (DR drill) | 2026-11-02 | 2026-11-06 | 24 | SYS, QA | High |
| P2-M6-005 | Ajuste fino de rendimiento post-pruebas | 2026-11-02 | 2026-11-06 | 24 | BACKEND 1, ARQ-Arquitecto TI / PMO, SYS | High |
| VPS-010 | Prueba de conectividad desde mina real: fibra, 4G (todos los operadores) y satelital | 2026-11-02 | 2026-11-06 | 24 | ARQ-Arquitecto TI / PMO, SYS, QA | Urgent |
| VPS-011 | Prueba de failover completo: caida de servidor principal y activacion de respaldo | 2026-11-02 | 2026-11-13 | 24 | SYS, QA | Urgent |
| P2-M6-009 | Marcha blanca con datos reales en unidad minera | 2026-11-09 | 2026-11-20 | 40 | ARQ-Arquitecto TI / PMO, SYS, QA | Urgent |
| SYS-I14 | Soporte infraestructura 24/7 en marcha blanca y Go-Live | 2026-11-16 | 2026-11-27 | 40 | SYS | Urgent |
| ARQ-G13 | Transferencia formal del sistema a operaciones TI del cliente | 2026-11-23 | 2026-11-27 | 40 | ARQ-Arquitecto TI / PMO, SYS | Urgent |
| P2-M6-012 | Pase a producción global (Hard-Launch LATAM) | 2026-11-23 | 2026-11-27 | 16 | ARQ-Arquitecto TI / PMO, SYS | Urgent |
| P2-M6-013 | Soporte post-GoLive y estabilización (Semana 26) | 2026-11-23 | 2026-11-27 | 40 | BACKEND 1, ARQ-Arquitecto TI / PMO, SYS, QA | Urgent |

## QA_Transversal (2 tareas, 64 h)

| ID | Tarea | Inicio | Fin | h | Asignacion | Prioridad |
|---|---|---|---|---:|---|---|
| QA-002 | Preparar ambiente de PRUEBAS (staging) para el equipo QA | 2026-08-03 | 2026-08-14 | 24 | SYS, QA | High |
| QA-T09 | Desarrollo de scripts de pruebas de estrés | 2026-08-24 | 2026-10-16 | 40 | SYS, QA | High |

---

## Tareas compartidas (SYS + otros recursos)

- **DEV-002** — Empaquetar todos los servicios en contenedores Docker (BE3,SYS) — 40 h
- **IA-M03** — Preparar servidor de Inteligencia Artificial (GPU + MLflow) (BE3,IA,SYS) — 48 h
- **SYS-I01** — Automatizar instalacion de servidores (Ansible) (BE3,SYS) — 32 h
- **SYS-I02** — Centralizar logs del sistema (Loki + Grafana) (BE3,SYS) — 32 h
- **DEV-004** — Instalar VPS de PRUEBAS / CERTIFICACION (staging) (SYS,QA) — 32 h
- **SYS-I05** — Mantenimiento semanal de bases de datos (BE1,BE3,ARQ,SYS) — 44 h
- **QA-002** — Preparar ambiente de PRUEBAS (staging) para el equipo QA (SYS,QA) — 24 h
- **P1-M4-004** — Instalar cola de mensajes Redpanda/Kafka en datacenter (BE3,SYS) — 24 h
- **SYS-I07** — Documentar infraestructura y red (diagramas) (ARQ,SYS) — 24 h
- **SYS-I08** — Igualar ambientes dev, staging y produccion (BE3,SYS) — 32 h
- **QA-T09** — Desarrollo de scripts de pruebas de estrés (SYS,QA) — 40 h
- **DEV-005** — Instalar VPS de PRODUCCION en datacenter Lima (usuarios reales) (ARQ,SYS) — 32 h
- **P2-M5-001** — Disenar red del datacenter Lima y enlace con minas (BE3,ARQ,SYS) — 40 h
- **P2-M5-004** — Crear estructura de usuarios, permisos y politicas de acceso al servidor (BE2,SYS) — 24 h
- **P2-M5-005** — Instalar y configurar orquestador de contenedores (Docker Swarm / K3s) (BE3,SYS) — 40 h
- **P2-M5-006** — Blindaje de seguridad de servidores: firewall, bloqueo de accesos no autorizados (BE2,SYS) — 32 h
- **P2-M5-010** — Instalar base de datos PostgreSQL con replica y alta disponibilidad (BE1,ARQ,SYS) — 32 h
- **SYS-I11** — Acelerar carga web con Nginx (cache y compresion) (FE1,SYS) — 16 h
- **VPS-003** — Configurar VPN WireGuard para acceso seguro desde mina (BE2,SYS) — 24 h
- **VPS-004** — Provisionar servidor VPS de respaldo (arquitectura Activo-Pasivo) (ARQ,SYS) — 32 h
- **VPS-005** — Plan de conectividad operador-agnostica para clientes mineros (Claro, Movistar, Bitel, Entel) (ARQ,SYS) — 24 h
- **P2-M5-008** — Automatizar proceso de compilacion, pruebas y despliegue del sistema (BE1,ARQ,SYS) — 32 h
- **P2-M5-011** — Configurar copias de seguridad continuas de la base de datos (BE1,ARQ,SYS) — 24 h
- **P2-M5-013** — Plan de recuperacion ante desastres (DRP): que hacer si todo falla (ARQ,SYS) — 32 h
- **P2-M5-014** — Crear procesos automaticos de limpieza y mantenimiento de la base de datos (BE1,ARQ,SYS) — 16 h
- **VPS-006** — Instalar WAF (Web Application Firewall) para proteger la plataforma web (BE2,SYS) — 24 h
- **VPS-008** — Configurar replicacion automatica de datos al servidor de respaldo (BE3,SYS) — 32 h
- **VPS-009** — Documentar arquitectura completa VPS datacenter Lima (diagrama tecnico y gerencial) (ARQ,SYS) — 24 h
- **P2-M5-016** — Simulacro de falla: verificar que el sistema se recupera automaticamente (SYS,QA) — 24 h
- **P2-M5-019** — Milestone: Infraestructura Productiva Lista (ARQ,SYS) — 8 h
- **SYS-I13** — Plan de capacidad y escalamiento (1 ano) (ARQ,SYS) — 24 h
- **P2-M6-001** — Pruebas de estrés: 10,000 sensores simultáneos (BE1,ARQ,SYS,QA) — 40 h
- **P2-M6-003** — Simulacros de fallo y recuperación (DR drill) (SYS,QA) — 24 h
- **P2-M6-005** — Ajuste fino de rendimiento post-pruebas (BE1,ARQ,SYS) — 24 h
- **VPS-010** — Prueba de conectividad desde mina real: fibra, 4G (todos los operadores) y satelital (ARQ,SYS,QA) — 24 h
- **VPS-011** — Prueba de failover completo: caida de servidor principal y activacion de respaldo (SYS,QA) — 24 h
- **P2-M6-009** — Marcha blanca con datos reales en unidad minera (ARQ,SYS,QA) — 40 h
- **ARQ-G13** — Transferencia formal del sistema a operaciones TI del cliente (ARQ,SYS) — 40 h
- **P2-M6-012** — Pase a producción global (Hard-Launch LATAM) (ARQ,SYS) — 16 h
- **P2-M6-013** — Soporte post-GoLive y estabilización (Semana 26) (BE1,ARQ,SYS,QA) — 40 h
