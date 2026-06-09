# Aviso de convocatoria — LinkedIn
## Backend Senior · Arquitecto de Datos y Núcleo de Plataforma

> **Uso:** Publicar en LinkedIn. Texto genérico: sin ubicación de infraestructura, proveedores ni detalles de implementación. Enfoque **industrial** (no sector minero).

---

## Confirmación interna (no publicar en LinkedIn)

### ¿La trazabilidad forma parte de Industria 4.0 y 5.0?

**Sí.** En ambos marcos es un requisito transversal, aunque con distinto énfasis:

| Marco | Rol de la trazabilidad |
|-------|------------------------|
| **Industria 4.0** | Integración de datos de planta, identificación de activos y procesos, trazabilidad de producto y operación, auditoría de eventos, interoperabilidad (p. ej. **OPC UA**) y evidencia para calidad y cumplimiento. |
| **Industria 5.0** | Mantiene la trazabilidad digital y añade foco en resiliencia, gobernanza de datos, supervisión humana y decisiones auditables en entornos colaborativos humano–máquina. |

En **este proyecto** la trazabilidad **sí está considerada e implementada** a nivel de plataforma: bitácoras de plataforma, auditoría de autenticación, registro de acciones sensibles en documentos, contexto de sesión por transacción y refuerzo en migraciones de esquema (sin publicar nombres técnicos en el aviso).

### ¿Reconocimiento y validación biométrica están considerados?

**Sí.** El alcance del producto incluye identidad con **plantillas faciales**, auditoría de eventos de autenticación y uso de validación biométrica en **acciones sensibles** (acceso y operaciones críticas sobre informes). En el aviso se menciona de forma genérica; el candidato Senior debe poder **modelar datos y auditoría** que soporten esos flujos, en coordinación con el equipo de seguridad.

---

## Texto para publicar (copiar desde aquí)

---

**🔹 Convocatoria abierta: Arquitecto de Datos / Backend Senior — Plataforma industrial de monitoreo y reportabilidad**

Organización del sector **industrial** busca un profesional **SENIOR** para liderar la **capa de datos y el núcleo de servicios** de una plataforma web enterprise en construcción: monitoreo operativo, telemetría, documentación técnica, alarmas y continuidad en entornos con conectividad limitada.

**Nivel requerido:** Senior (8+ años). No se evaluarán perfiles semi-senior o junior.  
**Duración:** Proyecto de implementación (~6 meses), dedicación alta.  
**Modalidad:** Remoto / híbrido (coordinación con equipo técnico y usuarios de operación).

---

### 🎯 Misión del rol

Garantizar que la **arquitectura de datos y la persistencia** soporten de forma confiable:

- Monitoreo avanzado de activos y variables operativas en contexto **Industria 4.0 / 5.0**.
- Integración con **sistemas de telemetría y automatización industrial** ya existentes (extracción, transformación y sincronización continua).
- **Trazabilidad end-to-end**: quién hizo qué, cuándo y sobre qué activo o documento, con evidencia auditable.
- Operación **sin conexión estable**: almacenamiento temporal en el cliente, cola de cambios y reconciliación al restablecer la comunicación con el servidor central.
- Soporte a **identidad y validación biométrica** en flujos de acceso y acciones sensibles, con registro auditable de eventos.
- Cumplimiento de buenas prácticas alineadas a **estándares y certificaciones de software** (enfoque ISO: calidad, seguridad de la información y ciclo de vida del producto).

---

### 🛠️ Responsabilidades

**Diseño e implementación de bases de datos**

- Modelar esquemas transaccionales y de series temporales para telemetría, usuarios, documentos operativos, alarmas y configuración multiempresa.
- Incorporar **trazabilidad** en el modelo de datos (auditoría, versionado, acciones críticas, correlación usuario–sesión–entidad).
- Definir partición, retención, índices, búsqueda de contenido y rendimiento bajo carga sostenida.
- Documentar modelo de datos, contratos de integración y criterios de calidad de la información.

**Integración industrial y sincronización**

- Diseñar pipelines **ETL/ELT** (carga masiva, incremental y continua) desde plataformas IoT/SCADA/MES hacia el repositorio central.
- Conocimiento práctico de conectividad industrial (**OPC UA** y/o protocolos complementarios según el entorno del cliente).
- Gestionar conectividad segura, marcas de agua, idempotencia, reintentos y monitoreo de rezagos.
- Asegurar coherencia entre fuentes externas y el modelo operativo de la nueva plataforma.

**Servicios de núcleo y APIs de datos**

- Implementar y mantener servicios backend de alto rendimiento conectados al motor de base de datos (pool de conexiones, APIs REST y canales en tiempo real).
- Exponer capacidades de documentos, versionado, flujos de aprobación, plantillas, adjuntos y consultas operativas.
- Colaborar con frontend, seguridad, integraciones y arquitectura; **liderazgo en datos y persistencia**.

**Continuidad operativa y DevOps de datos**

- Administración de servidores **Linux** y despliegues contenedorizados del entorno de datos.
- **Backups**, restauración probada, recuperación ante desastres y simulacros documentados.
- **Pruebas de esfuerzo** y validación de capacidad del motor de base de datos.
- **Migraciones** versionadas entre entornos y repositorios lógicos de la plataforma.
- Runbooks: monitoreo, alertas, espacio, rendimiento y escalamiento.

**Operación offline**

- Estrategia de persistencia local en aplicaciones web para zonas sin red.
- Conservación segura de cambios y reconciliación al reconectar, sin pérdida ni conflictos no controlados.

**Trabajo colaborativo en equipo (transversal)**

- Uso diario de **Git** (ramas, merge requests, revisión de cambios, convenciones de commits).
- Seguimiento de tareas, dependencias y capacidad en **ClickUp** (o herramienta equivalente de gestión ágil).
- Participación en ceremonias: planning, dailies, reviews, retrospectivas.
- Documentación colaborativa de decisiones, runbooks y matrices de trazabilidad requisito–dato.
- Comunicación clara con perfiles de arquitectura, frontend, QA, PMO y usuarios de negocio.

---

### ✅ Requisitos obligatorios

| Área | Detalle |
|------|---------|
| Experiencia | 8+ años en backend y arquitectura de datos; 5+ años con motor relacional en producción |
| Base de datos | PostgreSQL avanzado (modelado, JSON, auditoría, replicación, backup/restore, tuning) |
| Industrial | Proyectos en manufactura, energía, utilities, oil & gas, logística o plantas automatizadas |
| Industria 4.0 / 5.0 | Integración de datos de planta, trazabilidad operativa y gobierno de la información |
| Conectividad | **OPC UA** (cliente/servidor, mapeo de tags, sincronización con sistemas de planta) |
| Trazabilidad | Diseño de auditoría, bitácoras, evidencias para calidad y cumplimiento |
| Integración | ETL/ELT con sistemas externos; sincronización incremental y en tiempo casi real |
| Backend | Servicios de alto rendimiento con acceso eficiente a base de datos |
| Infraestructura | Linux, contenedores, operación de entornos productivos |
| Colaboración | **Git** + **ClickUp** (o Jira/Azure DevOps) en equipos multidisciplinarios |
| Calidad / ISO | Conocimiento de marcos **ISO** aplicables a software (p. ej. calidad del producto, seguridad de la información, evaluación de procesos) y su relación con trazabilidad y evidencias |
| Idioma | Español fluido; inglés técnico de lectura |

---

### ⭐ Deseable

- Validación **biométrica** integrada a flujos de acceso y operaciones críticas (modelado de eventos y plantillas de identidad).
- **Modbus**, MQTT u otros protocolos industriales además de OPC UA.
- Multi-tenant, RBAC y bitácoras forenses.
- Mensajería o streaming para ingesta ordenada de eventos.
- Certificaciones en administración de bases de datos o seguridad industrial (**IEC 62443** u homólogas).
- Experiencia en Latinoamérica con plantas remotas y conectividad intermitente.
- Familiaridad con **ISO/IEC 25010** (calidad de producto software) o participación en auditorías de certificación.

---

### 📌 Entregables esperados

- Modelo de datos productivo con **trazabilidad** operativa.
- Integración con sistemas de planta existentes operativa y monitoreada.
- Estrategia offline documentada y validada.
- Procedimientos de backup, recuperación y pruebas de carga con evidencias.
- Documentación para operación y transferencia al equipo de mantenimiento.
- Evidencias de trabajo en **Git** y seguimiento en herramienta de gestión del proyecto.

---

### 💼 Qué ofrecemos

- Proyecto de alto impacto en **transformación digital industrial**.
- Equipo multidisciplinario con metodología ágil y herramientas de colaboración definidas.
- Rol con autonomía técnica en la capa de datos y el núcleo de servicios.
- Compensación acorde a perfil **Senior**, a coordinar en selección.

---

### 📩 Cómo postular

Envía CV en PDF y respuesta breve (máx. 1 página) con:

1. Dos proyectos de **arquitectura de datos** en entorno industrial (Industria 4.0/5.0 o equivalente).
2. Experiencia con **OPC UA** o integración planta–sistema corporativo.
3. Un caso de **trazabilidad / auditoría de datos** que hayas diseñado o implementado.
4. Un caso de **backup, recuperación o prueba de esfuerzo**.
5. Herramientas que usas para colaboración (**Git**, **ClickUp** u otras) y disponibilidad de inicio.

**Contacto:** [correo o enlace de postulación]  
**Asunto del mensaje:** `Senior DBA / Datos y Core — [Tu nombre]`

---

**#Hiring #TrabajoTI #DBA #DataEngineer #PostgreSQL #BackendSenior #ETL #IoT #Industria40 #Industria50 #OPCUA #Trazabilidad #Linux #DevOps #ArquitectoDeDatos #Git #ClickUp #ISO #Industria #LATAM #Remoto**

---

## Versión corta (post principal)

> **Convocatoria — Arquitecto de Datos / Backend Senior (industrial)**  
> Monitoreo, telemetría, trazabilidad (Ind. 4.0/5.0), **OPC UA**, ETL, offline, backups/DR, soporte a validación biométrica, **Git + ClickUp**. 8+ años, PostgreSQL, Linux. Solo Senior. CV a [contacto]. #Hiring #Industria40 #OPCUA #PostgreSQL #Trazabilidad

---

## Checklist antes de publicar

- [ ] Reemplazar `[correo o enlace de postulación]`.
- [ ] No adjuntar diagramas, SOW ni nombres internos de proyecto.
- [ ] Revisar comentarios del equipo (sin stack ni arquitectura).
- [ ] Confirmar que el post no mencione sector minero ni ubicación de infraestructura.

---

*Documento interno — publicación externa genérica. Última revisión: mayo 2026.*
