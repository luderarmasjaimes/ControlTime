# SYS Etapa 1 — Tareas COMPARTIDAS con otros recursos

**Total:** 40 tareas | **Horas:** 1180 h

| ID | Tarea | Lista | Inicio | Fin | h | Con quien | Prioridad |
|---|---|---|---|---|---:|---|---|
| DEV-002 | Empaquetar todos los servicios en contenedores Docker | DevOps_Infra | 2026-07-13 | 2026-07-31 | 40 | BE3 | High |
| IA-M03 | Preparar servidor de Inteligencia Artificial (GPU + MLflow) | MES2_JULIO_Core_Seguridad | 2026-07-27 | 2026-07-31 | 48 | BE3, IA | High |
| SYS-I01 | Automatizar instalacion de servidores (Ansible) | MES2_JULIO_Core_Seguridad | 2026-07-27 | 2026-07-31 | 32 | BE3 | High |
| SYS-I02 | Centralizar logs del sistema (Loki + Grafana) | MES2_JULIO_Core_Seguridad | 2026-07-27 | 2026-07-31 | 32 | BE3 | High |
| DEV-004 | Instalar VPS de PRUEBAS / CERTIFICACION (staging) | DevOps_Infra | 2026-08-03 | 2026-08-28 | 32 | QA | High |
| SYS-I05 | Mantenimiento semanal de bases de datos | MES3_AGOSTO_UX_Sensores | 2026-08-03 | 2026-09-04 | 44 | BE1, BE3, ARQ | High |
| QA-002 | Preparar ambiente de PRUEBAS (staging) para el equipo QA | QA_Transversal | 2026-08-03 | 2026-08-14 | 24 | QA | High |
| P1-M4-004 | Instalar cola de mensajes Redpanda/Kafka en datacenter | MES4_SEPTIEMBRE_Integracion_QA | 2026-08-24 | 2026-09-04 | 24 | BE3 | High |
| SYS-I07 | Documentar infraestructura y red (diagramas) | MES4_SEPTIEMBRE_Integracion_QA | 2026-08-24 | 2026-09-18 | 24 | ARQ | Normal |
| SYS-I08 | Igualar ambientes dev, staging y produccion | MES4_SEPTIEMBRE_Integracion_QA | 2026-08-24 | 2026-10-02 | 32 | BE3 | High |
| QA-T09 | Desarrollo de scripts de pruebas de estrés | QA_Transversal | 2026-08-24 | 2026-10-16 | 40 | QA | High |
| DEV-005 | Instalar VPS de PRODUCCION en datacenter Lima (usuarios reales) | DevOps_Infra | 2026-09-21 | 2026-10-02 | 32 | ARQ | Urgent |
| P2-M5-001 | Disenar red del datacenter Lima y enlace con minas | MES5_OCTUBRE_Optimizacion | 2026-09-21 | 2026-10-02 | 40 | BE3, ARQ | Urgent |
| P2-M5-004 | Crear estructura de usuarios, permisos y politicas de acceso al servidor | MES5_OCTUBRE_Optimizacion | 2026-09-28 | 2026-10-02 | 24 | BE2 | High |
| P2-M5-005 | Instalar y configurar orquestador de contenedores (Docker Swarm / K3s) | MES5_OCTUBRE_Optimizacion | 2026-09-28 | 2026-10-09 | 40 | BE3 | Urgent |
| P2-M5-006 | Blindaje de seguridad de servidores: firewall, bloqueo de accesos no autorizados | MES5_OCTUBRE_Optimizacion | 2026-09-28 | 2026-10-09 | 32 | BE2 | Urgent |
| P2-M5-010 | Instalar base de datos PostgreSQL con replica y alta disponibilidad | MES5_OCTUBRE_Optimizacion | 2026-09-28 | 2026-10-09 | 32 | BE1, ARQ | Urgent |
| SYS-I11 | Acelerar carga web con Nginx (cache y compresion) | MES5_OCTUBRE_Optimizacion | 2026-09-28 | 2026-10-09 | 16 | FE1 | Normal |
| VPS-003 | Configurar VPN WireGuard para acceso seguro desde mina | MES5_OCTUBRE_Optimizacion | 2026-09-28 | 2026-10-09 | 24 | BE2 | High |
| VPS-004 | Provisionar servidor VPS de respaldo (arquitectura Activo-Pasivo) | MES5_OCTUBRE_Optimizacion | 2026-09-28 | 2026-10-09 | 32 | ARQ | Urgent |
| VPS-005 | Plan de conectividad operador-agnostica para clientes mineros (Claro, Movistar, Bitel, Entel) | MES5_OCTUBRE_Optimizacion | 2026-09-28 | 2026-10-02 | 24 | ARQ | High |
| P2-M5-008 | Automatizar proceso de compilacion, pruebas y despliegue del sistema | MES5_OCTUBRE_Optimizacion | 2026-10-05 | 2026-10-09 | 32 | BE1, ARQ | High |
| P2-M5-011 | Configurar copias de seguridad continuas de la base de datos | MES5_OCTUBRE_Optimizacion | 2026-10-05 | 2026-10-16 | 24 | BE1, ARQ | High |
| P2-M5-013 | Plan de recuperacion ante desastres (DRP): que hacer si todo falla | MES5_OCTUBRE_Optimizacion | 2026-10-05 | 2026-10-16 | 32 | ARQ | Urgent |
| P2-M5-014 | Crear procesos automaticos de limpieza y mantenimiento de la base de datos | MES5_OCTUBRE_Optimizacion | 2026-10-05 | 2026-10-16 | 16 | BE1, ARQ | Normal |
| VPS-006 | Instalar WAF (Web Application Firewall) para proteger la plataforma web | MES5_OCTUBRE_Optimizacion | 2026-10-05 | 2026-10-09 | 24 | BE2 | High |
| VPS-008 | Configurar replicacion automatica de datos al servidor de respaldo | MES5_OCTUBRE_Optimizacion | 2026-10-05 | 2026-10-16 | 32 | BE3 | Urgent |
| VPS-009 | Documentar arquitectura completa VPS datacenter Lima (diagrama tecnico y gerencial) | MES5_OCTUBRE_Optimizacion | 2026-10-05 | 2026-10-16 | 24 | ARQ | High |
| P2-M5-016 | Simulacro de falla: verificar que el sistema se recupera automaticamente | MES5_OCTUBRE_Optimizacion | 2026-10-12 | 2026-10-16 | 24 | QA | High |
| P2-M5-019 | Milestone: Infraestructura Productiva Lista | MES5_OCTUBRE_Optimizacion | 2026-10-12 | 2026-10-16 | 8 | ARQ | Urgent |
| SYS-I13 | Plan de capacidad y escalamiento (1 ano) | MES5_OCTUBRE_Optimizacion | 2026-10-12 | 2026-10-16 | 24 | ARQ | High |
| P2-M6-001 | Pruebas de estrés: 10,000 sensores simultáneos | MES6_NOVIEMBRE_GoLive | 2026-11-02 | 2026-11-06 | 40 | BE1, ARQ, QA | Urgent |
| P2-M6-003 | Simulacros de fallo y recuperación (DR drill) | MES6_NOVIEMBRE_GoLive | 2026-11-02 | 2026-11-06 | 24 | QA | High |
| P2-M6-005 | Ajuste fino de rendimiento post-pruebas | MES6_NOVIEMBRE_GoLive | 2026-11-02 | 2026-11-06 | 24 | BE1, ARQ | High |
| VPS-010 | Prueba de conectividad desde mina real: fibra, 4G (todos los operadores) y satelital | MES6_NOVIEMBRE_GoLive | 2026-11-02 | 2026-11-06 | 24 | ARQ, QA | Urgent |
| VPS-011 | Prueba de failover completo: caida de servidor principal y activacion de respaldo | MES6_NOVIEMBRE_GoLive | 2026-11-02 | 2026-11-13 | 24 | QA | Urgent |
| P2-M6-009 | Marcha blanca con datos reales en unidad minera | MES6_NOVIEMBRE_GoLive | 2026-11-09 | 2026-11-20 | 40 | ARQ, QA | Urgent |
| ARQ-G13 | Transferencia formal del sistema a operaciones TI del cliente | MES6_NOVIEMBRE_GoLive | 2026-11-23 | 2026-11-27 | 40 | ARQ | Urgent |
| P2-M6-012 | Pase a producción global (Hard-Launch LATAM) | MES6_NOVIEMBRE_GoLive | 2026-11-23 | 2026-11-27 | 16 | ARQ | Urgent |
| P2-M6-013 | Soporte post-GoLive y estabilización (Semana 26) | MES6_NOVIEMBRE_GoLive | 2026-11-23 | 2026-11-27 | 40 | BE1, ARQ, QA | Urgent |