from .base import AnimationBackend, GpuRequiredError, ModelLoadError
from .latentsync_backend import LatentSyncBackend
from .liveportrait_backend import LivePortraitBackend
from .sadtalker_backend import SadTalkerBackend

_REGISTRY = {
    "sadtalker": SadTalkerBackend,
    "liveportrait": LivePortraitBackend,
    "latentsync": LatentSyncBackend,
}


def get_backend(name: str) -> AnimationBackend:
    key = (name or "").strip().lower()
    cls = _REGISTRY.get(key)
    if cls is None:
        raise ValueError(
            f"AVATAR_ANIMATION_ENGINE={name!r} desconocido -- valores válidos: "
            f"{sorted(_REGISTRY)}"
        )
    return cls()


__all__ = [
    "AnimationBackend",
    "GpuRequiredError",
    "ModelLoadError",
    "get_backend",
]
