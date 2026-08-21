# SPEC 011 — IA de texto local (corrección y redacción)

| Campo | Valor |
|---|---|
| **ID** | 011 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | KPI **O6** (corrección por párrafo < 1 s); IA local no nube (S6, S11) |
| **Constitución** | Art. 6 (soberanía/seguridad), Art. 5 (observabilidad) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-011**; fuente ADR: `docs/decisions/`.

- **ADR-024** — [`024-ia-local-ollama-languagetool.md`](../../docs/decisions/024-ia-local-ollama-languagetool.md)
- **ADR-068** — [`068-ia-editorial-multimodelo-referencias-externas-controladas.md`](../../docs/decisions/068-ia-editorial-multimodelo-referencias-externas-controladas.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-093** — [`093-vite8-rolldown-migracion-parcial-interop-plotly.md`](../../docs/decisions/093-vite8-rolldown-migracion-parcial-interop-plotly.md)
- **ADR-094** — [`094-lectura-dni-camara-pdf417-mrz.md`](../../docs/decisions/094-lectura-dni-camara-pdf417-mrz.md)
- **ADR-095** — [`095-usermaintenancemodal-css-autocontenida-marca.md`](../../docs/decisions/095-usermaintenancemodal-css-autocontenida-marca.md)
- **ADR-096** — [`096-opencv-4-12-vcpkg-backend.md`](../../docs/decisions/096-opencv-4-12-vcpkg-backend.md)


## 1. Problema
Los informes técnicos requieren corrección ortográfica/gramatical y reescritura
asistida, pero **sin enviar texto confidencial a la nube** (soberanía). Debe ser
rápido (< 1 s) para no interrumpir la redacción.

## 2. Objetivo
Corrección y reescritura de texto ejecutadas **localmente** (LanguageTool + Ollama
on-premise), integradas al editor (007), respondiendo < 1 s por párrafo.

## 3. Usuarios y contexto
- **Roles:** redactor de informes. **IA local:** `languagetool` (gramática) +
  `ollama` (reescritura). El backend centraliza en `/api/text/*`.

## 4. Alcance
**Incluye:** corrección rápida y avanzada, reescritura, chequeo LanguageTool.
**NO incluye:** traducción multi-idioma masiva, generación de informe completo.

## 5. Criterios de aceptación
- [ ] **CA-1:** Corrección de un párrafo responde **< 1 s** (O6).
- [ ] **CA-2:** (soberanía) Todo el procesamiento es **local** (LanguageTool/Ollama), sin APIs externas.
- [ ] **CA-3:** Endpoints responden: `/api/text/correct/quick`, `/correct/advanced`, `/rewrite`, `/languagetool-check`.
- [ ] **CA-4:** Tope de tamaño de texto configurable (`TEXT_SPELL_MAX_CHARS`).
- [ ] **CA-5:** Degrada con gracia si Ollama no está listo (corrección básica sigue disponible).

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Latencia corrección | < 1 s (O6) |
| Soberanía | 100% local |
| Modelo reescritura | local (`OLLAMA_MODEL`, hot) |

## 7. Contratos (endpoints reales)
- `POST /api/text/correct/quick`, `POST /api/text/correct/advanced`
- `POST /api/text/rewrite`, `POST /api/text/languagetool-check`

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Cold start de Ollama (latencia) | mantener modelo hot (`OLLAMA_KEEP_ALIVE=-1`) |
| Texto muy largo satura | `TEXT_SPELL_MAX_CHARS` + timeouts |
