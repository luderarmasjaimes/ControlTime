# Reporte de pendientes — definición, implementación y ADRs
**Generado:** 2026-08-08 · **Rama:** `2026-03-31-elz3-ae7cd` · **Último commit:** `fc0dd48` (2026-07-21, hace 18 días)

---

## 🔴 Resumen ejecutivo (lo más urgente primero)

1. **750 archivos modificados/sin trackear en git, cero commits desde el 21 de julio.** Todo el trabajo de los ADRs 068–095 (¡28 ADRs!) más la migración completa de hoy vive únicamente en el disco de esta máquina. Un `git clean`, un problema de disco, o simplemente trabajar desde otra máquina, lo pierde todo. **Esto es más urgente que cualquier ADR pendiente.**
2. **La migración de hoy (OpenCV/vcpkg, NumPy 2, aislamiento de sesión, fix de rendimiento, fix de registro) no tiene ningún ADR.** Son 6 decisiones de arquitectura reales, ninguna documentada.
3. **Backlog operativo bloqueante para release** (no es código, son decisiones de negocio): pentest sin agendar, dominio de producción sin definir, QA formal sin firma, GO-LIVE sin fecha.
4. Solo **3 ADRs con estado abiertamente abierto**: ADR-035 (`proposed`), ADR-033/034/093 (`partial`).
5. **1 TODO de ADR real sin resolver** en código: proveedor TTS para narración de informes.

---

## 1. Lo que hicimos hoy y todavía no tiene ADR

Trabajo real, verificado en producción (containers reconstruidos y probados con curl/logs), pero sin decisión arquitectónica formal documentada. Recomiendo un ADR por cada bloque (pueden ir numerados 096, 097... siguiendo la convención):

| # sugerido | Tema | Qué se decidió | Archivos tocados |
|---|---|---|---|
| 096 | Migración backend a OpenCV 4.12.0 vía vcpkg | Reemplazar `libopencv-dev` 4.6.0 (apt/Ubuntu, congelado desde 2022) por vcpkg manifest (`backend/vcpkg.json`) compilando OpenCV 4.12.0 estático en la etapa de build. Runtime queda igual (apt) solo para los cascades Haar de respaldo. | `backend/vcpkg.json` (nuevo), `backend/Dockerfile` |
| 097 | Migración ai_engine a NumPy 2.x / OpenCV-Python 4.14 / onnxruntime 1.23.2 | Subir las 3 librerías Python manteniendo insightface en 0.7.3 (bug `np.int` documentado upstream, resuelto con shim propio). Fijado también `opencv-contrib-python<5` por conflicto de namespace `cv2` con `opencv-python-headless`. | `ai_engine/requirements.txt`, `ai_engine/face_embedding_insight.py` |
| 098 | Aislamiento de sesión en captura biométrica en vivo | `gBiometricCaptureState` (backend) y la histéresis de lentes/EAR (`eye_analyzer.py`) eran variables globales de proceso compartidas por TODAS las capturas concurrentes. Se introduce `X-Capture-Session-Id` (generado por pestaña en `authApi.ts`) propagado backend→ai_engine, con mapas por sesión + limpieza TTL en ambos lados. | `backend/src/biometric/biometric_types.{hpp,cpp}`, `biometric_routes.{hpp,cpp}`, `ai_engine_client.cpp`, `main.cpp`, `ai_engine/eye_analyzer.py`, `frontend/src/auth/authApi.ts` |
| 099 | Fallback InsightFace no bloqueante | `analyzeFaceImage()` intentaba InsightFace primero y, si fallaba, retornaba error sin caer al pipeline legacy — contradice el diseño de ADR-089 (InsightFace = motor secundario). Corregido para hacer fallback real. | `backend/src/biometric/face_analysis.cpp` |
| 100 | Límite de hilos onnxruntime para InsightFace | `/face_embedding` tardaba 4-7s con 398% CPU por sobre-suscripción de hilos (onnxruntime detecta núcleos del host, no el cupo de cgroup del contenedor). Se parchea `onnxruntime.InferenceSession` para fijar `intra_op_num_threads=2` cuando el llamador no especifica opciones — mejora de ~10x medida (0.6-0.8s, 8.68% CPU). | `ai_engine/face_embedding_insight.py` |
| 101 | Fix bucle de auto-reintento de registro | El `useEffect` de auto-envío en `AuthGateway.tsx` reintentaba registro cada ~2.7s con los mismos datos tras CUALQUIER error del servidor (incl. errores permanentes como username duplicado), borrando el mensaje de error en cada intento (`setError('')`) — se veía como pantalla parpadeando sin error visible. Corregido: un rechazo del servidor ya no rearma el auto-reintento. | `frontend/src/components/Auth/AuthGateway.tsx` |

**Hallazgo colateral sin resolver:** `docker-compose.prod.yml` tenía la variable `OPENCV_HAAR_DIR` con el nombre viejo (el código espera `BEEMETRY_OPENCV_HAAR_DIR` desde un rename no documentado) — corregido hoy, pero vale la pena confirmar que no hay OTRAS variables de entorno con el mismo tipo de desfase dev/prod.

---

## 2. Riesgo crítico de pérdida de trabajo (fuera del sistema de ADRs)

```
git log -1 --format="%h %ci %s"
fc0dd48 2026-07-21 18:31:47 -0500 fix(auth): autoregistro provisiona tenant real (ADR-067)

git status --short | wc -l
750
```

Desglose: 264 archivos borrados (`D`), 123 modificados (`M`), 262 sin trackear (`??`), 56 renombrados (`R`), resto (`A`/`AM`/`RM`) ya en stage. El propio `docs/decisions/README.md` (actualización 2026-08-07) ya señalaba ~739 archivos sin commitear desde la migración JS→TS (ADR-069) + Vite 8/Rolldown (ADR-093); hoy son 750 — la brecha sigue creciendo, no achicándose.

**Recomendación:** antes de seguir agregando features, hacer un commit (o una serie de commits temáticos) que capture el estado actual. Si hay archivos que NO deberían commitearse (secretos, artifacts de build), es buen momento para revisar `.gitignore` — noté que `artifacts/` y algunos `.tar`/logs aparecen como `D` (borrados) en el status inicial de esta sesión, sugiriendo que se está limpiando el repo de binarios grandes, lo cual es una buena señal si se completa con un commit.

---

## 3. Backlog operativo bloqueante para release (no es código — decisiones de negocio)

Del índice maestro `docs/decisions/README.md` (líneas 641-684):

| Ítem | Estado |
|---|---|
| Dominio real de producción en `BEEMETRY_CORS_ALLOWED_ORIGIN` | Abierto — depende de DNS/HTTPS definitivo |
| Pentest de seguridad pre-release | **No iniciado** |
| QA funcional formal v0.1 (firma del catálogo de 69 casos, ADR-061) | Cobertura parcial (smoke tests); falta pase exhaustivo firmado |
| Grabación real de video (cámara/pantalla) con hardware físico | Pendiente de prueba manual (ADR-064/065) |
| Release v0.1: Deploy + Documentación + GO-LIVE formal | Abierto, sin fecha comprometida |

La fecha referencial "2026-07-31" que aparece en memoria de sesiones previas **solo se sostiene condicionada** a que estos 4 puntos se resuelvan — hoy siguen abiertos.

---

## 4. ADRs con estado abiertamente no cerrado

| ADR | Título | Estado | Qué falta |
|---|---|---|---|
| 035 | Plataforma enterprise LATAM | `proposed` | Nunca pasó a `accepted`/`implemented` — revisar si sigue vigente como visión o se descartó |
| 033 | Convención nombres/prefijos | `partial` | Revisado 2026-07-07, sin cierre desde entonces |
| 034 | Core plataforma IoT (reemplazo ThingsBoard) | `partial` (ampliado) | Adaptadores Modbus/OPC-UA/CoAP/MQTT confirmados implementados 2026-07-13, pero el ADR en sí sigue marcado parcial |
| 093 | Vite 8/Rolldown migración parcial | `partial` | *"todo el árbol sigue sin commitear"* — directamente ligado al punto 2 de este reporte |

**Superseded (sin acción pendiente, solo por completitud):** ADR-028 → reemplazado por ADR-072. ADR-062 → reemplazado por ADR-064/065.

---

## 5. Pendientes puntuales documentados dentro de ADRs específicos

Agrupados por si requieren código o decisión de gerencia/producto:

### Requieren decisión de Gerencia/Producto (no código)
- **ADR-048** (carátula imagen libre): decisión de diseño pendiente de Gerencia.
- **ADR-061** (catálogo QA, hallazgos G1/G2): decisión pendiente de Gerencia.
- **ADR-066** (login razón social minera): alcance no incluido, pendiente de decisión.
- **ADR-067** (autoregistro tenant real): deduplicación/normalización de nombres de empresa, pendiente de decisión de producto.
- **ADR-092** (plantilla TimeTelemetry): divergencia de color de marca (`#EF6535` vs `#F07E41`) sin resolver.
- **ADR-094** (lectura DNI cámara): soporte QR del DNI-e 3.0 fuera de alcance, sin fecha.

### Requieren verificación/prueba (no diseño)
- **ADR-085, 086, 088** (CRUD empresas, RBAC granular, seed demo): implementados backend+frontend, **pendientes de verificación E2E** (Fase 6 del plan).
- **ADR-064, 065** (grabación video cámara/pantalla): implementados, pendiente de prueba manual con hardware físico real (no simulable en sandbox).
- **ADR-072** (GDAL CLI confinado): ya cerrado — verificación E2E completada 2026-08-05.

### Trabajo futuro documentado explícitamente
- **ADR-015** (versionado informe): sin política de retención/archivado.
- **ADR-023** (presupuestos de rendimiento): `measurePerfAsync` sobre el ciclo completo, pendiente.
- **ADR-039** (puente tenant_id↔company_name): tiene sección "Trabajo futuro recomendado (no implementado en esta sesión)" — revisar contenido.
- **ADR-011** (estructura formal secciones/TOC): alcance reconocido como incompleto — no existe un árbol `sections[]` real todavía; está documentado como "funcionalidad pendiente", no como bug.

---

## 6. TODOs de ADR sin resolver, encontrados en código (no en documentación)

| Archivo | Línea | Pendiente real |
|---|---|---|
| `backend/src/reports/report_export_jobs.hpp` | 25 | Proveedor TTS (text-to-speech) para narración por notas de orador — sin decisión arquitectónica propia. ADR-084 lo menciona de pasada como "diferido" pero no hay ADR dedicado. |
| `scripts/ensure-ollama-model.ps1` / `.sh` | 3-4 | Cambio de modelo Ollama default de `tinyllama` a `gemma2:2b` (por alucinaciones, verificado en vivo 2026-07-22) — nunca formalizado en ADR propio. ADR-024/068 tocan Ollama pero no este cambio puntual. |

**Resuelto 2026-08-20:** `db_scripts/65_report_export_narration.sql:3` (renumerado desde `44_report_export_narration.sql` al resolver una colisión real de numeración — ver `docs/decisions/README.md`) ya no dice "ADR pendiente"; el comentario ahora apunta a ADR-083/084.

---

## 7. Advertencia sobre una carpeta trampa

Existe `docs/docs/decisions/` (y `docs/docs/specs/`) — una **copia histórica congelada** con corte al 2026-06-24, sin trackear en git, que su propio README marca explícitamente como "NO ES LA FUENTE VIGENTE". Si alguna herramienta de búsqueda/RAG indexa `docs/` de forma recursiva sin filtrar esa subcarpeta, va a duplicar o contradecir el inventario real. No debe usarse como fuente ni para calcular avance.

---

## 8. Recomendación de orden de ataque

1. **Commitear el estado actual del repo** (750 archivos) — antes que cualquier otra cosa. Sin esto, todo lo demás corre riesgo real de pérdida.
2. **Escribir los 6 ADRs de la migración de hoy** (sección 1) — mientras el contexto está fresco.
3. **Cerrar los 4 ADRs `partial`/`proposed`** (035, 033, 034, 093) — decidir si se aceptan, se archivan, o se completan.
4. **Agendar el pentest** — es la dependencia externa con mayor tiempo de espera típico, conviene arrancarla ya aunque el resto no esté listo.
5. **Definir el dominio de producción** — desbloquea `BEEMETRY_CORS_ALLOWED_ORIGIN` y probablemente otras configuraciones de despliegue.
6. **Firmar el catálogo QA (ADR-061)** y correr las pruebas manuales de video (ADR-064/065) en paralelo a lo anterior.
7. Los TODOs puntuales de código (TTS, modelo Ollama) son de baja urgencia — documentarlos cuando haya ventana, no bloquean nada.
