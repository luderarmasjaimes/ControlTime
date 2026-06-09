# EVALUACION TECNICA

## Portafolio de IA para Nueva Plataforma Minera, Continuidad AWS y Automatizacion Compartida de Ingenieria

**Fecha**: 15 de mayo de 2026  
**Dirigido a**: Gerencia TI y Arquitectura de Soluciones  
**Preparado por**: Arquitectura TI Senior LATAM

---

## 1. Objetivo tecnico

Definir una arquitectura y un portafolio de modelos, APIs, SDKs, librerias y herramientas de IA que permitan:

1. Construir la nueva plataforma minera en VPS con respaldo AWS.
2. Mantener la plataforma actual desplegada en AWS.
3. Compartir capacidades de IA entre equipos de ingenieria que trabajan en varios proyectos de automatizacion minera.
4. Habilitar una base tecnica para evolucionar hacia entrenamientos de modelos de prediccion de eventos mineros, deteccion de anomalias y automatizacion avanzada.

## 2. Base actual verificada en el repositorio

La evidencia del directorio actual confirma una base tecnologica compatible con una estrategia IA pragmaticamente integrable:

1. **Frontend React/Vite** en la carpeta `frontend`, con dependencias React 18 y toolchain moderna de JavaScript.
2. **Motor de IA en Python** en la carpeta `ai_engine`.
3. **Componente de biometria facial existente** con `InsightFace`, `onnxruntime` y modelos de analisis facial.
4. **Enfoque Docker / Compose** ya presente para despliegue de componentes.

Esto es importante porque permite adoptar una estrategia poliglota **JavaScript + Python**, sin redisenar el stack base del proyecto.

## 3. Principio rector

La empresa debe separar claramente dos mundos:

### 3.1 IA generativa y asistentes

Para:

1. Coding y mantenimiento.
2. Analisis documental.
3. Busqueda contextual y RAG.
4. Generacion de reportes, resumentes y mejoras de estilo.
5. Ayuda operativa y copilots internos.

### 3.2 IA predictiva y analitica minera

Para:

1. Deteccion de anomalias.
2. Prediccion de eventos.
3. Clasificacion de alertas y telemetria.
4. Correlacion geotecnica, geoespacial e historica.
5. Modelos de riesgo y mantenimiento predictivo.

**No es tecnicamente correcto resolver la segunda capa solo con LLMs.** Alli se requiere un stack real de machine learning y series temporales.

## 4. Arquitectura objetivo recomendada

### 4.1 Arquitectura general

1. **VPS Lima / private cloud** como plano principal de aplicacion y servicios compartidos.
2. **AWS** como plano de continuidad, respaldo y coexistencia con la plataforma vigente.
3. **AI Gateway interno** como capa unificada de acceso a modelos externos e internos.
4. **RAG y Document AI** sobre repositorio documental compartido.
5. **ML Platform** para experimentacion, entrenamiento, evaluacion y despliegue de modelos predictivos.

### 4.2 Diagrama logico de alto nivel

| Capa | Recomendacion |
|---|---|
| UI y copilotos | Web app React, paneles internos, Slack/Teams opcional |
| API de negocio | Node.js / FastAPI segun servicio |
| Gateway LLM | LiteLLM o gateway propio con politicas y auditoria |
| Orquestacion agentes | LangGraph, Semantic Kernel o flujos propios |
| RAG / vector store | PostgreSQL + pgvector o Qdrant |
| Document AI | OCR, embeddings, chunking, metadata, reranking |
| ML predictivo | MLflow + PyTorch + XGBoost/LightGBM |
| Observabilidad | OpenTelemetry + Prometheus + Grafana + Loki |
| Seguridad | Vault / SOPS, Wazuh, Trivy, Semgrep, OPA |
| Almacenamiento | MinIO en VPS y S3 en AWS |

## 5. Modelos recomendados por categoria

### 5.1 Coding y mantenimiento de software

| Proveedor | Modelo / producto | Ajuste tecnico |
|---|---|---|
| Anthropic | Claude Sonnet 4.6 / Claude Code | Muy alto para refactor, debugging, analisis de repositorios y PRs |
| OpenAI | GPT-5.4 / GPT-5.4 mini | Muy alto para agentes de desarrollo y code reviews |
| Mistral | Codestral / Devstral 2 | Muy atractivo para coding, especialmente si se prioriza portabilidad |
| Google | Gemini 2.5 Pro | Fuerte para reasoning y flujos de trabajo largos |

**Recomendacion**: usar GitHub Copilot como base y complementar con Claude Code o Windsurf para los perfiles senior y tareas de mayor complejidad.

### 5.2 Document AI, ortografia, autocorreccion y mejora contextual

| Componente | Recomendacion |
|---|---|
| OCR complejo PDF / imagen | Mistral OCR 3 |
| Extraccion multimodal y contexto largo | Gemini 2.5 Flash / Pro |
| Reescritura senior y revision ejecutiva | Claude Sonnet 4.6 o GPT-5.4 |
| Embeddings | Gemini Embedding 2 o text-embedding-3-small |
| Reranking | Cohere Rerank o reranker open-source |

**Patron recomendado**: OCR + clasificacion + embeddings + RAG + modelo de redaccion final. No usar un solo modelo para todo el pipeline.

### 5.3 Telemetria, IoT y copilotos operativos

| Necesidad | Modelo recomendado |
|---|---|
| Resumen de alarmas y eventos | Gemini 2.5 Flash-Lite / GPT-5.4 mini / Haiku 4.5 |
| Explicacion operativa de incidentes | Claude Sonnet 4.6 o GPT-5.4 |
| Clasificacion de tickets y observaciones | Gemini Flash-Lite o Haiku |
| Asistente de operadores | Gemini Flash o GPT-4o mini via Azure/OpenAI |

**Nota senior**: para telemetria en tiempo real, el LLM debe estar fuera del loop critico de control. Su rol es interpretacion, clasificacion, resumen y asistencia, no control de actuacion en tiempo real.

### 5.4 Geologia, geotecnia y deteccion de fallas mineras

Aqui el stack correcto es **hibrido**:

1. **Modelos de series temporales y tabulares**: XGBoost, LightGBM, CatBoost.
2. **Modelos secuenciales / deep learning**: PyTorch, Temporal Fusion Transformer, LSTM, TCN.
3. **Geoespacial**: GeoPandas, Rasterio, PostGIS, Kepler.gl o Deck.gl.
4. **LLM**: solo para explicar hallazgos, generar reportes, responder preguntas tecnicas y asistir a ingenieros.

**Recomendacion senior**: los modelos predictivos mineros deben entrenarse con datos propios. Los LLMs comerciales no reemplazan ese trabajo; solo lo aceleran y lo hacen mas accesible.

### 5.5 Vision, deteccion facial y biometria

| Capa | Recomendacion |
|---|---|
| Deteccion facial y embeddings | Continuar con InsightFace + ONNX Runtime |
| Landmarking / preprocesamiento | MediaPipe y OpenCV |
| Backend Python | Mantener Python para este dominio |
| Integracion web | React + servicios Python via API |
| Liveness / PAD | Evaluar servicio comercial si el caso de uso es identidad critica |

**Observacion basada en el repo**: el proyecto ya cuenta con `InsightFace` y `MediaPipe`, por lo que la ruta mas eficiente no es reemplazar esa base, sino industrializarla y endurecerla.

### 5.6 Ciberseguridad y observabilidad asistida

| Necesidad | Recomendacion |
|---|---|
| Triage inicial de alertas | Haiku 4.5, Gemini Flash-Lite o GPT-5.4 mini |
| Explicacion de incidentes | Claude Sonnet o GPT-5.4 |
| Guardrails / controles | Bedrock Guardrails, filtros propios y politicas OPA |
| Analisis de logs | OpenSearch + Loki + LLM copilots |

## 6. SDKs, librerias y plataformas recomendadas

### 6.1 Orquestacion y APIs

1. **LiteLLM** para gateway multi-modelo y normalizacion de APIs.
2. **LangGraph** para agentes controlables con memoria, tools y evaluacion.
3. **FastAPI** para servicios Python IA.
4. **Node.js / TypeScript** para integracion con frontend, auth y APIs de negocio.

### 6.2 ML y entrenamiento

1. **MLflow** para tracking, registry y lineage.
2. **PyTorch** para deep learning.
3. **XGBoost / LightGBM / CatBoost** para tabular y eventos.
4. **scikit-learn** para baselines y pipelines.
5. **DVC** o versionado de datasets si el volumen crece.

### 6.3 Datos y RAG

1. **PostgreSQL + pgvector** para simplicidad y gobierno.
2. **Qdrant** si el volumen vectorial y la latencia exigen especializacion.
3. **Redis** para cache y colas ligeras.
4. **MinIO** en VPS y **S3** en AWS para objetos, datasets y backups.

### 6.4 Linux y plataforma base

1. **Rocky Linux 9** para nodos core, por estabilidad enterprise.
2. **Ubuntu 24.04 LTS** para nodos AI/GPU, por ecosistema de drivers y tooling.

### 6.5 DevOps y seguridad

1. **Docker** y **K3s** para el plano VPS si se desea control ligero.
2. **Terraform u OpenTofu** para IaC.
3. **Ansible** para configuracion y hardening.
4. **GitHub Actions** o GitLab CI para CI/CD.
5. **Trivy, Semgrep, Wazuh, Falco** para seguridad continua.
6. **Vault** o SOPS para secretos.

## 7. Comparativa tecnica de modelos API

| Proveedor | Modelo | Precio input | Precio output | Fuerte en | Observacion |
|---|---|---:|---:|---|---|
| OpenAI | GPT-5.4 | USD 2.50 / 1M | USD 15.00 / 1M | Coding, agentes, razonamiento | Muy util para servicios premium |
| OpenAI | GPT-5.4 mini | USD 0.75 / 1M | USD 4.50 / 1M | Alto volumen, agentes | Muy buen balance costo-calidad |
| Anthropic | Sonnet 4.6 | USD 3.00 / 1M | USD 15.00 / 1M | Repositorios y documentos | Muy fuerte para ingenieria |
| Anthropic | Haiku 4.5 | USD 1.00 / 1M | USD 5.00 / 1M | Clasificacion y soporte rapido | Excelente capa economica |
| Anthropic | Opus 4.7 | USD 5.00 / 1M | USD 25.00 / 1M | Casos premium complejos | Reservar para tareas puntuales |
| Google | Gemini 2.5 Pro | USD 1.25 / 1M | USD 10.00 / 1M | Contexto largo, analisis | Hasta 200K tokens en este tramo |
| Google | Gemini 2.5 Flash | USD 0.30 / 1M | USD 2.50 / 1M | Multimodal barato y rapido | 1M de contexto |
| Google | Gemini 2.5 Flash-Lite | USD 0.10 / 1M | USD 0.40 / 1M | Clasificacion, ETL, routing | Muy atractivo para volumen |
| Mistral | Mistral Medium 3.1 | USD 0.40 / 1M | USD 2.00 / 1M | Agentic, coding, multimodal | Muy buen TCO |
| Mistral | Codestral | USD 0.30 / 1M | USD 0.90 / 1M | Coding dedicado | Muy competitivo |

## 8. Comparativa tecnica de copilotos para ingenieria

| Producto | Precio visible | Ajuste tecnico | Observacion |
|---|---:|---|---|
| GitHub Copilot Pro | USD 10 usuario/mes | Alto | Mejor base de adopcion amplia |
| GitHub Copilot Pro+ | USD 39 usuario/mes | Alto | Mejor para usuarios avanzados |
| Windsurf Teams | USD 40 usuario/mes | Muy alto | Fuerte enfoque agentes + multi-modelo |
| Claude Code Team | USD 150 persona/mes | Muy alto | Excelente para senior engineers |
| Mistral Team | USD 24.99 usuario/mes | Medio/alto | Interesante para colaboracion IA |

## 9. Recomendacion tecnica final por dominio

### 9.1 Ruta recomendada para TIME TELEMETRY

1. **Copilot corporativo base**: GitHub Copilot.
2. **Capa avanzada para arquitectura y refactor**: Claude Code Team o Windsurf Teams.
3. **Modelo principal de documentos y razonamiento**: Claude Sonnet 4.6 o GPT-5.4.
4. **Modelo principal de alto volumen**: Gemini 2.5 Flash / Flash-Lite.
5. **Modelo portable / hybrid**: Mistral Medium, Codestral y modelos open-weight de Mistral.
6. **Capa AWS de continuidad**: Bedrock, Knowledge Bases, Guardrails y S3.
7. **Prediccion minera**: stack propio PyTorch + XGBoost + MLflow + Timescale/Postgres.

### 9.2 Ruta no recomendada

1. Comprar un solo copiloto y asumir que resuelve document AI, vision, prediccion y seguridad.
2. Intentar hacer forecasting minero serio solo con prompts a LLM.
3. Distribuir API keys por proyecto sin gateway central, observabilidad ni cuotas.

## 10. Roadmap de implementacion sugerido

### Fase 1 - 30 a 45 dias

1. Gateway multi-modelo.
2. GitHub Copilot base.
3. Piloto con Claude Code o Windsurf para equipo senior.
4. RAG documental inicial.

### Fase 2 - 45 a 90 dias

1. OCR y document AI.
2. Observabilidad y evaluacion de prompts.
3. Integracion de copilotos para mantenimiento AWS y nueva plataforma VPS.

### Fase 3 - 90 a 180 dias

1. Plataforma ML para prediccion de eventos.
2. Modelos de riesgo y anomalias mineras.
3. Industrializacion de biometria y vision.

## 11. Conclusion tecnica

La conclusion correcta, desde una mirada senior de arquitectura minera LATAM, es que la empresa necesita **una plataforma IA compartida, multivendor, con gobierno central y especializacion por dominio**. La nueva plataforma minera y la continuidad del sistema actual en AWS se benefician mas de una combinacion de modelos y herramientas que de una apuesta unica.

La mejor estrategia tecnica hoy es:

1. **GitHub Copilot + Claude Code o Windsurf** para la productividad del equipo.
2. **Claude / OpenAI / Gemini / Mistral** como portafolio de modelos por API.
3. **ML propio** para prediccion minera.
4. **VPS principal + AWS respaldo** con gateway central, seguridad y observabilidad.

Esa combinacion es la que mejor equilibra costo, velocidad, control, portabilidad, madurez enterprise y aplicabilidad real a la industria minera.
