# PLAN 011 — IA de texto local (corrección y redacción)

| Campo | Valor |
|---|---|
| **Spec** | `specs/011-ia-texto-local/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Sprint·Release** | S6, S11 · R3, R5 |
| **Constitución** | Art. 7 (IA local, sin datos externos), Art. 9 (recursos acotados) |
| **Última revisión** | 2026-06-24 (plan verificado — endpoints LanguageTool/Ollama confirmados en spec.md) |

---

## 1. Enfoque técnico

**Procesamiento NLP 100% local** — ningún texto del operador sale al cloud. Tres
capacidades según el nivel de sofisticación:

1. **Corrección rápida** (`correct-quick`) — reglas locales en C++ o lista de
   correcciones comunes del español técnico minero. Sub-50 ms.
2. **Corrección avanzada** (`correct-advanced`) — delega a **LanguageTool** (servicio
   local en Docker, modelo Java). Latencia ~200-500 ms, detección gramatical completa.
3. **Redacción/reescritura** (`rewrite`) — delega a **Ollama** (LLM local, modelo
   configurable: Llama3, Mistral). Latencia ~0.5-2 s. Cumple O6 < 1 s para prompts cortos.

El **modelo de Art. 7** exige: IA solo para amplificar al ingeniero, datos permanecen
locales, sin cloud AI para datos operacionales.

## 2. Arquitectura

```
 Frontend (editor de informe)
       │
       ├── POST /api/text/correct-quick   ──► text_spell_service.cpp
       │   (inline suggestions, < 50 ms)          (reglas locales)
       │
       ├── POST /api/text/correct-advanced ──► LanguageTool (local Docker)
       │   (revisión gramatical completa)           http://languagetool:8010
       │
       └── POST /api/text/rewrite         ──► Ollama (local Docker)
           (reescribir párrafo)                     http://ollama:11434
                                                   model: OLLAMA_MODEL env

 text_spell_service.cpp
   ├── handleCorrectQuick(json) → {corrections: [{word, suggestion}]}
   ├── handleCorrectAdvanced(json) → proxy to LanguageTool HTTP API
   └── handleRewrite(json) → proxy to Ollama /api/generate
```

## 3. Endpoints

| Método | Ruta | Lógica | Latencia objetivo |
|---|---|---|---|
| POST | `/api/text/correct-quick` | corrección rápida (reglas locales) | < 50 ms |
| POST | `/api/text/correct-advanced` | LanguageTool (gramática/estilo) | < 500 ms |
| POST | `/api/text/rewrite` | Ollama LLM reescritura | < 1 s (O6) |

**Schemas de request/response:**
```json
// correct-quick / correct-advanced
{ "text": "El motor funciono mal" }
→ { "corrected": "El motor funcionó mal", "changes": [{...}] }

// rewrite
{ "text": "...", "instruction": "formalizar para informe técnico" }
→ { "rewritten": "..." }
```

## 4. Configuración

```bash
LANGUAGETOOL_URL=http://languagetool:8010   # vacío = correct-advanced no disponible
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=llama3:8b                      # modelo cargado en Ollama
OLLAMA_TIMEOUT_MS=2000                      # tope duro (O6 < 1 s para prompts cortos)
```

## 5. Manejo de dependencias externas (Art. 7, 9)

- Si LanguageTool no está disponible → `correct-advanced` devuelve `503
  languagetool_unavailable` (no silencia el error — el usuario sabe que el servicio
  no está listo).
- Si Ollama no responde en `OLLAMA_TIMEOUT_MS` → `503 ai_timeout`.
- `correct-quick` nunca falla por dependencias externas (es local).

## 6. Privacidad (Art. 7)

- Todo el texto pasa por servicios en la misma red Docker — **sin salida a Internet**.
- Ollama descarga el modelo en build/primer arranque; luego opera offline.
- LanguageTool corre con el paquete de español local (no llama a `languagetool.org`).
- Los textos **no se almacenan** — cada request es stateless.

## 7. ADR

| ADR | Decisión | Estado |
|---|---|---|
| ADR-011-1 | **LanguageTool local** (no API cloud) — Art. 7: datos no salen | Aceptado |
| ADR-011-2 | **Ollama local** (no OpenAI/Anthropic API) — Art. 7 | Aceptado |
| ADR-011-3 | Tres endpoints separados (quick/advanced/rewrite) — latencia distinta, UX diferente | Aceptado |
| ADR-011-4 | `503` explícito si LanguageTool/Ollama no disponibles (no fallback silencioso) | Aceptado |

## 8. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | `correct-quick`: texto con typo → corrección en < 50 ms | `time curl` |
| CA-2 | `correct-advanced`: texto con error gramatical → LanguageTool detecta | curl response |
| CA-3 | `rewrite`: párrafo informal → versión formal en < 1 s (O6) | `time curl` |
| CA-4 | LanguageTool down → `503 languagetool_unavailable` (no 500) | test sin LT |
| CA-5 | Sin sesión válida → 401 (texto no se procesa) | curl sin token |
| Priv | Traffic capture: 0 paquetes hacia IPs externas durante rewrite | tcpdump |
