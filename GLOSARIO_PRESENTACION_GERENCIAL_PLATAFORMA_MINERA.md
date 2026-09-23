# Glosario gerencial de términos y siglas

**Plataforma Minera Beemetry**  
Documento de apoyo para sustentar la presentación gerencial y explicar términos técnicos, siglas y conceptos de la plataforma.

> Nota de alcance: este glosario está construido a partir del contexto disponible del proyecto Beemetry, antes AURIXA, y de los términos técnicos propios de plataformas mineras, arquitectura de software, inteligencia artificial, automatización y gobierno de desarrollo. Sirve como material de soporte para explicar la presentación ante gerencia con lenguaje claro, orientado a negocio y operación.

---

## 1. Resumen ejecutivo

La plataforma minera Beemetry combina componentes de software, inteligencia artificial, gobierno técnico y automatización para apoyar decisiones operativas y de gestión. En una presentación gerencial pueden aparecer términos de tres mundos distintos:

- **Negocio minero:** operación, mantenimiento, seguridad, productividad, alertas, continuidad operativa y trazabilidad.
- **Tecnología de plataforma:** backend, frontend, APIs, datos, servicios, CI/CD, multi-tenant, monitoreo y seguridad.
- **Inteligencia artificial:** agentes, LLM, RAG, prompts, modelos locales o cloud, orquestación y revisión automatizada.

El objetivo de este glosario es que cada término pueda explicarse con claridad ante gerencia, destacando qué significa, para qué sirve y por qué importa en una plataforma minera.

---

## 2. Términos clave de la plataforma Beemetry / AURIXA

### Beemetry

**Definición:** nombre actual de la plataforma minera. Representa el sistema integral que busca apoyar procesos mineros mediante datos, automatización, inteligencia artificial y trazabilidad.

**Cómo explicarlo a gerencia:** Beemetry es la plataforma que centraliza información operativa y técnica para convertirla en decisiones, alertas y acciones más rápidas.

**Importancia:** permite pasar de una gestión reactiva a una gestión más preventiva, medible y apoyada por datos.

---

### AURIXA

**Definición:** nombre anterior de la plataforma, mencionado en la documentación como antecedente de Beemetry.

**Cómo explicarlo a gerencia:** AURIXA fue la denominación previa del proyecto; Beemetry es la evolución actual de esa plataforma.

**Importancia:** ayuda a entender referencias históricas en documentos, repositorios, variables técnicas o flujos antiguos.

---

### Plataforma minera

**Definición:** conjunto integrado de módulos tecnológicos diseñados para apoyar procesos propios de una operación minera: producción, mantenimiento, seguridad, control de activos, alertas, reportes y análisis.

**Cómo explicarlo a gerencia:** no es una aplicación aislada, sino un ecosistema que conecta información, procesos y usuarios de la operación.

**Importancia:** una plataforma permite escalar funcionalidades, integrar áreas y mantener trazabilidad de decisiones.

---

### Portal de desarrollo IA

**Definición:** entorno metodológico y técnico que usa inteligencia artificial para apoyar el ciclo de vida del desarrollo: análisis, diseño, generación de código, revisión, pruebas y documentación.

**Cómo explicarlo a gerencia:** es una forma de acelerar el desarrollo de la plataforma usando IA con controles, reglas y trazabilidad.

**Importancia:** permite mejorar velocidad sin perder gobierno técnico.

---

## 3. Gobierno técnico y metodología

### ADR

**Significado:** Architecture Decision Record.

**Definición:** documento que registra una decisión de arquitectura importante: qué se decidió, por qué se decidió, qué alternativas se evaluaron y cuáles son sus consecuencias.

**Cómo explicarlo a gerencia:** un ADR es la evidencia formal de por qué se eligió una tecnología, diseño o enfoque técnico.

**Ejemplo:** decidir si la plataforma usará un modelo de IA local, un modelo en la nube o una arquitectura híbrida.

**Importancia gerencial:** reduce riesgos, evita decisiones informales y permite auditar la evolución tecnológica.

---

### SPEC

**Significado:** Specification o especificación funcional/técnica.

**Definición:** documento que describe una funcionalidad, necesidad o requerimiento que debe implementar la plataforma.

**Cómo explicarlo a gerencia:** una SPEC define qué se debe construir, para quién, con qué reglas y con qué criterios de aceptación.

**Ejemplo:** una SPEC puede describir el funcionamiento de alertas offline, control de usuarios, reportes de producción o integración con sensores.

**Importancia gerencial:** asegura que el desarrollo responda a una necesidad clara del negocio.

---

### Constitución

**Definición:** documento rector del proyecto que establece reglas obligatorias de gobierno, calidad, trazabilidad y aprobación.

**Cómo explicarlo a gerencia:** funciona como una política interna del proyecto: define qué se permite, qué no se permite y bajo qué condiciones se puede avanzar.

**Importancia:** evita que se desarrollen cambios sin sustento, sin SPEC o sin control de calidad.

---

### Trazabilidad ADR ↔ SPEC

**Definición:** relación documentada entre decisiones de arquitectura y funcionalidades específicas.

**Cómo explicarlo a gerencia:** cada funcionalidad importante debe estar conectada con las decisiones técnicas que la justifican.

**Importancia:** permite responder preguntas como: “¿por qué se construyó así?”, “¿qué decisión respalda esta funcionalidad?” o “¿qué impacto tendría cambiarla?”.

---

### REGISTRY

**Definición:** registro central que vincula ADRs, SPECs y otros elementos de gobierno del proyecto.

**Cómo explicarlo a gerencia:** es el índice maestro de trazabilidad del proyecto.

**Importancia:** facilita auditoría, control documental y continuidad del conocimiento.

---

### Pipeline

**Definición:** secuencia automatizada de pasos para procesar una solicitud, validar una funcionalidad o ejecutar el flujo de desarrollo.

**Cómo explicarlo a gerencia:** un pipeline es una línea de producción digital: toma una necesidad y la hace pasar por análisis, generación, revisión y validación.

**Importancia:** estandariza el proceso y reduce errores humanos.

---

## 4. Inteligencia artificial y modelos

### IA

**Significado:** Inteligencia Artificial.

**Definición:** conjunto de técnicas que permiten a un sistema realizar tareas que normalmente requieren razonamiento humano, como interpretar texto, sugerir decisiones, detectar patrones o generar contenido.

**Cómo explicarlo a gerencia:** IA es la capacidad de la plataforma para asistir decisiones y automatizar análisis complejos a partir de datos y reglas.

**Importancia:** mejora velocidad de análisis, priorización y generación de respuestas.

---

### IA multi-agente

**Definición:** enfoque en el que varios agentes especializados de IA colaboran, cada uno con un rol específico.

**Cómo explicarlo a gerencia:** en lugar de tener una sola IA genérica, la plataforma organiza varios “especialistas”: analista funcional, arquitecto, planificador, revisor, generador de código, entre otros.

**Importancia:** mejora la calidad porque cada agente opera con un propósito definido.

---

### Agente

**Definición:** componente de IA configurado para cumplir una función específica dentro del flujo de trabajo.

**Ejemplos en el proyecto:** functional_analyst, architect, planner, reviewer.

**Cómo explicarlo a gerencia:** un agente es un asistente especializado que participa en una etapa del proceso.

**Importancia:** distribuye responsabilidades y permite controlar mejor la calidad de los resultados.

---

### LLM

**Significado:** Large Language Model.

**Definición:** modelo de lenguaje entrenado con grandes volúmenes de texto, capaz de comprender, resumir, generar y razonar sobre información escrita.

**Cómo explicarlo a gerencia:** es el motor de IA que entiende instrucciones, documentos y contexto para generar respuestas o apoyar decisiones.

**Ejemplo:** modelos como GPT, Claude o modelos locales ejecutados en Ollama.

**Importancia:** habilita análisis documental, generación de código, revisión técnica y apoyo a la toma de decisiones.

---

### Modelo cloud

**Definición:** modelo de IA ejecutado en servicios externos en la nube.

**Cómo explicarlo a gerencia:** la capacidad de IA se consume desde un proveedor externo mediante internet y credenciales.

**Ventajas:** mayor potencia, actualización constante y disponibilidad de modelos avanzados.

**Riesgos o consideraciones:** dependencia de conectividad, costos variables y políticas de privacidad de datos.

---

### Modelo local

**Definición:** modelo de IA ejecutado en infraestructura propia o cercana a la operación.

**Cómo explicarlo a gerencia:** la IA puede operar dentro del entorno controlado de la empresa, sin depender totalmente de servicios externos.

**Ventajas:** mayor control de datos, potencial funcionamiento offline y menor exposición de información sensible.

**Consideraciones:** requiere infraestructura, mantenimiento y evaluación de rendimiento.

---

### Ollama

**Definición:** herramienta que permite ejecutar modelos de lenguaje localmente.

**Cómo explicarlo a gerencia:** Ollama permite tener IA funcionando en servidores o equipos propios.

**Importancia en minería:** puede ser relevante donde hay baja conectividad, restricciones de seguridad o necesidad de operar cerca del sitio minero.

---

### Modo mock

**Definición:** modo de simulación en el que el sistema responde sin llamar a servicios reales de IA.

**Cómo explicarlo a gerencia:** es una forma de probar el flujo sin gastar tokens, sin depender de internet y sin exponer datos.

**Importancia:** útil para pruebas automatizadas, CI y validaciones controladas.

---

### Prompt

**Definición:** instrucción que se entrega a un modelo de IA para guiar su respuesta.

**Cómo explicarlo a gerencia:** es la forma de pedirle trabajo a la IA, indicando rol, contexto, tarea y formato esperado.

**Importancia:** la calidad del prompt afecta directamente la calidad de la respuesta.

---

### Prompt por rol

**Definición:** instrucción especializada para un agente específico.

**Ejemplo:** un prompt de arquitecto no debe responder igual que un prompt de analista funcional.

**Importancia:** permite que la IA actúe con criterios consistentes según la etapa del proceso.

---

## 5. RAG, memoria y conocimiento

### RAG

**Significado:** Retrieval-Augmented Generation.

**Definición:** técnica que permite a la IA buscar información relevante en una base documental antes de generar una respuesta.

**Cómo explicarlo a gerencia:** la IA no responde solo con conocimiento general; primero consulta documentos del proyecto y luego responde con contexto.

**Ejemplo:** antes de generar una respuesta sobre `tenant_id`, la plataforma puede buscar ADRs, SPECs o documentación donde ese término aparece.

**Importancia:** reduce respuestas inventadas y mejora la alineación con la realidad del proyecto.

---

### Indexación

**Definición:** proceso de analizar documentos y prepararlos para que puedan ser buscados por la IA.

**Cómo explicarlo a gerencia:** es como crear un índice inteligente de toda la documentación del proyecto.

**Importancia:** permite recuperar información rápidamente cuando un agente necesita contexto.

---

### Query

**Definición:** consulta realizada a una base de datos, motor de búsqueda o sistema RAG.

**Cómo explicarlo a gerencia:** es una pregunta técnica que el sistema usa para encontrar información.

**Ejemplo:** consultar “tenant_id” para recuperar documentos donde se explica la separación por cliente o unidad.

---

### Contexto automático

**Definición:** capacidad del sistema para reunir información relevante antes de ejecutar una tarea.

**Cómo explicarlo a gerencia:** antes de actuar, la plataforma busca el contexto necesario para reducir errores y trabajar con información actualizada.

**Importancia:** mejora la precisión de los agentes de IA.

---

### Memoria RAG

**Definición:** conjunto de documentos indexados que la IA puede consultar para responder con base en conocimiento interno.

**Cómo explicarlo a gerencia:** es la memoria documental de la plataforma.

**Importancia:** conserva decisiones, reglas y conocimiento institucional.

---

## 6. Arquitectura de software

### Backend

**Definición:** parte interna del sistema que procesa reglas, datos, seguridad, integraciones y lógica de negocio.

**Cómo explicarlo a gerencia:** es el motor operativo de la plataforma.

**Ejemplo:** validación de usuarios, cálculo de métricas, consulta de alertas o integración con datos de operación.

---

### Frontend

**Definición:** interfaz visible para el usuario: pantallas, formularios, tableros, reportes y controles.

**Cómo explicarlo a gerencia:** es la cara de la plataforma con la que interactúan supervisores, gerentes, operadores o analistas.

**Importancia:** determina la experiencia de uso y la adopción por parte del negocio.

---

### API

**Significado:** Application Programming Interface.

**Definición:** mecanismo para que sistemas distintos se comuniquen entre sí.

**Cómo explicarlo a gerencia:** una API es un contrato de intercambio de información entre aplicaciones.

**Ejemplo:** conectar Beemetry con un sistema de mantenimiento, sensores, ERP o plataforma de reportes.

**Importancia:** permite integración y evita duplicar información manualmente.

---

### Servicio

**Definición:** componente de software que cumple una función específica.

**Cómo explicarlo a gerencia:** un servicio es una pieza especializada de la plataforma.

**Ejemplo:** servicio de alertas, servicio de usuarios, servicio de reportes, servicio de IA.

---

### Orquestador

**Definición:** componente que coordina la ejecución de varios pasos, agentes o servicios.

**Cómo explicarlo a gerencia:** actúa como director de orquesta: decide qué componente participa, en qué orden y con qué información.

**Importancia:** evita procesos manuales desordenados y permite automatizar flujos completos.

---

### Router IA

**Definición:** componente que decide qué agente o modelo debe atender una solicitud.

**Cómo explicarlo a gerencia:** funciona como un derivador inteligente: si la tarea es de arquitectura, la envía al agente arquitecto; si es de revisión, al revisor.

**Importancia:** mejora eficiencia y calidad al asignar cada tarea al especialista correcto.

---

### Motor de decisión

**Definición:** módulo que ayuda a evaluar opciones o determinar el mejor camino de acción según criterios definidos.

**Cómo explicarlo a gerencia:** permite que la plataforma recomiende decisiones o rutas de trabajo con base en reglas, contexto y evidencia.

**Importancia:** aporta consistencia a decisiones técnicas y operativas.

---

### Generador de código

**Definición:** componente que usa IA para producir código a partir de una SPEC, ADR o instrucción.

**Cómo explicarlo a gerencia:** acelera el desarrollo, pero debe trabajar bajo revisión y reglas de calidad.

**Importancia:** aumenta productividad sin eliminar la necesidad de validación humana y técnica.

---

### Revisor IA

**Definición:** componente que revisa cambios, código o documentos con ayuda de IA.

**Cómo explicarlo a gerencia:** actúa como una capa adicional de control de calidad.

**Importancia:** puede detectar incumplimientos, riesgos, inconsistencias o falta de trazabilidad.

---

## 7. Desarrollo, calidad y CI/CD

### CI

**Significado:** Continuous Integration.

**Definición:** práctica que ejecuta validaciones automáticas cada vez que se agregan cambios al proyecto.

**Cómo explicarlo a gerencia:** CI verifica que los cambios no rompan reglas, pruebas o documentación.

**Importancia:** reduce errores antes de pasar a producción.

---

### CD

**Significado:** Continuous Delivery o Continuous Deployment.

**Definición:** práctica para preparar o desplegar cambios de software de forma automatizada.

**Cómo explicarlo a gerencia:** CD permite entregar nuevas funcionalidades de manera más rápida y controlada.

**Importancia:** mejora velocidad de entrega y reduce riesgo operativo.

---

### CI/CD

**Definición:** combinación de integración continua y entrega/despliegue continuo.

**Cómo explicarlo a gerencia:** es una fábrica automatizada de validación y publicación de software.

**Importancia:** permite entregar cambios con controles repetibles y medibles.

---

### GitHub Actions

**Definición:** herramienta de automatización usada para ejecutar flujos CI/CD dentro de GitHub.

**Cómo explicarlo a gerencia:** cada cambio puede activar revisiones automáticas, validaciones de SPEC/ADR y pruebas.

**Importancia:** formaliza el control de calidad del desarrollo.

---

### Workflow

**Definición:** flujo automatizado compuesto por pasos.

**Ejemplo:** `adr-spec-validation.yml`, `ai-review.yml`, `ai-pipeline.yml`.

**Cómo explicarlo a gerencia:** un workflow es una rutina automática que valida o procesa cambios.

---

### Pull Request

**Definición:** solicitud para revisar e integrar cambios al código principal.

**Cómo explicarlo a gerencia:** es una puerta de control antes de aceptar cambios en la plataforma.

**Importancia:** facilita revisión, trazabilidad y aprobación.

---

### Merge

**Definición:** incorporación de cambios revisados a la rama principal del proyecto.

**Cómo explicarlo a gerencia:** es el momento en que un cambio aprobado pasa a formar parte oficial del sistema.

**Importancia:** debe ocurrir solo después de cumplir validaciones.

---

### Branch

**Definición:** rama de trabajo independiente dentro del repositorio de código.

**Cómo explicarlo a gerencia:** permite desarrollar una funcionalidad sin afectar la versión principal.

**Importancia:** reduce riesgo y ordena el trabajo por iniciativas.

---

### CONTEXT.md

**Definición:** archivo que documenta el contexto de una rama o tarea.

**Cómo explicarlo a gerencia:** registra qué se está trabajando, por qué y con qué referencias.

**Importancia:** mejora continuidad y trazabilidad.

---

### Métricas

**Definición:** indicadores que permiten medir desempeño, calidad o avance.

**Cómo explicarlo a gerencia:** las métricas permiten saber si el proceso mejora o empeora.

**Ejemplos:** tiempo de entrega, cantidad de revisiones, errores detectados, cumplimiento de SPEC, cobertura de pruebas.

---

## 8. Datos, seguridad y operación

### Tenant

**Definición:** cliente, unidad de negocio, faena, empresa o entorno lógico separado dentro de una plataforma compartida.

**Cómo explicarlo a gerencia:** un tenant permite que varios clientes o unidades usen la misma plataforma sin mezclar información.

**Importancia en minería:** puede separar datos por operación, mina, contratista, país o unidad productiva.

---

### tenant_id

**Definición:** identificador único de un tenant.

**Cómo explicarlo a gerencia:** es la etiqueta técnica que permite saber a qué cliente, faena o unidad pertenece cada dato.

**Importancia:** es clave para seguridad, privacidad, reportes y segregación de información.

---

### Multi-tenant

**Definición:** arquitectura donde una misma plataforma atiende a varios tenants manteniendo separación lógica de datos y configuración.

**Cómo explicarlo a gerencia:** permite escalar la plataforma para varias operaciones sin crear una instalación completamente distinta para cada una.

**Beneficio:** eficiencia de costos y mantenimiento.

**Riesgo a controlar:** asegurar que los datos de un tenant nunca sean visibles para otro.

---

### Trazabilidad

**Definición:** capacidad de seguir el origen, cambios y destino de una decisión, dato, alerta o funcionalidad.

**Cómo explicarlo a gerencia:** permite responder quién hizo qué, cuándo, por qué y con base en qué información.

**Importancia:** fundamental para auditoría, seguridad, cumplimiento y mejora continua.

---

### Auditoría

**Definición:** revisión estructurada de acciones, decisiones, cambios o accesos.

**Cómo explicarlo a gerencia:** permite verificar que la plataforma opera bajo reglas y controles.

**Importancia:** reduce riesgos regulatorios, operativos y de seguridad.

---

### Seguridad de datos

**Definición:** conjunto de controles para proteger información contra acceso indebido, pérdida, modificación o exposición.

**Cómo explicarlo a gerencia:** asegura que los datos críticos de operación y negocio estén protegidos.

**Importancia en minería:** puede involucrar información productiva, contractual, geológica, operacional y de seguridad.

---

### RBAC

**Significado:** Role-Based Access Control.

**Definición:** control de acceso basado en roles.

**Cómo explicarlo a gerencia:** cada usuario ve o hace solo lo que corresponde a su rol.

**Ejemplo:** un gerente puede ver indicadores globales, mientras un supervisor puede gestionar alertas de su área.

---

### SLA

**Significado:** Service Level Agreement.

**Definición:** acuerdo de nivel de servicio que define disponibilidad, tiempos de respuesta o compromisos operativos.

**Cómo explicarlo a gerencia:** es el estándar esperado de funcionamiento del servicio.

**Ejemplo:** disponibilidad mensual, tiempo máximo de respuesta ante incidentes o tiempo de recuperación.

---

### Disponibilidad

**Definición:** porcentaje de tiempo en que la plataforma está operativa.

**Cómo explicarlo a gerencia:** mide si el sistema está disponible cuando la operación lo necesita.

**Importancia:** en minería, la indisponibilidad puede impactar decisiones, seguridad o continuidad operativa.

---

### Resiliencia

**Definición:** capacidad de un sistema para seguir funcionando o recuperarse frente a fallas.

**Cómo explicarlo a gerencia:** una plataforma resiliente no colapsa completamente ante una falla aislada.

**Importancia:** clave en entornos mineros donde conectividad e infraestructura pueden ser variables.

---

## 9. Conceptos mineros y operacionales

### Operación minera

**Definición:** conjunto de actividades necesarias para extraer, transportar, procesar y controlar mineral.

**Cómo explicarlo a gerencia:** es el entorno real al que la plataforma debe servir.

**Importancia:** toda funcionalidad debe generar valor operacional o de gestión.

---

### Faena

**Definición:** sitio o unidad donde se desarrolla la operación minera.

**Cómo explicarlo a gerencia:** una faena es una operación específica, con equipos, procesos, personal y datos propios.

**Importancia:** suele ser una unidad natural para segmentar información, usuarios y reportes.

---

### Activo

**Definición:** equipo, instalación o recurso relevante para la operación.

**Ejemplos:** camiones, palas, chancadoras, fajas, sensores, plantas, sistemas eléctricos.

**Cómo explicarlo a gerencia:** los activos son elementos que generan valor y requieren control, mantenimiento y seguimiento.

---

### KPI

**Significado:** Key Performance Indicator.

**Definición:** indicador clave de desempeño.

**Cómo explicarlo a gerencia:** un KPI resume si una operación, proceso o equipo está funcionando según lo esperado.

**Ejemplos mineros:** disponibilidad de equipos, utilización, toneladas movidas, cumplimiento de plan, incidentes, tiempo detenido.

---

### Producción

**Definición:** volumen de material extraído, procesado o entregado en un periodo.

**Cómo explicarlo a gerencia:** es uno de los indicadores centrales de desempeño operativo.

**Importancia:** permite comparar avance real contra plan.

---

### Disponibilidad mecánica

**Definición:** porcentaje de tiempo en que un equipo está técnicamente disponible para operar.

**Cómo explicarlo a gerencia:** mide qué tanto los equipos están listos para trabajar.

**Importancia:** impacta directamente en producción y cumplimiento del plan.

---

### Utilización

**Definición:** porcentaje de tiempo en que un equipo disponible realmente se usa.

**Cómo explicarlo a gerencia:** un equipo puede estar disponible, pero no necesariamente estar siendo utilizado.

**Importancia:** ayuda a detectar ineficiencias operativas.

---

### Mantenimiento preventivo

**Definición:** mantenimiento programado para evitar fallas futuras.

**Cómo explicarlo a gerencia:** busca intervenir antes de que el equipo falle.

**Importancia:** reduce paradas no planificadas.

---

### Mantenimiento predictivo

**Definición:** mantenimiento basado en datos, patrones o modelos que anticipan posibles fallas.

**Cómo explicarlo a gerencia:** usa datos para predecir cuándo un equipo podría fallar.

**Importancia:** reduce costos y mejora disponibilidad.

---

### Alerta

**Definición:** notificación generada cuando ocurre una condición relevante o anómala.

**Cómo explicarlo a gerencia:** una alerta permite reaccionar rápido ante riesgos, desviaciones o eventos importantes.

**Ejemplo:** pérdida de conectividad, equipo detenido, incumplimiento de umbral, evento de seguridad.

---

### Alertas offline

**Definición:** alertas que pueden generarse, conservarse o gestionarse incluso con conectividad limitada o inexistente.

**Cómo explicarlo a gerencia:** si la operación pierde internet, la plataforma puede seguir registrando o procesando eventos críticos.

**Importancia en minería:** muchas faenas tienen zonas con conectividad intermitente.

---

### Evento

**Definición:** hecho registrado por el sistema.

**Ejemplos:** inicio de turno, detención de equipo, lectura de sensor, cambio de estado, generación de alerta.

**Cómo explicarlo a gerencia:** los eventos son señales que permiten reconstruir la operación.

---

### Umbral

**Definición:** valor límite que activa una acción o alerta.

**Ejemplo:** temperatura mayor a cierto valor, vibración fuera de rango o producción menor al plan.

**Cómo explicarlo a gerencia:** el umbral define cuándo una condición se considera relevante.

---

### Desviación

**Definición:** diferencia entre el valor esperado y el valor real.

**Cómo explicarlo a gerencia:** indica que algo se está alejando del plan o estándar.

**Importancia:** permite tomar acciones correctivas.

---

## 10. Integraciones industriales y tecnológicas

### OT

**Significado:** Operational Technology.

**Definición:** tecnología usada para controlar procesos físicos e industriales.

**Cómo explicarlo a gerencia:** OT es la tecnología que está cerca de equipos, sensores, controladores y procesos de planta o mina.

**Ejemplos:** PLC, SCADA, sensores industriales.

---

### IT

**Significado:** Information Technology.

**Definición:** tecnología orientada a sistemas de información, aplicaciones, redes corporativas y datos.

**Cómo explicarlo a gerencia:** IT administra sistemas empresariales, aplicaciones, usuarios y datos.

**Importancia:** Beemetry se ubica en la intersección entre IT y la operación minera.

---

### IT/OT

**Definición:** integración entre sistemas corporativos de información y sistemas operacionales industriales.

**Cómo explicarlo a gerencia:** conecta la operación física con la gestión digital.

**Importancia:** permite convertir señales operativas en indicadores, alertas y decisiones.

---

### SCADA

**Significado:** Supervisory Control and Data Acquisition.

**Definición:** sistema usado para supervisar y controlar procesos industriales.

**Cómo explicarlo a gerencia:** SCADA permite observar variables de operación en tiempo real y controlar procesos.

**Relación con Beemetry:** la plataforma puede consumir información proveniente de sistemas SCADA para análisis, alertas o reportes.

---

### PLC

**Significado:** Programmable Logic Controller.

**Definición:** controlador industrial que automatiza equipos o procesos.

**Cómo explicarlo a gerencia:** es un dispositivo que ejecuta reglas de control en terreno.

**Ejemplo:** controlar una faja, bomba, válvula o sistema de chancado.

---

### IoT

**Significado:** Internet of Things.

**Definición:** red de dispositivos conectados que capturan y transmiten datos.

**Cómo explicarlo a gerencia:** sensores y equipos conectados que envían información para monitoreo y análisis.

**Importancia en minería:** permite visibilidad de condiciones operativas, ambientales y de activos.

---

### Sensor

**Definición:** dispositivo que mide una variable física o ambiental.

**Ejemplos:** temperatura, vibración, presión, humedad, ubicación, velocidad.

**Cómo explicarlo a gerencia:** los sensores convierten condiciones reales de la operación en datos digitales.

---

### Edge computing

**Definición:** procesamiento de datos cerca del lugar donde se generan, en vez de enviarlos siempre a la nube.

**Cómo explicarlo a gerencia:** permite procesar información en la faena o cerca de los equipos.

**Importancia en minería:** reduce dependencia de conectividad y mejora tiempos de respuesta.

---

### Nube

**Definición:** infraestructura tecnológica externa usada para almacenar, procesar o desplegar sistemas.

**Cómo explicarlo a gerencia:** permite escalar recursos sin instalar todo físicamente en la empresa.

**Consideraciones:** costo, seguridad, conectividad y cumplimiento.

---

### ERP

**Significado:** Enterprise Resource Planning.

**Definición:** sistema empresarial que integra procesos como finanzas, compras, inventario, contratos y recursos.

**Cómo explicarlo a gerencia:** es el sistema administrativo central de una empresa.

**Relación con Beemetry:** puede integrarse para cruzar datos operativos con costos, órdenes de trabajo o inventario.

---

### CMMS

**Significado:** Computerized Maintenance Management System.

**Definición:** sistema para gestionar mantenimiento, órdenes de trabajo, activos y repuestos.

**Cómo explicarlo a gerencia:** administra las actividades de mantenimiento de equipos e instalaciones.

**Relación con Beemetry:** puede recibir alertas o eventos para generar acciones de mantenimiento.

---

### MES

**Significado:** Manufacturing Execution System.

**Definición:** sistema que gestiona y monitorea operaciones de producción.

**Cómo explicarlo a gerencia:** conecta el plan productivo con la ejecución real.

**Relación con minería:** puede aplicar a plantas de procesamiento, chancado, molienda o concentración.

---

## 11. Términos de datos y analítica

### Dato

**Definición:** registro individual de información.

**Ejemplo:** una lectura de sensor, un usuario, una alerta, una tonelada producida.

**Cómo explicarlo a gerencia:** el dato es la unidad básica para generar información.

---

### Información

**Definición:** datos organizados y contextualizados.

**Cómo explicarlo a gerencia:** cuando los datos se ordenan y explican, se convierten en información útil.

---

### Analítica

**Definición:** uso de datos para encontrar patrones, tendencias, explicaciones o recomendaciones.

**Cómo explicarlo a gerencia:** permite convertir información operacional en decisiones.

---

### Dashboard

**Definición:** tablero visual que muestra indicadores, estados y tendencias.

**Cómo explicarlo a gerencia:** es una pantalla de control para ver rápidamente cómo está la operación.

**Importancia:** facilita seguimiento ejecutivo y operativo.

---

### Reporte

**Definición:** documento o vista que resume información relevante para análisis o decisión.

**Cómo explicarlo a gerencia:** entrega evidencia estructurada para seguimiento y control.

---

### Tiempo real

**Definición:** capacidad de recibir o procesar información casi al mismo momento en que ocurre.

**Cómo explicarlo a gerencia:** permite reaccionar rápido ante eventos de operación.

**Nota:** “tiempo real” no siempre significa instantáneo; puede depender de conectividad, sensores y arquitectura.

---

### Batch

**Definición:** procesamiento por lotes, ejecutado en intervalos o grupos de datos.

**Cómo explicarlo a gerencia:** en vez de procesar dato por dato al instante, se procesa un conjunto de información cada cierto tiempo.

**Ejemplo:** consolidar reportes diarios o cargar datos históricos.

---

### Data lake

**Definición:** repositorio amplio donde se almacenan datos en distintos formatos.

**Cómo explicarlo a gerencia:** es un gran depósito de datos para análisis futuros.

**Importancia:** útil cuando se quiere conservar información operacional, documental e histórica.

---

### Data warehouse

**Definición:** repositorio estructurado para análisis, reportes e indicadores.

**Cómo explicarlo a gerencia:** es una base preparada para consultar indicadores confiables.

**Diferencia con data lake:** el data warehouse está más ordenado y modelado para reportes.

---

## 12. Riesgos, controles y valor gerencial

### Riesgo operativo

**Definición:** posibilidad de pérdida, falla o impacto negativo en la operación.

**Cómo explicarlo a gerencia:** puede originarse por fallas de equipos, datos incompletos, conectividad, errores humanos o falta de alertas.

---

### Riesgo tecnológico

**Definición:** posibilidad de que una decisión, sistema o dependencia tecnológica afecte el funcionamiento de la plataforma.

**Ejemplos:** proveedor externo, baja disponibilidad, problemas de integración, deuda técnica.

---

### Deuda técnica

**Definición:** acumulación de decisiones técnicas que permiten avanzar rápido, pero generan costos futuros si no se corrigen.

**Cómo explicarlo a gerencia:** es como una deuda financiera, pero en software: si no se gestiona, encarece cambios futuros.

---

### Control de calidad

**Definición:** conjunto de revisiones, pruebas y criterios para asegurar que el sistema cumple lo esperado.

**Cómo explicarlo a gerencia:** evita que errores lleguen a producción o afecten operación.

---

### Criterios de aceptación

**Definición:** condiciones que debe cumplir una funcionalidad para considerarse terminada.

**Cómo explicarlo a gerencia:** son las reglas que determinan si el entregable satisface la necesidad del negocio.

---

### Cumplimiento

**Definición:** alineación con políticas, normas, regulaciones o reglas internas.

**Cómo explicarlo a gerencia:** asegura que la plataforma opere dentro del marco requerido por la empresa y la industria.

---

### Continuidad operativa

**Definición:** capacidad de mantener operaciones críticas funcionando a pesar de fallas o interrupciones.

**Cómo explicarlo a gerencia:** la plataforma debe apoyar que la operación no se detenga innecesariamente.

---

### Escalabilidad

**Definición:** capacidad de crecer en usuarios, datos, operaciones o módulos sin rediseñar todo el sistema.

**Cómo explicarlo a gerencia:** permite que la plataforma acompañe el crecimiento del negocio.

---

### Interoperabilidad

**Definición:** capacidad de integrarse y trabajar con otros sistemas.

**Cómo explicarlo a gerencia:** evita islas de información y permite conectar sistemas existentes.

---

## 13. Guía rápida para sustentar ante gerencia

### Si preguntan: “¿Por qué usar IA en la plataforma?”

Respuesta sugerida:

> Porque la IA permite acelerar análisis, automatizar tareas repetitivas, revisar documentación, generar apoyo técnico y convertir grandes volúmenes de información en decisiones más oportunas. En Beemetry, la IA no opera sin control: se apoya en SPECs, ADRs, RAG, agentes especializados y validaciones automáticas.

---

### Si preguntan: “¿Cómo evitamos que la IA invente respuestas?”

Respuesta sugerida:

> Se reduce ese riesgo usando RAG, trazabilidad documental, prompts por rol, revisiones automáticas y reglas de gobierno. La IA consulta documentación del proyecto antes de responder y sus resultados pueden ser revisados por agentes o personas.

---

### Si preguntan: “¿Qué valor aporta ADR y SPEC?”

Respuesta sugerida:

> ADR y SPEC aseguran que las funcionalidades no se construyan de manera improvisada. La SPEC define qué necesita el negocio y el ADR justifica las decisiones técnicas importantes. Juntos dan trazabilidad, control y continuidad.

---

### Si preguntan: “¿Qué significa multi-agente?”

Respuesta sugerida:

> Significa que el trabajo se divide entre agentes de IA especializados. Cada uno tiene una responsabilidad: analizar, diseñar, planificar, generar, revisar o validar. Esto mejora la calidad frente a usar una IA generalista para todo.

---

### Si preguntan: “¿Qué significa que la plataforma sea multi-tenant?”

Respuesta sugerida:

> Significa que la plataforma puede atender a varias unidades, faenas o clientes manteniendo separados sus datos, usuarios y configuraciones. Esto permite escalar con control y seguridad.

---

### Si preguntan: “¿Qué importancia tienen las alertas offline?”

Respuesta sugerida:

> En minería, la conectividad puede ser limitada. Las alertas offline permiten que eventos críticos no se pierdan cuando no hay conexión, y que la operación mantenga continuidad y trazabilidad.

---

### Si preguntan: “¿Qué diferencia hay entre modelo cloud y modelo local?”

Respuesta sugerida:

> Un modelo cloud usa infraestructura externa y suele ofrecer mayor potencia. Un modelo local corre en infraestructura propia y ofrece mayor control de datos y continuidad en entornos con conectividad limitada. La decisión depende de seguridad, costo, desempeño y criticidad.

---

### Si preguntan: “¿Qué es CI y por qué importa?”

Respuesta sugerida:

> CI es integración continua. Cada cambio se valida automáticamente para verificar que cumple reglas, documentación y calidad. Esto reduce errores y evita que cambios no controlados lleguen a la plataforma.

---

## 14. Tabla resumida de siglas

| Sigla | Significado | Explicación gerencial breve |
|---|---|---|
| ADR | Architecture Decision Record | Registro formal de decisiones de arquitectura. |
| API | Application Programming Interface | Canal para integrar sistemas. |
| CD | Continuous Delivery / Deployment | Entrega o despliegue automatizado de software. |
| CI | Continuous Integration | Validación automática de cambios. |
| CI/CD | Continuous Integration / Continuous Delivery | Flujo automatizado de validación y entrega. |
| CMMS | Computerized Maintenance Management System | Sistema de gestión de mantenimiento. |
| ERP | Enterprise Resource Planning | Sistema empresarial administrativo. |
| IA | Inteligencia Artificial | Tecnología para apoyar análisis y automatización. |
| IoT | Internet of Things | Dispositivos y sensores conectados. |
| IT | Information Technology | Tecnología de información corporativa. |
| KPI | Key Performance Indicator | Indicador clave de desempeño. |
| LLM | Large Language Model | Modelo de lenguaje usado como motor de IA. |
| MES | Manufacturing Execution System | Sistema de ejecución de producción. |
| OT | Operational Technology | Tecnología de operación industrial. |
| PLC | Programmable Logic Controller | Controlador industrial programable. |
| PR | Pull Request | Solicitud de revisión e integración de cambios. |
| RAG | Retrieval-Augmented Generation | IA que consulta documentos antes de responder. |
| RBAC | Role-Based Access Control | Control de acceso por roles. |
| SCADA | Supervisory Control and Data Acquisition | Sistema de supervisión y control industrial. |
| SLA | Service Level Agreement | Acuerdo de nivel de servicio. |
| SPEC | Specification | Especificación de una funcionalidad o requerimiento. |

---

## 15. Recomendación final para exposición

Para presentar estos términos ante gerencia, conviene evitar una explicación excesivamente técnica. La mejor estructura es:

1. **Qué significa el término.**
2. **Qué problema resuelve.**
3. **Qué valor aporta a la operación minera.**
4. **Qué riesgo ayuda a controlar.**

Ejemplo:

> RAG significa que la IA consulta documentación interna antes de responder. Resuelve el problema de respuestas descontextualizadas. Aporta valor porque alinea la respuesta con las decisiones y especificaciones del proyecto. Controla el riesgo de que la IA entregue información inventada o fuera de gobierno.

Este enfoque permite sustentar la presentación con claridad, conectando cada concepto técnico con valor de negocio, continuidad operacional, control de riesgos y trazabilidad.
