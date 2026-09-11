"""Backend LivePortrait (ADR-150, Fase B -- NO implementado en esta pasada).

Bloqueante real: los pesos oficiales dependen de InsightFace `buffalo_l` y de
X-Pose, ambos "non-commercial research purposes only" -- mismo problema que
ya descartó InstantID/IP-Adapter-FaceID en ADR-141. Antes de implementar este
backend hace falta parchar el preprocesamiento de landmarks de LivePortrait
para usar `mediapipe.tasks.vision.FaceLandmarker` (ya usado en
`ai_engine/eye_analyzer.py`) en vez de InsightFace, y validar ese parche
contra fotos reales -- trabajo iterativo, no una sustitución mecánica. Ver
ADR-150, sección "Fases B/C".
"""

from .base import AnimationBackend


class LivePortraitBackend(AnimationBackend):
    name = "liveportrait"

    def load(self) -> str:
        raise NotImplementedError(
            "AVATAR_ANIMATION_ENGINE=liveportrait: backend no implementado "
            "todavía (ADR-150, Fase B -- pendiente parche InsightFace->MediaPipe "
            "por licencia de buffalo_l/X-Pose). Usar AVATAR_ANIMATION_ENGINE=sadtalker."
        )

    def animate(self, source_bgr, driving_audio_bytes=None, driving_video_bytes=None, **opts) -> bytes:
        raise NotImplementedError
