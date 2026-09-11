# ADR-159 — Tres mejoras de calidad del avatar por difusión: GFPGAN, más pasos/resolución, mejor-de-3 por identidad

**Status**: implemented en código; build/despliegue pendiente (Docker Desktop no disponible durante esta sesión)

**Fecha**: 2026-09-04

**Autores**: Luder Armas + Claude

**Ámbito**: ia

**Relación**: extiende ADR-141 (SD1.5+ControlNet), ADR-155 (safety checker) y
ADR-157/158 (encuadre y selección de fuente). No reemplaza ninguna.

## Contexto

Pedido explícito del usuario tras validar que ADR-157/158 arreglaban el
encuadre: mejorar aún más la calidad visual del resultado, dentro de las
mismas restricciones de licencia ya investigadas en ADR-141 (nada que
dependa de pesos InsightFace "non-commercial research only").

## Decisión

### 1. Restauración facial GFPGAN como post-proceso

`avatar_engine/avatar_diffusion.py::enhance_with_gfpgan()`, aplicado en
`server.py` justo después de `stylize_portrait`, antes de codificar el PNG
de respuesta.

- **Licencia**: GFPGANv1.4 (TencentARC), Apache 2.0, uso comercial libre --
  mismos pesos ya auditados en este repo para `avatar_animation_engine`
  (ADR-150, ver su `THIRD_PARTY_NOTICES.md`). No depende de InsightFace.
- **Carga**: preload síncrono en `_preload()` (mismo patrón que el pipeline
  SD1.5), gateado por `AVATAR_DIFFUSION_GFPGAN_ENABLED` (default 1).
  `load_gfpgan()` nunca lanza: cualquier fallo de red/pesos devuelve `None`
  y el servicio arranca igual, sirviendo SD1.5 sin mejorar -- este
  post-proceso es estrictamente opcional, nunca bloqueante.
- **Aplicación**: `enhance_with_gfpgan()` tampoco lanza nunca; un fallo en
  `enhance()` devuelve la imagen sin mejorar en vez de romper el request.
- **Pesos**: descarga propia (no la de `GFPGANer`/basicsr) a
  `HF_HOME/gfpgan/GFPGANv1.4.pth`, bajo el mismo volumen persistente que la
  caché de Hugging Face (`diffusion_avatar_cache`) -- una sola descarga,
  sobrevive a recrear el contenedor.
- **Build**: `basicsr==1.4.2` (dependencia de gfpgan) necesita
  `--no-build-isolation` para ver el `torch` ya instalado en vez de resolver
  el suyo propio en un entorno PEP 517 aislado -- mismo hallazgo real ya
  documentado en `avatar_animation_engine/requirements-torch.txt`. Nuevo
  `avatar_engine/requirements-gfpgan.txt`, instalado en un segundo paso del
  Dockerfile.
- **Limitación conocida**: los pesos internos de facexlib (detección/
  parseo de rostro que usa `GFPGANer` puertas adentro) se descargan por su
  cuenta a su ruta por defecto, no al volumen persistente -- pueden
  re-descargarse si se recrea el contenedor. No bloqueante (misma network
  ya usada para HF), pero documentado para no sorprender en el próximo
  rebuild.

### 2. Más pasos de difusión y más resolución de trabajo

- `AVATAR_DIFFUSION_STEPS`: 32 → 40 (default en código y en
  `docker-compose.yml`). Más definición de detalle fino (poros, mechones,
  iris) a costo de ~1-2s extra por intento.
- `AVATAR_DIFFUSION_MAX_SIDE`: 768 → 896. Más resolución de trabajo antes de
  reducir al tamaño final -- gana detalle a costo de más VRAM/tiempo.
- Mismo criterio que el cambio 24→32 de la sesión anterior: aceptable en el
  flujo asíncrono post-registro (ADR-074), no en un render interactivo.

### 3. Elegir la mejor de las 3 seeds por similitud de identidad, no la primera que pasa

`ai_engine/eye_analyzer.py::_diffusion_stylize_with_quality_retry()`.

Antes: la primera seed que pasaba los dos controles (raw + compuesto) se
devolvía de inmediato, aunque una seed posterior tuviera mejor parecido real
con la foto fuente. `_avatar_identity_similarity()` ya se calculaba para
cada intento, pero sólo como filtro pasa/no-pasa
(`AVATAR_QUALITY_MIN_IDENTITY_SIM`), nunca como criterio de selección --
desperdiciando la señal.

Ahora: se acumulan TODOS los candidatos que pasan ambos controles junto con
su `identity_sim`, y al final se devuelve el de mayor similitud. Sin costo
adicional de GPU: las 3 seeds ya se generaban siempre que hacía falta
reintentar: el cambio es de selección, no de trabajo. Si ningún candidato
tiene señal de similitud (InsightFace no detectó rostro en alguna imagen),
se conserva el primero que pasó -- no se descarta nada por falta de señal.

## Consecuencias

- Mayor costo de inferencia por intento (steps 32→40, resolución 768→896,
  más GFPGAN): el flujo sigue siendo asíncrono post-registro, no afecta el
  tiempo de respuesta del alta.
- GFPGAN puede introducir artefactos de "over-smoothing" típicos de
  restauradores de rostro entrenados sobre datasets de caras reales,
  aplicados aquí sobre una salida ya estilizada (no fotográfica) -- riesgo
  conocido, no verificado con evidencia visual real todavía. Apagable sin
  rebuild vía `AVATAR_DIFFUSION_GFPGAN_ENABLED=0`.
- La selección por identidad puede, en teoría, preferir un candidato con
  mejor similitud pero peor composición visual entre dos que ya pasaron el
  control de composición -- ambos controles de calidad (raw + compuesto)
  siguen aplicándose ANTES de comparar, así que el candidato elegido de
  todas formas ya es "aceptable"; el desempate solo decide cuál de los
  aceptables gana.

## Validación pendiente

**Bloqueado por Docker Desktop no disponible durante esta sesión** (el
daemon dejó de responder a mitad de sesión, sin intervención de este
trabajo). Pendiente, en cuanto Docker vuelva:

1. Reconstruir `avatar_engine` (confirmar que `--no-build-isolation`
   resuelve basicsr sin fallo, igual que en `avatar_animation_engine`).
2. Reconstruir `ai_engine` (cambio de Python puro, sin nuevas dependencias).
3. Registro real con cámara: comparar el resultado visual contra los
   volcados de la sesión anterior (`00_work_wb_*`, `diffusion_seed*`,
   `99_thumb_final_candidate`), y revisar en `docker logs beemetry-ai-vision`
   las líneas nuevas `[AVATAR_QUALITY] passed seed=... identity_sim=...` /
   `best of N passing seed(s) identity_sim=...`.
4. Confirmar en `docker logs beemetry-avatar-engine` que el preload reporta
   `gfpgan=True` y que no hay excepciones de `basicsr`/`facexlib` al cargar.
