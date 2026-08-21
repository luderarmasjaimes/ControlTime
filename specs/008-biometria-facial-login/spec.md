# SPEC 008 — Biometría facial para login de operación

| Campo | Valor |
|---|---|
| **ID** | 008 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | IA avanzada / biometría (Etapa 2, S6/S11, R3/R5); IA local (no nube) |
| **Constitución** | Art. 6 (seguridad), Art. 1 (multitenant) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-008**; fuente ADR: `docs/decisions/`.

- **ADR-025** — [`025-biometria-vision-epp-diferidas.md`](../../docs/decisions/025-biometria-vision-epp-diferidas.md)
- **ADR-029** — [`029-rbac-identidad-plataforma-jwt.md`](../../docs/decisions/029-rbac-identidad-plataforma-jwt.md)
- **ADR-041** — [`041-resiliencia-token-fetch-crudo.md`](../../docs/decisions/041-resiliencia-token-fetch-crudo.md)
- **ADR-074** — [`074-avatar-biometrico-local-hd-bajo-demanda.md`](../../docs/decisions/074-avatar-biometrico-local-hd-bajo-demanda.md)
- **ADR-075** — [`075-internacionalizacion-pais-idioma-acceso.md`](../../docs/decisions/075-internacionalizacion-pais-idioma-acceso.md)
- **ADR-076** — [`076-separacion-identificadores-secretos-csprng.md`](../../docs/decisions/076-separacion-identificadores-secretos-csprng.md)
- **ADR-077** — [`077-migracion-password-argon2id-versionada.md`](../../docs/decisions/077-migracion-password-argon2id-versionada.md)
- **ADR-089** — [`089-biometria-dermalog-cli-integration.md`](../../docs/decisions/089-biometria-dermalog-cli-integration.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-099** — [`099-fallback-insightface-no-bloqueante.md`](../../docs/decisions/099-fallback-insightface-no-bloqueante.md)
- **ADR-104** — [`104-seetaface6-proveedor-biometrico-local.md`](../../docs/decisions/104-seetaface6-proveedor-biometrico-local.md)
- **ADR-105** — [`105-deepface-silentface-proveedor-biometrico-primario.md`](../../docs/decisions/105-deepface-silentface-proveedor-biometrico-primario.md)
- **ADR-107** — [`107-geolocalizacion-cliente-login-contrasena.md`](../../docs/decisions/107-geolocalizacion-cliente-login-contrasena.md)


## Decisiones vigentes complementarias

- **ADR-025** — login facial activo bajo gate legal; EPP diferida.
- **ADR-029/041** — identidad JWT y refresh canónico.
- **ADR-074** — avatar local HD derivado, self-only y bajo demanda.
- **ADR-075** — textos/estados biométricos en ES/EN/FR/PT-BR.
- **ADR-076/077** — CSPRNG y Argon2id implementados; no cambian umbrales,
  plantilla facial ni soberanía.
- **ADR-104** — SeetaFace6 libre/local seleccionable, PAD fail-closed y sin
  afirmación de certificación RENIEC/ISO/NIST. **Superseded por ADR-105** como
  proveedor por defecto (queda seleccionable para rollback/comparación).
- **ADR-105** — DeepFace (Facenet512) + Silent-Face-Anti-Spoofing (MiniFASNet)
  como proveedor biométrico local por defecto; Dermalog como secundario
  explícito solo ante fallos de infraestructura, nunca ante rechazos de
  seguridad (spoof/no-match).


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
- [x] **CA-6:** Estado del subsistema disponible en `/api/auth/biometric/status` (gated admin).
- [x] **CA-7:** El avatar derivado se genera localmente; su miniatura no
  arrastra el maestro 4K en la sesión y la ampliación self-only se cierra con
  clic exterior o `Esc`.
- [x] **CA-8:** Instrucciones de cámara, calidad ICAO, liveness, errores y
  estados del enrolamiento/login facial se muestran en el idioma activo sin
  cambiar umbrales, plantilla, proveedor local ni reglas de privacidad.
- [x] **CA-9:** SeetaFace6 se ejecuta localmente en Docker, requiere un solo
  rostro y liveness `REAL`, y no acepta plantillas de cliente como sustituto
  de la imagen evaluada por el servidor.
- [ ] **CA-10:** Antes de producción existe informe de calibración independiente
  con FMR/FNMR/FTE/FTA y, cuando el TDR lo exija, ensayo ISO/IEC 30107-3.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Procesamiento | local (DeepFace+Silent-Face por defecto; SeetaFace6/InsightFace/Dermalog seleccionables) |
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
