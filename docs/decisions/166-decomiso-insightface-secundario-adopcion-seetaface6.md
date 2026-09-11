# ADR-166 — Decomiso de InsightFace como motor biométrico secundario; adopción de SeetaFace6Open

**Status**: accepted (decisión de producto/licencia); implementación de wiring pendiente

**Fecha**: 2026-09-11

**Ámbito**: ia, seguridad, biometría, plataforma

**Relación**: cierra formalmente la decisión comercial que ADR-144 dejó pendiente
(evaluación de InspireFace); actualiza ADR-089 y ADR-099 (InsightFace como motor
secundario, rol que aquí se retira); usa la integración ya existente de ADR-104
(SeetaFace6Open); no cambia la jerarquía de proveedores por defecto fijada por
ADR-105 (DeepFace+Silent-Face sigue siendo el proveedor local primario).

## Contexto

`backend/src/biometric/face_analysis.cpp` documenta en su propio comentario que
"InsightFace es motor secundario (ADR-089)": desde ADR-089 (2026-08-05,
parcialmente superseded por ADR-105) y ADR-099 (2026-08-08), el pipeline de
captura llama de forma no bloqueante a `ai_engine/face_embedding_insight.py`
— el paquete `insightface` de PyPI, modelo `buffalo_l` — para generar un
embedding de alta seguridad que mejora la plantilla capturada frente al
fallback legado (heurística 24×24, no es un embedding biométrico real). Las
cuentas registradas por este camino quedan marcadas
`face_template_provider = 'insightface_onnx'` en Postgres
(`backend/src/auth/auth_storage_pg.cpp:1115`) y ese valor gobierna una rama de
comparación propia en el login facial.

Al redactar ADR-144 (evaluación de InspireFace, SDK C/C++ de HyperInspire) se
encontró que sus packs de modelos gratuitos heredan una licencia de "solo uso
académico" de InsightFace, incompatible con un producto comercial como
Beemetry (vendido a empresas mineras, ver `kMiningCompanies` en
`backend/src/config/app_config.hpp`). Investigando esa misma restricción para
este ADR se confirma que **no es exclusiva de InspireFace**: el propio
`buffalo_l` que ya corre en producción desde ADR-089 tiene la misma condición.
El código de InsightFace es MIT, pero sus modelos pre-entrenados (incluido
`buffalo_l`) están licenciados solo para investigación/uso no comercial; usarlos
comercialmente requiere contactar a InsightFace para una licencia aparte
(`recognition-oss-pack@insightface.ai`), sin tier gratuito para producción
comercial — ver la página de licenciamiento empresarial de InsightFace y el
issue público `deepinsight/insightface#2587` ("Pricing of Buffalo Model").

A diferencia de InspireFace (ADR-144, spike de I+D que nunca se desplegó a
producción), **InsightFace/`buffalo_l` sí está desplegado en producción hoy**
como motor secundario — esto convierte el hallazgo de licencia en una
exposición real, no solo en un riesgo evitado a tiempo.

## Decisión

1. **Se decomisiona InsightFace (`buffalo_l`) como motor biométrico
   secundario.** No se contrata licencia comercial con InsightFace: no se
   justifica el costo/proceso de licenciamiento frente a una alternativa ya
   integrada, sin esa restricción y sin costo (punto 2). Con esto, **ADR-144
   queda formalmente cerrado**: la decisión de no adoptar InspireFace se
   confirma con la misma justificación comercial, ahora extendida
   explícitamente a InsightFace. No se edita el texto original de ADR-144 ni
   de ADR-089/099 — ver el bloque de actualización fechado que este ADR agrega
   a cada uno.
2. **Se adopta SeetaFace6Open (`BiometricProvider::SeetaFace6`) como
   reemplazo.** Ya vendorizado, compilado y verificado desde ADR-104 (commit
   `a32e2faa0694c0f841ace4df9ead0407b78363c6`, licencia BSD confirmada: el
   propio README de `SeetaFace6Open/index` declara *"SeetaFace open source
   version can be used freely for commercial and personal purposes"*), con
   detección, 5 landmarks, reconocimiento 1:1 (1024 componentes) y PAD de un
   frame propios — cubre el mismo rol funcional que hoy cumple InsightFace
   (generar un embedding de identidad de mayor calidad que el fallback
   legado), sin depender de un proveedor externo de licencias.
3. **Se evalúa y se descarta libfacedetection (ShiqiYu, BSD-3-Clause,
   `github.com/ShiqiYu/libfacedetection`) como reemplazo directo.** Es
   exclusivamente un detector de rostros + 5 landmarks (hasta 1000 FPS en
   CPU), sin componente de reconocimiento/embedding de identidad — no puede
   cumplir el rol que hoy cumple InsightFace (comparación 1:1 de identidad),
   por más permisiva que sea su licencia. Mismo patrón de error que este log
   ya evitó una vez (ADR-144, descartar LivePortrait/LatentSync por
   desajuste técnico con el objetivo real, no solo por licencia): no se
   adopta una pieza que no resuelve el problema solo porque su licencia es
   favorable. Queda documentado como candidato viable únicamente para una
   etapa de detección/pre-filtro rápido (p. ej. sustituir el Haar cascade del
   pipeline "Legacy" de baja calidad) — si se persigue esa vía, requiere su
   propio ADR, porque no es la misma decisión que reemplazar el motor
   secundario de reconocimiento.
4. **Cuentas existentes con `face_template_provider = 'insightface_onnx'`
   quedan sin camino de login una vez retirado el proveedor.** Confirmado
   explícitamente por el developer: en el entorno actual son cuentas de
   prueba del entorno de desarrollo — se eliminan o se reinscriben con
   SeetaFace6/DeepFace sin impacto de negocio. Esta decisión NO se extiende
   por sí sola a un entorno productivo con usuarios reales: si en el futuro
   existen cuentas productivas bajo este proveedor, su migración exige el
   mismo cuidado que ADR-105 ya documentó para cualquier cambio de motor
   ("las plantillas de algoritmos distintos no son interoperables" — reenrolar,
   no migrar el vector).

## Trabajo de implementación pendiente (fuera de alcance de este ADR)

Este ADR fija la decisión de producto/licencia; el wiring queda para quien
mantenga `ai_engine`/`backend/src/biometric`:

- Retirar o redirigir la llamada auxiliar de `face_analysis.cpp` a
  `/face_embedding` (InsightFace) hacia un endpoint equivalente sobre
  SeetaFace6Open, o simplemente eliminarla y dejar que SeetaFace6 opere solo
  como proveedor completo seleccionable (`BEEMETRY_BIOMETRIC_PROVIDER=seetaface6`),
  sin la capa auxiliar de "mejora de calidad" que hoy aporta InsightFace.
- Retirar la dependencia `insightface` y el pull del modelo `buffalo_l` de
  `ai_engine/requirements.txt` y `ai_engine/Dockerfile.ai` una vez confirmado
  que ningún flujo productivo depende ya de `face_embedding_insight.py`.
- Decidir y ejecutar la baja/reinscripción de las cuentas
  `face_template_provider = 'insightface_onnx'` existentes en el entorno de
  desarrollo (autorizado en el punto 4 de la Decisión).
- Actualizar `specs/008-biometria-facial-login/spec.md`/`tasks.md` si citan a
  InsightFace como motor secundario vigente.

## Evidencia de licencias (verificada para este ADR, 2026-09-11)

| Motor | Código | Modelos/pesos | Uso comercial |
|---|---|---|---|
| InsightFace (`buffalo_l`) | MIT | Licencia propia InsightFace | **No** sin licencia comercial aparte (`recognition-oss-pack@insightface.ai`); sin tier gratuito. Fuente: página de licenciamiento empresarial de InsightFace (insightface.ai) y `deepinsight/insightface#2587`. |
| InspireFace (ref. ADR-144) | Apache-2.0 | Hereda la licencia de InsightFace | **No** — mismo bloqueante, ya documentado en ADR-144. |
| SeetaFace6Open | BSD | BSD, mismo repositorio | **Sí**, uso comercial y personal libre, según el propio README de `SeetaFace6Open/index`. |
| libfacedetection | BSD-3-Clause | BSD-3-Clause | Sí, pero **solo detección** — no reemplaza el rol de reconocimiento de InsightFace. |

## Consecuencias

### Positivas
- Cierra una exposición de licenciamiento comercial **real y ya desplegada**
  (a diferencia de ADR-144, que evitó el riesgo antes de llegar a
  producción) — deja de correr en el stack un modelo cuyo uso comercial no
  está autorizado por su licencia.
- No requiere adoptar software nuevo ni evaluar una licencia adicional:
  SeetaFace6Open ya está vendorizado, compilado y verificado desde ADR-104.
- Cierra, para el corte gerencial del 2026-09-10, los dos hallazgos abiertos
  "decisión comercial pendiente sobre licencia de InspireFace (ADR-144)" —
  la decisión es no licenciar ni InspireFace ni InsightFace, y migrar al
  proveedor libre ya integrado.

### Riesgos y límites
- SeetaFace6 no tiene, a la fecha de ADR-104, evidencia pública de ensayo
  ISO/IEC 19795 (FMR/FNMR) ni ISO/IEC 30107-3 propia para este build — el
  mismo pendiente de calibración que ya aplicaba a InsightFace y a
  DeepFace+SilentFace (SPEC-008 CA-10), no una regresión nueva.
- Mientras no se ejecute el wiring pendiente (sección de arriba), InsightFace
  sigue presente en el árbol de código — este ADR autoriza y documenta su
  retiro, no certifica que ya esté retirado.

## Alternativas descartadas

- **Pagar la licencia comercial de InsightFace/InspireFace**: descartada —
  sin justificación de negocio frente a una alternativa BSD ya integrada sin
  costo ni bloqueante de licencia.
- **libfacedetection como reemplazo 1:1 del motor secundario**: descartada
  por desajuste técnico (solo detección, no reconocimiento) — ver punto 3 de
  la Decisión.
- **Mantener InsightFace en producción aceptando el riesgo de licencia**:
  descartada explícitamente por decisión del developer, dado que ya existe
  una alternativa libre sin ese riesgo y sin costo de integración adicional.

## Referencias

- `backend/src/biometric/face_analysis.cpp` (motor secundario, comentario
  "InsightFace es motor secundario (ADR-089)")
- `backend/src/auth/auth_storage_pg.cpp` (rama de login `insightface_onnx`)
- `ai_engine/face_embedding_insight.py` (modelo `buffalo_l`)
- ADR-089 (`biometria-dermalog-cli-integration`) — origen del rol de
  InsightFace como fallback
- ADR-099 (`fallback-insightface-no-bloqueante`) — comportamiento no
  bloqueante que se retira
- ADR-104 (`seetaface6-proveedor-biometrico-local`) — integración ya
  existente que este ADR reutiliza
- ADR-105 (`deepface-silentface-proveedor-biometrico-primario`) — jerarquía
  de proveedores vigente, sin cambios por este ADR
- ADR-144 (`inspireface-evaluacion-licencia-academica`) — mismo patrón de
  licencia, cerrado formalmente por este ADR
- ADR-074 (`avatar-biometrico-local-hd-bajo-demanda`) — mismo patrón de
  riesgo de licencia ya identificado antes (AnimeGANv2)
