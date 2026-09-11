# ADR-099 — Fallback a pipeline legacy cuando InsightFace falla (no bloquear)

> **Actualización 2026-09-11 — InsightFace se decomisiona por ADR-166.**
> Motivo: licencia no comercial en los modelos pre-entrenados (`buffalo_l`),
> mismo hallazgo que cerró la evaluación de InspireFace en ADR-144.
> Reemplazo: SeetaFace6Open (ADR-104, ya integrado, licencia BSD). El
> comportamiento no bloqueante que este ADR corrigió sigue siendo el
> principio correcto de diseño para cualquier motor auxiliar; se documenta
> acá para quien conecte SeetaFace6 en el mismo punto de llamada. No se
> edita el texto original de abajo.

**Status**: implemented, verificado (2026-08-08)
**Fecha**: 2026-08-08
**Autores**: EC
**Ámbito**: ia
**Relación**: restaura un principio de diseño ya establecido en ADR-089
(InsightFace como motor secundario/fallback, Dermalog CLI primario), que
un cambio sin commitear había contradicho.

## Contexto

Un cambio en `backend/src/biometric/face_analysis.cpp` (sin commitear,
detectado en `git status` al inicio de esta sesión de trabajo) modificó
`analyzeFaceImage()` para intentar extraer un embedding vía InsightFace
**antes** del pipeline legacy (Haar + heurísticas OpenCV). El problema:
si esa llamada fallaba — condición común en baja luz, movimiento, o
mientras el modelo `buffalo_l` aún terminaba de cargar en el `ai_engine`
— la función retornaba de inmediato con
`issues = ["insightface_inference_failed", ...]`, **sin caer al
pipeline legacy** como hacía el código original.

El efecto downstream era severo: `stripLegacyIssuesWhenAiIcaoPasses()`
(la función que limpia issues cuando MediaPipe ya validó el ICAO
correctamente) tiene una lista fija de tags que puede limpiar
(`kLegacyStripCore`), y `"insightface_inference_failed"` no estaba en
esa lista. Resultado: aunque el óvalo se viera bien y MediaPipe
confirmara ojos/boca/frontal perfectos, `eval.face.issues` nunca quedaba
vacío, `eval.ok` nunca era `true`, y la captura no avanzaba nunca —
reportado por el usuario como "no detecta ningún patrón".

## Decisión

Se elimina el `return` temprano en el caso de fallo de InsightFace. El
bloque ahora, si `fetchFaceEmbeddingFromAiEngine()` no tiene éxito,
simplemente **no retorna** — el flujo continúa hacia
`analyzeFaceImageLegacy()` al final de la función, exactamente como
antes de que existiera el bloque de InsightFace. El caso de éxito
(`aiEm.ok()`) no cambia.

## Verificación

- Reproducido con InsightFace deliberadamente roto en runtime (numpy
  incompatible, ver ADR-097 antes de su fix): `/api/process_frame`
  siguió devolviendo `{"ok":true,"state":4}` con el óvalo calculado
  correctamente vía MediaPipe — el fallback funcionó exactamente como
  se esperaba, validando la resiliencia del diseño.
- Con InsightFace funcionando (post-ADR-097), el mismo endpoint siguió
  funcionando igual — sin regresión en el caso feliz.

## Consecuencias

- InsightFace vuelve a comportarse como lo que su propio diseño
  documentado dice que es: un motor secundario que mejora la calidad
  del template cuando está disponible, no un gate obligatorio.
- Si en el futuro se necesita que un fallo de InsightFace sea
  bloqueante en algún flujo específico (por ejemplo, para exigir el
  embedding de alta seguridad en un login crítico), esa decisión debe
  tomarse explícitamente en el llamador, no de forma implícita dentro
  de `analyzeFaceImage()`.

## Alternativas descartadas

- **Agregar `"insightface_inference_failed"` y los códigos de error de
  `aiEm.error` a `kLegacyStripCore`**: técnicamente also habría
  resuelto el síntoma, pero es un parche sobre el síntoma (la lista de
  strings a limpiar) en vez de corregir la causa (la función no debía
  bloquear en primer lugar). Se descarta a favor del fallback real.

## Referencias

- `backend/src/biometric/face_analysis.cpp` (`analyzeFaceImage`,
  `stripLegacyIssuesWhenAiIcaoPasses`, `kLegacyStripCore`)
- ADR-089 (`biometria-dermalog-cli-integration`)
