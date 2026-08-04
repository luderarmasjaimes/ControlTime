# Evaluación de Candidato: Anthony Alarcón Obando
**Puesto:** Backend Developer Especialista en Bases de Datos (PostgreSQL / Telemetría)  
**Nivel Requerido:** Semi-Senior (Backend y Base de Datos)

---

## 📊 Resumen de la Evaluación

Tras realizar un análisis exhaustivo del currículum de **Anthony Alarcón Obando** y contrastarlo con los requerimientos detallados en la convocatoria laboral, se presenta la siguiente calificación de idoneidad:

### **Puntuación: 5 / 10 (Apto con reservas / Nivel Técnico Backend Sólido, pero con Brechas Críticas en DB y Telemetría)**

> [!IMPORTANT]
> **Diagnóstico Principal:**  
> El candidato posee una sólida trayectoria de **~5 años** como desarrollador Backend y Analista Programador (cumpliendo el límite inferior del rango de 5-8 años solicitado). Tiene experiencia robusta en múltiples lenguajes (PHP/Laravel, C#/.NET, Node.js, Java) y bases de datos relacionales tradicionales como **SQL Server y MySQL**.  
> Sin embargo, la convocatoria exige un perfil **especialista en PostgreSQL** y valora altamente la experiencia en **telemetría, IoT y bases de datos de series temporales (TimescaleDB)**. El candidato **no menciona en absoluto PostgreSQL ni experiencia en telemetría o procesamiento en tiempo real**, lo que representa una brecha crítica para el núcleo del puesto.

---

## 🔍 Análisis Comparativo de Requisitos

A continuación se detalla el nivel de cumplimiento del candidato respecto a los requisitos mínimos e indispensables y los puntos especialmente valorados.

### 1. Requisitos Mínimos (Convocatoria)

| Requisito de la Convocatoria | Cumplimiento | Observaciones / Evidencia en el CV |
| :--- | :---: | :--- |
| **5 a 8 años de experiencia** en Backend y BD | **Sí (5 años)** | • **Inversiones Préstamos del Norte:** 21 meses (2021-2022 / 2024-2025)<br>• **BPO Perú:** 15 meses (2022-2023)<br>• **Dolphin Telecom:** 9 meses (2023-2024)<br>• **Agrícola San Juan:** 14 meses (2025-Act.). Total: ~59 meses (~5 años). |
| **Experiencia sólida en PostgreSQL** | **No** | **No se menciona PostgreSQL** en su CV. Su experiencia en bases de datos relacionales está concentrada en **SQL Server** (en 3 de sus 4 empleos) y **MySQL**. |
| **Modelado y optimización relacional** | **Sí** | Diseñó la base de datos para el sistema de préstamos en Inversiones Préstamos del Norte y ha administrado base de datos SQL Server en múltiples proyectos. |
| **Procedimientos, funciones y vistas** | **Sí** | Experiencia explícita en SQL Server y MySQL creando triggers, procedimientos almacenados, vistas, funciones y jobs (Agrícola San Juan y Préstamos del Norte). |
| **Respaldos y mantenimiento de BD** | **Sí** | Menciona tareas de administración de base de datos en SQL Server y MySQL, lo cual típicamente incluye mantenimiento y administración básica. |
| **Integración de datos entre apps** | **Sí** | Interconexión de sistemas propios mediante API REST y desarrollo de APIs en Node.js y Laravel. |
| **Manejo de Docker y Linux** | **No** | **No se mencionan** en el CV, aunque es común que un programador backend tenga nociones de estos entornos. Requiere validación. |
| **APIs REST y Microservicios** | **Sí** | Experiencia fuerte desarrollando APIs REST con Laravel (PHP) y Node.js en Dolphin Telecom y Agrícola San Juan. |
| **Git y metodologías ágiles** | **Sí** | Uso de Gitkraken, GitLab, GitHub. Scrum mediante Jira, Asana y tableros Kanban. |

---

### 2. Puntos Especialmente Valorados (Deseables)

| Requisito Deseable | Cumplimiento | Detalle en el CV |
| :--- | :---: | :--- |
| **Plataformas de alta demanda (millones de registros)** | **No detallado** | Sus sistemas son principalmente transaccionales corporativos (sistemas de préstamos, HelpDesk, reportes de campo, ERP agrícola). No hay evidencia de volumen masivo. |
| **Procesamiento de eventos en tiempo real** | **No** | No se menciona infraestructura de mensajería (Kafka, RabbitMQ, MQTT) ni arquitecturas reactivas. |
| **TimescaleDB y particionamiento** | **No** | No se mencionan bases de datos especializadas en series temporales ni técnicas avanzadas de particionamiento. |
| **Sistemas industriales, telemetría o IoT** | **No** | **Dolphin Telecom** es una empresa de telecomunicaciones, pero el candidato desarrolló un sistema de gestión interna (proceso TETRA, reportes de visitas) y no sistemas de telemetría de red o IoT. |
| **Data Engineering / ETL** | **Parcial** | Ha desarrollado scripts para tareas automatizadas (Jobs y triggers en SQL Server y MySQL), pero no herramientas formales de ETL. |
| **Conocimientos de Python** | **No** | Su stack tecnológico reportado se compone de PHP, Node.js, C#/.NET, Java y Kotlin. No lista Python. |

---

## 💡 Balance Técnico de Telemetría y Base de Datos

### **Fortalezas del Candidato:**
* **Versatilidad de Backend:** Su dominio de PHP/Laravel, NodeJS y C#/.NET le proporciona la flexibilidad necesaria para integrarse rápidamente a cualquier arquitectura backend existente.
* **Fuerte base en SQL tradicional:** Al dominar SQL Server y saber estructurar lógica en la base de datos (procedimientos, vistas, triggers), tiene los fundamentos lógicos necesarios. La lógica relacional de SQL Server se puede transferir a PostgreSQL con una curva de aprendizaje moderada.
* **Experiencia en liderazgo técnico interino:** En Agrícola San Juan asumió la supervisión interina temporal del área y gestión de equipos, demostrando madurez profesional y capacidad de organización.

### **Riesgos y Áreas a Evaluar:**
* **Curva de Aprendizaje en PostgreSQL:** PostgreSQL posee características particulares en cuanto a control de concurrencia (MVCC), tipos de índices (GIN, BRIN), optimización de queries (EXPLAIN ANALYZE) y extensiones que difieren significativamente de SQL Server.
* **Carencia de Experiencia en Series Temporales (Telemetry):** La telemetría industrial requiere el manejo eficiente de flujos continuos de datos indexados por tiempo (time-series). El candidato está acostumbrado a bases de datos relacionales puramente transaccionales (OLTP).

---

## 🎤 Guía de Preguntas para la Entrevista Virtual (Inicial)

Este set de preguntas está diseñado para medir el nivel real de conocimientos en **PostgreSQL**, **conceptos de telemetría / alto rendimiento** y **arquitectura Backend**, permitiendo validar si el candidato posee la base teórica y la capacidad de adaptación rápida para cubrir sus vacíos en el CV.

### **Bloque 1: Transición de SQL Server/MySQL a PostgreSQL**
*El objetivo es evaluar si, a pesar de no listar PostgreSQL en su CV, entiende las particularidades de este motor.*

1. **Pregunta:** *"En tu CV destacas una fuerte experiencia con SQL Server. Si tuvieras que migrar un procedimiento almacenado complejo de SQL Server a PostgreSQL, ¿cuáles crees que serían las principales diferencias técnicas que deberías considerar en cuanto a sintaxis, tipos de datos y ejecución?"*
   * **Qué evaluar en la respuesta:** Debe mencionar diferencias como el uso de PL/pgSQL, la declaración de funciones que retornan conjuntos de datos (`SETOF`, `TABLE`), diferencias en el control de transacciones dentro de funciones, o la sintaxis de variables y estructuras de control.
2. **Pregunta:** *"PostgreSQL utiliza un mecanismo de concurrencia llamado MVCC (Multi-Version Concurrency Control). ¿Sabes qué impacto tiene esto en el rendimiento de escritura/actualización y por qué es importante el proceso de `VACUUM`?"*
   * **Qué evaluar en la respuesta:** El candidato ideal debe saber que las actualizaciones en Postgres generan nuevas versiones de filas en disco y dejan "filas muertas" (tuples). El `VACUUM` se encarga de liberar ese espacio. Si desconoce esto, denotaría que nunca ha administrado PostgreSQL en producción.

---

### **Bloque 2: Telemetría, Series Temporales y Alto Volumen**
*El objetivo es evaluar su capacidad analítica y teórica para diseñar sistemas de telemetría (IoT / Monitoreo).*

3. **Pregunta:** *"Imagina que nuestra plataforma recibe métricas de sensores industriales de telemetría cada segundo por cada dispositivo (con miles de dispositivos conectados). ¿Qué estrategias de base de datos utilizarías en PostgreSQL para evitar que una sola tabla crezca desmesuradamente y degrade las consultas de datos históricos?"*
   * **Qué evaluar en la respuesta:** Debe mencionar **Particionamiento de tablas** (por rangos de tiempo, por ejemplo), uso de índices optimizados (como índices BRIN para datos ordenados cronológicamente), o idealmente el uso de extensiones de series temporales como **TimescaleDB** (hipertablas).
4. **Pregunta:** *"En la ingesta de telemetría en tiempo real, a veces el flujo de datos supera la velocidad de escritura directa en la base de datos relacional. ¿Cómo diseñarías la arquitectura backend para mitigar este cuello de botella antes de escribir en la base de datos?"*
   * **Qué evaluar en la respuesta:** Se espera que proponga el uso de una arquitectura con colas de mensajería o brokers de eventos (ej. RabbitMQ, Kafka, o MQTT Broker) para almacenar temporalmente los datos (buffer/backpressure) e ingresarlos en lotes (batch inserts) en lugar de uno a uno.

---

### **Bloque 3: Desarrollo Backend y APIs (Node.js / Laravel / C#)**
*El objetivo es validar sus capacidades en su área fuerte (Backend) y cómo lo relaciona con bases de datos.*

5. **Pregunta:** *"Mencionas haber trabajado con Node.js y Laravel para la creación de APIs REST. En un escenario donde una API debe consultar millones de registros de telemetría para generar un reporte gráfico, ¿cómo manejarías la respuesta a nivel de backend y base de datos para no agotar la memoria del servidor ni colgar la conexión?"*
   * **Qué evaluar en la respuesta:** Debe proponer **paginación**, uso de **Streams** o cursores a nivel de base de datos en Node.js, procesamiento asíncrono (jobs/colas) y generación del reporte en background con notificaciones en tiempo real (WebSockets / SSE), en lugar de cargar todo en memoria en una sola petición síncrona.
6. **Pregunta:** *"¿Qué experiencia tienes utilizando ORMs (como Eloquent en Laravel o Sequelize/TypeORM en Node.js) frente a escribir consultas SQL nativas? ¿En qué casos prefieres escribir SQL nativo por razones de rendimiento?"*
   * **Qué evaluar en la respuesta:** Los ORMs facilitan el desarrollo pero suelen ser ineficientes para inserciones masivas de telemetría o consultas con múltiples joins complejos. El candidato debe reconocer que para telemetría u optimización crítica es preferible usar SQL nativo (Raw Queries o Query Builders livianos como Knex.js).

---

### **Bloque 4: Entorno de Despliegue y Prácticas Devops**
*El objetivo es validar sus conocimientos en Docker y Linux, requeridos para el puesto.*

7. **Pregunta:** *"¿Cómo ha sido tu experiencia trabajando con Docker en tus proyectos anteriores? Describe cómo estructurarías un entorno local de desarrollo que requiera un backend en Node.js y una base de datos PostgreSQL usando Docker Compose."*
   * **Qué evaluar en la respuesta:** Debería poder explicar conceptualmente la creación de un archivo `docker-compose.yml`, la configuración de variables de entorno, la definición de volúmenes persistentes para la base de datos y la exposición de puertos.

---

## 🎯 Veredicto y Siguientes Pasos

Si bien el candidato no es un especialista nativo en PostgreSQL ni cuenta con experiencia directa en telemetría (IoT), su sólida experiencia en backend y administración de otras bases de datos SQL relacionales (SQL Server) demuestra que **tiene la capacidad lógica y técnica para reconvertirse**.

**Recomendación:**
Si la urgencia del proyecto permite darle un margen de adaptación de **1 a 2 meses** para familiarizarse con PostgreSQL y TimescaleDB, vale la pena entrevistarlo utilizando el set de preguntas provisto para medir su agilidad de aprendizaje y fundamentos de bases de datos. Si el proyecto requiere un especialista que rinda al 100% desde el día uno en optimización avanzada de PostgreSQL para telemetría industrial, el candidato se queda corto en los requisitos específicos del perfil.
