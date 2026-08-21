# Evaluación Exhaustiva de Perfiles — Expansión Multi-País y Recursos Compartidos
## Operaciones de Campo LATAM: de una unidad a una flota de clientes

**Documento:** PERFILES-CAMPO-EXPANSION-2026-08
**Fecha:** 14 de agosto de 2026
**Clasificación:** Confidencial — Uso interno
**Extiende:** [`Modelo_Perfiles_Operaciones_Campo_Instalacion_Soporte_2026-08-14.md`](Modelo_Perfiles_Operaciones_Campo_Instalacion_Soporte_2026-08-14.md)
**Trigger de negocio declarado:** múltiples unidades mineras en trabajo simultáneo, recursos técnicos compartidos entre proyectos distintos, operación en Perú y en el extranjero, objetivo de expandir a muchos más clientes en LATAM.

---

## 1. Por qué este documento es distinto del anterior

El documento anterior definió 5 perfiles para **una unidad minera operada de forma autónoma**, y dejó una condición explícita de revisión: *"no se recomienda un sexto rol de plataforma — solo reevaluarlo si se atienden más de 5-6 unidades mineras simultáneas."* El negocio confirma que **ese umbral ya se cruzó**: hay muchas unidades simultáneas, los recursos (principalmente instrumentistas) se comparten entre proyectos de clientes distintos, y la operación cruza fronteras.

Esto no es una ampliación cuantitativa de los mismos 5 perfiles — es un **cambio de forma organizativa**: de "un equipo por unidad" a "un pool de especialistas que se despliega entre unidades y países según demanda". Los cinco perfiles de sitio (almacenero, instrumentista, jefe de proyecto, analista QA, admin) **se mantienen sin cambios** — siguen siendo correctos para lo que ocurre dentro de una unidad. Lo que hace falta es la **capa de coordinación por encima de ellos**, que hoy no existe como rol ni como capacidad de plataforma.

## 2. Punto de partida arquitectónico: esto ya estaba previsto

La plataforma tiene una decisión de arquitectura formal para exactamente este escenario: **ADR-035 — "Plataforma enterprise multi-unidad para operaciones mineras LATAM"**, con estado *"propuesto... sigue en F0... a la espera de una decisión de negocio sobre expansión multi-región, no un ADR olvidado."*

ADR-035 define una topología de **3 niveles**:

```
Nivel 1 — EDGE (por unidad minera, on-site)
  Stack autónomo actual: ingesta, alarmas locales, mapas offline, informes.
  Sigue operando 100% si pierde el enlace WAN.
        │  sincronización asíncrona — SOLO agregados/metadatos, nunca crudo transfronterizo
        ▼
Nivel 2 — HUB REGIONAL (por país o cluster de países con misma soberanía)
  Consola multi-unidad, federación de identidad, catálogo corporativo de reglas.
        │  KPIs consolidados + gobierno global
        ▼
Nivel 3 — CORPORATIVO LATAM (global)
  Gobierno de identidad SSO, licenciamiento, observabilidad de la flota de hubs.
```

**Esta es exactamente la respuesta a "recursos compartidos entre proyectos y países"**: el hallazgo de negocio que trae este documento es la señal que ADR-035 pedía para pasar de F0 a F1. El resto de este documento diseña **qué perfiles humanos operan cada nivel** de esa topología — el ADR ya resolvió la arquitectura técnica; faltaba el modelo organizativo, que es lo que se entrega aquí.

## 3. Modelo de 3 niveles — perfiles por capa

### Nivel 1 — Edge / Sitio (sin cambios respecto al documento anterior)

Almacenero, Instrumentista (I/II/III), Jefe de Proyecto, Analista de Calidad, Admin de tenant. Ver documento base. Con una única precisión nueva:

> **El Instrumentista deja de ser homogéneo.** Con recursos compartidos entre proyectos, conviene distinguir dos modalidades dentro del mismo perfil (no dos roles nuevos, dos *atributos de asignación*):
> - **Instrumentista de planta**: asignado de forma estable a una unidad/cliente.
> - **Instrumentista de pool regional (itinerante)**: sin unidad fija, se moviliza entre proyectos según demanda — el modelo que en servicios petroleros se conoce como técnicos operando desde una "base" regional que se despliegan a múltiples sitios (Schlumberger opera así a escala global, con bases que llegan a alojar cientos de técnicos movilizables). Es el perfil que hace viable compartir especialistas caros (comisionamiento, calibración avanzada) entre varios clientes sin que cada uno tenga que contratar uno propio.

### Nivel 2 — Hub Regional (por país o clúster de países) — **capa nueva, requerida ahora**

Esta es la capa que responde directamente a "recursos compartidos entre proyectos distintos" dentro de un mismo país o bloque de soberanía de datos (ADR-035 exige que el hub viva dentro de la frontera del país — ver "soberanía de datos" en ese ADR).

| Rol nuevo | Misión | Por qué es necesario ahora (no antes) |
|---|---|---|
| **Coordinador de Despacho Regional** *(Dispatcher)* | Decide qué instrumentista va a qué unidad, con qué prioridad, dado el pool disponible del país/región. | Con 1-3 unidades, el jefe de proyecto lo absorbía sin fricción. Con múltiples unidades y clientes compitiendo por los mismos técnicos, la asignación deja de ser trivial — es exactamente el rol de *Dispatcher* que ServiceNow y SAP FSM documentan como bisagra entre oficina y campo. |
| **Planificador de Capacidad / Recursos** *(Resource Planner)* | Pronostica demanda de técnicos por proyecto/mes, detecta sobreasignación o tiempo muerto, coordina rotación de personal itinerante entre unidades y países. | Sin este rol, el riesgo típico multi-proyecto es doble: técnicos sobrecargados en un cliente mientras otro espera, o capacidad ociosa que nadie ve hasta el cierre del mes. La práctica de la industria (herramientas de *capacity planning* en FSM) separa este rol del despacho táctico diario. |
| **Gerente de Almacén Regional** | Consolida stock entre los almacenes de sitio de su país/región, gestiona compras centralizadas, coordina importación/aduana de sensores y repuestos que cruzan fronteras. | El almacenero de sitio (Nivel 1) sigue existiendo, pero ya no es autosuficiente: si un repuesto crítico está en la unidad A y se necesita en la unidad B del mismo país, alguien debe decidir el traslado y mantener la trazabilidad de serie consolidada. Es además quien gestiona la aduana cuando el equipo se compra en un país y se instala en otro. |
| **Supervisor Regional de QA/QC** | Estandariza el checklist de comisionamiento y los criterios de calibración entre todas las unidades del país, audita a los analistas QA de sitio. | Con un solo cliente, la calidad la define el analista de sitio directamente. Con muchos clientes, dos analistas QA de sitios distintos pueden aplicar el criterio de forma distinta — este rol evita que la calidad varíe por unidad. |
| **Gerente de Cuenta / Key Account Manager** | Dueño de la relación comercial con el cliente minero — puede ser transversal a varias unidades del mismo grupo minero. Distinto del jefe de proyecto, que es dueño de la *entrega* en una unidad concreta. | La distinción *account manager* (relación, largo plazo, ventas de nuevos contratos) vs. *project manager* (entrega, corto/mediano plazo) es estándar en la industria de servicios una vez que el número de clientes crece — mezclar ambos roles en el jefe de proyecto de sitio no escala cuando el objetivo explícito es "muchos más clientes". |
| **Analista de Centro de Monitoreo Remoto** *(NOC regional)* | Monitorea telemetría y alarmas de todas las unidades del país/región desde un punto centralizado, tríada primero al instrumentista de sitio o al pool regional según severidad. | La plataforma ya construye la base técnica para esto (`notification_routes.cpp`, `device_alarm_routes.cpp`, matriz de canales de notificación) — falta el rol humano que lo opera a escala multi-unidad. Es el patrón de *Remote Operations Center* que ya usan operaciones mineras grandes para cubrir varios sitios con un equipo central de especialistas. |

### Nivel 3 — Corporativo LATAM — **capa a diseñar para la expansión futura**

Necesaria cuando el número de países/hubs crece más allá de uno o dos — es la capa que hace posible "expandir a muchos más clientes en LATAM" sin que cada país reinvente sus propios estándares.

| Rol nuevo | Misión |
|---|---|
| **Director de Operaciones de Campo LATAM** | Dueño end-to-end de la operación de campo a través de todos los hubs/países; consolida KPIs ejecutivos. |
| **Responsable de Formación y Certificación** | Define el estándar único de progresión I/II/III del instrumentista y gestiona qué certificaciones país-específicas (trabajo en altura, espacios confinados, áreas clasificadas/ATEX, eléctrica) requiere cada instrumentista según a qué países se moviliza. Crítico para el modelo de pool itinerante: un técnico certificado en Perú no necesariamente cumple el estándar de otro país. |
| **Responsable de Movilidad y Logística Internacional** | Gestiona visados/permisos de trabajo para instrumentistas que cruzan fronteras, y coordina con los gerentes de almacén regional la importación/exportación de equipos entre países. |
| **Gerente de Calidad Corporativo** | Dueño del estándar maestro de comisionamiento/calibración que cada Supervisor Regional de QA audita localmente — evita que "calidad" signifique algo distinto en cada país. |
| **Steward de Datos Maestros de Activos** | Dueño único del registro de activos (número de serie, historial de calibración) a través de todos los hubs — necesario porque, a diferencia del modelo de una sola unidad, un sensor puede fabricarse, entrar por almacén en un país, y terminar instalado en otro. |
| **Gerente Comercial LATAM / Business Development** | Lidera la expansión a nuevos clientes; los Gerentes de Cuenta (Nivel 2) le reportan funcionalmente. |

## 4. Diagrama y matriz de roles — ver artifact visual

El diagrama de la topología de 3 niveles con flujo de datos, movilidad de recursos entre unidades y roles por capa se entregó como pieza visual actualizada (mismo enlace del documento anterior).

## 5. Qué es "ahora" y qué es "futuro"

| Rol | Estado |
|---|---|
| Coordinador de Despacho Regional | **Ahora** — el umbral que lo justificaba ya se cruzó según lo declarado por el negocio |
| Planificador de Capacidad / Recursos | **Ahora** — directamente ligado a "recursos compartidos entre proyectos distintos" |
| Gerente de Almacén Regional | **Ahora** — directamente ligado a operación en Perú y en el extranjero (cruce de fronteras de equipo) |
| Supervisor Regional de QA/QC | **Ahora**, si ya hay más de un cliente en el mismo país |
| Analista de Centro de Monitoreo Remoto | **Ahora si el volumen de alarmas/unidades ya no es monitoreable por sitio individual; futuro cercano en caso contrario** |
| Gerente de Cuenta / Key Account Manager | **Futuro inmediato** — se activa en cuanto el objetivo de "muchos más clientes" empiece a ejecutarse, no hace falta esperar a tener los clientes primero |
| Director de Operaciones de Campo LATAM | **Futuro** — con 2+ hubs regionales operando |
| Formación y Certificación / Movilidad Internacional / Calidad Corporativa / Datos Maestros | **Futuro** — se activan junto con la expansión a un segundo país, no antes |

## 6. La brecha de plataforma que este modelo expone

Esto es lo más importante para Gerencia TI: **el RBAC actual (7 roles) es estrictamente por-tenant (por unidad minera)**. No existe hoy un rol ni un alcance "regional" o "corporativo" en el esquema — `auth_user_tenant` solo modela pertenencia unidad por unidad (ADR-035, ADR-038).

Esto significa que, con la arquitectura de hoy, un Coordinador de Despacho Regional o un Gerente de Cuenta que necesite ver 8 unidades **tendría que recibir membresía individual en cada una de las 8**, una por una, exactamente como ADR-038 ya documentó como su propio trade-off conocido: *"un admin que necesita delegar acceso a varias unidades debe cambiar su tenant activo repetidamente... queda como mejora futura si el volumen de operaciones multi-unidad lo justifica."*

**Ese volumen ya existe.** Las dos vías posibles:

1. **Corto plazo (sin cambios de plataforma):** operar los roles de Nivel 2/3 con membresía multi-tenant manual (ADR-038 tal cual existe hoy). Funciona, pero no escala bien pasadas ~10-15 unidades por coordinador.
2. **Estructural (recomendado):** iniciar la **Fase F1 de ADR-035** — hub regional con consola multi-unidad de solo lectura y agregados vía Redpanda/continuous aggregates, que es justamente la pieza de plataforma que los roles de Nivel 2 de este documento necesitan para operar sin fricción. ADR-035 ya deja dicho que esta fase "no requiere reescribir el edge" — es la extensión natural, no un proyecto nuevo desde cero.

## 7. Recomendaciones

1. **Formalizar el Coordinador de Despacho Regional y el Planificador de Capacidad ahora**, como funciones organizativas — no requieren esperar cambios de plataforma, pueden operar con las herramientas actuales (multi-tenant manual) mientras se decide sobre ADR-035 F1.
2. **Elevar ADR-035 de "propuesto" a una decisión formal de negocio.** El propio ADR señala que solo le falta esa decisión para pasar a F1 — este documento es, en la práctica, la justificación de negocio que faltaba.
3. **Diseñar la matriz de habilidades/certificaciones del instrumentista de pool regional** antes de mover técnicos entre países — es el prerrequisito operativo (y potencialmente legal) para la movilidad internacional.
4. **No crear el Nivel 3 (Corporativo LATAM) todavía si solo Perú está activo hoy.** Diseñarlo ahora, activarlo con el segundo país/hub — coherente con el rollout incremental que ADR-035 ya define (F1 Perú → F3 segundo país → F4 corporativo).
5. **Registrar esta evaluación como insumo directo para retomar ADR-035**, referenciándola en ese documento cuando se decida iniciar F1.

## 8. Fuentes consultadas (adicionales a las del documento base)

- [Remote operating centers in mining: Unlocking their full potential — McKinsey](https://www.mckinsey.com/industries/metals-and-mining/our-insights/remote-operating-centers-in-mining-unlocking-their-full-potential)
- [Remote Operations Centres Transform Mining Workforce Models](https://minermundo.com/blog/remote-operations-centres-mining/)
- [Field Service Skills Management — FieldProxy](https://www.fieldproxy.ai/resources/blog/field-service-skills-management)
- [Resource Capacity Planning — Visual Planning](https://www.visual-planning.com/en/blog/resource-capacity-planning)
- [How to Plan Resources for Multiple Projects — Epicflow](https://www.epicflow.com/blog/managing-resources-in-a-multi-project-environment-common-challenges-and-ways-to-solve-them/)
- [Hub-and-Spoke model on the global service delivery market](https://www.academia.edu/10677916/Hub_and_Spoke_model_on_the_global_service_delivery_market)
- [The World's Next Top Model? — SSON](https://www.ssonetwork.com/shared-services/articles/the-world-s-next-top-model)
- [Account Manager vs. Project Manager — Workamajig](https://www.workamajig.com/blog/account-manager-vs-project-manager)
- [Schlumberger — overview / base model — ScienceDirect](https://www.sciencedirect.com/topics/engineering/schlumberger)
- [Top energy staffing firms: global mobility, rotational staffing, credential tracking — MSH Talent](https://www.talentmsh.com/insights/best-oil-gas-recruitment-firms)

### Referencias internas
- ADR-035 — Plataforma enterprise multi-unidad para operaciones mineras LATAM (`docs/decisions/035-plataforma-enterprise-latam.md`) — pieza central de este documento
- ADR-038 — Delegación de acceso multitenant escopeada al tenant activo del emisor (`docs/decisions/038-delegacion-acceso-tenant-activo-emisor.md`) — mecanismo actual de acceso multi-unidad y su límite conocido
- ADR-075 — País e idioma determinan la interfaz de acceso (`docs/decisions/075-internacionalizacion-pais-idioma-acceso.md`) — validación fiscal/regulatoria ya diferenciada por país, base para el rol de Cumplimiento Regional
- ADR-030 — Auditoría 100% de acciones — aplica igual a las acciones de los roles de Nivel 2/3
- `backend/src/mining/notification_routes.cpp`, `backend/src/mining/device_alarm_routes.cpp` — base técnica ya existente para el Analista de Centro de Monitoreo Remoto
- Documento base: `Modelo_Perfiles_Operaciones_Campo_Instalacion_Soporte_2026-08-14.md`
