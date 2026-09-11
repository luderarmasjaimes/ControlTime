"""Interfaz común para backends de avatar animado (ADR-150).

Cada backend (sadtalker, liveportrait, latentsync) implementa esta interfaz.
Solo se carga UN backend por proceso/contenedor -- ver server.py -- nunca los
tres a la vez en la misma GPU.
"""

from typing import Optional


class GpuRequiredError(RuntimeError):
    """El backend exige GPU (AVATAR_ANIMATION_REQUIRE_GPU=1, default) y no hay
    CUDA visible. Mismo criterio que avatar_engine/avatar_diffusion.py."""


class ModelLoadError(RuntimeError):
    """Fallo real cargando pesos/checkpoints (descarga, archivo corrupto,
    checkpoint faltante, etc.) -- distinto de GpuRequiredError."""


class AnimationBackend:
    name: str = "base"

    def load(self) -> str:
        """Carga pesos/checkpoints y valida el dispositivo. Bloqueante a
        propósito -- se llama una sola vez, antes de aceptar tráfico (ver
        server.py::_preload). Devuelve el device efectivo ("cuda"/"cpu").
        Lanza GpuRequiredError o ModelLoadError si falla."""
        raise NotImplementedError

    def animate(
        self,
        source_bgr,
        driving_audio_bytes: Optional[bytes] = None,
        driving_video_bytes: Optional[bytes] = None,
        driving_text: Optional[str] = None,
        transparent_bg: bool = False,
        **opts,
    ) -> "AnimateOutput":
        """Genera el video animado. Recibe la imagen fuente ya decodificada
        (BGR uint8, mismo formato que cv2.imdecode) y la señal conductora:
        audio para lip-sync, video para reenactment puro (cada backend
        declara cuál soporta), o `driving_text` (TTS local, sin depender de
        que el llamador ya tenga un WAV -- integración a producto, ADR-150).
        `transparent_bg=True` aplica el post-proceso de matting (ver
        matting.py) antes de devolver. Devuelve un AnimateOutput (bytes +
        content_type: video/mp4 o video/webm si transparent_bg)."""
        raise NotImplementedError


class AnimateOutput:
    def __init__(self, video_bytes: bytes, content_type: str = "video/mp4") -> None:
        self.video_bytes = video_bytes
        self.content_type = content_type
