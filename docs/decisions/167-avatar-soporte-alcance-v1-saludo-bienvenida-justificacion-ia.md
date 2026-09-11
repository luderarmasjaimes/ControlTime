# ADR-167 — Avatar de soporte: alcance v1 acotado a saludo de bienvenida; hoja de ruta y justificación de la inversión en IA

**Status**: accepted (alcance de negocio v1); hoja de ruta ampliada queda `proposed`/diferida

**Fecha**: 2026-09-11

**Ámbito**: ia, plataforma, reports (frontend)

**Relación**: se apoya en ADR-074 (avatar local), ADR-141/155/157-159
(estilización por difusión), ADR-150/160 (evaluación de avatar animado),
ADR-164 (wiring a onboarding/informes/alarmas) — no reabre ninguna de ellas,
fija el alcance de negocio para el primer release y documenta el retorno de
la inversión técnica del conjunto.

## Contexto

Entre el 2026-07-27 (ADR-074) y el 2026-09-08 (ADR-164) se investigó y
construyó, por partes, un avatar biométrico personal (generado desde la
propia foto de registro del usuario) con varias capacidades posibles más
allá de una imagen estática: estilización artística local (SD1.5+ControlNet,
ADR-141), animación con habla (SadTalker, ADR-150, evaluado y verificado
E2E en Fase A), y puntos de disparo ya cableados en el frontend real
(`requestSupportAvatar()`, `AvatarWidget.tsx`) para tres eventos:
`onboarding` (bienvenida tras registro), `report` (al exportar un informe) y
`alarm_loop` (ante una alarma crítica nueva) — ADR-164.

Durante esa misma investigación se evaluaron explícitamente, y quedaron
documentadas como técnicamente viables o como líneas de trabajo futuras, más
capacidades: un rol de **soporte/asistente** dentro de la plataforma (el
propio nombre de la función, `requestSupportAvatar`, ya anticipa este rol),
un avatar **animado/"en línea"** con habla real (Fase A de ADR-150 ya
verificada; Fases B/C sin implementar), **indicadores visuales de alarma y
advertencia** (el disparador `alarm_loop` ya existe en código; un disparador
`kpi` quedó deliberadamente diferido en ADR-164 "sin punto de disparo real
en la UI"), y un **tutorial de uso guiado** (idea explorada, sin ADR ni
código propio todavía).

Ninguna de esas capacidades adicionales está lista para comprometerse como
alcance contractual del primer release: `report`/`alarm_loop` funcionan y
están verificados a nivel de wiring (ADR-164), pero no tienen contenido
narrativo propio todavía (hoy disparan la misma animación de saludo, no un
mensaje contextual); el tutorial guiado y el rol conversacional de soporte
no tienen código ni SPEC.

## Decisión

1. **El alcance comprometido de v1 es exclusivamente el saludo de
   bienvenida** (`onboarding`/`welcome` en `AvatarWidget.tsx`, tras
   registro/login) — es la única capacidad que se presenta y se vende como
   parte de esta etapa del proyecto.
2. **Los disparadores `report` y `alarm_loop` de ADR-164 quedan como están**:
   activos en el código, ya verificados a nivel de wiring, de bajo costo
   marginal (reutilizan la misma animación) — pero **no forman parte de la
   promesa de alcance v1**. Se documentan acá como refuerzo incidental ya
   entregado, no como una capacidad nueva que necesite justificarse aparte
   ni que se anuncie formalmente a Gerencia todavía.
3. **El resto de la hoja de ruta queda `proposed`/diferida, no descartada**
   (mismo patrón que ADR-025 con EPP): rol conversacional de soporte, avatar
   animado con habla en producción (Fases B/C de ADR-150), sistema de
   indicadores de alarma/advertencia con contenido propio por severidad, y
   tutorial de uso guiado. Ninguna se construye sin su propio SPEC/ADR — en
   particular, un rol conversacional exigiría decidir aparte qué motor de
   lenguaje lo sostiene, con qué datos y bajo qué límites, y un sistema de
   alarmas con contenido propio exige decidir el catálogo de mensajes por
   severidad, no solo el punto de disparo.

## Justificación técnica: por qué la inversión valió la pena aunque v1 sea "solo" un saludo

El valor real de este trabajo no se mide únicamente por lo que el usuario ve
en pantalla en v1. Construir el avatar fue el **vehículo** que forzó
resolver, con evidencia real, una serie de mejoras que hoy sostienen el
flujo de biometría/seguridad de TODA la plataforma — no solo el widget:

- **Endurecimiento del pipeline de liveness/anti-spoofing** que usa
  cualquier login o registro facial, no solo el avatar: verificación de
  desafíos movida al servidor, parpadeo natural pasivo, desacoplo de
  desafío/espera, contador ICAO sin tolerancia (ADR-142, 145, 146, 148, 149,
  156).
- **Reemplazo del tracking facial del cliente** (`Chromium FaceDetector`,
  frágil y solo disponible en un navegador) por MediaPipe Tasks Vision
  (WASM), la misma geometría que ya usa el servidor — mejora la fiabilidad
  de captura en cualquier pantalla de biometría, no solo en el avatar
  (ADR-162).
- **Un microservicio aislado para Silent-Face-Anti-Spoofing** que resolvió
  de raíz un conflicto real de cuDNN entre TensorFlow y PyTorch — sin este
  fix, ningún servicio nuevo con GPU (avatar incluido, pero no solo avatar)
  podía convivir con el resto del stack (ADR-143).
- **Un pipeline de curación y reentrenamiento de datasets** (66k→111k
  imágenes revisadas, filtros de calidad/frontalidad/duplicados) construido
  para mejorar el avatar, pero que terminó mejorando el clasificador de
  lentes que usa el login biométrico real de producción (ADR-119), con un
  fix de capacidad que ya se reutilizó una vez (ADR-165 reaplica el mismo
  parche de límite de hilos de ADR-100).
- **Endurecimiento del registro**: precheque de DNI/usuario antes de abrir
  la cámara, buffer de nginx correcto para el tráfico de captura, reintentos
  que ya no se disparan ante rechazos deterministas (ADR-147, 153), y OTP de
  contacto antes de habilitar la biometría (ADR-161) — hallazgos de
  depuración real del flujo de captura del avatar, aplicables a cualquier
  registro.
- **Un hallazgo de cumplimiento real y ya cerrado**: investigar la licencia
  del estilizador del avatar (ADR-141/144) llevó a descubrir que el motor
  biométrico secundario que sí estaba en producción (InsightFace) tenía la
  misma restricción de licencia no comercial — corregido en ADR-166 antes de
  que fuera un problema contractual.
- **Un beacon de diagnóstico de incidentes de cliente** (ADR-154), que hoy
  da visibilidad de fallos reales de captura en cualquier pantalla
  biométrica, no solo en el flujo del avatar.

**Lectura para Gerencia**: el costo de este ciclo de trabajo no debe leerse
solo contra "una animación de bienvenida" — debe leerse contra un
endurecimiento real y verificado del sistema de biometría/seguridad que
protege cada login de la plataforma, más un pipeline de entrenamiento de
modelos propio y reutilizable, más un hallazgo de licenciamiento cerrado a
tiempo. El avatar es la parte visible; la mejora de la base biométrica es la
parte que sostiene el negocio.

## Alternativas descartadas

- **No lanzar ninguna versión del avatar en este release**: descartada —
  hubiera dejado sin motivo de negocio el mismo trabajo de endurecimiento de
  biometría descrito arriba, que se encontró y se corrigió precisamente
  depurando el flujo real de captura del avatar en vivo.
- **Lanzar la visión completa (soporte conversacional + tutorial + sistema
  de alarmas con contenido propio) en v1**: descartada — ninguna de esas
  piezas tiene código, contenido ni SPEC hoy; forzar el lanzamiento
  arriesgaría una primera impresión peor que un saludo simple y confiable.
- **Apagar los disparadores `report`/`alarm_loop` ya cableados por ADR-164
  hasta tener contenido propio**: descartada por costo/beneficio — ya están
  verificados, no cuestan mantenimiento adicional y no se anuncian como
  capacidad nueva; apagarlos no aporta nada y sí resta valor ya entregado.

## Consecuencias

- v1 comunica una sola promesa clara y ya verificada (saludo de bienvenida),
  sin sobre-prometer capacidades sin terminar.
- `report`/`alarm_loop` siguen activos como refuerzo silencioso, listos para
  recibir contenido propio el día que se apruebe esa hoja de ruta, sin
  trabajo de wiring adicional.
- Toda expansión futura (soporte conversacional, tutorial guiado, alarmas
  con contenido por severidad, Fases B/C de avatar animado) requiere su
  propio SPEC/ADR antes de construirse — no se autoriza por este documento.

## Referencias

- ADR-074 (`avatar-biometrico-local-hd-bajo-demanda`)
- ADR-141 (`avatar-estilizado-difusion-local-sd15-controlnet`)
- ADR-143 (`silentface-servicio-aislado-cudnn`)
- ADR-144 (`inspireface-evaluacion-licencia-academica`)
- ADR-147, 153 (guardrails de registro/login)
- ADR-150, 160 (avatar animado, evaluación y descarte de cuerpo completo)
- ADR-154 (beacon de diagnóstico de incidentes)
- ADR-155, 157, 158, 159 (calidad del avatar por difusión)
- ADR-161 (OTP de contacto)
- ADR-162 (tracking facial MediaPipe)
- ADR-163, 165 (curación de dataset y reentrenamiento del clasificador de lentes)
- ADR-164 (`avatar-busto-uniforme-logo-y-wiring-soporte` — disparadores
  `onboarding`/`report`/`alarm_loop`)
- ADR-166 (decomiso de InsightFace, adopción de SeetaFace6Open)
- ADR-025 (mismo patrón de "diferido, no descartado" aplicado antes a EPP)
- `frontend/src/components/UI/AvatarWidget.tsx` (`requestSupportAvatar`,
  `AvatarAnimationKind`)
- `frontend/src/components/Dashboard/AlarmCenter.tsx` (disparador `alarm_loop`)
- `frontend/src/components/ReportStudioV2/App.tsx` (disparador `report`)
