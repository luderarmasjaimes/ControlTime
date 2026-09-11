# ADR-155 — Avatar por difusión: desactivado el safety checker NSFW por defecto de SD1.5

**Status**: implemented

**Fecha**: 2026-09-04

**Ámbito**: ia

**Relación**: extiende ADR-141 (`avatar-estilizado-difusion-local-sd15-controlnet`).
Decisión explícita del usuario, no unilateral (ver sección Decisión).

## Contexto

Reporte real del usuario: el avatar generado tras un registro exitoso salía
como la foto real sin ningún estilizado artístico, en vez del resultado
esperado del pipeline SD1.5+ControlNet de ADR-141.

Investigado con evidencia real (`docker logs beemetry-avatar-engine`), no
por sospecha: el pipeline de difusión SÍ está activo y corriendo (inferencia
real en GPU, ~4-8s por intento), pero repetidamente devuelve

```
Potential NSFW content was detected in one or more images. A black image
will be returned instead. Try again with a different prompt and/or seed.
```

-- el safety checker NSFW que trae Stable Diffusion por defecto,
notoriamente mal calibrado para casos fuera de su diseño original
(generación libre texto→imagen): en img2img sobre fotos reales de personas
comunes, especialmente ciertos tonos de piel/iluminación/encuadre, genera
falsos positivos con frecuencia. `main.cpp` (`AUTH_REGISTER_CARTOON_BG`)
tiene una cadena de reintento en 3 niveles (bust async → portrait sync →
raw sync) precisamente para nunca terminar mostrando una imagen negra
rota -- pero cuando los tres intentos de estilizado se topan con el filtro,
el nivel final cae de vuelta a la foto original sin estilizar, que es
exactamente lo que reportó el usuario.

## Decisión

Confirmado explícitamente con el usuario (no es un cambio unilateral sobre
un filtro de seguridad): **desactivar el safety checker NSFW** del pipeline
SD1.5, en vez de bajar su umbral o dejarlo como está. Justificación
aceptada: la entrada a este pipeline SIEMPRE es una foto que ya pasó el
flujo real de liveness/anti-spoofing (ICAO + parpadeo natural + desafío
activo, ADR-142/143/148/149) -- el checker NSFW no aporta ninguna
protección adicional en este flujo específico (no es generación libre a
partir de un prompt de usuario), sólo arruinaba el resultado de personas
reales al azar.

`avatar_engine/avatar_diffusion.py`:

```python
pipe = StableDiffusionControlNetImg2ImgPipeline.from_pretrained(
    SD15_REPO,
    ...
    safety_checker=None,
    requires_safety_checker=False,
)
```

Verificado tras el rebuild+redeploy: el log de arranque pasó de cargar 7
componentes del pipeline a 6 (`Loading pipeline components...: 100%|██████████| 6/6`,
antes 7/7) -- confirma que el componente `safety_checker` ya no se
instancia. El código que consume `result.images[0]`
(`avatar_diffusion.py`, función `stylize_portrait`) no depende de
`result.nsfw_content_detected` en ningún punto, así que no hizo falta
tocar nada más.

## Consecuencias

- Los avatares nuevos deberían mostrar el estilizado artístico esperado en
  vez de caer al fallback de foto sin estilizar -- pendiente de
  confirmación del usuario con un registro real tras el despliegue.
- El mecanismo de reintento por semillas (`seed_override`, en el llamador)
  sigue existiendo y sigue siendo inofensivo dejarlo -- ya no debería
  necesitar reintentar por causa del NSFW checker, pero cubre otras fallas
  transitorias del pipeline igual.
- Sin este checker, el pipeline no tiene ningún filtro de contenido propio
  para la ruta de difusión -- aceptable en este flujo porque la entrada es
  siempre una foto de registro biométrico real, nunca un prompt libre de
  usuario ni una imagen subida sin verificar.
- Referencias: `avatar_engine/avatar_diffusion.py` (`_load_pipeline`),
  `backend/src/main.cpp` (`AUTH_REGISTER_CARTOON_BG`, cadena de reintento de
  3 niveles, sin cambios).
