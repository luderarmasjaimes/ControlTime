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
- **ADR-141** — [`141-avatar-estilizado-difusion-local-sd15-controlnet.md`](../../docs/decisions/141-avatar-estilizado-difusion-local-sd15-controlnet.md)
- **ADR-143** — [`143-silentface-servicio-aislado-cudnn.md`](../../docs/decisions/143-silentface-servicio-aislado-cudnn.md)


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
- **ADR-143** — Silent-Face-Anti-Spoofing (PyTorch) movido a servicio propio
  `silentface_engine`, aislado de TensorFlow por conflicto real de cuDNN —
  contrato HTTP externo sin cambios, fail-closed verificado en runtime real.
  Complementa a ADR-105, no cambia su proveedor ni sus umbrales.
- **ADR-141** — estilizador de avatar por difusión local (SD1.5+ControlNet,
  servicio `avatar_engine` aislado de TensorFlow por conflicto real de
  cuDNN), opcional vía `AVATAR_STYLE_ENGINE`, apagado por defecto.
  Complementa a ADR-074, no lo reemplaza.


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
- [x] **CA-11:** (ADR-141) El estilizador de avatar por difusión corre en un
  proceso/contenedor separado de TensorFlow (`avatar_engine`, sin
  `tensorflow`/`mediapipe`/`insightface` en su `requirements.txt`) — cero
  conflicto de versión de cuDNN con `ai_engine` por construcción, no por
  ajuste de versión.
- [x] **CA-12:** `avatar_engine` nunca ejecuta más de una inferencia de
  difusión en simultáneo (`ThreadPoolExecutor(max_workers=1)`), rechaza
  arrancar sin GPU salvo opt-in explícito (`AVATAR_ENGINE_REQUIRE_GPU=0`), y
  cada request tiene un timeout real (`AVATAR_ENGINE_TIMEOUT_SECONDS`) que
  responde al llamador en vez de colgarlo indefinidamente.
- [x] **CA-13:** Los modelos (SD1.5, ControlNet-Canny) se precargan en GPU
  de forma síncrona antes de que el contenedor acepte tráfico —
  `GET /health` responde `200`/`ready:true` solo después del preload, nunca
  antes.
- [x] **CA-14:** Los pesos se cargan en FP16, formato `safetensors`
  (`variant="fp16"`, `torch_dtype=torch.float16`, `use_safetensors=True`), y
  con revisión de modelo fijada a un commit SHA concreto (no `main` flotante)
  para ambos repositorios HuggingFace usados. El servicio queda detrás del
  perfil Docker `avatar-diffusion`, para no reservar VRAM cuando el modo
  efectivo es `classic`.
- [x] **CA-15:** Antes de activar `AVATAR_STYLE_ENGINE=diffusion` en
  cualquier entorno con usuarios reales: (a) validación visual manual contra
  10-20 retratos de registro autorizados (variedad de tono de piel, lentes,
  iluminación), y (b) prueba de carga con varias registraciones concurrentes.
  **CA-15(b) completado 2026-09-03:** 5 solicitudes simultáneas → 3 procesadas
  en serie y 2 rechazadas inmediatamente con `503 busy`, cero errores/timeouts;
  integración completa devolvió `generator=local_sd15_controlnet`.
  **CA-15(a) completado 2026-09-03** con 12 retratos oficiales de dominio
  público (sustituto de fotos de registro reales por disponibilidad de
  consentimiento; ver manifiesto con fuente/licencia/SHA-256 en
  `artifacts/avatar_ca15_public_domain/sources.json`): 2/12 colapsaban
  (cabeza flotante/rasgos derretidos); causa raíz real fue un falso positivo
  en `_is_oval_matte_black_background()` (fondo oscuro real confundido con el
  óvalo-sobre-negro del cliente), corregido — 12/12 sin colapso tras el fix;
  revalidación fresca en `artifacts/avatar_ca15_verified_20260903/`.
  Detalle completo, hipótesis descartadas y limitación conocida (deriva de
  género/tono de piel bajo difusión, no bloqueante) en ADR-141 actualización
  v4 (2026-09-03).
- [x] **CA-16:** (ADR-143) Silent-Face-Anti-Spoofing corre en un servicio
  separado de TensorFlow/DeepFace (`silentface_engine`, sin `tensorflow` en
  su `requirements.txt`) — verificado que `docker compose build ai_engine`
  (imagen oficial) resuelve y construye sin conflicto de cuDNN con `torch`
  removido, primera vez que esto ocurre.
- [x] **CA-17:** (ADR-143) Fail-closed real verificado: con `silentface_engine`
  detenido, `POST /deepface_analyze` responde `error: "silentface_unavailable"`
  y HTTP 503 — nunca aprueba una verificación cuando el chequeo de
  anti-spoofing no está disponible.
- [x] **CA-18:** (ADR-143) Prueba de carga con múltiples `verify-frame`
  concurrentes reales contra `silentface_engine` — completada 2026-09-03:
  10/10, 20/20 y 50/50 requests exitosas (latencia media 1.03s/0.44s/2.69s
  respectivamente). La corrida a 50 concurrentes encontró un bug real de
  concurrencia preexistente (`cv2.dnn.Net` no thread-safe en el detector
  vendorizado, 4/50 fallos con `OverflowError`) — corregido con un lock
  específico, no simulado ni ignorado. Reproducido tras el fix: 50/50 sin
  errores.

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
