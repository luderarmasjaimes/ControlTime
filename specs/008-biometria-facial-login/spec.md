# SPEC 008 — Biometría facial para login de operación

| Campo | Valor |
|---|---|
| **ID** | 008 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | IA avanzada / biometría (Etapa 2, S6/S11, R3/R5); IA local (no nube) |
| **Constitución** | Art. 6 (seguridad), Art. 1 (multitenant) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-008**.

- **ADR-007** — [`ADR-007-sdd-specs-fuente-verdad.md`](../adr/ADR-007-sdd-specs-fuente-verdad.md)
- **ADR-009** — [`ADR-009-git-branching-feature-release.md`](../adr/ADR-009-git-branching-feature-release.md)
- **ADR-010** — [`ADR-010-ai-routing-por-tarea.md`](../adr/ADR-010-ai-routing-por-tarea.md)
- **ADR-011** — [`ADR-011-rag-memoria-proyecto.md`](../adr/ADR-011-rag-memoria-proyecto.md)
- **ADR-012** — [`ADR-012-revision-pr-adr-spec.md`](../adr/ADR-012-revision-pr-adr-spec.md)

## Decisiones vigentes complementarias

- **ADR-025** — login facial activo bajo gate legal; EPP diferida.
- **ADR-029/041** — identidad JWT y refresh canónico.
- **ADR-074** — avatar local HD derivado, self-only y bajo demanda.
- **ADR-075** — textos/estados biométricos en ES/EN/FR/PT-BR.
- **ADR-076/077** — CSPRNG y Argon2id implementados; no cambian umbrales,
  plantilla facial ni soberanía.


## 1. Problema
En campo minero, el login por contraseña es lento y propenso a suplantación. Se
requiere verificación de identidad por rostro, **ejecutada localmente en el
servidor** (no nube), para acceso de operación.

## 2. Objetivo
Verificar identidad por rostro con modelos locales (ONNX/InsightFace), con
calidad de imagen ICAO mínima, integrado al login (006), sin enviar datos a la nube.

## 3. Usuarios y contexto
- **Roles:** operador en campo (tablet). **Multitenant:** plantilla facial por
  usuario/empresa. **IA local:** servicio `ai_engine` (no nube — soberanía SOW).

## 4. Alcance
**Incluye:** captura de frame, verificación de calidad (gafas/máscara/frontal/
ojos), comparación de embedding facial (umbral coseno), enrolamiento y avatar
local derivado del retrato conforme a ADR-074.
**NO incluye:** reconocimiento 1:N masivo, visión EPP (spec 017).

## 5. Criterios de aceptación
- [ ] **CA-1:** Verifica un frame contra la plantilla del usuario y responde match/no-match con score.
- [ ] **CA-2:** Rechaza imágenes de baja calidad (no frontal, ojos cerrados, oclusión) según umbral ICAO configurable.
- [ ] **CA-3:** (soberanía) Todo el procesamiento ocurre **local** (`ai_engine`), sin llamadas a APIs externas.
- [ ] **CA-4:** (multitenant) La plantilla y verificación están aisladas por empresa/usuario.
- [ ] **CA-5:** El enrolamiento guarda el embedding de forma segura; la verificación usa umbral coseno configurable.
- [ ] **CA-6:** Estado del subsistema disponible en `/api/auth/biometric/status` (gated admin).
- [x] **CA-7:** El avatar derivado se genera localmente; su miniatura no
  arrastra el maestro 4K en la sesión y la ampliación self-only se cierra con
  clic exterior o `Esc`.
- [x] **CA-8:** Instrucciones de cámara, calidad ICAO, liveness, errores y
  estados del enrolamiento/login facial se muestran en el idioma activo sin
  cambiar umbrales, plantilla, proveedor local ni reglas de privacidad.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Procesamiento | local (ONNX/InsightFace `buffalo_l`) |
| Latencia verificación | objetivo < 1 s (warmup precargado) |
| Umbrales | `FACE_EMBEDDING_COSINE_THRESHOLD`, `BIOMETRIC_ICAO_EYE_CONFIDENCE_MIN` |

## 7. Contratos (endpoints reales)
- `POST /api/auth/biometric/verify-frame`, `GET /api/auth/biometric/status`
- `POST /api/process_frame`, `POST /api/auth/login/face`, `POST /api/enroll`

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Falsos positivos/negativos | umbral calibrado + calidad ICAO; afinado pre-UAT (S11) |
| Cold start del modelo (latencia) | `WARMUP_FACE_EMBEDDING=1` (precarga) |
| Privacidad de datos biométricos | almacenamiento cifrado, soberano, auditable |
