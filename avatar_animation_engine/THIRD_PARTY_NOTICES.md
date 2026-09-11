# Avisos de terceros — `avatar_animation_engine` (ADR-150)

Este servicio invoca código y pesos de terceros que NO son propiedad de este
proyecto. Investigación de licencias completa en ADR-150; resumen operativo:

## SadTalker (Fase A, implementado)

- Código: [`OpenTalker/SadTalker`](https://github.com/OpenTalker/SadTalker),
  commit pineado `cd4c0465ae0b54a6f85af57f5c65fec9fe23e7f8` (2023-10-10,
  último commit real del repo). Licencia **Apache 2.0** (actualizada; la
  restricción "non-commercial" histórica fue removida por los mantenedores).
  Clonado a `/opt/sadtalker` en el `Dockerfile`, invocado vía subproceso
  (`backends/sadtalker_backend.py`) — no se copia ni reescribe su código aquí.
- Checkpoints principales (`mapping_*.pth.tar`, `SadTalker_V0.0.2_*.safetensors`):
  GitHub Releases de `OpenTalker/SadTalker` (release `v0.0.2-rc`).
- `BFM_Fitting/` (3DMM): espacio oficial en Hugging Face
  [`vinthony/SadTalker`](https://huggingface.co/spaces/vinthony/SadTalker)
  (mismo autor/proyecto), revisión pineada
  `5194f86e46b8d20f11c9c3610b808c325032e1c5`.
- Enhancer opcional (`--enhancer gfpgan`): pesos de
  [`xinntao/facexlib`](https://github.com/xinntao/facexlib) (BSD-3) y
  [`TencentARC/GFPGAN`](https://github.com/TencentARC/GFPGAN) (Apache 2.0).

Ninguno de estos componentes depende de InsightFace.

## LivePortrait / LatentSync (Fases B/C, NO implementados)

Documentados en ADR-150 como bloqueados por licencia hasta parchar su
preprocesamiento de landmarks (InsightFace `buffalo_l`/X-Pose, o
`insightface==0.7.3` respectivamente — ambos "non-commercial research
purposes only"). No se descarga ni se vendoriza código de estos dos todavía.

## Obligación de atribución

Cualquier despliegue de este servicio debe conservar este archivo y la
sección de licencias de ADR-150 accesible junto al código, por los términos
de Apache 2.0 (aviso de copyright + cambios) de SadTalker/facexlib/GFPGAN.
