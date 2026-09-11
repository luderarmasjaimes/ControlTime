"""Backend SadTalker (ADR-150, Fase A) -- reenactment/lip-sync audio-driven.

No reimplementa el pipeline interno de SadTalker (3DMM/audio2exp/audio2pose/
face-render): invoca su `inference.py` real vía subproceso, sobre un checkout
pineado del repo (ver Dockerfile, SADTALKER_COMMIT). Mismo criterio que dejó
ADR-141 v4 como lección ("no reconstrucciones aisladas, siempre el pipeline
real") -- acá se lleva un paso más lejos: ni siquiera se reconstruye el
pipeline interno en Python propio, se corre el binario real de terceros.

Licencia: SadTalker es Apache 2.0 (sin restricción NC), sin dependencia de
InsightFace -- ver tabla de licencias de ADR-150. Los pesos de MAPPING/
mapping de expresión (SadTalker_V0.0.2_*.safetensors, mapping_*.pth.tar) y
BFM_Fitting (3DMM) se descargan de las fuentes reales documentadas abajo, no
se hornean en la imagen.
"""

import glob
import logging
import os
import shutil
import subprocess
import tempfile
import time
import uuid

import cv2
import numpy as np
import requests

from .base import AnimateOutput, AnimationBackend, GpuRequiredError, ModelLoadError

log = logging.getLogger("avatar_animation_engine.sadtalker")

SADTALKER_HOME = os.environ.get("SADTALKER_HOME", "/opt/sadtalker")
MODEL_CACHE = os.environ.get("SADTALKER_MODEL_CACHE", "/app/.model_cache/sadtalker")
CHECKPOINTS_DIR = os.path.join(MODEL_CACHE, "checkpoints")
GFPGAN_WEIGHTS_DIR = os.path.join(MODEL_CACHE, "gfpgan", "weights")

# Modelo principal (mapping + face-render), formato safetensors moderno --
# URLs reales confirmadas desde scripts/download_models.sh del propio repo
# (release "v0.0.2-rc" de OpenTalker/SadTalker, no la legacy Winfredy/v0.0.2).
_GITHUB_RELEASE_FILES = {
    "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/mapping_00109-model.pth.tar": (
        CHECKPOINTS_DIR, "mapping_00109-model.pth.tar"
    ),
    "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/mapping_00229-model.pth.tar": (
        CHECKPOINTS_DIR, "mapping_00229-model.pth.tar"
    ),
    "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/SadTalker_V0.0.2_256.safetensors": (
        CHECKPOINTS_DIR, "SadTalker_V0.0.2_256.safetensors"
    ),
    "https://github.com/OpenTalker/SadTalker/releases/download/v0.0.2-rc/SadTalker_V0.0.2_512.safetensors": (
        CHECKPOINTS_DIR, "SadTalker_V0.0.2_512.safetensors"
    ),
    # Enhancer opcional (--enhancer gfpgan): detección/alineación (facexlib)
    # + restauración facial (GFPGAN), ambos Apache 2.0 / BSD-3.
    "https://github.com/xinntao/facexlib/releases/download/v0.1.0/alignment_WFLW_4HG.pth": (
        GFPGAN_WEIGHTS_DIR, "alignment_WFLW_4HG.pth"
    ),
    "https://github.com/xinntao/facexlib/releases/download/v0.1.0/detection_Resnet50_Final.pth": (
        GFPGAN_WEIGHTS_DIR, "detection_Resnet50_Final.pth"
    ),
    "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth": (
        GFPGAN_WEIGHTS_DIR, "GFPGANv1.4.pth"
    ),
    "https://github.com/xinntao/facexlib/releases/download/v0.2.2/parsing_parsenet.pth": (
        GFPGAN_WEIGHTS_DIR, "parsing_parsenet.pth"
    ),
}

# BFM_Fitting/ (3DMM, exigido por inference.py --bfm_folder) no tiene URL de
# GitHub Releases -- se obtiene del espacio oficial en HF del mismo autor
# (mirror histórico del árbol checkpoints/ completo), revisión pineada, no
# "main" flotante.
_BFM_HF_REPO = "vinthony/SadTalker"
_BFM_HF_REVISION = "5194f86e46b8d20f11c9c3610b808c325032e1c5"
_BFM_MARKER = os.path.join(CHECKPOINTS_DIR, "BFM_Fitting", "facemodel_info.mat")


def _download_if_missing(url: str, dest_dir: str, filename: str) -> None:
    dest_path = os.path.join(dest_dir, filename)
    if os.path.exists(dest_path) and os.path.getsize(dest_path) > 0:
        return
    os.makedirs(dest_dir, exist_ok=True)
    tmp_path = dest_path + ".part"
    log.info("downloading %s -> %s", url, dest_path)
    with requests.get(url, stream=True, timeout=600) as resp:
        resp.raise_for_status()
        with open(tmp_path, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    fh.write(chunk)
    os.replace(tmp_path, dest_path)


def _ensure_checkpoints() -> None:
    for url, (dest_dir, filename) in _GITHUB_RELEASE_FILES.items():
        _download_if_missing(url, dest_dir, filename)

    if not os.path.exists(_BFM_MARKER):
        from huggingface_hub import snapshot_download

        log.info(
            "downloading BFM_Fitting from HF space %s@%s",
            _BFM_HF_REPO, _BFM_HF_REVISION,
        )
        snapshot_path = snapshot_download(
            repo_id=_BFM_HF_REPO,
            repo_type="space",
            revision=_BFM_HF_REVISION,
            allow_patterns=["checkpoints/BFM_Fitting/*"],
        )
        src = os.path.join(snapshot_path, "checkpoints", "BFM_Fitting")
        dst = os.path.join(CHECKPOINTS_DIR, "BFM_Fitting")
        if not os.path.isdir(src):
            raise ModelLoadError(
                f"BFM_Fitting no encontrado en el snapshot de {_BFM_HF_REPO}@{_BFM_HF_REVISION}"
            )
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.isdir(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst)

    if not os.path.exists(_BFM_MARKER):
        raise ModelLoadError(f"BFM_Fitting incompleto tras la descarga: falta {_BFM_MARKER}")

    _ensure_repo_symlinks()


def _ensure_repo_symlinks() -> None:
    """SadTalker resuelve el enhancer GFPGAN por una ruta relativa a su propio
    repo (`./gfpgan/weights`, no un flag CLI como --checkpoint_dir) -- sin
    verificar su código interno línea a línea, la forma robusta de garantizar
    que encuentre los pesos ya descargados (en el volumen, fuera de la imagen)
    es enlazar esa ruta relativa hacia el cache real, en vez de adivinar el
    nombre de una variable de entorno que ese código quizás no lea."""
    link_path = os.path.join(SADTALKER_HOME, "gfpgan")
    target = os.path.dirname(GFPGAN_WEIGHTS_DIR)  # .../sadtalker/gfpgan
    if os.path.islink(link_path):
        if os.readlink(link_path) == target:
            return
        os.remove(link_path)
    elif os.path.exists(link_path):
        shutil.rmtree(link_path)
    os.makedirs(target, exist_ok=True)
    os.symlink(target, link_path, target_is_directory=True)


def _synthesize_tts_wav(text: str) -> bytes:
    """TTS local/offline vía espeak-ng, invocado como subproceso (GPL-3.0 del
    binario NO alcanza a este servicio por eso -- ver Dockerfile/
    THIRD_PARTY_NOTICES.md). Usado por las funcionalidades pre-renderizadas
    (bienvenida/onboarding/informes/KPIs, integración a producto ADR-150)
    cuando el llamador manda texto en vez de un WAV ya grabado -- evita
    reabrir la discusión de licencia de audio que ya se resolvió para la
    corrida de evaluación 2026-09-07 (TTS local, no un clip con copyright
    de terceros)."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out_path = tmp.name
    try:
        proc = subprocess.run(
            ["espeak-ng", "-v", "es", "-s", "150", "-w", out_path, text],
            capture_output=True,
            timeout=30,
        )
        if proc.returncode != 0 or not os.path.isfile(out_path):
            raise RuntimeError(
                f"espeak-ng falló rc={proc.returncode} stderr={proc.stderr[-2000:]}"
            )
        with open(out_path, "rb") as fh:
            return fh.read()
    finally:
        if os.path.isfile(out_path):
            os.remove(out_path)


def _resize_max_side(bgr: np.ndarray, max_side: int) -> np.ndarray:
    """Redimensiona la foto fuente ANTES de invocar inference.py -- hallazgo
    real de la corrida 2026-09-07 (ADR-150): con --preprocess full, la
    detección/landmarks corre sobre la imagen completa antes de recortar, y
    una foto de cámara/celular moderna (2-4K) agota el timeout por defecto
    (180s) donde un retrato de Wikimedia (~960px) no lo hacía. No se
    depende de que el llamador ya la mande chica."""
    h, w = bgr.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return bgr
    scale = max_side / float(longest)
    new_size = (max(1, int(round(w * scale))), max(1, int(round(h * scale))))
    return cv2.resize(bgr, new_size, interpolation=cv2.INTER_AREA)


class SadTalkerBackend(AnimationBackend):
    name = "sadtalker"

    def __init__(self) -> None:
        self.device = "cpu"
        self.size = int(os.environ.get("AVATAR_ANIMATION_SADTALKER_SIZE", "256"))
        self.enhancer = os.environ.get("AVATAR_ANIMATION_SADTALKER_ENHANCER", "gfpgan").strip() or None
        self.preprocess = os.environ.get("AVATAR_ANIMATION_SADTALKER_PREPROCESS", "full")
        self.max_source_side = int(
            os.environ.get("AVATAR_ANIMATION_SADTALKER_MAX_SOURCE_SIDE", "1024")
        )
        self.timeout_seconds = float(
            os.environ.get("AVATAR_ANIMATION_TIMEOUT_SECONDS", "180")
        )

    def load(self) -> str:
        require_gpu = os.environ.get("AVATAR_ANIMATION_REQUIRE_GPU", "1").strip() == "1"
        try:
            import torch
        except Exception as exc:  # pragma: no cover - fallo de instalación
            raise ModelLoadError(f"no se pudo importar torch: {exc}") from exc

        cuda_ok = torch.cuda.is_available()
        if require_gpu and not cuda_ok:
            raise GpuRequiredError(
                "AVATAR_ANIMATION_REQUIRE_GPU=1 y no hay CUDA visible "
                "(SadTalker en CPU es impracticable para un video corto)"
            )
        self.device = "cuda" if cuda_ok else "cpu"

        if not os.path.isdir(SADTALKER_HOME):
            raise ModelLoadError(f"SADTALKER_HOME no existe: {SADTALKER_HOME}")
        inference_script = os.path.join(SADTALKER_HOME, "inference.py")
        if not os.path.isfile(inference_script):
            raise ModelLoadError(f"inference.py no encontrado en {SADTALKER_HOME}")

        _ensure_checkpoints()

        # Smoke check liviano: importar el CLI en un subproceso con --help
        # confirma que las dependencias (kornia/facexlib/basicsr/etc, ver el
        # riesgo documentado en requirements.txt) importan de verdad contra
        # el torch pineado de este servicio, sin gastar una inferencia real.
        probe = subprocess.run(
            ["python", "inference.py", "--help"],
            cwd=SADTALKER_HOME,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if probe.returncode != 0:
            raise ModelLoadError(
                "smoke check de SadTalker (inference.py --help) falló: "
                f"rc={probe.returncode} stderr={probe.stderr[-4000:]}"
            )

        return self.device

    def animate(
        self,
        source_bgr,
        driving_audio_bytes=None,
        driving_video_bytes=None,
        driving_text=None,
        transparent_bg=False,
        **opts,
    ) -> AnimateOutput:
        if driving_audio_bytes is None and driving_text:
            driving_audio_bytes = _synthesize_tts_wav(driving_text)
        if driving_audio_bytes is None:
            raise ValueError(
                "SadTalkerBackend requiere driving_audio_bytes o driving_text "
                "(lip-sync audio-driven)"
            )

        work_dir = tempfile.mkdtemp(prefix="sadtalker_req_")
        req_id = uuid.uuid4().hex[:12]
        try:
            source_path = os.path.join(work_dir, "source.png")
            audio_path = os.path.join(work_dir, "driving.wav")
            result_dir = os.path.join(work_dir, "result")
            os.makedirs(result_dir, exist_ok=True)

            source_bgr = _resize_max_side(source_bgr, self.max_source_side)
            ok = cv2.imwrite(source_path, source_bgr)
            if not ok:
                raise RuntimeError("no se pudo escribir la imagen fuente temporal")
            with open(audio_path, "wb") as fh:
                fh.write(driving_audio_bytes)

            cmd = [
                "python", "inference.py",
                "--source_image", source_path,
                "--driven_audio", audio_path,
                "--result_dir", result_dir,
                "--checkpoint_dir", CHECKPOINTS_DIR,
                "--preprocess", self.preprocess,
                "--size", str(self.size),
                "--still",
            ]
            if self.enhancer:
                cmd += ["--enhancer", self.enhancer]
            if self.device == "cpu":
                cmd += ["--cpu"]

            log.info("req_id=%s running SadTalker: %s", req_id, " ".join(cmd))
            t0 = time.monotonic()
            proc = subprocess.run(
                cmd,
                cwd=SADTALKER_HOME,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
            )
            elapsed_ms = int((time.monotonic() - t0) * 1000)
            if proc.returncode != 0:
                raise RuntimeError(
                    f"SadTalker inference.py falló rc={proc.returncode} "
                    f"elapsed_ms={elapsed_ms} stderr={proc.stderr[-4000:]}"
                )

            candidates = sorted(glob.glob(os.path.join(result_dir, "*.mp4")))
            if not candidates:
                raise RuntimeError(
                    f"SadTalker terminó ok pero no se encontró .mp4 en {result_dir} "
                    f"(stdout={proc.stdout[-2000:]})"
                )
            with open(candidates[-1], "rb") as fh:
                video_bytes = fh.read()
            log.info(
                "req_id=%s ok elapsed_ms=%d video_bytes=%d",
                req_id, elapsed_ms, len(video_bytes),
            )

            if transparent_bg:
                from matting import apply_transparent_background

                t1 = time.monotonic()
                webm_bytes = apply_transparent_background(video_bytes)
                log.info(
                    "req_id=%s matting ok elapsed_ms=%d webm_bytes=%d",
                    req_id, int((time.monotonic() - t1) * 1000), len(webm_bytes),
                )
                return AnimateOutput(webm_bytes, content_type="video/webm")

            return AnimateOutput(video_bytes, content_type="video/mp4")
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
