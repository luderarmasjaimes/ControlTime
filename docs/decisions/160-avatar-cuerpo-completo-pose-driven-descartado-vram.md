# ADR-160 — Avatar de cuerpo completo con movimiento (pose-driven): descartado por VRAM en este host

**Status**: descartado para este hardware — investigación de licencia/VRAM
completa, sin implementación.
**Fecha**: 2026-09-07
**Autores**: Luder Armas + Claude
**Ámbito**: ia
**Relación**: responde a una extensión de alcance sobre ADR-150 (avatar
animado audio-driven, `avatar_animation_engine`); no lo reemplaza ni lo
modifica.

## Contexto

Sobre la base de ADR-150 (SadTalker, Fase A verificada end-to-end), se pidió
evaluar una extensión de alcance mayor: videos de **cuerpo completo con
movimiento real** — la persona haciendo deporte, corriendo, trabajando en
computadora/laptop/celular, trabajando en una mina, manejando un camión.

**Desajuste técnico con lo ya implementado, mismo patrón que motivó
ADR-150**: SadTalker (y cualquier modelo de reenactment/lip-sync
audio-driven) no hace esto ni con más tiempo ni con más VRAM. Ese modelo
mueve cabeza/labios/expresión facial siguiendo audio — no sintetiza pose
corporal, extremidades, ni escena/entorno (una mina, un camión). Pedirle eso
no da un resultado degradado, da directamente nada: la capacidad no existe
en esa arquitectura.

Lo que se pide es una categoría de modelo distinta: **generación de video
humano pose-driven** — reciben una imagen fuente + un video/esqueleto
conductor de otra persona haciendo la acción deseada, y animan a la persona
de la foto siguiendo esa pose. Se investigaron los tres candidatos abiertos
más conocidos de esta familia, mismo proceso de licencia+VRAM que ya usó
ADR-141 (InstantID/IP-Adapter-FaceID) y ADR-150 (LivePortrait/LatentSync)
antes de escribir código.

## Investigación de licencia y VRAM

| Modelo | Licencia del código | VRAM real (fuente propia) | Bloqueante |
|---|---|---|---|
| **Moore-AnimateAnyone** (`MooreThreads/Moore-AnimateAnyone`, reimplementación abierta de AnimateAnyone de Alibaba, cuyo código original nunca se liberó) | Apache 2.0. Dependencias de pose (`controlnet-aux`, DWPose) sin bloqueante — ver abajo. | **README propio: "if you have your own GPU resource (>=16GB vram)"** | VRAM. Este host tiene 8151 MiB totales, compartidos con `avatar_engine`/`avatar_animation_engine`/`ollama`. |
| **Champ** (`fudan-generative-vision/champ`) | MIT | **README propio: "The default motion-02 in inference.yaml has about 250 frames, requires ~20GB VRAM"** | VRAM (peor que Moore-AnimateAnyone). Además usa **SMPL** (modelo paramétrico de cuerpo humano) — su licencia real de pesos no se confirmó en esta pasada porque el bloqueante de VRAM ya descarta el modelo, no se justifica invertir tiempo en verificarla. |
| **MagicAnimate** (`magic-research/magic-animate`) | BSD-3-Clause (sin restricción NC) | No confirmado con una cifra propia verificada en esta pasada (arquitectura de la misma familia — SD1.5 + ReferenceNet + AnimateDiff + ControlNet DensePose — reportada por la comunidad en el rango de 15GB+; no se afirma un número exacto sin la fuente propia del proyecto, a diferencia de los otros dos donde el propio README lo dice). | VRAM, con la misma confianza más baja que los otros dos por no tener la cifra de primera fuente — no se investiga más porque incluso el caso más optimista de esta familia arquitectónica no cabe en 8GB compartidos. |

**Extractor de pose (DWPose, usado por Moore-AnimateAnyone y variantes de
esta familia)**: Apache 2.0, basado en MMPose (Apache 2.0) y ControlNet — sin
bloqueante de licencia, a diferencia de InsightFace en ADR-150. La pose no es
el problema en esta familia de modelos; el problema es el modelo de difusión
de video en sí (SD1.5 + ReferenceNet + módulo de movimiento tipo AnimateDiff
corriendo sobre secuencias completas de frames, no una sola imagen como
SD1.5 estático).

## Decisión

**Descartado para este hardware, no descartado como concepto.** Los tres
candidatos investigados requieren VRAM muy por encima de los 8151 MiB
totales de este host — y ese total ya se comparte con `avatar_engine`
(ADR-141) y `avatar_animation_engine` (ADR-150), que además ya midió un pico
real de **7748 MiB solo con SadTalker** (ver corrección de VRAM en ADR-150).
No hay ningún candidato de esta familia que quepa ni siquiera corriendo solo,
sin nada más cargado.

No se investigan más candidatos de la misma familia arquitectónica
(diffusion + ReferenceNet + motion module) porque el patrón de VRAM es
estructural a esa arquitectura, no específico de un repo — un cuarto
candidato de la misma familia no cambiaría la conclusión.

## Camino real si esto se vuelve prioridad

1. **Cambiar de hardware**: esta familia de modelos (16-20GB+) apunta a una
   GPU de datacenter/workstation (A10, RTX 4090 24GB, etc.), no a la RTX 5060
   Laptop de 8GB de este entorno de pruebas. No hay optimización de software
   (cuantización, offloading) que cierre una brecha de 2-2.5x sin degradar
   la calidad al punto de no servir.
2. **Servicios de API de terceros** (no local): si el objetivo del negocio
   justifica el costo, existen APIs comerciales de generación de video
   humano con pose que no corren en este hardware — evaluación de costo y
   términos de servicio, fuera del alcance de este ADR (que es
   específicamente sobre modelos locales/gratuitos, mismo encuadre que
   ADR-141/150).
3. **Reducir alcance**: si lo que realmente se necesita es "el avatar se ve
   trabajando/en contexto" y no video con movimiento corporal real, una
   alternativa mucho más barata es *imagen* estática con fondo/contexto
   (persona en la mina, en el camión) generada por el pipeline de difusión
   ya existente de `avatar_engine` (ADR-141, SD1.5+ControlNet, ya corre en
   este hardware) en vez de *video* con movimiento real — cambia la pregunta
   de "generar movimiento humano" (cara ADR-160) a "generar una escena
   estática" (ya resuelto, mismo costo que el avatar actual). Requeriría su
   propia evaluación de prompt/ControlNet si se decide perseguir, no
   implementado en esta pasada.

## Alternativas descartadas

- **Probar igual con `--size` reducido / menos frames**: la cifra de VRAM
  reportada por Moore-AnimateAnyone y Champ ya es la de su configuración por
  defecto documentada por el propio proyecto; reducir agresivamente
  resolución/frames para forzar que quepa en 8GB degradaría la calidad al
  punto de no cumplir el objetivo (videos de acciones reconocibles como
  correr/manejar/trabajar), y no hay cifra de referencia de los propios
  proyectos para saber cuánto reducir sin romper el modelo — se prefiere no
  adivinar (mismo criterio de "no asumir sin verificar" que dejó ADR-141 v4).
- **Investigar más candidatos de la misma familia arquitectónica**: no
  cambia la conclusión, el techo de VRAM es estructural a
  difusión+ReferenceNet+motion-module, no a una implementación particular.
