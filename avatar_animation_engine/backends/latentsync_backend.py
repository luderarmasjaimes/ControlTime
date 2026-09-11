"""Backend LatentSync (ADR-150, Fase C -- NO implementado en esta pasada).

Bloqueante real: `requirements.txt` de bytedance/LatentSync trae
`insightface==0.7.3` para el recorte/alineación facial de preprocesamiento --
mismo bloqueante de licencia "non-commercial research only" que LivePortrait,
a pesar de que el código propio del repo es Apache 2.0. Antes de implementar
este backend hace falta el mismo tipo de parche InsightFace->MediaPipe que
LivePortrait (Fase B), validado contra fotos reales. Ver ADR-150, sección
"Fases B/C".
"""

from .base import AnimationBackend


class LatentSyncBackend(AnimationBackend):
    name = "latentsync"

    def load(self) -> str:
        raise NotImplementedError(
            "AVATAR_ANIMATION_ENGINE=latentsync: backend no implementado "
            "todavía (ADR-150, Fase C -- pendiente parche InsightFace->MediaPipe "
            "por licencia de insightface==0.7.3 en su preprocesamiento). "
            "Usar AVATAR_ANIMATION_ENGINE=sadtalker."
        )

    def animate(self, source_bgr, driving_audio_bytes=None, driving_video_bytes=None, **opts) -> bytes:
        raise NotImplementedError
