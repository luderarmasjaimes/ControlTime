"""
Pipeline de estilización de avatar por difusión local: SD1.5 img2img +
ControlNet-Canny. Ver ADR-141
(docs/decisions/141-avatar-estilizado-difusion-local-sd15-controlnet.md)
para el análisis de licencias y la razón de que este pipeline viva en un
servicio propio, separado de `ai_engine` (que carga TensorFlow -- conflicto
real e irreconciliable de cuDNN entre torch==2.11.0+cu128 y
tensorflow[and-cuda]==2.15.1, ver la actualización 2026-09-03 del ADR).

Licencias (ambas CreativeML OpenRAIL-M, uso comercial libre):
- stable-diffusion-v1-5/stable-diffusion-v1-5
- lllyasviel/control_v11p_sd15_canny

Revisiones fijadas a un commit SHA concreto (no "main" flotante) para que un
cambio upstream no altere el comportamiento en silencio; actualizar a
propósito, no como efecto colateral de un rebuild.
"""

import logging
import os
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger("avatar_engine")

SD15_REPO = "stable-diffusion-v1-5/stable-diffusion-v1-5"
SD15_REVISION = "451f4fe16113bff5a5d2269ed5ad43b0592e9a14"  # main @ 2026-09-03
CONTROLNET_CANNY_REPO = "lllyasviel/control_v11p_sd15_canny"
CONTROLNET_CANNY_REVISION = "115a470d547982438f70198e353a921996e2e819"  # main @ 2026-09-03

# Prompt ajustado 2026-09-03 tras feedback real del usuario ("calidad de
# plástico/maniquí"): referencias explícitas a Pixar/DreamWorks + subsurface
# scattering suavizan el sombreado y dan volumen más orgánico; se agregaron
# términos negativos específicos para el defecto observado (plastic/waxy/
# mannequin, distorsión de lentes, asimetría facial). Probado contra fotos
# reales de alta resolución del usuario -- mejora visible y consistente en
# 5 variantes de steps/strength/guidance, ver sesión 2026-09-03.
# Lenguaje de uniformidad/simetría reforzado (hallazgo real, sesión
# 2026-09-08, pedido explícito del usuario "rostro más uniforme, formas de
# boca/nariz/ojos" sobre el incidente ALPAYANA/09637600) -- agregado al
# prompt YA probado del 2026-09-03 (comentario arriba), no reemplazado. Ver
# CONTROL_SCALE/STRENGTH más abajo para el resto del ajuste: la fidelidad
# estructural sube junto con esto a propósito, para no perder rasgos de la
# foto fuente al pedir más uniformidad -- verificar con CA-15 antes de
# confiar en el resultado, mismo criterio que el resto de este archivo.
#
# Vestuario de campo minero (ADR-164, avatar de soporte): frase descriptiva
# agregada AL FINAL del prompt ya probado de arriba, sin tocar el lenguaje
# existente -- solo describe la prenda visible en la zona de hombros/cuello
# del recorte de busto (no se le pide a la difusión que dibuje el logo, eso
# sigue siendo compositing determinístico, ver apply_logo_badge más abajo;
# "logo" sigue excluido en _NEGATIVE_PROMPT sin cambios).
#
# "corporate id photo composition" retirada (sesión 2026-09-08, experimento
# CONTROL_SCALE): el usuario pidió probar si esa frase influía en un
# artefacto visto en un experimento con CONTROL_SCALE=0.70 -- investigado y
# DESCARTADO como causa real (el artefacto era apply_logo_badge, compositing
# determinístico ajeno al prompt, ver esa función más abajo). Se retira de
# todas formas porque el usuario la pidió probar por su cuenta, no porque
# hubiera evidencia de que causaba algo -- ver CA-15 antes de asumir que este
# cambio por sí solo mejora o empeora nada.
_STYLE_PROMPT = (
    "professional 3D animated character portrait, Pixar and DreamWorks "
    "animation style, warm cinematic studio lighting, subtle rim light, "
    "smooth stylized skin shading with soft subsurface scattering, "
    "symmetric balanced facial features, uniform even complexion, "
    "clean proportioned nose and lips, large expressive detailed eyes, "
    "clean vector-inspired hair strands, plain white background, "
    "centered headshot, "
    "wearing a navy blue collared corporate polo shirt with a thin "
    "safety-orange trim at the collar, professional mining-field support "
    "technician styling, "
    "high quality character design"
)
_NEGATIVE_PROMPT = (
    "photo, photorealistic skin pores, text, watermark, signature, logo, "
    "extra limbs, extra fingers, deformed, disfigured, blurry, lowres, "
    "bad anatomy, duplicate, frame, border, multiple people, plastic "
    "skin, waxy, mannequin, glasses distortion, asymmetric face, "
    "lopsided features, uneven skin tone, blotchy skin"
)


class ModelLoadError(RuntimeError):
    pass


class GpuRequiredError(RuntimeError):
    pass


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, "").strip() or default)
    except Exception:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except Exception:
        return default


def _round8(x: int) -> int:
    return max(8, int(round(x / 8.0)) * 8)


def load_pipeline():
    """
    Carga el pipeline. Síncrona y bloqueante a propósito -- se llama una
    sola vez al arrancar el proceso (server.py), antes de aceptar tráfico
    (ADR-141: "precargar modelos antes del readiness"). Lanza excepción si
    falla; el llamador decide si el proceso arranca o no.
    """
    import torch
    from diffusers import (
        ControlNetModel,
        StableDiffusionControlNetImg2ImgPipeline,
        UniPCMultistepScheduler,
    )

    require_gpu = os.environ.get("AVATAR_ENGINE_REQUIRE_GPU", "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )
    cuda_ok = torch.cuda.is_available()
    if require_gpu and not cuda_ok:
        raise GpuRequiredError(
            "AVATAR_ENGINE_REQUIRE_GPU=1 (default) y torch.cuda.is_available() "
            "es False -- este servicio rechaza correr la difusión en CPU "
            "(demasiado lento para un flujo de registro interactivo). "
            "Setear AVATAR_ENGINE_REQUIRE_GPU=0 solo para pruebas locales "
            "sin GPU, nunca en producción."
        )
    device = "cuda" if cuda_ok else "cpu"
    dtype = torch.float16 if device == "cuda" else torch.float32
    variant = "fp16" if device == "cuda" else None

    try:
        controlnet = ControlNetModel.from_pretrained(
            CONTROLNET_CANNY_REPO,
            revision=CONTROLNET_CANNY_REVISION,
            torch_dtype=dtype,
            use_safetensors=True,
            variant=variant,
        )
        pipe = StableDiffusionControlNetImg2ImgPipeline.from_pretrained(
            SD15_REPO,
            revision=SD15_REVISION,
            controlnet=controlnet,
            torch_dtype=dtype,
            use_safetensors=True,
            variant=variant,
            # Hallazgo real 2026-09-04: el safety checker NSFW por defecto de
            # SD1.5 -- calibrado para generación libre de texto-a-imagen, no
            # para img2img sobre retratos reales de empleados -- daba falsos
            # positivos repetidos en fotos de registro biométrico normales
            # ("Potential NSFW content was detected... A black image will be
            # returned instead."), confirmado en logs reales de producción.
            # La entrada aquí SIEMPRE es una foto ya validada por el pipeline
            # de liveness/anti-spoofing real (ver ADR-142/143/148/149) -- este
            # checker no aporta protección adicional en este flujo, sólo
            # arruinaba el resultado de personas reales al azar. Decisión
            # explícita del usuario (2026-09-04): desactivarlo.
            safety_checker=None,
            requires_safety_checker=False,
        )
    except Exception as exc:
        raise ModelLoadError(f"No se pudo cargar el pipeline SD1.5+ControlNet: {exc}") from exc

    pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config)
    pipe = pipe.to(device)
    if device == "cuda":
        pipe.enable_attention_slicing()
    return pipe, device


_FACE_CASCADE = None


def _get_face_cascade():
    global _FACE_CASCADE
    if _FACE_CASCADE is None:
        path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        cascade = cv2.CascadeClassifier(path)
        _FACE_CASCADE = cascade if not cascade.empty() else False
    return _FACE_CASCADE or None


def _face_limited_edge_weight(gray: np.ndarray, outside_weight: float) -> Optional[np.ndarray]:
    """
    Devuelve un mapa de peso [outside_weight, 1.0] centrado en el rostro
    detectado (Haar cascade, liviano, ya vive en cv2 -- no agrega
    dependencias al servicio), o None si no se detecta rostro (en ese caso
    el llamador debe usar los bordes de Canny sin atenuar, comportamiento
    idéntico al actual). Objetivo: evitar que texturas de ropa/fondo con
    muchos bordes (pañuelos estampados, trajes a rayas) saturen el control
    de ControlNet y arrastren al colapso anatómico -- ver CA-15(a) y la
    comparación Yellen/Fudge vs. el resto en el ADR-141.
    """
    cascade = _get_face_cascade()
    if cascade is None:
        return None
    h, w = gray.shape[:2]
    faces = cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=5, minSize=(int(0.12 * min(h, w)),) * 2
    )
    if len(faces) == 0:
        return None
    fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
    cx, cy = fx + fw / 2.0, fy + fh * 0.42
    rx, ry = fw * 0.95, fh * 1.35
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dist = np.sqrt(((xx - cx) / max(rx, 1.0)) ** 2 + ((yy - cy) / max(ry, 1.0)) ** 2)
    oval = (dist <= 1.0).astype(np.float32)
    oval = cv2.GaussianBlur(oval, (0, 0), sigmaX=max(rx, ry) * 0.18)
    oval = np.clip(oval, 0.0, 1.0)
    return outside_weight + (1.0 - outside_weight) * oval


def stylize_portrait(
    pipe, device: str, work_bgr: np.ndarray, seed_override: Optional[int] = None
) -> np.ndarray:
    """
    work_bgr: recorte de rostro sobre fondo blanco (BGR uint8). Devuelve
    BGR uint8 del mismo tamaño. Lanza excepción en cualquier fallo -- el
    llamador (server.py) decide cómo reportarlo (no hay fallback acá
    adentro; el fallback clásico vive en ai_engine, el llamador HTTP).

    seed_override: si viene, reemplaza AVATAR_DIFFUSION_SEED solo para esta
    llamada -- usado por el reintento de calidad de ai_engine (ver CA-15(a)
    y la actualización 2026-09-03 del ADR-141): la seed fija por defecto
    colapsa de forma idiosincrática en algunas fotos (cabeza flotante o
    bloque negro sólido) sin que ningún parámetro global (strength,
    control_scale, recorte de Canny) lo explique de forma estable -- el
    llamador reintenta con otra seed sobre el mismo work_bgr en vez de
    cambiar el default global.
    """
    import torch
    from PIL import Image

    th, tw = work_bgr.shape[:2]
    max_side = _env_int("AVATAR_DIFFUSION_MAX_SIDE", 640)
    scale = min(1.0, float(max_side) / float(max(th, tw)))
    gw = _round8(int(round(tw * scale)))
    gh = _round8(int(round(th * scale)))

    init_bgr = cv2.resize(work_bgr, (gw, gh), interpolation=cv2.INTER_AREA)
    init_rgb = cv2.cvtColor(init_bgr, cv2.COLOR_BGR2RGB)
    init_img = Image.fromarray(init_rgb)

    gray = cv2.cvtColor(init_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    edges = cv2.Canny(gray, 80, 160)

    face_limited = os.environ.get("AVATAR_DIFFUSION_FACE_LIMITED_CONTROL", "").strip().lower() in (
        "1", "true", "yes",
    )
    if face_limited:
        outside_weight = _env_float("AVATAR_DIFFUSION_CONTROL_OUTSIDE_WEIGHT", 0.25)
        weight = _face_limited_edge_weight(gray, outside_weight)
        if weight is not None:
            edges = np.clip(edges.astype(np.float32) * weight, 0, 255).astype(np.uint8)

    edges_rgb = cv2.cvtColor(edges, cv2.COLOR_GRAY2RGB)
    control_img = Image.fromarray(edges_rgb)

    # 24->32->40 (2026-09-04, pedido explícito del usuario de mejorar
    # calidad): más pasos de difusión = más definición de detalle fino
    # (poros, mechones de pelo, iris) a costo de ~1-2s extra por intento --
    # aceptable en el flujo asíncrono post-registro (ADR-074), donde ya se
    # toleran hasta 3 intentos de ~5-8s cada uno.
    steps = _env_int("AVATAR_DIFFUSION_STEPS", 40)
    strength = _env_float("AVATAR_DIFFUSION_STRENGTH", 0.55)
    guidance = _env_float("AVATAR_DIFFUSION_GUIDANCE", 6.5)
    control_scale = _env_float("AVATAR_DIFFUSION_CONTROL_SCALE", 0.85)
    seed = int(seed_override) if seed_override is not None else _env_int("AVATAR_DIFFUSION_SEED", 7)

    generator = torch.Generator(device=device).manual_seed(seed)
    with torch.inference_mode():
        result = pipe(
            prompt=_STYLE_PROMPT,
            negative_prompt=_NEGATIVE_PROMPT,
            image=init_img,
            control_image=control_img,
            strength=strength,
            num_inference_steps=steps,
            guidance_scale=guidance,
            controlnet_conditioning_scale=control_scale,
            generator=generator,
        )
    if not result.images:
        raise RuntimeError("pipeline no devolvió ninguna imagen")

    out_rgb = np.array(result.images[0])
    out_bgr = cv2.cvtColor(out_rgb, cv2.COLOR_RGB2BGR)
    out_bgr = cv2.resize(out_bgr, (tw, th), interpolation=cv2.INTER_LANCZOS4)
    return out_bgr


# ── GFPGAN: restauración facial como post-proceso (2026-09-04) ────────────
# Mejora de calidad pedida explícitamente por el usuario. Corre DESPUÉS de
# stylize_portrait, sobre la salida ya estilizada de SD1.5+ControlNet --
# limpia el sombreado ligeramente "pintado"/blando que deja la difusión y
# recupera nitidez en ojos/boca/pelo. Apache 2.0, mismos pesos ya vetados
# para avatar_animation_engine/ADR-150 (ver su THIRD_PARTY_NOTICES.md): no
# depende de InsightFace ni de ningún peso "non-commercial research only",
# a diferencia de IP-Adapter-FaceID/InstantID (descartados en ADR-141).

GFPGAN_WEIGHTS_URL = (
    "https://github.com/TencentARC/GFPGAN/releases/download/v1.3.0/GFPGANv1.4.pth"
)


def _gfpgan_weights_path() -> str:
    # Bajo el mismo volumen persistente que la caché de Hugging Face
    # (HF_HOME=/app/.hf_cache, docker-compose.yml: diffusion_avatar_cache) --
    # se descarga una sola vez, sobrevive a recrear el contenedor.
    cache_root = os.environ.get("HF_HOME", "/app/.hf_cache")
    return os.path.join(cache_root, "gfpgan", "GFPGANv1.4.pth")


def _ensure_gfpgan_weights() -> str:
    """Descarga GFPGANv1.4.pth si falta. Descarga explícita y propia (no la
    de GFPGANer/basicsr) para controlar exactamente dónde queda el archivo y
    reutilizar el volumen ya montado, en vez de depender de la ruta relativa
    por defecto de la librería."""
    path = _gfpgan_weights_path()
    if os.path.isfile(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    import requests

    tmp = path + ".tmp"
    with requests.get(GFPGAN_WEIGHTS_URL, timeout=180, stream=True) as resp:
        resp.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                if chunk:
                    f.write(chunk)
    os.replace(tmp, path)
    return path


def load_gfpgan(device: str):
    """Carga el restaurador GFPGAN una sola vez al arrancar (mismo patrón que
    load_pipeline: preload síncrono antes del readiness). Devuelve None si
    está deshabilitado o si la carga falla -- este post-proceso es
    estrictamente OPCIONAL: su ausencia no debe impedir que avatar_engine
    sirva el avatar sin mejorar, ni bloquear el arranque del servicio."""
    enabled = os.environ.get("AVATAR_DIFFUSION_GFPGAN_ENABLED", "1").strip().lower() not in (
        "0", "false", "no",
    )
    if not enabled:
        log.info("gfpgan disabled via AVATAR_DIFFUSION_GFPGAN_ENABLED")
        return None
    try:
        from gfpgan import GFPGANer

        weights_path = _ensure_gfpgan_weights()
        restorer = GFPGANer(
            model_path=weights_path,
            # upscale=1: solo restauración de detalle, no upscaling -- el
            # tamaño final ya lo decide _compose_avatar_canvas (ai_engine).
            upscale=1,
            arch="clean",
            channel_multiplier=2,
            bg_upsampler=None,
            device=device,
        )
        log.info("gfpgan restorer ready device=%s", device)
        return restorer
    except Exception as exc:
        log.warning("gfpgan load failed, continuing WITHOUT enhancement: %s", exc)
        return None


def enhance_with_gfpgan(restorer, out_bgr: np.ndarray) -> np.ndarray:
    """Aplica GFPGAN sobre la salida ya estilizada. Nunca lanza: cualquier
    fallo de esta función debe devolver la imagen SIN mejorar en vez de
    tumbar el request -- es un paso opcional, no debe convertir un avatar ya
    aceptable en un fallo de registro."""
    if restorer is None:
        return out_bgr
    try:
        _, _, restored = restorer.enhance(
            out_bgr, has_aligned=False, only_center_face=False, paste_back=True
        )
        if restored is None:
            return out_bgr
        if restored.shape[:2] != out_bgr.shape[:2]:
            restored = cv2.resize(
                restored, (out_bgr.shape[1], out_bgr.shape[0]),
                interpolation=cv2.INTER_LANCZOS4,
            )
        return restored
    except Exception as exc:
        log.warning("gfpgan enhance failed, using unenhanced output: %s", exc)
        return out_bgr


# ── Insignia de logo Beemetry (ADR-164) ────────────────────────────────────
# Compositing determinístico, NO generado por difusión: SD1.5 no renderiza
# texto/logos legibles de forma confiable (por eso _NEGATIVE_PROMPT excluye
# "logo" explícitamente, sin cambios) -- en vez de pedirle a la difusión que
# "dibuje" el logo, se pega el archivo real como insignia sobre la salida ya
# estilizada, mismo punto del pipeline que enhance_with_gfpgan (después de
# GFPGAN, antes de encodear la respuesta -- ver server.py).
_LOGO_BADGE_CACHE: dict = {}


def _load_logo_badge_rgba(path: str) -> Optional[np.ndarray]:
    """Carga el logo y le agrega canal alfa por color-key sobre blanco --
    los 3 archivos fuente (ver avatar_engine/assets/) son tinta azul sólida
    sobre fondo blanco plano SIN transparencia real (verificado con PIL:
    alpha extrema 255-255 donde había canal alfa, o sin canal alfa) -- un
    umbral simple de "casi blanco" alcanza porque no hay degradados.
    Cachea por path; None si el archivo no existe o falla la carga."""
    cached = _LOGO_BADGE_CACHE.get(path)
    if cached is not None:
        return cached
    img = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if img is None:
        log.warning("logo badge not found/unreadable: %s", path)
        return None
    if img.shape[2] == 4:
        bgr = img[:, :, :3]
    else:
        bgr = img
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    # Blanco real ~255; margen generoso (>=245) para no dejar halo del
    # antialiasing del borde de los trazos azules.
    alpha = np.where(gray >= 245, 0, 255).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0)  # suaviza el borde recortado
    rgba = np.dstack([bgr, alpha])
    _LOGO_BADGE_CACHE[path] = rgba
    return rgba


def apply_logo_badge(out_bgr: np.ndarray) -> np.ndarray:
    """Pega la insignia del logo Beemetry en la esquina inferior derecha del
    retrato ya estilizado. Nunca lanza -- mismo criterio que
    enhance_with_gfpgan: cualquier fallo (asset ausente, imagen inválida)
    devuelve out_bgr sin tocar en vez de tumbar el request."""
    enabled = os.environ.get("AVATAR_LOGO_BADGE_ENABLED", "1").strip().lower() not in (
        "0", "false", "no",
    )
    if not enabled:
        return out_bgr
    path = os.environ.get("AVATAR_LOGO_BADGE_PATH", "/app/assets/beemetry-logo-hex.png")
    try:
        badge = _load_logo_badge_rgba(path)
        if badge is None:
            return out_bgr
        th, tw = out_bgr.shape[:2]
        badge_w = max(24, int(round(min(th, tw) * 0.16)))
        bh, bw = badge.shape[:2]
        badge_h = max(24, int(round(badge_w * bh / bw)))
        badge_rs = cv2.resize(badge, (badge_w, badge_h), interpolation=cv2.INTER_AREA)

        margin = int(round(min(th, tw) * 0.04))
        x0 = max(0, tw - badge_w - margin)
        y0 = max(0, th - badge_h - margin)
        x1 = min(tw, x0 + badge_w)
        y1 = min(th, y0 + badge_h)
        bw_clip, bh_clip = x1 - x0, y1 - y0
        if bw_clip <= 0 or bh_clip <= 0:
            return out_bgr

        region = out_bgr[y0:y1, x0:x1].astype(np.float32)
        badge_bgr = badge_rs[:bh_clip, :bw_clip, :3].astype(np.float32)
        alpha_f = (badge_rs[:bh_clip, :bw_clip, 3:4].astype(np.float32)) / 255.0
        blended = region * (1.0 - alpha_f) + badge_bgr * alpha_f
        out_bgr = out_bgr.copy()
        out_bgr[y0:y1, x0:x1] = blended.astype(np.uint8)
        return out_bgr
    except Exception as exc:
        log.warning("logo badge compositing failed, using output without badge: %s", exc)
        return out_bgr
