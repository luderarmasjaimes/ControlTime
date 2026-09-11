# ADR-144 — Evaluación de InspireFace (Opción C): licencia académica bloquea producción, spike aislado autorizado

**Status**: evaluado, no adoptado (spike de I+D autorizado, sin ruta a producción sin licencia comercial)

**Fecha**: 2026-09-03

**Ámbito**: ia, seguridad, biometría

**Relación**: evalúa una alternativa a ADR-105 (DeepFace/Facenet512 +
Silent-Face-Anti-Spoofing, proveedor local por defecto) y ADR-099
(InsightFace como motor secundario no bloqueante, ya en uso); mismo patrón de
riesgo de licencia ya identificado con AnimeGANv2 en
[ADR-074](074-avatar-biometrico-local-hd-bajo-demanda.md).

## Contexto

Pedido explícito del usuario: revisar "Opción C — InsightFace/InspireFace +
OpenCV (C/C++)" para reforzar el liveness/reconocimiento facial del sistema
actual, dado que el liveness pasivo de un solo frame (Silent-Face) ya está
documentado como insuficiente por sí solo (ADR-104).

Antes de invertir tiempo de integración (CMake, Dockerfile, adaptador en
`face_analysis.cpp`, mismo patrón que SeetaFace6/ADR-104), se auditó el
proyecto real `github.com/HyperInspire/InspireFace` (clonado localmente,
commit `248067bc18c383863cdc63de06fb1d1e3f4788bd`, 2026-08-04): SDK C/C++
multiplataforma sobre MNN, con detección, reconocimiento, pose, calidad y
liveness RGB/IR empaquetados.

**Hallazgo bloqueante**: el propio `README.md` del proyecto declara, en su
sección "License" (no hay archivo `LICENSE` separado):

> "The licensing of the open-source models employed by InspireFace adheres to
> the same requirements as InsightFace, specifying their use solely for
> academic purposes and explicitly prohibiting commercial applications."

El código del SDK es Apache-2.0, pero los packs de modelos gratuitos
(Pikachu/Megatron/etc. — sin ellos el SDK no funciona) heredan la restricción
académica-only de InsightFace. El propio README invita a contactar
`contact@insightface.ai` desde un correo corporativo para soporte/licencia
comercial — no hay tier comercial gratuito. Beemetry es un producto
comercial (plataforma vendida a empresas mineras, ver lista en
`backend/src/config/app_config.hpp::kMiningCompanies`); adoptar estos packs
como proveedor de producción sin esa licencia violaría la condición, en el
mismo sentido que ya se identificó y se descartó para AnimeGANv2 (ADR-074).

## Decisión

1. **No se integra InspireFace como `BiometricProvider` de producción.** No se
   toca `CMakeLists.txt` del backend, `biometric_routes.cpp`,
   `face_analysis.cpp` ni el `Dockerfile`/`docker-compose.yml` de producción.
2. **Se autoriza un spike aislado de I+D** en
   `spikes/inspireface_bakeoff/` (Dockerfile + script Python independientes,
   nunca importados por `ai_engine/` ni `backend/`) para obtener números
   reales de precisión de reconocimiento y latencia, puramente comparativos —
   nunca desplegado a un cliente ni usado para procesar biometría real de
   usuarios de la plataforma.
3. El spike usa un subconjunto de LFW re-hosteado en HuggingFace
   (`vilsonrodrigues/lfw`, Apache-2.0) en vez del dataset oficial de LFW: el
   host oficial (`vis-www.cs.umass.edu`) y Figshare (mirror usado por
   scikit-learn) no eran alcanzables desde el entorno donde se escribió este
   spike (red restringida a `github.com`/`huggingface.co`/`pypi.org`) — ver
   `spikes/inspireface_bakeoff/README.md` para el detalle y las limitaciones
   de comparabilidad que esto implica.
4. **No se midió liveness/PAD** en este spike: ningún dataset de ataques de
   presentación (CelebA-Spoof/CASIA-FASD/OULU-NPU/SiW/NUAA) era descargable
   desde ese mismo entorno restringido. El script queda preparado para
   agregar esa medición en cuanto se disponga de un manifiesto real
   vivo/spoof, en un entorno con acceso de red normal.

## Resultado del spike (informativo, no de producción)

Corrida ejecutada el 2026-09-03 (`spikes/inspireface_bakeoff/data/bakeoff_report.json`),
modelo `Pikachu-t4.0` (general, CPU, MNN), 600 pares (300 genuinos + 300
impostores) sobre el subconjunto de 9164 imágenes de `vilsonrodrigues/lfw`:

| Métrica | Valor |
|---|---|
| Precisión @ mejor umbral coseno propio | **99.17%** (umbral 0.26) |
| Latencia detección+extracción (CPU) | media **20.7 ms**, p95 23.6 ms, máx 30.6 ms |
| Imágenes sin rostro detectado | 0 / 1100 |
| Imágenes con **más de un rostro** detectado | **191 / 1100 (17%)** |

Lectura de estos números:

- La precisión (99.17%) y la latencia (~21 ms/imagen en CPU, sin GPU) son
  buenas señales — para contexto, InsightFace (paquete Python, ya usado como
  motor secundario, ADR-099) medía 580-790 ms por llamada a `/face_embedding`
  incluso **después** de la corrección de sobre-suscripción de hilos de
  ADR-100; InspireFace corrió esto ~25-30x más rápido en el mismo tipo de
  hardware (CPU, contenedor Docker).
- El 17% de imágenes con **más de un rostro detectado** es una señal de alerta,
  no un dato menor: LFW son mayoritariamente retratos individuales, así que
  esa tasa sugiere que el detector por defecto de InspireFace, con la
  configuración por defecto de este spike (`HF_DETECT_MODE_ALWAYS_DETECT`,
  sin ajustar el umbral de confianza de detección), es más propenso a falsos
  positivos de detección que lo esperable — el script se quedó con el primer
  rostro devuelto (`faces[0]`) en esos casos, sin lógica de "rostro más
  grande/más centrado", lo que pudo introducir ruido en la precisión medida.
  Antes de tomar el 99.17% como referencia seria, valdría ajustar
  `set_detection_confidence_threshold`/`set_filter_minimum_face_pixel_size` y
  volver a correr.
- Sigue sin medirse liveness/PAD (ver sección de arriba) y sigue sin ser el
  protocolo oficial de pares de LFW — estas cifras son una señal preliminar
  de viabilidad técnica, no evidencia de calibración (ese nivel de evidencia
  sigue siendo el pendiente CA-10 de `specs/008-biometria-facial-login/spec.md`).

## Consecuencias

### Positivas
- Se evita invertir tiempo de integración C++/CMake/Docker en un proveedor
  que no se puede promover a producción sin resolver primero una licencia
  comercial — la pregunta de negocio (¿vale la pena contactar a InsightFace
  por licencia comercial?) puede resolverse con el número real de precisión
  del spike antes de gastar ese esfuerzo, no después.
- Deja un harness reproducible (`spikes/inspireface_bakeoff/`) listo para
  reactivarse rápido si en el futuro se resuelve la licencia (contrato
  comercial, o InspireFace libera un pack con licencia distinta).

### Riesgos y límites
- El spike corrió sobre un subconjunto no oficial de LFW y sin medir PAD —
  cualquier decisión de negocio basada en este número debe tratarlo como una
  señal preliminar, no como evidencia de calibración (ese nivel de evidencia
  sigue siendo, para cualquier proveedor, el pendiente CA-10 de
  `specs/008-biometria-facial-login/spec.md`: FMR/FNMR/FTE/FTA + ISO/IEC
  30107-3 cuando el TDR lo exija).
- Si en el futuro alguien clona `spikes/inspireface_bakeoff/` esperando que
  sea material de partida para producción, el README y este ADR son la
  barrera documental — pero no hay una barrera técnica (el código sí
  funciona) que impida copiarlo por error a `ai_engine/`. Mitigado por
  mantenerlo en un directorio `spikes/` explícitamente fuera de los targets
  de build de `backend/CMakeLists.txt` y `ai_engine/Dockerfile.ai`.

## Alternativas descartadas

- **Integración completa como `BiometricProvider::InspireFace` seleccionable**
  (mismo patrón que SeetaFace6): descartada por ahora — no tiene sentido
  construir el adaptador C++ completo, el CMake vendoring y el
  provisionamiento de modelos en Docker antes de saber si el resultado del
  spike siquiera justifica resolver la licencia comercial.
- **Ignorar el hallazgo de licencia y evaluar solo métricas técnicas**:
  descartada — es exactamente el error que este ADR existe para prevenir
  (evaluar solo la licencia del código del SDK, Apache-2.0, sin verificar la
  de los pesos que lo hacen funcionar).

## Referencias

- `spikes/inspireface_bakeoff/` (Dockerfile, `bakeoff_lfw.py`, `README.md`,
  `data/bakeoff_report.json`)
- ADR-074 (mismo patrón de riesgo de licencia, AnimeGANv2)
- ADR-104 (SeetaFace6 — patrón de proveedor seleccionable con evidencia de
  licencia explícita, referencia de cómo se documentaría una integración real)
- ADR-105 (proveedor local por defecto actual)
- ADR-099 (InsightFace ya en uso como motor secundario no bloqueante —
  paquete Python `insightface`, PyPI, no este SDK)
- `specs/008-biometria-facial-login/spec.md` (CA-10, calibración pendiente)
