# Modelo de Perfiles de Usuario — Operaciones de Campo LATAM
## Instalación, Mantenimiento, Reparación, Configuración y Calibración de Sensores de Telemetría Minera

**Documento:** PERFILES-CAMPO-2026-08
**Fecha:** 14 de agosto de 2026
**Clasificación:** Confidencial — Uso interno
**Alcance:** Perú y proyectos de automatización minera LATAM
**Preparado para:** Gerencia TI / Gerencia de Operaciones de Campo

---

## 1. Objetivo

Definir, con base en investigación de plataformas de gestión de servicio de campo (Field Service Management — FSM), estándares de gestión de activos (ISO 55001) y prácticas documentadas de integradores mineros (ABB, Hexagon Mining, Modular Mining) y de empresas mineras peruanas, un **modelo de perfiles de usuario** para el área que ejecuta instalación, mantenimiento, reparación, configuración y calibración de equipos sensores de telemetría minera en campo — cubriendo **todo el ciclo, desde la recepción de la mercadería en almacén hasta el cierre documental en el ERP**.

Este modelo parte de los 5 perfiles ya identificados por el negocio (instrumentista, almacenero, jefe de proyecto, analista/supervisor de calidad, admin), los valida contra la práctica de la industria, y los conecta explícitamente con el **RBAC de 7 roles ya implementado en la plataforma** (`admin`, `manager`, `supervisor`, `geologist`, `safety`, `operator`, `viewer` — ver [`roleConstants.ts`](../../frontend/src/auth/roleConstants.ts) y ADR-036/ADR-063), para que el diseño sea accionable y no quede como un esquema paralelo desconectado del sistema.

## 2. Metodología

Investigación en tres frentes:

1. **Plataformas FSM/EAM de referencia**: ServiceNow Field Service Management, SAP Field Service Management, IBM Maximo (Manage) — cómo modelan roles de técnico, despachador, planificador, supervisor y almacén/repuestos, y cómo integran con ERP.
2. **Estándares de gestión de activos y servicio**: ISO 55001 (ciclo de vida de activos), y prácticas de comisionamiento/QC de instrumentación industrial (loop checks, punch lists, certificados de calibración).
3. **Práctica del sector minero**: descripciones de puesto públicas de integradores (ABB Ability, Hexagon Mining, Modular Mining Systems) y de operaciones mineras peruanas (avisos de almacenero, instrumentista, jefe/supervisor de campo en Volcan, Las Bambas y otras, vía Indeed Perú, Bumeran, Enlace Talento, Computrabajo).

Fuentes citadas al final de cada sección relevante y consolidadas en la sección 9.

## 3. Cadena de valor de campo (end-to-end)

El patrón que se repite en todas las fuentes consultadas — FSM comercial (ServiceNow, SAP), EAM (Maximo) y las propias ofertas laborales mineras peruanas — es el mismo ciclo de 8 etapas, con una diferencia de fondo respecto a un FSM genérico: en telemetría minera **el activo instalado queda bajo trazabilidad de por vida** (número de serie, certificado de calibración, historial de mantenimiento), por lo que la cadena de custodia debe empezar en el almacén, no en el despacho del técnico.

```
 1. RECEPCIÓN         2. ALTA EN          3. PLANIFICACIÓN      4. DESPACHO
    de mercadería   →     INVENTARIO    →     y armado de     →    a campo /
    (sensor, repuesto,    (kardex,            kit por OT           unidad minera
    accesorio)             n° de serie)        (orden de trabajo)

 5. EJECUCIÓN EN       6. CONTROL DE        7. CIERRE            8. CIERRE DE OT
    CAMPO            →    CALIDAD         →    DOCUMENTAL      →    y devolución de
    (instalación/          (checklist de       + carga a ERP        material sobrante
    mantenimiento/          comisionamiento,    (evidencia,          al almacén
    reparación/             loop check,         firma digital)       (ciclo cerrado)
    configuración/          punch list)
    calibración)
```

Este ciclo coincide con lo que describen SAP FSM e IBM Maximo: *"technicians receive assignments, access asset history, record time and materials, and close work orders"* (SAP), y en Maximo la planificación es un rol dedicado — *"el Planner conoce el trabajo lo suficiente para estimar mano de obra y materiales, y tiene acceso al almacén y sabe qué hay en stock"* — lo cual valida que **almacén y planificación de campo no pueden estar desacoplados**: es la misma razón por la que el negocio identificó al almacenero como punto de partida del proceso.

## 4. Benchmark de roles — qué modela cada referencia

| Referencia | Rol equivalente a "almacenero" | Rol equivalente a "instrumentista" | Rol equivalente a "jefe de proyecto" | Rol equivalente a "analista/QA" | Notas relevantes |
|---|---|---|---|---|---|
| **ServiceNow FSM** | Inventory/Parts management (dentro del rol de Dispatcher o Technician) | Field Technician | Field Service Manager / Dispatcher | — (integrado en cierre de orden) | El *Dispatcher* es el rol bisagra entre oficina y campo — asigna técnico según ubicación, habilidad y disponibilidad |
| **SAP FSM** | Warehouse/parts (integración con ERP) | Technician (con acceso offline) | Dispatcher (tablero gráfico de planificación) | Cierre automatizado con carga a ERP | *"Con integración a ERP, conecta toda la cadena de valor para la gestión inteligente y proactiva del ciclo de vida completo de los activos físicos"* |
| **IBM Maximo (Manage)** | Storeroom clerk (control de stock, kardex) | Technician (labor, materiales, notas de cierre) | Planner + Supervisor (dos roles separados) | Supervisor aprueba trabajo planificado | Maximo separa **Planner** (estima mano de obra/materiales, conoce el almacén) de **Supervisor** (aprueba y da visibilidad de carga de equipo) — útil si el jefe de proyecto termina sobrecargado con ambas funciones |
| **ISO 55001** | — (gestión de inventario como parte del ciclo de vida del activo) | Rol de ejecución de mantenimiento dentro del SAMP (Plan Estratégico de Gestión de Activos) | Rol de gobierno/aseguramiento del sistema de gestión de activos | Aseguramiento de que el activo cumple su función a lo largo del ciclo de vida | Marco de *costo-riesgo-desempeño*, útil para justificar KPIs por rol (sección 8) |
| **Integradores mineros (ABB Ability, Hexagon, Modular Mining)** | No documentado públicamente en detalle (procesos internos) | Técnico de campo / ingeniero de comisionamiento — ABB reporta comisionamiento remoto asistido (HoloLens) desde España para una mina en Kazajistán | Ingeniería y consultoría de mina (mine design/engineering services) | Integrado en sus sistemas de gestión de operaciones (ABB Ability OMS) | Confirma que comisionamiento remoto/híbrido (experto senior + técnico en sitio) es ya práctica de la industria — relevante para LATAM por distancia entre unidades mineras |
| **Avisos laborales Perú (Volcan, SMCV, otras — Indeed/Bumeran/Enlace Talento)** | Almacenero: recepciona mercadería, verifica guías, registra en sistema, controla kardex, ejecuta inventarios mensuales, aplica 5S | Técnico instrumentista: instalación/calibración de instrumentación de proceso, SCADA, redes industriales, IIoT | Jefe/Supervisor de campo: supervisa y coordina ejecución en campo, gestiona personal operativo, da seguimiento a cronogramas | (No se encontró aviso específico "analista de calidad de campo" — es un rol interno, no de mercado externo) | Confirma que los 5 perfiles del negocio **sí son roles reales y buscados activamente en el mercado peruano**, no una invención interna |

## 5. Modelo propuesto — 5 perfiles + 1 función crítica de bisagra

Se valida el modelo de 5 perfiles del negocio y se agrega una recomendación: **la función de despacho/coordinación** (equivalente al *Dispatcher* de ServiceNow/SAP) que en el mercado peruano suele absorber el almacenero en operaciones pequeñas, pero que en proyectos multi-unidad LATAM conviene modelar como una *responsabilidad explícita* del almacenero senior o del jefe de proyecto — no como un sexto perfil nuevo, para no fragmentar el RBAC ya en 7 roles.

### 5.1 Almacenero (Recepción, Custodia y Despacho de Campo)

- **Misión**: ser el punto de entrada y de trazabilidad física de todo sensor, repuesto o accesorio que ingresa al servicio, desde la guía de remisión del proveedor hasta el kit despachado a la unidad minera.
- **Responsabilidades** (confirmadas por avisos laborales peruanos y por el patrón *Storeroom/Warehouse* de Maximo/SAP FSM):
  - Recepcionar mercadería, verificar guías de remisión y hacer inspección de ingreso (cantidad, estado físico, número de serie/lote).
  - Registrar el alta en kardex/inventario, incluyendo el número de serie del sensor (clave para la trazabilidad de calibración de por vida).
  - Atender solicitudes de repuestos/insumos por orden de trabajo (OT), armar el kit de despacho según lo que planifique el jefe de proyecto.
  - Embalar, rotular y coordinar el traslado a la unidad minera (propio o courier a taller externo si el equipo requiere reparación en banco).
  - Ejecutar inventarios periódicos (mensual) y aplicar 5S en almacén.
  - Recepcionar y dar de baja/reingresar el material sobrante o retirado al cierre de la OT (cierra el ciclo de la sección 3).
- **Sistemas**: módulo de inventario/kardex, escaneo de número de serie, generación de guías de despacho.
- **Mapeo RBAC de plataforma**: `operator` (ejecución operativa sin gestión de usuarios ni configuración de tenant) — puede requerir un permiso específico de `inventario.manage` si se modela como módulo nuevo (ver sección 7).

### 5.2 Instrumentista de Campo (Instalación, Mantenimiento, Reparación, Configuración, Calibración)

- **Misión**: ejecutar en sitio el trabajo técnico sobre el sensor/equipo de telemetría — es el rol de ejecución pura, equivalente al *Field Technician* en toda la literatura FSM consultada.
- **Responsabilidades** (consistentes entre ServiceNow, SAP, avisos de Indeed/CareerMine para minería):
  - Instalación y calibración de instrumentación de campo y de banco (transmisores, sensores de proceso, controladores).
  - Diagnóstico y reparación de fallas; mantenimiento preventivo, predictivo y correctivo.
  - Configuración de parámetros de comunicación/red industrial (IIoT, SCADA) del sensor.
  - Uso de planos P&ID, hojas de datos del instrumento y manuales de fabricante como referencia de instalación.
  - Documentación de campo: reporte de trabajo, evidencia fotográfica, solicitud de repuestos.
  - Acceso *offline* al historial del activo y a la orden de trabajo — funcionalidad estándar en SAP FSM y ya cubierta arquitectónicamente en la plataforma por el modo offline con cola versionada en IndexedDB (ADR-022, ADR-045).
- **Niveles de madurez** (career ladder documentado en la industria — Utilities Field Technician I-III, Field Service Technician I-IV):
  | Nivel | Alcance típico | Experiencia |
  |---|---|---|
  | Instrumentista I (junior) | Instalación estándar, calibración simple bajo supervisión | Entrada / < 2 años |
  | Instrumentista II | Diagnóstico y reparación autónoma, calibración compleja | 2-5 años |
  | Instrumentista III (senior) | Comisionamiento, casos no estándar, mentoría de niveles I-II, apoyo remoto a otras unidades | > 5 años |
- **Sistemas**: app de campo (modo offline), checklist digital de calibración con evidencia, escaneo de número de serie del activo.
- **Mapeo RBAC de plataforma**: `operator` (nivel I-II) → `supervisor` (nivel III, si además valida/aprueba trabajo de otros instrumentistas en su unidad).

### 5.3 Jefe de Proyecto (Site Lead / Supervisor de Campo)

- **Misión**: planificar, coordinar y ser responsable ante el cliente minero de la ejecución completa en la unidad — el punto de escalamiento entre campo y oficina.
- **Responsabilidades** (confirmadas por avisos peruanos de "Jefe/Supervisor de Campo — Minería" y por el rol *Planner + Supervisor* de Maximo):
  - Planificación de la OT: qué se instala/mantiene/repara, con qué kit de materiales, en qué ventana de trabajo — función de *Planner* (Maximo) que en operaciones LATAM de tamaño medio suele recaer en el jefe de proyecto en vez de un rol separado.
  - Coordinación y supervisión del personal operativo (instrumentistas) en sitio.
  - Seguimiento de cronograma, gestión de riesgos y coordinación con el cliente (permisos de acceso a mina, protocolos HSE del sitio).
  - Aprobación de trabajo ejecutado antes de pasar a control de calidad (función *Supervisor* de Maximo: *"team workload, overdue work, status visibility, approval actions"*).
  - Gestión del cierre de la OT y devolución de material sobrante a almacén.
- **Nota de diseño**: si el volumen de proyectos crece, Maximo recomienda separar *Planner* de *Supervisor*; para el tamaño actual del negocio se recomienda mantenerlos unificados en "Jefe de Proyecto" y solo separar si un jefe de proyecto termina gestionando más de ~3-4 instrumentistas o más de una unidad minera simultánea.
- **Mapeo RBAC de plataforma**: `supervisor` (ya modelado como "Supervisor / Jefe" en `roleConstants.ts` — coincide exactamente con el perfil).

### 5.4 Analista / Supervisor de Calidad (QA-QC y Cierre a ERP)

- **Misión**: el "último control humano en oficina" antes de que el trabajo de campo se considere formalmente cerrado — verifica que la evidencia técnica sea correcta y completa, y sube los datos al ERP.
- **Responsabilidades** (consistentes con el rol de *QA/QC Inspector* de instrumentación industrial documentado en fuentes de comisionamiento):
  - Revisión de punch list / checklist de comisionamiento (loop checks, certificados de calibración, terminaciones, pruebas de continuidad) contra lo reportado por el instrumentista en campo.
  - Validación de evidencia fotográfica y firma digital del cierre de OT.
  - Carga de resultados al ERP corporativo (el "puente" entre el sistema de campo y el sistema administrativo/financiero) — coincide con el patrón *"automated delivery of ... uploads to other systems"* de SAP FSM.
  - Trazabilidad de no conformidades (ítems de punch list abiertos) hasta su cierre.
- **Nota importante de gobierno de datos**: dado que este rol sube datos al ERP, conviene que sus acciones queden auditadas igual que el resto de la plataforma (ADR-030, auditoría de 100% de acciones) — la carga a ERP debería registrarse como evento auditable, no como una exportación manual sin trazo.
- **Mapeo RBAC de plataforma**: `geologist` o `safety` no encajan (son roles de dominio técnico/HSE); el ajuste más cercano es un `supervisor` con alcance de solo-lectura sobre ejecución de campo + permiso de escritura sobre cierre/QC, **o** formalizar más adelante como octavo permiso granular (`qa.close`, `erp.export`) dentro del `role_permissions` existente en vez de un rol nuevo — el sistema ya soporta permisos granulares por rol vía `role_permissions` (ver `backend/src/auth/permissions.cpp`), así que no requiere modificar el CHECK de 7 roles.

### 5.5 Admin

- **Misión**: administración de usuarios, tenants, y configuración de la plataforma para el área de campo — sin ejecutar trabajo operativo.
- **Mapeo RBAC de plataforma**: `admin` (ya es el rol de mayor privilegio, con bypass explícito de permisos en `hasPermission()` — ver `permissions.cpp:80`).

### 5.6 Función de bisagra: Despacho/Coordinación (no es un rol nuevo)

Toda referencia FSM comercial (ServiceNow, SAP) modela un **Dispatcher** como rol separado del técnico y del almacén — la persona que decide *qué técnico va a qué sitio, con qué prioridad*. En el mercado peruano esta función normalmente no aparece como puesto independiente en operaciones de este tamaño: la absorbe el jefe de proyecto (si es una sola unidad) o un almacenero senior con visión de todas las OT abiertas (si son varias unidades pequeñas). **Recomendación**: no crear un sexto perfil ahora; dejarlo documentado como una *responsabilidad* que se reevalúa como rol propio solo si el número de unidades mineras atendidas simultáneamente supera un umbral operativo (p. ej. más de 5-6 unidades activas a la vez), momento en el que sí conviene separarlo — igual que Maximo recomienda separar Planner de Supervisor solo cuando el volumen lo justifica.

## 6. Matriz RACI — perfiles × etapas del ciclo

| Etapa | Almacenero | Instrumentista | Jefe de Proyecto | Analista QA/Cierre | Admin |
|---|---|---|---|---|---|
| 1. Recepción de mercadería | **R/A** | I | I | — | — |
| 2. Alta en inventario (kardex, n° serie) | **R/A** | — | C | — | — |
| 3. Planificación / armado de kit por OT | C | I | **R/A** | — | — |
| 4. Despacho a campo | **R** | I | **A** | — | — |
| 5. Ejecución en campo | I | **R** | **A** | — | — |
| 6. Control de calidad (checklist, loop check) | — | C | C | **R/A** | — |
| 7. Cierre documental + carga a ERP | I | I | C | **R/A** | — |
| 8. Cierre de OT y devolución de material | **R** | I | **A** | I | — |
| Administración de usuarios y roles | — | — | — | — | **R/A** |

*(R = Responsable de ejecutar, A = Aprueba/rinde cuentas, C = Consultado, I = Informado)*

## 7. Mapeo a la plataforma existente

La plataforma ya implementa un RBAC de 7 roles unificados (ADR-036, corregido en ADR-063), con permisos granulares por rol vía `role_permissions` (override por tenant soportado desde `db_scripts/42` y `db_scripts/43`). El modelo de campo **no requiere un octavo rol ni romper el `CHECK` de 7 roles** — se resuelve así:

| Perfil de campo | Rol de plataforma (`roleConstants.ts`) | Justificación |
|---|---|---|
| Almacenero | `operator` | Ejecución operativa, sin gestión de usuarios ni configuración |
| Instrumentista I-II | `operator` | Igual — el nivel de seniority es un dato del perfil, no un rol distinto |
| Instrumentista III (senior) | `operator` con permisos extendidos, o `supervisor` si valida trabajo de otros | A definir según si en la práctica aprueba trabajo ajeno |
| Jefe de Proyecto | `supervisor` | Coincide 1:1 con la etiqueta ya existente "Supervisor / Jefe" |
| Analista QA / Cierre ERP | `supervisor` con permisos granulares de solo-QC, o permiso nuevo `qa.close`/`erp.export` sobre rol existente | No amerita rol nuevo; usar el mecanismo de permisos granulares ya construido |
| Admin | `admin` | Directo |

Esto evita repetir el problema que motivó ADR-036/ADR-063 (taxonomías divergentes entre frontend y backend): en vez de crear una segunda lista de "roles de campo" paralela a `USER_ROLES`/`ADMIN_ASSIGNABLE_ROLES`, el nivel de seniority y la función de campo se modelan como **atributos del perfil de usuario** (p. ej. `fieldLevel: "I"|"II"|"III"`, `fieldFunction: "warehouse"|"instrumentation"|"site_lead"|"qa"`) dentro del rol de plataforma que ya le corresponde, y los permisos finos se resuelven vía `role_permissions` por tenant — mecanismo que el sistema ya soporta sin cambios de esquema.

## 8. Trazabilidad y evidencia — qué debería registrar cada etapa

Consistente con la exigencia de auditoría al 100% ya decidida para la plataforma (ADR-030) y con la práctica de comisionamiento de instrumentación (loop checks, certificados de calibración como evidencia obligatoria):

| Etapa | Evidencia mínima recomendada |
|---|---|
| Recepción | Guía de remisión, fotos del estado de ingreso, número de serie |
| Despacho | Kit despachado (lista de ítems + n° de serie) vinculado a la OT |
| Ejecución en campo | Fotos antes/después, checklist de calibración firmado, GPS/geolocalización del punto de instalación (la plataforma ya tiene bloque de mapa georreferenciado, ADR-020) |
| Control de calidad | Punch list con estado de cada ítem (abierto/cerrado), certificado de calibración |
| Cierre a ERP | Evento auditable de exportación (quién, cuándo, qué OT), no una carga manual sin trazo |

## 9. Recomendaciones de siguiente paso

1. **No crear un octavo rol de plataforma.** Usar los 7 roles ya existentes + atributos de perfil (función de campo, nivel de seniority) + permisos granulares por `role_permissions`.
2. **Modelar la Orden de Trabajo (OT) de campo como entidad propia** (hoy la plataforma tiene `reports`, `Project`, telemetría — no hay un objeto "OT de instalación/mantenimiento" con estados recepción→despacho→ejecución→QC→cierre). Esto probablemente amerita un ADR nuevo si se decide construir el módulo.
3. **Extender el inventario con número de serie por sensor** como clave de trazabilidad de calibración de por vida — insumo directo para el módulo de telemetría ya existente (`backend/src/mining/sensor_service.*`).
4. **Definir KPIs por perfil** (ejemplo, alineado a los KPIs de plataforma ya definidos en el SOW maestro): tiempo recepción→despacho, % de calibraciones con certificado completo al primer intento, tiempo de cierre de OT desde ejecución hasta carga a ERP, ítems de punch list reabiertos.
5. **Revisar el umbral de "Despacho/Coordinación" como rol propio** cuando el número de unidades mineras atendidas simultáneamente lo justifique (sección 5.6).

## 10. Fuentes consultadas

- [What is a Field Technician? — ServiceNow](https://www.servicenow.com/products/field-service-management/what-is-field-technician.html)
- [Field Service Team: Key Roles & Responsibilities — FieldProxy](https://www.fieldproxy.ai/resources/blog/roles-and-responsibilities-of-a-field-team)
- [What Is Field Service Dispatching? — NetSuite](https://www.netsuite.com/portal/resource/articles/erp/field-service-dispatching.shtml)
- [Work Order Role-Based Applications in IBM Maximo — Naviam](https://www.naviam.io/resources/blog/work-order-role-based-applications-in-ibm-maximo)
- [How to Plan a Work Order in Maximo — MaximoMastery](https://maximomastery.com/blog/2026/03/how-to-plan-a-work-order-in-maximo/)
- [Role-Based Applications – Technician — Maximo Secrets](https://maximosecrets.com/2024/01/18/role-based-applications-technician-3/)
- [SAP Field Service and Asset Management](https://www.sap.com/products/scm/field-service-and-asset-management.html)
- [What is field service management (FSM)? — SAP](https://www.sap.com/products/scm/field-service-management/what-is-field-service-management.html)
- [ISO 55001:2024 — Asset management](https://www.iso.org/standard/83054.html)
- [Yuman — ISO 55001 & asset management](https://www.yuman.io/en/blog-post/433-iso-55001-asset-management-structuring-your-maintenance-strategy/)
- [ABB: Trends in mining for 2022 — Mining Magazine](https://www.miningmagazine.com/environment/opinion/1426845/abb-trends-mining-2022)
- [ABB Ability Operations Management System for mining](https://new.abb.com/mining/digital-applications/operations-management-system-oms-for-mining)
- [Modular Mining Systems — Wikipedia](https://en.wikipedia.org/wiki/Modular_Mining_Systems)
- [Instrumentation Technician Mining — Indeed](https://ca.indeed.com/q-instrumentation-technician-mining-jobs.html)
- [Mining Needs You — Instrumentation Technician](https://miningneedsyou.ca/career/instrumentation-technician)
- [INSTRUMENT QA QC INSPECTOR — SlideShare](https://slideshare.net/ReguMkc/instrument-qa-qc-inspector-57950112)
- [Utilities Field Technician I-III Career Path](https://www.governmentjobs.com/jobs/4873585-0/utilities-field-technician-i-iii-career-path)
- [Field Service Technician III Job Description — Salary.com](https://www.salary.com/research/job-description/benchmark/field-service-technician-iii-job-description)
- [Perfil de Puesto: Almacenero — gob.pe](https://cdn.www.gob.pe/uploads/document/file/6212972/5475133-4-perfil-de-puesto-almacenero-a.pdf)
- [Descripción del Puesto: Almacenero — Studocu](https://www.studocu.com/pe/document/universidad-de-lima/derecho-romano/descripcion-del-puesto-almacenero-manual-de-organizacion-y-funciones/153427202)
- [Trabajos de Almacenero — SMCV, Computrabajo](https://pe.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-almacenero-smcv-en-arequipa-028F0331A3783F1A61373E686DCF3405)
- [ENLACE TALENTO: Jefe/Supervisor de Campo — Minería](https://enlacetalento.com/Home/BolsaTrabajoDetalle?OfertaLaboralId=12006)
- [Supervisor TI de Automatización — Minera Volcan](https://www.empleosmineria.pe/oferta-supervisor-automatizacion-minera-volcan-2045)
- [Responsibility assignment matrix (RACI) — Wikipedia](https://en.wikipedia.org/wiki/Responsibility_assignment_matrix)

### Referencias internas
- [`frontend/src/auth/roleConstants.ts`](../../frontend/src/auth/roleConstants.ts) — fuente de verdad de los 7 roles de plataforma
- [`backend/src/auth/permissions.cpp`](../../backend/src/auth/permissions.cpp) — resolución de rol efectivo y permisos granulares por tenant
- ADR-029 (identidad de plataforma / RBAC + JWT), ADR-035 (RBAC por tenant), ADR-036 (7 roles unificados), ADR-063 (corrección de roles asignables), ADR-030 (auditoría 100% de acciones), ADR-022/ADR-045 (modo offline de campo)
