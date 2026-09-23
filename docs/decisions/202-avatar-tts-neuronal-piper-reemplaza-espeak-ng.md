# ADR-202 — TTS neuronal (Piper) reemplaza espeak-ng para el guion de bienvenida del avatar

**Status**: implemented en código; build/despliegue real pendiente de verificación

**Fecha**: 2026-09-20

**Autores**: Luder Armas + Claude

**Ámbito**: ia

**Relación**: extiende ADR-150 (avatar animado, Fase A SadTalker) y ADR-167
(alcance v1 del avatar de soporte, saludo de bienvenida). No reemplaza
ninguna decisión de esos dos, solo el motor TTS interno que ADR-150 dejó
documentado como "TTS local y offline" sin comprometerse a un motor
específico.

## Contexto

Reporte explícito del usuario: el audio del saludo de bienvenida del avatar
(disparado automáticamente al iniciar sesión, `AvatarWidget.tsx`) suena
robotizado. Causa confirmada en código:
`avatar_animation_engine/backends/sadtalker_backend.py::_synthesize_tts_wav`
invocaba `espeak-ng` (síntesis por formantes, el mismo motor detrás de
lectores de pantalla de los 90s) elegido en la evaluación de ADR-150
únicamente porque resolvía la duda de licencia de audio de esa sesión (TTS
local, sin clip con copyright de terceros) — nunca se evaluó la calidad de
voz en sí, que es inherentemente robótica por el tipo de síntesis, no por un
parámetro mal calibrado.

## Decisión

Reemplazar espeak-ng por **Piper** (`OHF-Voice/piper1-gpl`, paquete PyPI
`piper-tts==1.8.0`), un motor TTS neuronal (VITS) sobre `onnxruntime` —
sigue siendo 100% local/offline (mismo criterio de licencia de audio que
ADR-150 ya resolvió, no lo reabre), pero con voz sintética natural en vez de
formantes.

- **Voz**: `es_MX-claude-high` (VITS, 22050Hz), del repositorio
  `rhasspy/piper-voices` en Hugging Face. Es la voz de mayor calidad
  disponible en español entre las publicadas ahí (junto con
  `es_AR-daniela-high`); se prefiere `es_MX` por ser el español neutro más
  cercano al ya usado en el resto de la plataforma (mensajes de
  error/UI en `es`, sin variante regional marcada). Descarga bajo demanda al
  arranque (`_ensure_piper_voice`, mismo patrón que los checkpoints de
  SadTalker) hacia `PIPER_MODEL_CACHE` (`/app/.model_cache/piper` por
  defecto), dentro del volumen persistente ya existente
  (`avatar_animation_model_cache`, `docker-compose.yml`) — no requiere
  ningún cambio de infraestructura.
- **Licencias verificadas** (no asumidas):
  - Piper (código): GPL-3.0-or-later (confirmado en `setup.py`/clasificador
    de PyPI del propio proyecto — el nombre del repo, `piper1-gpl`, ya lo
    anticipaba). Mismo tratamiento que espeak-ng antes: se invoca
    EXCLUSIVAMENTE como subproceso vía su entry point de consola `piper`
    (`subprocess.run(["piper", ...])`), nunca `import piper` en el código de
    este servicio — la licencia no alcanza a este proyecto por el mismo
    criterio de aislamiento por proceso que ya aplicaba el `Dockerfile`
    original a espeak-ng y que se documenta en varios puntos de este
    ecosistema para herramientas GPL invocadas como binario externo.
  - Voz `es_MX-claude-high` (modelo/pesos): Apache 2.0, confirmado en su
    propio `MODEL_CARD` en Hugging Face (dataset:
    `HirCoir/Piper-TTS-Spanish`) — sin restricción de uso comercial, no
    depende de InsightFace ni de ningún paquete bloqueado por licencia
    "non-commercial research only" de los ya catalogados en ADR-150/166.
  - El wheel de `piper-tts` es un paquete manylinux prebuilt (no requiere
    compilar en el build de Docker) y embebe su propio `espeak-ng-data` para
    fonemización — el paquete apt `espeak-ng` deja de ser necesario y se
    retira del `Dockerfile`.
- **Invocación**: mismo patrón exacto que espeak-ng antes (texto por stdin,
  WAV temporal como salida, `subprocess.run` con timeout) — cambia el
  binario y sus flags (`piper --model ... --config ... --output-file ...`),
  no la forma de integrarse con `SadTalkerBackend.animate()` (que sigue
  recibiendo bytes WAV, sin cambios en esa interfaz).

## Consecuencias

- Calidad de voz sustancialmente más natural (síntesis neuronal VITS vs.
  formantes) sin salir de la restricción de licencia ya establecida
  (local/offline, sin dependencia de una API de voz de terceros ni costo
  recurrente).
- Nueva dependencia GPL-3.0-or-later en la imagen (antes ya había una,
  espeak-ng, con el mismo tratamiento) — el aislamiento por subproceso es el
  mismo mecanismo ya aceptado en este repo, no un precedente nuevo.
- Primer arranque tras el rebuild descarga ~63MB adicionales (voz Piper) al
  volumen persistente — una sola vez, igual que los checkpoints de
  SadTalker; no afecta el tiempo de respuesta de requests posteriores.
- Superficie de voz limitada a lo publicado por `rhasspy/piper-voices` — si
  a futuro se pide otro acento/tono, es cambiar la constante
  `_PIPER_VOICE_NAME`/`_PIPER_VOICE_HF_BASE` en `sadtalker_backend.py` y
  verificar la licencia de la voz elegida (no todas las voces de ese
  repositorio están confirmadas Apache 2.0/CC0 — hay que revisar el
  `MODEL_CARD` de cada una antes de adoptarla, mismo criterio aplicado acá).

## Validación pendiente

No se pudo reconstruir la imagen Docker de `avatar_animation_engine` ni
correr un saludo de bienvenida real durante esta sesión (cambio hecho sobre
el código fuente, sin acceso a un rebuild/despliegue en este entorno).
Pendiente, en cuanto el build esté disponible:

1. `docker compose --profile avatar-animation build avatar_animation_engine`
   — confirmar que `pip install piper-tts` resuelve el wheel manylinux
   prebuilt sin caer a compilar desde sdist.
2. Levantar el servicio y confirmar en logs que `_ensure_piper_voice()`
   descarga `es_MX-claude-high.onnx`/`.onnx.json` sin error antes de que el
   healthcheck pase.
3. Disparar un `welcome` real (login nuevo) y confirmar auditivamente que la
   voz ya no suena robotizada — comparar contra el audio anterior si hay una
   grabación de referencia disponible.
4. Confirmar que `THIRD_PARTY_NOTICES.md` actualizado se mantiene accesible
   junto al código (obligación de atribución ya establecida para este
   servicio).
