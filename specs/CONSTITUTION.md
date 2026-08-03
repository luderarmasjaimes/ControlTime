# CONSTITUCIÓN DEL PROYECTO · Plataforma Minera AURIXA

> Principios **no negociables**. Todo spec, plan y línea de código debe
> cumplirlos. Una violación bloquea el merge. Cambiar un artículo requiere un
> **ADR** aprobado por el Arquitecto TI y registro de versión.

**Versión:** 1.0 · **Vigente desde:** 2026-06-24

---

## Art. 1 — Multitenancy primero
Todo dato, query, endpoint y dashboard **debe** estar aislado por `tenant_id`.
Ninguna consulta cruza empresas mineras sin autorización explícita. El
`tenant_id` es obligatorio en toda tabla de negocio y en todo filtro de lectura.

## Art. 2 — Tiempo real sin pérdida
La ingesta de telemetría es **durable**: ningún mensaje confirmado al sensor se
pierde ante caída de un componente. El pipeline usa un log durable (Kafka/
Redpanda) con *commit* de offset **posterior** a la persistencia (at-least-once).
Objetivo de pérdida en operación normal: **0**.

## Art. 3 — Aislamiento lectura/escritura
La ingesta (escritura) y la analítica (dashboards/informes) **no comparten** la
ruta de CPU del primario. Dashboards e informes leen de **réplica** o de
**agregados materializados**, nunca escaneando la tabla caliente cruda.

## Art. 4 — Capas por temperatura del dato
- **Caliente** (horas–días): TimescaleDB sin comprimir + agregados continuos.
- **Templado** (días–1 año): chunks comprimidos (columnar).
- **Frío** (> 1 año): objeto S3/MinIO (Parquet), consultable, fuera del primario.

## Art. 5 — Observabilidad obligatoria
Todo servicio expone métricas (`/api/metrics`, formato Prometheus). Una feature
sin métricas de su salud/throughput **no está terminada**. Toda decisión de
performance se respalda con una **medición**, no con una opinión.

## Art. 6 — Seguridad y trazabilidad
- Autenticación y RBAC en todo endpoint; respuestas `unauthorized` por defecto.
- Roles separados: **escritura** (ingesta) vs **solo-lectura** (dashboards) con
  `statement_timeout` que impida que la analítica ahogue la ingesta.
- Auditoría de acciones sensibles.

## Art. 7 — Disciplina de IA / costo
- El **spec y el plan** se redactan con modelo económico; el modelo premium
  (Opus) se reserva para arquitectura difícil y debugging complejo.
- **Una feature por sesión**; no arrastrar contexto.
- El alcance lo fija el spec aprobado: **nada fuera de spec** sin nuevo spec.

## Art. 8 — Reproducibilidad
Todo se levanta con `docker compose`. Sin pasos manuales no documentados.
Builds deterministas; configuración por variables de entorno, no hardcode.

## Art. 9 — Recursos acotados
Todo contenedor declara límites de CPU/memoria. Toda política de retención
(WAL, Kafka, datos) está acotada para no agotar disco. El disco es el recurso
más sensible del entorno.

## Art. 10 — Verificación contra el spec
"Funciona" significa **"cumple cada criterio de aceptación del spec, demostrado
con evidencia"**. No se acepta "parece que anda".

## Art. 11 — Metodología IA multi-agente
- Toda implementación asistida por IA sigue **ADR + SPEC + Router** (`AGENTS.md`).
- Ningún código generado por IA se mergea sin **revisión automática** ADR/SPEC (ADR-012).
- El contexto se obtiene vía **RAG** (`ai_platform/`), no enviando el repo completo.
- El agente y modelo se eligen por especialidad (backend→Claude, frontend→GPT, SQL→DeepSeek, docs→Gemini).

---

### Registro de enmiendas
| Versión | Fecha | Cambio | ADR |
|---|---|---|---|
| 1.0 | 2026-06-24 | Constitución inicial | — |
| 1.1 | 2026-06-24 | Art. 11 Metodología IA multi-agente | ADR-004, ADR-010, ADR-012 |
