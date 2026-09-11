# REGISTRO MAESTRO ADR ↔ SPEC · Plataforma Minera Beemetry

> **Fuente vigente al 2026-08-21, rango de ADR actualizado 2026-09-11.** Las
> decisiones canónicas están únicamente en
> [`docs/decisions/`](../docs/decisions/README.md), ADR-000 a ADR-169 (huecos
> en 151-152 ya cerrados con archivo mínimo, ver ADR-151/152) *(rango corregido 2026-08-21 —
> este banner decía "ADR-111" pese a que la fila SPEC-024 más abajo ya citaba
> ADR-121/123; ampliado ese día a 128 tras redactar ADR-124 a 128; corregido
> de nuevo 2026-09-10 — la fila SPEC-008 de abajo ya citaba ADR-141 desde
> antes de esta corrección, el banner había quedado rezagado otra vez; ver
> `docs/decisions/README.md` para el detalle completo de la tanda 141-165)*.
> `specs/adr/` y `docs/docs/decisions/` son copias históricas/no canónicas y no
> deben alimentar decisiones nuevas, RAG ni conteos de avance.

## Reglas de trazabilidad

1. Ningún cambio de producto se integra sin SPEC y ADR vigente o una referencia
   expresa a una decisión existente.
2. `implemented` significa código existente; `accepted` significa decisión
   aprobada; ninguno sustituye la evidencia de criterios de aceptación.
3. Los directorios duplicados `004-replica-alta-disponibilidad` y
   `005-push-tiempo-real-sse` se conservan como alias históricos. Para métricas
   solo cuentan `004-replica-lectura-ha` y `005-push-sse-tiempo-real`.
4. Las decisiones superseded se conservan, pero la relación efectiva usa su
   reemplazo: ADR-028→072, ADR-062→064/065, ADR-104→105 y prioridad de
   ADR-089→105.

## Matriz SPEC → decisiones canónicas principales

| SPEC | Capacidad | ADR canónicos principales | Estado de aceptación al corte |
|---|---|---|---|
| SPEC-001 | Ingesta durable | 001, 007, 008, 023, 032, 034, 108 | Implementada; línea base 25k validada en SPEC-020 |
| SPEC-002 | Dashboard realtime | 002, 006, 031, 057, 108 | Parcialmente aceptada |
| SPEC-003 | Tier frío | 006, 023, 033 | Parcial; operación/restore pendiente |
| SPEC-004 | Réplica y HA | 006, 032, 033 | Parcial; failover y gate DR pendientes |
| SPEC-005 | Push realtime | 002, 008, 031, 057 | Parcialmente aceptada |
| SPEC-006 | Auth/RBAC/multitenant | 029, 030, 036, 043, 058, 063, 066, 067, 076-078, 085-088, 100-102, 106-107 | Implementada; pentest externo pendiente |
| SPEC-007 | ReportStudio/export | 009-021, 046-053, 055, 064-065, 068-073, 079-084, 092, 097-098 | Implementada con regresiones abiertas |
| SPEC-008 | Biometría | 025, 029, 074, 089, 099, 105, 107, 141 | Implementada; calibración/certificación pendiente; ADR-141 (avatar por difusión) opt-in, CA-15 sin validar |
| SPEC-009 | GIS/mapas | 022, 026-028, 056, 072 | Implementada; pruebas offline de sitio pendientes |
| SPEC-010 | Fórmulas | 031, 034 | Implementada |
| SPEC-011 | IA de texto | 024, 068, 093-096 | Implementada; SLA depende del modelo/hardware |
| SPEC-012 | Conversión GDAL | 027, 072 | Implementada |
| SPEC-013 | Videovigilancia | 031, 034, 064-065 | Parcial; integración de cámaras reales pendiente |
| SPEC-014 | Offline y reconciliación | 022, 026, 045, 056 | No implementada como flujo integral |
| SPEC-015 | DR/continuidad | 032, 033, 059 | No aceptada; ejercicios RTO/RPO pendientes |
| SPEC-016 | Alertas | 002, 008, 031, 034, 057 | Backlog; existen componentes, falta cierre SPEC |
| SPEC-017 | Visión IA EPP | 025, 105, 110 | Deferred por ADR-025; no implementada |
| SPEC-018 | Dictado STT | 024, 068, 095 | Parcial/experimental |
| SPEC-019 | RP TimeTelemetry/Odoo | 103, 110 | Lectura real validada; escritura productiva pendiente |
| SPEC-020 | Telemetría 25k/s | 008, 023, 032, 108 | Aceptada a 25k; 100k no aprobado |
| SPEC-021 | Zonas y gráficos multiserie | 057, 109 | Código 6/10 tareas; aceptación integrada pendiente |
| SPEC-022 | Operaciones de campo | 022, 025, 026, 045, 103, 110 | Aprobado como proyecto derivado (2026-09-11), propio PO/presupuesto, etapas posteriores; 0/14 tareas |
| SPEC-023 | Portabilidad/despliegue/restore | 033, 035, 111 | Utilidad 6/11; restore/CI/CD pendientes |
| SPEC-025 | Soporte/WhatsApp | 112-118, 122, 129, 137, 168 | Aprobado al alcance contractual (2026-09-11, ADR-168); sin tasks.md formal todavía; canal SMS de ADR-137 pendiente de cuenta Twilio comercial |
| SPEC-024 | Integración GEOCATMIN INGEMMET | 009, 026, 121, 123 | Implementada; acceso directo por unidad minera |

## Decisiones transversales

| Tema | ADR | Aplicación |
|---|---|---|
| Constitución/SDD y log canónico | 090, Constitución | SPEC-001–022 |
| IA multiagente, router, RAG y revisión | 004, 010, 011, 012 | Todo cambio asistido por IA |
| Seguridad y QA | 043, 058-061 | Todos los gates |
| Despliegue y operación | 033, 035 | R5/R6 y expansión LATAM |
| Accesibilidad/i18n | 091, 106 | Todas las interfaces nuevas |

## Conflictos y resolución al 2026-08-18

| Hallazgo | Resolución canónica |
|---|---|
| ADR-089 decía Dermalog primario; ADR-105 usa DeepFace+SilentFace | ADR-089 marcado parcialmente superseded; ADR-105 manda en prioridad |
| ADR-104 SeetaFace default | Superseded por ADR-105; solo rollback heredado |
| ADR-025 difiere EPP, pero SPEC-017 lo planifica | Sigue deferred; ADR-110 exige reactivación y evidencia antes de construir |
| ADR-035 describe LATAM, algunos planes lo tratan como hecho | F0 actual; F1-F4 sin código y sujetas a decisión de negocio |
| Material conceptual declara ROI/IA de campo | Se conserva como hipótesis; SPEC-022 inicia en 0% |
| Prueba 100k podría interpretarse como capacidad | ADR-108 prohíbe el claim; solo 25k está validado |

## Checklist pre-código

Toda rama debe identificar SPEC, ADR, criterios de aceptación, pruebas, agente,
modelo y rollback. El Router y el revisor deben consultar este registro y el
log canónico; ninguna copia histórica puede prevalecer.
