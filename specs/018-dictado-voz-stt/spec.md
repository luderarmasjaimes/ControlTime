# SPEC 018 — Dictado por voz (STT) para informes

| Campo | Valor |
|---|---|
| **ID** | 018 · **Estado** | **Borrador (a construir — S6/S11)** |
| **SOW** | IA: dictado por voz / STT (S6 demo, afinado S11); IA local |
| **Constitución** | Art. 6 (soberanía), Art. 1 (multitenant) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-018**; fuente ADR: `docs/decisions/`.

- **ADR-024** — [`024-ia-local-ollama-languagetool.md`](../../docs/decisions/024-ia-local-ollama-languagetool.md)
- **ADR-068** — [`068-ia-editorial-multimodelo-referencias-externas-controladas.md`](../../docs/decisions/068-ia-editorial-multimodelo-referencias-externas-controladas.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-095** — [`095-usermaintenancemodal-css-autocontenida-marca.md`](../../docs/decisions/095-usermaintenancemodal-css-autocontenida-marca.md)


## 1. Problema
En campo, con guantes y manos ocupadas, escribir informes es lento. El operador
necesita **dictar por voz** y que el texto se transcriba dentro del editor (007),
**localmente** (sin enviar audio a la nube).

## 2. Objetivo
Transcripción de voz a texto (STT) local, integrada al editor, en español de mina.

## 3. Usuarios y contexto
- **Roles:** operador de campo, redactor de informes. **Dispositivo:** tablet en
  ambiente de mina (ruido, sin manos libres). **IA local:** modelo STT en `ai_engine`.
- **Integración:** texto insertado en editor ReportStudio (007).

## 4. Alcance
**Incluye:** captura de audio, transcripción local (modelo STT), inserción en el
editor. **NO incluye:** comandos de voz para controlar la app, identificación de
locutor.

## 5. Criterios de aceptación
- [ ] **CA-1:** El usuario dicta y el texto aparece transcrito en el editor.
- [ ] **CA-2:** (soberanía) La transcripción es **local**, sin enviar audio a la nube.
- [ ] **CA-3:** Soporta español (es-PE) con vocabulario de dominio minero.
- [ ] **CA-4:** Latencia de transcripción razonable para dictado fluido (cuasi tiempo real).
- [ ] **CA-5:** (multitenant) El audio/transcripción no cruza empresas; no se retiene audio salvo configuración.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Procesamiento | local (modelo STT en `ai_engine`/IA) |
| Idioma | es-PE + términos mineros |
| Privacidad | audio no persistido por defecto |

## 7. Plan técnico (esbozo)
- Modelo STT local (p. ej. Whisper/Vosk) en el servicio de IA; streaming de audio
  desde el navegador; inserción en ReportStudio (007).

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Ruido de mina degrada precisión | modelo robusto + corrección posterior (011) |
| Latencia alta | chunking de audio + modelo dimensionado |
