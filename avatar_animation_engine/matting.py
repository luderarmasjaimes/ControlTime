"""Fondo transparente para el video animado (ADR-150, integración a
producto) -- post-proceso frame a frame sobre el MP4 que ya generó SadTalker,
NO una capacidad de SadTalker en sí.

Reusa exactamente el mismo modelo y la misma polaridad que
`ai_engine/eye_analyzer.py` (ADR-074, actualización 2026-09-03): el
`selfie_segmenter.tflite` de MediaPipe expone la probabilidad de persona en
`confidence_masks[0]` (continua, persona=1/fondo=0) -- se usa esa señal
directamente como canal alfa, NO `category_mask` (su polaridad quedó
documentada como invertida/no confiable en ese ADR, causaba borrar a la
persona y dejar el fondo).

Se descartó Robust Video Matting (mejor consistencia temporal) por licencia
GPL-3.0, incompatible con uso comercial -- ver ADR-150/THIRD_PARTY_NOTICES.md.
MediaPipe (Apache 2.0) es la opción sin bloqueante, ya usada en este mismo
repo para el mismo propósito (persona/fondo) en otro servicio.
"""

import logging
import os
import shutil
import subprocess
import tempfile

import cv2
import numpy as np
import requests

log = logging.getLogger("avatar_animation_engine.matting")

_MODEL_CACHE = os.environ.get("SADTALKER_MODEL_CACHE", "/app/.model_cache/sadtalker")
_SELFIE_MODEL_PATH = os.path.join(os.path.dirname(_MODEL_CACHE), "selfie_segmenter.tflite")
_SELFIE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/"
    "selfie_segmenter/float16/latest/selfie_segmenter.tflite"
)

_segmenter = None
_segmenter_failed = False


def _ensure_model() -> bool:
    if os.path.isfile(_SELFIE_MODEL_PATH) and os.path.getsize(_SELFIE_MODEL_PATH) >= 5000:
        return True
    os.makedirs(os.path.dirname(_SELFIE_MODEL_PATH), exist_ok=True)
    tmp = _SELFIE_MODEL_PATH + ".part"
    try:
        with requests.get(_SELFIE_MODEL_URL, stream=True, timeout=180) as r:
            r.raise_for_status()
            with open(tmp, "wb") as fh:
                for chunk in r.iter_content(chunk_size=256 * 1024):
                    if chunk:
                        fh.write(chunk)
        os.replace(tmp, _SELFIE_MODEL_PATH)
        return True
    except Exception as exc:
        log.error("no se pudo descargar selfie_segmenter.tflite: %s", exc)
        return False
    finally:
        if os.path.isfile(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass


def _get_segmenter():
    global _segmenter, _segmenter_failed
    if _segmenter_failed:
        return None
    if _segmenter is not None:
        return _segmenter
    if not _ensure_model():
        _segmenter_failed = True
        return None
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision as mp_vision

    try:
        base = mp_python.BaseOptions(model_asset_path=_SELFIE_MODEL_PATH)
        opts = mp_vision.ImageSegmenterOptions(
            base_options=base,
            output_category_mask=False,
            output_confidence_masks=True,
        )
        _segmenter = mp_vision.ImageSegmenter.create_from_options(opts)
    except Exception as exc:
        log.error("no se pudo cargar ImageSegmenter: %s", exc)
        _segmenter_failed = True
        return None
    return _segmenter


def is_available() -> bool:
    return _get_segmenter() is not None


def apply_transparent_background(mp4_bytes: bytes) -> bytes:
    """Recibe el MP4 real de SadTalker (fondo opaco) y devuelve un WebM VP9
    con canal alfa (persona real, fondo transparente). Si el segmentador no
    está disponible por cualquier motivo, lanza RuntimeError -- el llamador
    (sadtalker_backend.py) decide si eso es fatal o si sirve el MP4 opaco
    como fallback, mismo criterio best-effort que el resto del repo."""
    import mediapipe as mp

    segmenter = _get_segmenter()
    if segmenter is None:
        raise RuntimeError("selfie_segmenter no disponible")

    work_dir = tempfile.mkdtemp(prefix="matting_")
    try:
        in_path = os.path.join(work_dir, "in.mp4")
        with open(in_path, "wb") as fh:
            fh.write(mp4_bytes)

        cap = cv2.VideoCapture(in_path)
        if not cap.isOpened():
            raise RuntimeError("no se pudo abrir el mp4 de entrada para matting")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0

        frames_dir = os.path.join(work_dir, "frames")
        os.makedirs(frames_dir, exist_ok=True)
        idx = 0
        while True:
            ok, frame_bgr = cap.read()
            if not ok:
                break
            rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            result = segmenter.segment(mp_image)
            if not result.confidence_masks:
                raise RuntimeError("segmenter no devolvió confidence_masks")
            # Señal primaria persona=1/fondo=0 (ADR-074 2026-09-03) -- no
            # category_mask, polaridad ya documentada como no confiable ahí.
            # .squeeze() saca la dimensión de canal (H,W,1) -> (H,W) -- mismo
            # ajuste que eye_analyzer.py ya aplica al mismo numpy_view(),
            # hallazgo real de esta sesión (ValueError: could not broadcast
            # input array from shape (H,W,1) into shape (H,W) al escribir el
            # canal alfa).
            alpha = np.asarray(
                result.confidence_masks[0].numpy_view(), dtype=np.float32
            ).squeeze()
            # Hallazgo real 2026-09-09: el usuario reportó, con captura real,
            # un hombro claramente peor separado del fondo que el otro --
            # confirmado con `getImageData` real en el navegador: la
            # confianza cruda del segmentador en esa franja no es 0/255
            # limpio, es un degradado ancho de valores intermedios (ejemplo
            # real medido: 255→142→97→43→7→2 en píxeles consecutivos), zona
            # de bajo contraste local (tela clara cerca de un color de
            # fondo/sombra similar) donde MediaPipe queda "indeciso" píxel a
            # píxel.
            #
            # Primer intento (revertido, medido y descartado): curva gamma
            # `alpha**0.6`, que empuja TODO valor intermedio hacia arriba sin
            # importar de qué lado del límite real está. Medido en vivo tras
            # aplicarlo: no solo subió la confianza de la piel/hombro
            # indecisos -- también subió la del margen blanco propio del
            # lienzo del avatar (ADR-074/141, confirmado con RGB≈250 blanco
            # y alfa que pasó de 43-85 a 120-255 en los mismos píxeles),
            # agrandando la mancha en vez de resolverla. Una curva que solo
            # empuja hacia arriba no sirve: hay que empujar los valores
            # BAJOS más abajo (fondo real) Y los ALTOS más arriba (persona
            # real), no todo para el mismo lado.
            #
            # Fix real: sigmoide centrado en 0.5 (el propio punto de
            # decisión binario del segmentador) en vez de una curva
            # monótona -- confianza por debajo de 0.5 se empuja hacia 0 (más
            # transparente), por encima de 0.5 se empuja hacia 1 (más
            # opaca), agudizando la frontera real en vez de desplazarla
            # entera. `k=5` (pendiente moderada): agudiza sin llegar a un
            # corte binario duro que se vería como un borde serruchado.
            #
            # Bug real encontrado en el primer intento de ESTE mismo fix,
            # verificado con `getImageData` real antes de seguir: una
            # sigmoide cruda nunca satura a 0/1 exactos en un dominio finito
            # -- con k=5, hasta un píxel 100% opaco (confianza=1.0) quedaba
            # en ~0.924 (alfa≈236 en vez de 255), volviendo TODO el video
            # ~8% más transparente/con neblina, no solo el borde
            # problemático. Se reescala la salida para que 0.0->0.0 y
            # 1.0->1.0 exactos (resta el piso, divide por el rango real de
            # la sigmoide en ese dominio) -- conserva el punto medio y el
            # agudizado del borde, sin tocar los extremos ya decididos.
            _k = 5.0
            _raw = 1.0 / (1.0 + np.exp(-_k * (np.clip(alpha, 0.0, 1.0) - 0.5)))
            _floor = 1.0 / (1.0 + np.exp(_k * 0.5))
            _ceil = 1.0 / (1.0 + np.exp(-_k * 0.5))
            alpha = (_raw - _floor) / (_ceil - _floor)
            alpha_u8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
            # Hallazgo real 2026-09-10 (cuenta de prueba 09637600, avatar
            # "welcome" real descargado y analizado píxel a píxel): por
            # debajo de aprox. el 65-70% del alto del cuadro, el segmentador
            # da confianza >0.75 (hasta 1.0) sobre el MISMO tono casi-blanco
            # (RGB≈248-251) que arriba de esa línea correctamente clasifica
            # como fondo (confianza=0.0) -- es el prior espacial propio del
            # modelo (entrenado con selfies reales, donde la mitad inferior
            # del cuadro casi siempre es torso/ropa) chocando con la entrada
            # de ESTE pipeline en particular: SadTalker anima el avatar YA
            # compuesto sobre lienzo blanco puro (`_compose_avatar_canvas`,
            # ai_engine/eye_analyzer.py), no una foto real con fondo natural
            # -- fuera de la distribución con la que se entrenó el
            # segmentador. Resultado real medido: franja de ~35% del alto
            # del video, debajo de los hombros, quedaba 100% opaca (alfa=255)
            # pese a ser lienzo blanco puro -- el "halo" fantasma reportado
            # por el usuario al componer el video sobre el fondo oscuro del
            # dashboard (AvatarWidget.tsx).
            #
            # Fix: a diferencia del resto de esta señal (confianza del
            # segmentador), acá SÍ conocemos el color exacto del lienzo de
            # origen -- es blanco puro por construcción, no una suposición.
            # Cualquier píxel casi-blanco (los 3 canales por encima de 238)
            # se fuerza a transparente sin importar qué diga el segmentador
            # -- el prior espacial nunca puede anular un hecho conocido
            # sobre CÓMO se generó este frame. Mismo umbral (238 aprox. 235)
            # que ya usa el frontend (AvatarWidget.tsx, detectContentBounds)
            # para lo mismo, ahora aplicado donde importa: al alfa real, no
            # solo al recorte del cuadro visible.
            near_white = (
                (frame_bgr[:, :, 0] > 238)
                & (frame_bgr[:, :, 1] > 238)
                & (frame_bgr[:, :, 2] > 238)
            )
            alpha_u8[near_white] = 0
            bgra = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2BGRA)
            bgra[:, :, 3] = alpha_u8
            cv2.imwrite(os.path.join(frames_dir, f"frame_{idx:06d}.png"), bgra)
            idx += 1
        cap.release()

        if idx == 0:
            raise RuntimeError("el mp4 de entrada no tiene frames legibles")

        audio_path = os.path.join(work_dir, "audio.aac")
        has_audio = (
            subprocess.run(
                ["ffmpeg", "-y", "-i", in_path, "-vn", "-acodec", "copy", audio_path],
                capture_output=True,
                timeout=60,
            ).returncode
            == 0
            and os.path.isfile(audio_path)
        )

        out_path = os.path.join(work_dir, "out.webm")
        cmd = [
            "ffmpeg", "-y",
            "-framerate", str(fps),
            "-i", os.path.join(frames_dir, "frame_%06d.png"),
        ]
        if has_audio:
            cmd += ["-i", audio_path]
        cmd += [
            "-c:v", "libvpx-vp9",
            "-pix_fmt", "yuva420p",
            "-auto-alt-ref", "0",
            # Hallazgo real, sesión 2026-09-09 (continuación): el usuario
            # reportó una "mancha gris" cerca de la mandíbula/hombro --
            # confirmado con `getImageData` real en el navegador: el color
            # RGB ahí es piel correcta, pero el canal ALFA fluctúa de forma
            # ruidosa (117-153 en una zona de ~semi-transparencia real,
            # sin gradiente suave) -- se ve como un patrón cuadriculado al
            # componer sobre el fondo claro del dashboard. `ffprobe` sobre
            # un video real ya generado midió solo ~1.14 Mbps de bitrate
            # total (video+audio) para 1536x2048 -- muy bajo para esa
            # resolución, la causa mecánica del ruido de cuantización en
            # zonas de alfa parcial. NO se usa `-crf`/`-b:v 0` (modo CQ):
            # ese combo ya se probó en esta misma sesión y rompió el canal
            # alfa por completo (quedaba 100% opaco) -- se sube el bitrate
            # en modo VBR normal en su lugar, que no toca esa ruta.
            "-b:v", "4M",
        ]
        if has_audio:
            cmd += ["-c:a", "libopus", "-shortest"]
        cmd += [out_path]

        proc = subprocess.run(cmd, capture_output=True, timeout=180)
        if proc.returncode != 0 or not os.path.isfile(out_path):
            raise RuntimeError(
                f"ffmpeg (mux webm alfa) falló rc={proc.returncode} "
                f"stderr={proc.stderr[-2000:]}"
            )

        with open(out_path, "rb") as fh:
            return fh.read()
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
