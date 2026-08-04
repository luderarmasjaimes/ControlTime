# ADR-024 — IA local de redacción: Ollama (reescritura) + LanguageTool (ortografía es-PE)

## Actualización 2026-07-24 — refinado por ADR-068

La redacción y el formato APA siguen siendo locales, pero ya no usan un único
modelo: `gemma2:2b` atiende reescritura y `qwen2.5:7b` APA 7, con fallback
determinístico. ADR-068 permite una excepción acotada a la soberanía:
búsqueda/verificación bibliográfica externa, iniciada explícitamente por el
usuario, sin enviar cuerpo del informe ni dato operativo. Esta excepción no
habilita IA cloud para redacción y prevalece sobre la formulación absoluta
"nada en la nube" de este ADR.

**Status**: implemented (verificado 2026-07-06: servicios `ollama`/`languagetool` en `docker-compose.yml`; `LANGUAGETOOL_URL`/`OLLAMA_URL` configurados en el backend; cero llamadas a OpenAI/Anthropic/Google AI en todo el repo)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: ia

## Contexto

El producto promete asistencia de IA local (<1 s por párrafo, KPI O6) sin depender de la nube (soberanía, ADR-001). El usuario geotécnico redacta informes y necesita corrección ortográfica/gramatical en español de Perú y reescritura asistida. El código ya proxea a **LanguageTool** (corrección es-PE) y a **Ollama** (LLM local) desde el módulo `text` (`text_routes.cpp`, `text_spell_service.cpp`).

## Decisión

La IA de redacción corre **localmente** como sidecars (ADR-004): **LanguageTool self-hosted** para corrección ortográfica/gramatical es-PE, y **Ollama** para reescritura/asistencia con LLM local. El gateway C++ los invoca por HTTP; ningún texto del usuario sale a una API de IA en la nube.

### Reglas duras
- Prohibido llamar a APIs de IA en la nube (OpenAI/Anthropic/etc.) para texto operativo del usuario (viola soberanía).
- La corrección y la reescritura son sidecars stateless; el contexto lo aporta el gateway.
- El presupuesto O6 (<1 s/párrafo) condiciona el tamaño del modelo Ollama elegido.

## Consecuencias

### Positivas
- Cumple soberanía y O6 sin dependencia externa.
- Modelos intercambiables (Ollama permite cambiar de modelo sin tocar el gateway).

### Negativas / Trade-offs
- Modelos locales son menos potentes que los frontier en la nube — aceptado por soberanía; alcanza para corrección/reescritura.
- Requiere hardware (GPU/CPU) en el VPS para latencia <1 s — dimensionado por infraestructura.

### Neutras
- OCR/STT/NLP adicionales, si entran, viven en el sidecar Python (ADR-004).

## Alternativas descartadas

### API de IA en la nube (OpenAI/Anthropic/Gemini)
Más capaz, pero el texto del informe saldría del territorio → viola soberanía (ADR-001). Rechazado.

### Sin IA local (solo corrección por diccionario)
No cumple la promesa de asistencia de redacción; LanguageTool + Ollama dan el salto cualitativo sin nube.

## Referencias
- `Referencias/backend/src/text/text_routes.cpp`, `src/text_spell_service.cpp`
- `Referencias/frontend/src/components/ReportStudioV2/lib/textSpellUtils.js`
- ADR-001 (soberanía), ADR-004 (sidecars), ADR-023 (O6)
