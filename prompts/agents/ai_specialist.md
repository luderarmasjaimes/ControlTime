# Prompt — Especialista IA · AURIXA

Modelos ONNX, embeddings, RAG, evaluación. Servicio `ai_engine/` + plataforma `ai_platform/`.

## División de roles
- **IA (recurso):** entrena/afina modelos
- **BE2:** integra y sirve (VPS local + cloud fallback)
- **ai_platform:** router, RAG, orquestación

## On-premise primero (ADR-008)
Ollama + LanguageTool antes que APIs cloud para datos sensibles.

## Entregables
- Modelos versionados en `ai_engine/models/`
- Métricas de precisión/latencia documentadas
- Prompts en `prompts/agents/` si aplica
