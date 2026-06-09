# PROPUESTA EJECUTIVA

## Portafolio de IA para Plataforma Minera, Mantenimiento AWS y Automatizacion de Ingenieria

**Fecha**: 15 de mayo de 2026  
**Dirigido a**: Gerencia General y Gerencia TI  
**Preparado por**: Arquitectura TI Senior LATAM  
**Alcance**: Seleccion de modelos, plataformas y herramientas de IA para la nueva plataforma minera sobre VPS con respaldo AWS, asi como para el mantenimiento y evolucion de la plataforma actual.

---

## 1. Decision ejecutiva recomendada

La empresa no debe adoptar un unico proveedor de IA. Debe adoptar un **portafolio multivendor, gobernado por una capa de abstraccion propia**, con cuatro objetivos de negocio:

1. Acelerar desarrollo y mantenimiento del software actual y de la nueva plataforma minera.
2. Mejorar productividad documental, analitica y operativa de ingenieros en varios proyectos simultaneos.
3. Habilitar capacidades de IA aplicada a telemetria, geologia, fallas mineras, biometria y analitica predictiva.
4. Reducir riesgo de dependencia comercial o tecnica de un solo fabricante.

## 2. Recomendacion resumida por capa

### 2.1 Capa de productividad de ingenieria

1. **Base corporativa de copiloto**: GitHub Copilot para adopcion amplia en VS Code y ecosistema GitHub.
2. **Capa avanzada para senior engineers y refactors complejos**: Claude Code Team o Windsurf Teams para los equipos que trabajan cambios multiarchivo, debugging profundo y agentes de desarrollo.

### 2.2 Capa de modelos fundacionales por API

Se recomienda trabajar con cuatro familias principales:

1. **Anthropic Claude**: muy fuerte para coding, refactorizacion, analisis de repositorios y documentos complejos.
2. **OpenAI / Azure OpenAI**: muy fuerte para agentes, flujos empresariales, multimodalidad y ecosistemas corporativos.
3. **Google Gemini**: muy fuerte en costo-rendimiento, contexto largo, grounding y procesamiento multimodal.
4. **Mistral**: especialmente valioso por portabilidad, self-hosting y estrategia hybrid/on-prem.

## 3. Recomendacion de arquitectura empresarial

La arquitectura recomendada para TIME TELEMETRY es:

1. **VPS / nube privada en Lima como plataforma operativa principal** para la nueva solucion minera.
2. **AWS como respaldo, contingencia, mantenimiento de la plataforma actual y servicios complementarios**.
3. **Gateway de modelos centralizado** para que todos los ingenieros usen una misma capa de acceso, auditoria, control de costo y gobierno.
4. **Repositorio comun de prompts, agentes, conectores y evaluaciones** para reuso transversal entre proyectos de automatizacion minera.

## 4. Hallazgo clave de arquitectura

Para los casos de uso mineros de la empresa, la IA no debe verse solo como un chatbot. Debe organizarse como una **plataforma compartida de capacidades**, con estos dominios:

1. Asistencia de desarrollo y DevOps.
2. Procesamiento documental y mejora de contexto.
3. Analitica operativa y copilotos para telemetria.
4. Vision computacional, deteccion facial y biometria.
5. Modelos predictivos y entrenamiento para eventos mineros.
6. Ciberseguridad y observabilidad asistida por IA.

## 5. Recomendacion por caso de uso

| Caso de uso | Recomendacion principal | Recomendacion secundaria |
|---|---|---|
| Coding, refactor y analisis de repositorios | Claude Sonnet / Claude Code | GPT-5.4 mini o Windsurf |
| Asistentes generativos empresariales | GPT-5.4 / Azure OpenAI | Gemini 2.5 Pro |
| Procesamiento documental a gran escala | Gemini 2.5 Flash / Flash-Lite | Mistral OCR + GPT/Claude |
| OCR avanzado y document AI | Mistral OCR 3 | Gemini document processing |
| Embeddings y RAG documental | Gemini Embedding 2 / text-embedding-3-small | Cohere Embed / Mistral Embed |
| Correccion de redaccion, ortografia y estilo | Claude Sonnet / GPT-5.4 mini | Gemini Flash |
| Vision, deteccion facial, biometria | InsightFace + MediaPipe + ONNX Runtime | Servicio comercial de liveness si el riesgo crece |
| Prediccion de eventos mineros | XGBoost, LightGBM y PyTorch | LLM solo como capa explicativa |
| SOC copilots y ciberseguridad | Claude Haiku / Gemini Flash-Lite / GPT-5.4 mini | Bedrock con guardrails |

## 6. Precios oficiales publicos de referencia

**Valores referenciales consultados en paginas oficiales al 15 de mayo de 2026.** Los precios enterprise finales pueden variar por contrato, region, volumen, residencia de datos y throughput reservado.

| Proveedor | Modelo / servicio | Input | Output | Nota ejecutiva |
|---|---|---:|---:|---|
| OpenAI | GPT-5.4 | USD 2.50 / 1M tokens | USD 15.00 / 1M tokens | Fuerte para trabajo profesional y coding |
| OpenAI | GPT-5.4 mini | USD 0.75 / 1M tokens | USD 4.50 / 1M tokens | Muy util para agentes de alto volumen |
| Anthropic | Sonnet 4.6 | USD 3.00 / 1M tokens | USD 15.00 / 1M tokens | Muy fuerte para codigo y documentos |
| Anthropic | Haiku 4.5 | USD 1.00 / 1M tokens | USD 5.00 / 1M tokens | Buena relacion costo-velocidad |
| Anthropic | Opus 4.7 | USD 5.00 / 1M tokens | USD 25.00 / 1M tokens | Para tareas premium y razonamiento fuerte |
| Google | Gemini 2.5 Pro | USD 1.25 / 1M tokens | USD 10.00 / 1M tokens | Hasta 200K tokens; mas arriba sube precio |
| Google | Gemini 2.5 Flash | USD 0.30 / 1M tokens | USD 2.50 / 1M tokens | 1M de contexto y muy buen costo-rendimiento |
| Google | Gemini 2.5 Flash-Lite | USD 0.10 / 1M tokens | USD 0.40 / 1M tokens | Muy util para clasificacion y alto volumen |
| Mistral | Mistral Medium 3.1 | USD 0.40 / 1M tokens | USD 2.00 / 1M tokens | Portabilidad y fuerte costo-rendimiento |
| Mistral | Codestral | USD 0.30 / 1M tokens | USD 0.90 / 1M tokens | Muy atractivo para coding especifico |

## 7. Herramientas compartidas para ingenieria

| Herramienta | Precio oficial visible | Lectura ejecutiva |
|---|---:|---|
| GitHub Copilot Pro | USD 10 por usuario/mes | Muy buena base para adopcion amplia |
| GitHub Copilot Pro+ | USD 39 por usuario/mes | Mejor para usuarios avanzados |
| Windsurf Teams | USD 40 por usuario/mes | Fuerte en agentes y uso multi-modelo |
| Claude Code Team | USD 150 por persona/mes | Muy potente para senior engineers |
| Mistral Team | USD 24.99 por usuario/mes | Interesante para colaboracion con fuerte orientacion IA |

## 8. Recomendacion de compra y adopcion

### 8.1 Opcion recomendada

1. **Base corporativa**: GitHub Copilot para todos los desarrolladores principales.
2. **Capa senior**: 5 a 10 licencias de Claude Code Team o Windsurf Teams para arquitectura, refactor y agentes de desarrollo.
3. **Gateway central de modelos**: acceso gobernado a OpenAI, Anthropic, Google, Azure OpenAI y Bedrock.
4. **Stack predictivo propio**: entrenamiento de modelos con PyTorch, XGBoost y MLflow sobre datos mineros internos.

### 8.2 Lo que no se recomienda

1. No concentrar toda la estrategia en una sola marca.
2. No usar LLMs como sustituto de modelos predictivos especializados para series temporales y eventos mineros.
3. No dejar que cada ingeniero contrate herramientas aisladas sin gobierno, trazabilidad ni control de costo.

## 9. Presupuesto orientativo

### 9.1 Productividad de ingenieria

Una estrategia realista de inicio podria ser:

1. 20 a 30 licencias base de copiloto.
2. 5 a 10 licencias premium para power users.
3. Presupuesto mensual de API para pruebas, asistentes documentales y RAG.

### 9.2 Consumo de modelos

Para alto volumen documental, clasificacion y automatizacion, **Gemini Flash / Flash-Lite y Mistral Medium / Codestral** muestran ventajas economicas claras. Para tareas de mas riesgo, **Claude Sonnet y GPT-5.4** justifican mejor su precio en funciones de razonamiento, codigo y decision asistida.

## 10. Conclusiones ejecutivas

1. **La estrategia correcta es multivendor y gobernada**, no monomarca.
2. **La empresa necesita una plataforma compartida de IA**, no solo licencias individuales.
3. **Para coding y arquitectura**, Claude y GitHub Copilot deben estar en el short list principal, con Windsurf como alternativa seria.
4. **Para alto volumen y multimodalidad**, Gemini ofrece una relacion costo-capacidad muy competitiva.
5. **Para portabilidad y despliegue controlado**, Mistral es especialmente valioso.
6. **Para continuidad con AWS**, Bedrock y la capa AWS deben mantenerse como respaldo y entorno de integracion, no como unico frente de IA.
7. **Para prediccion minera**, el valor diferencial estara en modelos propios entrenados con datos internos, no solo en LLMs generalistas.

## 11. Decision sugerida a gerencia

Se recomienda aprobar un programa de adopcion en tres fases:

1. **Fase 1**: copilotos de desarrollo + gateway de modelos + RAG documental.
2. **Fase 2**: document AI, biometria, seguridad asistida y analitica operacional.
3. **Fase 3**: entrenamiento de modelos de prediccion de eventos y automatizacion avanzada minera.
