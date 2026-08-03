# PLAN 018 — Dictado por voz (STT)

| Campo | Valor |
|---|---|
| **Spec** | `specs/018-dictado-voz-stt/spec.md` (Borrador) |
| **Autor** | Arquitectura TI |
| **Sprint·Release** | S6 (básico), S11 (avanzado) · R3, R5 |
| **Constitución** | Art. 7 (IA local), Art. 6 (privacidad), Art. 9 (recursos acotados) |
| **Última revisión** | 2026-06-24 (plan revisado — whisper.cpp local, sin API cloud) |

---

## 1. Enfoque técnico

**Speech-to-Text 100% local** con **Whisper** (OpenAI, ejecutado en Docker sin API
cloud). El audio del operador se graba en el browser, se envía al backend como bytes
WAV/WebM y se transcribe localmente. El texto resultante se inserta en el editor de
informes (spec 007) o en campos de formulario.

**Modelo seleccionado:** `whisper-small` o `whisper-medium` (español + jerga minera).
Latencia para 30 s de audio: < 5 s en CPU, < 1 s en GPU. Para cumplir O6 (<1 s) en
CPU, limitar a clips de máximo 5 s de audio o usar streaming chunkeado.

## 2. Arquitectura

```
 Browser (operador)
   ├── MediaRecorder API → PCM/WebM chunks (cada 3-5 s)
   └── POST /api/stt/transcribe (audio bytes base64 o multipart)

 Backend C++
   └── /api/stt/transcribe
         ├── decodificar audio → PCM 16kHz mono
         ├── (Opción A) llamar whisper.cpp (C++, en proceso)
         │   whisper_full(ctx, params, pcm, n_samples) → text
         └── (Opción B) proxy a servicio Whisper Docker (Python/FastAPI)
             POST http://whisper:8002/transcribe → {text, language, confidence}

 Resultado → {text, language, confidence, duration_s}
 → frontend inserta en editor de informe (spec 007)
```

## 3. Dos opciones de implementación (ADR-018-1)

| | Opción A: whisper.cpp | Opción B: servicio Python |
|---|---|---|
| Integración | en proceso C++ (librería) | HTTP interno (Docker) |
| Latencia | más baja (sin HTTP) | +10-30 ms HTTP overhead |
| Modelos | todos los modelos GGML | todos los modelos HuggingFace |
| Mantenimiento | build más complejo | independiente del backend |
| **Recomendación** | S6 prototipo rápido | S11 producción completa |

## 4. Endpoints

| Método | Ruta | Lógica |
|---|---|---|
| POST | `/api/stt/transcribe` | audio → texto (sync o streaming) |
| GET | `/api/stt/model-status` | modelo cargado, idioma, versión (solo admin) |
| POST | `/api/stt/transcribe/stream` | WebSocket o chunked SSE para transcripción en tiempo real |

**Schema request:**
```json
{ "audio_base64": "...", "language": "es", "format": "webm" }
→ { "text": "El motor de la bomba número 3 presenta vibración excesiva.",
    "language": "es", "confidence": 0.92, "duration_s": 4.2 }
```

## 5. Preprocesamiento de audio

```
browser WebM/Opus → FFmpeg (en servidor) → PCM 16kHz mono 16-bit
         │
         └── whisper.cpp/Python → text
```
- FFmpeg corre como librería (libavcodec) o como proceso externo.
- Normalización de volumen (librosa/sox) mejora precisión en ambientes ruidosos
  de mina (maquinaria, viento).

## 6. Especialización para minería (Art. 7)

- **Fine-tuning** con corpus de vocabulario minero (términos técnicos, nombres de
  equipos, siglas): `MMSS`, `tajeo`, `polvorín`, `galería`, `frente de avance`, etc.
- **Post-procesamiento**: diccionario de correcciones frecuentes (STT escucha "casco"
  como "casco" pero puede confundir "socavón" → corrección de lista).
- **Idioma**: español (Perú). Whisper es multilingual pero el modelo fine-tuneado
  mejora la precisión para el acento y términos técnicos locales.

## 7. Privacidad y seguridad (Art. 7, 6)

- El audio NO se almacena en BD — solo el texto transcrito (y solo si el usuario
  lo acepta/guarda en el informe).
- Todo el procesamiento es local (Docker red interna) — sin API de reconocimiento
  de voz de terceros.
- `session_required`: el endpoint verifica sesión válida antes de procesar.

## 8. ADR

| ADR | Decisión | Estado |
|---|---|---|
| ADR-018-1 | **whisper.cpp** para S6 (prototipo rápido), servicio Python para S11 | Propuesto |
| ADR-018-2 | `whisper-small` por defecto — buena precisión en CPU, < 500 MB RAM | Propuesto |
| ADR-018-3 | **No almacenar audio** — solo texto transcrito (privacidad, Art. 7) | Propuesto |
| ADR-018-4 | Chunked transcription (3-5 s) para O6 en CPU en lugar de audio largo | Propuesto |

## 9. Plan de pruebas

| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | POST audio 5 s ("El motor vibra") → texto correcto en < 1 s (O6) | `time curl` |
| CA-2 | Audio con término minero ("tajeo") → transcripción correcta | curl response |
| CA-3 | Audio en ambiente ruidoso (ruido de fondo) → texto legible | grabación real |
| CA-4 | Sin sesión → 401 | curl sin token |
| CA-5 | Latencia < 5 s para clip de 30 s (CPU) | benchmark |
| Priv | Sin audio en BD después de transcripción | SELECT en tablas |
