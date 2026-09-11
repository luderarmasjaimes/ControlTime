# ADR-170 — Evaluación de VPS/GPU pendiente: exportación de documentos extensos y funciones de IA concurrentes

**Status**: `proposed` — evaluación de capacidad e infraestructura pendiente; selección de proveedor y configuración sin definir

**Fecha**: 2026-09-11

**Ámbito**: plataforma, reports

**Relación**: motivado por evidencia real ya encontrada al construir la
exportación server-side (ADR-016, ADR-083/084, ADR-139); complementa las
mediciones de VRAM ya documentadas en ADR-150 (avatar animado) y la
capacidad de ingesta de ADR-108 (25k/s); es el último de los pendientes de
infraestructura identificados en esta ronda, junto al pentest externo
(ADR-169).

## Contexto

El dimensionamiento original de la plataforma (ADR-001, "todo on-prem, VPS
Lima") nunca fijó especificaciones concretas de CPU/RAM/GPU — se decidió la
soberanía del despliegue, no su capacidad. Desde entonces la plataforma
sumó varias funciones nuevas y reales que consumen recursos de forma mucho
más intensiva que el escenario original:

- **Exportación de documentos muy extensos** (Word/PPTX/PDF/video). Ya
  existe evidencia real, no proyectada, de que esto es un problema de
  capacidad y no solo de código: un export DOCX real de **2104 páginas /
  6300 diagramas** tardó, medido en vivo, **~101 minutos para llegar al
  69.5%** de avance — proyectando **~145 minutos** para completarse
  (`backend/src/config/app_config.hpp`, comentario junto a
  `gJwtExportTtlMinutes`). Esa misma corrida encontró y forzó a corregir dos
  bugs reales de infraestructura (sin ADR propio hasta ahora, documentados
  acá retroactivamente):
  1. El token de acceso del sidecar de export expiraba a los 120 minutos —
     insuficiente para un documento de esa escala; subido a **240 minutos**.
  2. `beast::tcp_stream::expires_after()` no aplica de forma confiable a las
     llamadas HTTP **síncronas** del backend hacia el sidecar de export: un
     job de 2104 páginas quedó marcado `"running"` en la base de datos
     **39+ minutos después** de que el sidecar ya había terminado y escrito
     el `.docx` en disco — el hilo del backend nunca se enteró. Corregido
     con `SO_RCVTIMEO`/`SO_SNDTIMEO` a nivel de socket POSIX
     (`backend/src/reports/report_export_jobs.cpp`), la única garantía real
     de que una llamada bloqueante retorna tras el plazo configurado.
- **Funciones de IA con GPU compitiendo por el mismo recurso**: avatar por
  difusión (SD1.5+ControlNet, ADR-141), avatar animado (SadTalker,
  ADR-150) y biometría local (DeepFace/Silent-Face/MediaPipe) corren hoy
  sobre una **GPU de laptop** (RTX 5060 Laptop, 8151 MiB totales) — no una
  GPU de servidor. ADR-150 ya midió el pico real: **7748/8151 MiB con
  `avatar_engine` activo, solo 403 MiB de margen**. Eso es antes de sumar
  tráfico real de login/registro biométrico concurrente sobre la misma GPU.
- **Techos de memoria configurados por servicio ya son considerables**,
  sin que se haya validado nunca contra la capacidad real del host de
  producción: `beemetry-llm` hasta 12288M, `beemetry-ai-vision` hasta
  10240M, `beemetry-pdf-export`/`beemetry-db`/`beemetry-api`/
  `beemetry-avatar-engine`/`beemetry-avatar-animation-engine` hasta
  6144-8192M cada uno (`docker-compose.yml`) — sumados, muy por encima de
  lo que una sola VPS mediana sostiene si todo corriera a la vez, y no hay
  evidencia de una prueba de carga real que combine ingesta de telemetría
  en vivo (25k/s, ADR-108) + un export extenso + tráfico biométrico
  concurrente sobre el mismo host.

## Decisión

**Se declara pendiente, no resuelta por este ADR**, la evaluación formal de
capacidad de VPS y GPU de producción. Este documento fija qué hay que
evaluar y con qué evidencia, no selecciona proveedor ni presupuesto — eso
es decisión de Gerencia.

### Qué queda por evaluar

1. **Dimensionamiento de CPU/RAM del VPS** contra el uso real combinado, no
   contra cada función por separado: ingesta de telemetría en tiempo real
   (25k/s sostenidos) + exportación de documentos extensos (90 min
   configurados para PDF/PPTX/DOCX, 3 min para video) + tráfico biométrico
   concurrente (login/registro) + las funciones de IA de texto/soporte
   (Ollama, hasta 12GB reservados). Falta una prueba de carga real con las
   cuatro cosas ocurriendo a la vez, no una detrás de otra.
2. **GPU dedicada de servidor vs. GPU de laptop**: hoy el margen medido es
   de 403 MiB sobre 8151 MiB totales, solo con avatar activo — sin
   contemplar aún login biométrico concurrente de varios usuarios reales
   sobre la misma GPU. Definir si producción necesita una GPU de mayor
   VRAM (16-24GB+, mismo piso que ya identificó ADR-160 para descartar
   video de cuerpo completo) o si se mantiene el perfil actual con
   exclusión mutua estricta entre funciones GPU-pesadas.
3. **Validar documentos extremos contra el pipeline real de exportación**:
   la corrida de 2104 páginas/6300 diagramas ya encontró y cerró dos bugs
   reales de timeout — falta repetir la prueba tras esos fixes para
   confirmar que un documento de esa escala completa de punta a punta sin
   degradar el resto de la plataforma mientras corre (¿la ingesta de
   telemetría sigue a 25k/s mientras un export de 145 minutos consume CPU/
   RAM del mismo host?).
4. **Selección de proveedor y configuración**: mantener el proveedor VPS
   actual con un tier superior, o evaluar alternativas — decisión de
   compra/presupuesto de Gerencia, no algo que este ADR resuelva.

## Consecuencias

### Positivas
- Dos bugs reales de timeout, encontrados por la prueba de 2104 páginas,
  ya están corregidos y verificados en código (aunque sin ADR propio hasta
  ahora) — quedan documentados retroactivamente en este mismo ADR.
- El pipeline de export ya soporta, a nivel de configuración de timeouts,
  documentos de esa escala (240 min de token, 90 min de export) — el
  trabajo pendiente es de capacidad de hardware, no de código adicional.

### Riesgos
- Sin esta evaluación, no hay garantía de que la VPS de producción pueda
  sostener un export extenso real **al mismo tiempo** que opera con
  clientes reales conectados — el escenario más parecido a producción que
  se probó hasta ahora fue un export aislado, no combinado con carga
  concurrente.
- La GPU de laptop actual es, por definición, un componente de desarrollo/
  evaluación, no de producción — cualquier estimación de capacidad de
  avatar/biometría basada en ella puede no representar el hardware real
  que atienda clientes.

## Alternativas descartadas

- **Asumir que la configuración actual alcanza sin medirla**: descartada —
  es exactamente el tipo de suposición que la prueba real de 2104 páginas
  ya demostró que era falsa dos veces (token TTL insuficiente, timeout de
  socket que no aplicaba); no hay motivo para asumir que el resto de la
  capacidad sí está bien dimensionada sin evidencia equivalente.
- **Resolver el dimensionamiento ahora, sin datos de carga combinada**:
  descartada — comprar o contratar una VPS/GPU más grande sin saber cuánto
  hace falta realmente sería gasto no informado; primero se necesita la
  prueba de carga combinada del punto 1.

## Referencias

- `backend/src/config/app_config.hpp` (`gJwtExportTtlMinutes`, comentario
  con la medición real de 2104 páginas)
- `backend/src/reports/report_export_jobs.cpp` (fix de
  `SO_RCVTIMEO`/`SO_SNDTIMEO`)
- `docker-compose.yml` (límites de memoria por servicio, comentario sobre
  la GPU RTX 5060 Laptop de 8151 MiB)
- ADR-001 (`despliegue-soberano-on-prem`) — decisión original, sin
  especificaciones de capacidad
- ADR-108 (`capacidad-telemetria-25k-topologia-escalamiento`)
- ADR-150 (`avatar-animado-reenactment-evaluacion`) — medición real de pico
  de VRAM
- ADR-160 (`avatar-cuerpo-completo-pose-driven-descartado-vram`) — piso de
  VRAM de referencia para funciones de video pesadas
- ADR-169 (`pentest-externo-seguridad-requisito-obligatorio-produccion`) —
  mismo patrón de pendiente de infraestructura sin proveedor ni fecha
