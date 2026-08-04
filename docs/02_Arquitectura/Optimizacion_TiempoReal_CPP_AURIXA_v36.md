# OPTIMIZACIÓN A BAJO NIVEL (C++) PARA TIEMPO REAL — AURIXA

## Maximizar C++/librerías nativas para minimizar tiempos de respuesta

**Versión:** v36 — basada en el código real (`backend/`, `ai_engine/`, `formula_engine/`)
**Fecha:** 19 de junio de 2026
**Objetivo:** Soportar miles de sensores en tiempo real con latencia mínima (O1 <20 ms, O6 <1 s) llevando los caminos calientes al nivel más bajo posible.

---

## 1. Principio

Lo que está en la **ruta caliente** (ingesta de telemetría, login biométrico, render de dashboards, exportación) debe ejecutarse en **C++/nativo** con librerías de alto rendimiento. Lo que es **batch o no crítico** (entrenamiento ML, corrección de texto premium) puede quedar en servicios separados (Python/Java) sin afectar la latencia.

El backend **ya es C++** (Boost.Asio/Beast, OpenCV, libpq, ONNX Runtime, pool de 15k WebSockets). La optimización **completa** ese diseño cerrando los puntos donde aún hay interpretación o serialización costosa.

---

## 2. Análisis por hot path

### 2.1 Ingesta de telemetría (el más crítico para 10k sensores)
- **Hoy:** los sensores llegan al gateway TLS C++; persistencia directa a Postgres.
- **Optimización:**
  - **librdkafka (C++)** como productor/consumidor de Redpanda en `aurixa-telemetry` — máxima tasa, batching, back-pressure.
  - **Inserción masiva** con `COPY` binario / `libpq` en modo binario y **prepared statements** (evita parseo SQL repetido).
  - **Formato de cable binario** (FlatBuffers o Cap'n Proto) en vez de JSON de texto; si se mantiene JSON, **simdjson** (parseo SIMD, GB/s).
  - **Lotes por chunk de tiempo** alineados al chunk de TimescaleDB (7d).

### 2.2 Login biométrico / visión (latencia en ruta caliente)
- **Hoy:** el backend C++ delega parte del análisis a `ai_engine` (**Python/Flask**, MediaPipe/InsightFace) vía HTTP — añade salto de red + overhead de intérprete en el login.
- **Optimización:**
  - Llevar **gafas / EAR / liveness** a **C++ + ONNX Runtime C++** (ya usado para el avatar cartoon) — elimina el salto a Python en la verificación.
  - **OpenCV con SIMD** (ya enlazado) y, donde haya GPU, **CUDA/cuDNN** o **ONNX Runtime GPU**.
  - Mantener InsightFace en `aurixa-ai-vision` solo para enrolamiento (no en cada login), con cache de embeddings.

### 2.3 Acceso a datos
- **pgbouncer** (pool de conexiones) delante de Postgres — evita coste de conexión por request bajo alta concurrencia.
- **Prepared statements** + **protocolo binario** en todas las consultas calientes (sensores, KPIs).
- **Continuous aggregates** de TimescaleDB para KPIs/dashboards **sub-segundo** (ver `Modelo_Datos_AURIXA_v36`).
- **Compresión nativa** de TimescaleDB para reducir I/O de históricos.

### 2.4 Analítica en memoria / feature serving
- **Apache Arrow C++ / DuckDB** para análisis columnar en memoria (ventanas, agregaciones) sin salir a Python.
- **Cache LRU in-proc (C++)** para catálogos y resultados frecuentes; **Redis** si se requiere cache distribuida entre réplicas.

### 2.5 Render y exportación
- El render del motor FORMULA ya es **OpenCV C++ con cache 2 s** — correcto.
- Exportación PDF/DOCX/PPTX: mantener como **job asíncrono** (no bloquear la API); worker dedicado.

### 2.6 Runtime / sistema
- **jemalloc / tcmalloc** como allocator (menos fragmentación, mejor multihilo).
- **io_uring** (Linux) para I/O asíncrono de muy baja latencia; Boost.Asio puede apoyarse en él.
- Mantener el **pool de 15k WebSockets** de Boost.Beast (ya óptimo) para streaming en vivo.
- Compilar con `-O3 -march=native`, LTO, y `-flto`.

---

## 3. Matriz de optimización

| Componente | Nivel actual | Acción | Librería / SDK | Ganancia esperada | Rol · Sprint |
|---|---|---|---|---|---|
| Ingesta sensores | C++ directo a PG | Bus + bulk binario | **librdkafka**, libpq COPY | Throughput 10k/s, back-pressure | BE1 · S9-S12 |
| Wire format | JSON texto | Binario / SIMD | **FlatBuffers** / **simdjson** | -50-80% CPU parseo | BE1 · S9 |
| Login biométrico | Python (ai_engine) | C++ inferencia | **ONNX Runtime C++**, OpenCV SIMD | -1 salto red, latencia <50 ms | BE2 · S11 |
| Conexiones DB | conexión por req | Pool | **pgbouncer** | -overhead conexión | SYS · S9 |
| Consultas calientes | SQL texto | Prepared + binario | libpq | -latencia consulta | BE1 · S10 |
| KPIs / dashboards | sobre crudo | Pre-agregado | **TimescaleDB continuous aggregates** | Respuesta sub-segundo | BE3 · S10 |
| Históricos | sin compresión | Compresión nativa | **TimescaleDB compress** | -90% almacenamiento, -I/O | BE3 · S9 |
| Analítica memoria | (Python) | Columnar C++ | **Arrow C++ / DuckDB** | Cálculo in-proc rápido | IA · S11 |
| Cache | — | LRU / distribuida | in-proc C++ / **Redis** | -lecturas repetidas | BE1 · S10 |
| Allocator / async | glibc malloc | tcmalloc + io_uring | **jemalloc/tcmalloc**, **io_uring** | -latencia colas, +throughput | SYS · S11 |

---

## 4. Qué NO bajar a C++ (decisión consciente)

| Componente | Se mantiene | Razón |
|---|---|---|
| `ml_engine` (entrenamiento) | Python (FastAPI) | Ecosistema ML (pandas/torch/sklearn); es **batch**, no ruta caliente |
| LanguageTool | Java (servicio) | Corrección premium, no crítica en tiempo; aislada |
| Ollama (LLM) | servicio | Redacción asistida, asíncrona |
| mbtileserver | Go | Sirve tiles eficientemente; estable |

> La **inferencia** ML de baja latencia sí puede exportarse a ONNX y servirse en C++ si un caso lo exige (p. ej. anomalías en tiempo real), manteniendo el entrenamiento en Python.

---

## 5. Conclusión

AURIXA ya nace con una base C++ de alto rendimiento. La optimización a tiempo real se logra **cerrando los puntos calientes**: bus de ingesta y bulk binario (librdkafka + COPY), biometría de login en C++/ONNX, pre-agregados y compresión en TimescaleDB, y afinamiento de runtime (pool, allocator, io_uring). El entrenamiento ML y la corrección de texto permanecen en sus servicios, fuera de la ruta crítica. Resultado: latencia mínima y capacidad para **miles de sensores operando en simultáneo** — el mejor sistema minero con IA de LATAM.
