# ADR-035 — Plataforma enterprise multi-unidad para operaciones mineras LATAM

> **Actualización 2026-09-11 — postura de negocio confirmada por Gerencia,
> cierra la decisión pendiente del corte gerencial del 2026-09-10.** Se
> confirma que la empresa **es Enterprise LATAM hoy, no un escenario
> hipotético a futuro**: existen proyectos activos en Perú, Brasil, Ecuador
> y Chile, entre otros. Esto fija dos cosas distintas — una decisión de
> **requisito de producto**, que aplica ya, y una decisión de **infraestructura
> (F1-F4 de este mismo ADR)**, que sigue sin aprobarse:
>
> 1. **Requisito de producto, vigente desde hoy**: toda implementación de
>    módulo nuevo debe considerar **soporte multi-país y multi-idioma** desde
>    el diseño, no como un añadido posterior. La parte de idioma ya está
>    resuelta (ADR-075: selector país→idioma, 4 locales ES/EN/FR/PT-BR,
>    cubre Perú/Brasil/mercados francófonos ya operativo) — no requiere
>    trabajo nuevo. La parte de validación fiscal/registro por país queda
>    documentada en la actualización de **ADR-087** (ver ese ADR): SUNAT
>    obligatorio para Perú; mecanismos equivalentes para Brasil/Ecuador/
>    Chile y el resto de LATAM, a implementar cuando cada mercado lo
>    requiera — no se construyen los cuatro a la vez sin pedido concreto.
> 2. **Decisión de infraestructura, todavía NO aprobada**: la topología
>    edge+hub jerárquica de 3 niveles (Fases F1-F4 de este ADR — hub
>    regional, federación OIDC/Keycloak, soberanía de datos por topología)
>    sigue **sin fecha ni presupuesto**. Confirmar que la empresa opera en
>    varios países no autoriza por sí solo empezar F1 — esa sigue siendo
>    una decisión de arquitectura/inversión separada, del tamaño de un
>    proyecto propio, que este mensaje no cubre. El estado de ejecución de
>    F1-F4 sigue en 0%.
>
> **Actualización 2026-09-11 (segunda pasada, mismo día) — infraestructura
> para pilotos fuera de Perú.** Gerencia confirma cómo se hospedan los
> pilotos iniciales en el resto de LATAM mientras F1-F4 no se aprueban: se
> usa la **misma infraestructura VPS ya instalada en Perú** — un despliegue
> centralizado servido desde Perú, no un edge/hub separado por país. Esto
> es consistente con el punto 2 de arriba (F0 sigue siendo el estado real,
> F1-F4 sin aprobar): no se trata de una fase nueva de este ADR, sino de la
> forma concreta en que un piloto de Brasil/Ecuador/Chile corre **hoy**,
> sobre el mismo stack F0, sin infraestructura propia en esos países
> todavía. Implica, y queda anotado para quien construya esos pilotos:
> latencia mayor para usuarios fuera de Perú (sin edge local) y ningún
> requisito de residencia de datos en el país del piloto (los datos viven
> en la VPS de Perú) — aceptable explícitamente para una etapa de piloto,
> no para operación productiva a escala, que es precisamente lo que F1-F4
> resolvería si se aprueba en el futuro.

**Status**: propuesto (2026-07-12) — revisado 2026-08-18: sigue en F0
(un edge autónomo por unidad, estado actual del stack). Los documentos de
perfiles multipaís del 2026-08-14 son planificación de recursos, no evidencia
de implementación. Ninguna fase F1-F4 tiene trabajo de código iniciado;
permanece como propuesta activa a la espera de una decisión de negocio sobre
expansión multi-región. No requiere acción de código hasta aprobar F1.
**Autores**: EC
**Ámbito**: plataforma / arquitectura
**Relacionado**: ADR-001 (soberanía on-prem), ADR-002 (gateway C++), ADR-005/006/032 (dos BD + réplica), ADR-007/008/034 (ingesta y core IoT), ADR-029 (JWT/identidad), ADR-030 (auditoría), ADR-031 (plataforma compartida)

## Contexto

La plataforma actual (Beemetry/AURIXA) corre como un **stack único** (un `docker-compose`, una base `sensors_db` multitenant por `tenant_id`, un backend C++, un frontend) validado para **una operación** con hasta 10.000 sensores por unidad. El objetivo de negocio es dar soporte a **todas las unidades mineras de LATAM**: decenas de operaciones, en varios países (Perú, Chile, México, Brasil, Colombia, Argentina…), cada una con conectividad, regulación y soberanía de datos distintas.

Escalar "hacia arriba" un solo stack monolítico no sirve para este caso: las unidades mineras están **físicamente aisladas** (sierra/selva, conectividad satelital variable — ver ADR-022/026), la telemetría es **de alto volumen y baja latencia local** (una alarma de gas no puede depender de un round-trip a un datacenter en otra ciudad), y varios países exigen que **ciertos datos no salgan de sus fronteras**. La arquitectura debe ser **distribuida por diseño**, no centralizada con clientes remotos.

## Decisión

Adoptar una topología **edge + hub jerárquica de 3 niveles**, reutilizando el stack actual como la **unidad de despliegue del edge** (no se reescribe: el `docker-compose` actual ES el nodo de sitio).

```
Nivel 1 — EDGE (por unidad minera, on-site)
  Stack actual completo, autónomo: ingesta (gateway TLS + MQTT/Modbus/OPC-UA),
  alarmas locales, mapas offline (MBTiles), FORMULA, informes. Sigue operando
  100% si pierde el enlace WAN (ADR-022/026 ya lo contemplan).
        │  (sincronización asíncrona, tolerante a particiones)
        ▼
Nivel 2 — HUB REGIONAL (por país / cluster de países con misma soberanía)
  Agregación de telemetría (rollups, no crudo), consola multi-unidad,
  federación de identidad, catálogo corporativo de reglas/plantillas,
  reporting consolidado. Vive dentro de la frontera de datos del país.
        │  (solo métricas agregadas + metadatos, nunca crudo transfronterizo)
        ▼
Nivel 3 — CORPORATIVO LATAM (global, opcional)
  KPIs ejecutivos consolidados, gobierno de identidad global (SSO),
  facturación/licenciamiento, observabilidad de la flota de hubs.
```

### Reglas duras

1. **El edge es autónomo y autoritativo sobre su operación.** Alarmas, control de acceso local y persistencia de telemetría cruda viven y se resuelven en el sitio. El hub nunca es un punto único de falla para la seguridad operacional de una unidad.
2. **La sincronización edge→hub es asíncrona y idempotente**, sobre la cola durable ya existente (Redpanda/Kafka, ADR-008), con reintento y deduplicación. Nunca síncrona en el hot path.
3. **Soberanía de datos por país (data residency).** El crudo de telemetría y los datos personales (biometría, ADR-025) permanecen en la frontera del país. Al hub corporativo global solo suben **agregados y metadatos no personales**. Esto se hace cumplir por topología (el hub regional vive en-país), no solo por política.
4. **Identidad federada, autorización local.** El SSO corporativo (nivel 3) emite la identidad; la **autorización efectiva la resuelve cada tenant/unidad** con su propia matriz RBAC (ver db_scripts/42 — `role_permissions` con override por tenant ya soporta esto). Un usuario corporativo no obtiene acceso a una unidad sin un rol asignado en ella.
5. **Un tenant = una unidad minera** (o un contrato). El `tenant_id` actual es la unidad de aislamiento y sigue siéndolo; el hub agrega tenants, no los fusiona.
6. **Reutilización, no reescritura.** El edge es el stack actual con flags de sincronización activados. El hub reutiliza los mismos componentes C++ (gateway, auth, FORMULA) en modo agregador. No hay una segunda base de código.

### Federación de identidad (extensión de ADR-029)

- Nivel 3 corre un **IdP OIDC** (Keycloak on-prem, soberano — coherente con ADR-001/024 "todo on-prem"). Emite tokens OIDC.
- El backend edge/hub ya valida JWT (ADR-029). Se agrega un **conector OIDC**: el JWT corporativo se intercambia por una sesión local del tenant tras verificar que el usuario tiene un rol en `auth_user_tenant` para esa unidad. Los usuarios existentes (login local con contraseña/biometría) siguen funcionando sin cambios — la federación es aditiva.
- **Break-glass local**: cada edge conserva al menos un admin local que funciona sin el IdP (para no quedar bloqueado si el enlace al nivel 3 cae). Ya soportado por el modo de auth actual.

### Modelo de datos multi-unidad

- **Edge**: `sensors_db` actual sin cambios (multitenant, normalmente 1 tenant activo por edge, pero soporta N).
- **Hub regional**: BD de agregación con `unit_id` + `tenant_id`. Recibe **continuous aggregates** (ya usamos TimescaleDB, ADR-006) — rollups de 1m/1h/1d por sensor/unidad, no filas crudas. Órdenes de magnitud menos volumen cruzando la WAN.
- La cadena de auditoría (ADR-030, hash-encadenada) es **por nodo**; el hub verifica la cadena de cada edge en la sincronización, detectando manipulación en tránsito o en el sitio.

### Dimensionamiento (orientativo, a validar con carga real)

| Escala | Sensores | Estrategia |
|---|---|---|
| 1 unidad | ≤10K | Stack actual, single-node (probado a 10.8M filas) |
| 1 país (~10 unidades) | ~100K | 10 edges + 1 hub regional; hub agrega rollups |
| LATAM (~50 unidades, 6 países) | ~500K | 50 edges + 6 hubs + 1 corporativo; sin cruce de crudo transfronterizo |

La ingesta ya escala horizontalmente por unidad (cada edge es independiente); el cuello de botella se mueve al hub, que solo ve agregados → manejable con la réplica de lectura (ADR-032) y particionado por `unit_id`.

### Alta disponibilidad

- **Edge**: réplica de streaming local (ADR-032, ya operativa) + los sidecars con `restart: unless-stopped`. RPO≈0 local. Un sitio sobrevive a la caída de su hub indefinidamente (opera en modo autónomo).
- **Hub**: activo-pasivo por región con la misma réplica Postgres; failover manual documentado en RUNBOOK. La caída de un hub degrada la consola consolidada, no la operación de las unidades.
- **Corporativo**: no es crítico para operación; su caída solo afecta reporting ejecutivo.

## Fases de rollout (estrangulamiento, no big-bang — coherente con ADR-034)

1. **F0 — hoy**: un edge autónomo por unidad. *(Estado actual.)*
2. **F1**: activar sincronización edge→hub de **agregados** (reusa Redpanda + continuous aggregates existentes). Un hub regional piloto (Perú). Consola multi-unidad de solo lectura.
3. **F2**: federación de identidad OIDC (Keycloak nivel 3) con fallback local. RBAC por tenant ya está listo (db_scripts/42).
4. **F3**: segundo país (Chile) validando el aislamiento de soberanía; catálogo corporativo de reglas/plantillas FORMULA distribuido a los edges.
5. **F4**: corporativo LATAM (KPIs ejecutivos, gobierno global, licenciamiento).

Cada fase entrega valor y es reversible; ninguna requiere reescribir el edge.

## Consecuencias

### Positivas
- Cada unidad minera es operacionalmente autónoma → resiliencia real ante la conectividad de sierra/selva.
- Soberanía de datos cumplida por topología, no por promesa.
- Reutiliza el 100% del stack actual como edge; el trabajo incremental es sincronización + federación, no un rewrite.
- Escala añadiendo edges (lineal), no engordando un monolito.

### Negativas / Trade-offs
- Operar N edges + M hubs es más complejo que un stack: exige **automatización de despliegue** (imágenes versionadas, GitOps por sitio) — necesario de todos modos a esta escala.
- La consola consolidada ve datos con retraso (sincronización asíncrona) — aceptable y explícito: el dato operacional en vivo se ve **en el edge**, el consolidado es para gestión.
- Requiere disciplina de versionado: edges en distintas versiones deben interoperar con el hub (contrato de sincronización versionado, igual que el evento canónico de ADR-007).

### Neutras
- No cambia el modelo de un solo tenant en el edge; lo generaliza a una flota.

## Alternativas descartadas

- **Un solo stack central con clientes remotos**: viola ADR-001/022/026 (autonomía offline), añade latencia inaceptable a las alarmas de seguridad, y no resuelve soberanía transfronteriza. Rechazado.
- **SaaS multi-tenant en nube pública**: contradice de raíz la soberanía on-prem (ADR-001), pilar del producto para el sector minero/estatal. Rechazado.
- **Un cluster Kubernetes global**: sobre-ingeniería para nodos que deben operar aislados con conectividad intermitente; K8s asume red confiable entre nodos. El edge necesita ser un artefacto simple que un técnico de sitio pueda operar. Reevaluable para los hubs (no para los edges).

## Referencias
- Stack actual: `docker-compose.yml` (el edge)
- RBAC multi-unidad ya implementado: `db_scripts/42_notifications_rbac_multitenant.sql`
- Ingesta multi-protocolo (base del edge): `backend/src/mining/protocol_adapters.cpp` (ADR-034)
- Sincronización durable: ADR-008 (Redpanda), ADR-006 (continuous aggregates)
