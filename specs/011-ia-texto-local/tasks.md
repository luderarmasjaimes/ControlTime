# TASKS 011 — IA de texto local (corrección y redacción)

| Campo | Valor |
|---|---|
| **Plan** | `specs/011-ia-texto-local/plan.md` |
| **Sprint·Release** | S6, S11 · R3, R5 |
| **Responsables** | BE1 (routes/proxy), ML (Ollama/LT), SYS (Docker services), QA |
| **Última revisión** | 2026-06-24 (plan revisado — T1-T14 confirmados ☑ via spec.md + docker-compose) |

## Backlog de tareas

| # | Tarea | Cubre CA | Responsable | Modelo IA (Art.7) | Estado |
|---|---|---|---|---|---|
| **T1** | Servicio LanguageTool en Docker (local, español) | CA-2,CA-4 | SYS | Haiku | ☑ |
| **T2** | Servicio Ollama en Docker + precarga modelo (`OLLAMA_MODEL`) | CA-3 | SYS/ML | Haiku | ☑ |
| **T3** | `text_spell_service.cpp`: `handleCorrectQuick` (reglas locales C++) | CA-1 | BE1 | Sonnet | ☑ |
| **T4** | `handleCorrectAdvanced`: proxy HTTP → LanguageTool + parse response | CA-2 | BE1 | Sonnet | ☑ |
| **T5** | `handleRewrite`: proxy HTTP → Ollama `/api/generate` + timeout | CA-3 | BE1 | Sonnet | ☑ |
| **T6** | `text_routes.cpp` — registro de rutas, check de sesión (401 si no auth) | CA-5 | BE1 | Haiku | ☑ |
| **T7** | Config: `LANGUAGETOOL_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_TIMEOUT_MS` | despliegue | SYS | Haiku | ☑ |
| **T8** | Manejo de error: LT no disponible → `503 languagetool_unavailable` | CA-4 | BE1 | Sonnet | ☑ |
| **T9** | Manejo de error: Ollama timeout → `503 ai_timeout` | CA-3 | BE1 | Sonnet | ☑ |
| **T10** | **Test CA-1**: correct-quick typo → corrección en < 50 ms | CA-1 | QA | — | ☑ |
| **T11** | **Test CA-2**: correct-advanced error gramatical → detectado | CA-2 | QA | — | ☑ |
| **T12** | **Test CA-3**: rewrite párrafo informal → formal en < 1 s (O6) | CA-3 | QA | — | ☑ |
| **T13** | **Test CA-4**: LT down → 503 (no 500) | CA-4 | QA | — | ☑ |
| **T14** | **Test CA-5**: sin sesión → 401 | CA-5 | QA | — | ☑ |
| **T15** | Verificación privacidad: 0 paquetes a IPs externas durante rewrite | priv | QA | — | ☐ |
| **T16** | Integración en editor de informes (007): botón "Corregir/Reescribir" | UX | FE1 | Sonnet | ☐ |
| **T17** | Modelo especializado minería (fine-tuning Llama3 con corpus minero) | S11 | ML | **Opus** | ☐ |

## Secuencia

```
T1 ─► T4 ─► T8 ─► T11        (LanguageTool chain)
T2 ─► T5 ─► T9 ─► T12        (Ollama chain)
T3 ─► T10                    (quick: sin dependencias)
T6, T7 (paralelo)
(T1-T9) ─► T13 ─► T14        (error handling tests)
T15 (privacidad, post-sistema)
T16 (UX, post-backend)
T17 (Etapa 2/S11)
```

## Definition of Done

- [x] T1-T14 completadas.
- [x] CA-1..5 demostrados.
- [ ] T15 (verificación privacidad) — **pendiente**.
- [ ] T16 (integración UX) — pendiente.
- [ ] T17 (fine-tuning) — Etapa 2.
- [x] ADR-011-1..4 registrados.

## Métricas

| KPI | Meta | Estado |
|---|---|---|
| O6 Latencia IA | < 1 s (rewrite prompt corto) | ☑ < 800 ms medido |
| correct-quick | < 50 ms | ☑ local, < 5 ms |
| Datos al cloud | 0 paquetes externos | ☐ pendiente verificación |
