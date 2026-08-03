# TASKS 018 — Dictado por voz (STT)

| Campo | Valor |
|---|---|
| **Plan** | `specs/018-dictado-voz-stt/plan.md` |
| **Sprint·Release** | S6 (prototipo) · S11 (producción) · R3, R5 |
| **Responsables** | ML (Whisper/modelo), BE1 (routes/C++), FE1 (MediaRecorder), SYS (Docker), QA |
| **Última revisión** | 2026-06-24 (plan y tasks revisados — todo ☐ pendiente, Sprint S6/S11) |

## Backlog de tareas

### Sprint S6 (prototipo whisper.cpp)

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Integrar whisper.cpp como librería en CMakeLists.txt | CA-1 | SYS/BE1 | Haiku | ☐ |
| **T2** | Descargar modelo `ggml-small.es.bin` en build | CA-1 | SYS | Haiku | ☐ |
| **T3** | `stt_service.cpp`: `whisper_full()` → texto (PCM 16kHz mono) | CA-1,CA-2 | BE1 | **Opus** (whisper.cpp API) | ☐ |
| **T4** | Pre-procesamiento: WebM/WAV → PCM via libavcodec | CA-1,CA-3 | BE1 | Sonnet | ☐ |
| **T5** | `POST /api/stt/transcribe` — request base64/bytes → respuesta JSON | CA-1,CA-4 | BE1 | Sonnet | ☐ |
| **T6** | `GET /api/stt/model-status` — solo admin | CA-1 | BE1 | Haiku | ☐ |
| **T7** | Config: `WHISPER_MODEL_PATH`, `WHISPER_LANGUAGE`, `WHISPER_THREADS` | despliegue | SYS | Haiku | ☐ |
| **T8** | Frontend: `MediaRecorder` → chunks 5 s → POST → texto en editor | CA-1 | FE1 | Sonnet | ☐ |
| **T9** | Integración en editor de informes (spec 007): botón "Dictar" | CA-1 | FE1 | Sonnet | ☐ |

### Sprint S11 (producción — servicio Python + fine-tuning)

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T10** | Servicio Python/FastAPI con Whisper HuggingFace (Docker) | CA-1,CA-5 | ML | **Opus** | ☐ |
| **T11** | Backend C++: proxy HTTP → servicio Python (ADR-018-1 Opción B) | CA-1 | BE1 | Sonnet | ☐ |
| **T12** | Diccionario de correcciones mineras (post-procesamiento STT) | CA-2 | ML | Sonnet | ☐ |
| **T13** | Fine-tuning `whisper-medium` con corpus minero peruano | CA-2,CA-3 | ML | **Opus** (ML) | ☐ |
| **T14** | Normalización de audio para ambiente ruidoso (librosa RMS) | CA-3 | ML | Sonnet | ☐ |
| **T15** | `POST /api/stt/transcribe/stream` — chunked transcripción en tiempo real | CA-1 | BE1 | **Opus** | ☐ |
| **T16** | **Test CA-1**: audio 5 s → texto en < 1 s (O6) | CA-1 | QA | — | ☐ |
| **T17** | **Test CA-2**: término minero "tajeo" → transcripción correcta | CA-2 | QA | — | ☐ |
| **T18** | **Test CA-3**: audio con ruido maquinaria → texto legible | CA-3 | QA | — | ☐ |
| **T19** | **Test CA-4**: sin sesión → 401 | CA-4 | QA | — | ☐ |
| **T20** | **Test CA-5**: clip 30 s → texto en < 5 s (CPU) | CA-5 | QA | — | ☐ |
| **T21** | Verificación privacidad: audio no persistido en BD ni disco | priv | QA | — | ☐ |

## Secuencia

```
── S6 (prototipo) ──
T1 ─► T2 ─► T3 ─► T4 ─► T5   (pipeline whisper.cpp)
T6, T7 (paralelo)
T8 ─► T9 (frontend)
T16 ─► T19 (tests básicos)

── S11 (producción) ──
T10 ─► T11                    (servicio Python)
T12 ─► T13 ─► T14            (fine-tuning + ruido)
T15 (streaming)
T17 ─► T18 ─► T20 ─► T21     (tests avanzados)
```

## Definition of Done

### S6 (gate R3 prototipo)
- [ ] T1-T9, T16, T19 completadas.
- [ ] CA-1 (transcripción básica), CA-4 (auth) demostrados.

### S11 (gate R5 producción)
- [ ] T10-T21 completadas.
- [ ] CA-1..5 demostrados con evidencia.
- [ ] ADR-018-1..4 registrados.
- [ ] Sin violar Art. 7 (IA local) ni Art. 6 (privacidad).
- [ ] Gate R5: demo dictado en campo (ambiente real con ruido de maquinaria).

## Métricas

| KPI | Meta | Sprint |
|---|---|---|
| O6 Latencia STT | < 1 s (clip ≤ 5 s) | S11 |
| WER (Word Error Rate) | < 15% (vocabulario minero) | S11 |
| Privacidad | 0 audio en BD | S6+ |
| Clip 30 s | < 5 s CPU | S11 |
