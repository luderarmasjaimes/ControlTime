# Prueba de capacidad de telemetría — criterio previo a afirmar 100k/s

Fecha de ejecución: 2026-08-11 (America/Lima)  
Entorno: Docker Desktop/WSL2 sobre Windows, 20 CPU lógicas visibles, 15.46 GiB asignados a Docker.

## Veredicto

**NO APROBADO para afirmar 100.000 eventos/s en tiempo real.**

El pipeline completo TLS gateway → Redpanda/Kafka → consumidor C++ → COPY binario → TimescaleDB conserva los eventos en operación normal hasta el escalón probado de 25k/s, pero a 25k/s ya incumple tiempo real (p95 de ACK de 4.35 s, p99 de 4.77 s y tasa efectiva de 24.26k/s). Además, la prueba de caída de TimescaleDB produjo pérdida confirmada de 230 eventos aunque Kafka terminó con lag cero.

Por el criterio de corte seguro, no se ejecutaron 50k/s, 75k/s ni 100k/s: el SLO ya estaba incumplido en 25k/s y continuar habría aumentado el riesgo de congelar Docker Desktop sin aportar una aprobación posible.

## Configuración observada

- 100.000 sensores temporales aislados; caché del backend: 110.202 sensores durante la campaña.
- Redpanda: un broker, seis particiones, factor de réplica 1.
- Consumidor: un único miembro para las seis particiones.
- COPY: lotes de 1.000 filas y commit síncrono de offsets después de COPY exitoso.
- Servicios no esenciales detenidos durante la medición (Ollama, IA, PDF, LanguageTool, frontend, réplica y auxiliares).

## Resultados por escalón

| Escalón | Duración | Conexiones TLS | Enviados/ACK OK | Tasa efectiva | ACK p95 | ACK p99 | Persistencia/Kafka |
|---|---:|---:|---:|---:|---:|---:|---|
| 1k/s | 10 s | 100 | 10.000/10.000 | 999,4/s | 8,81 ms | 10,69 ms | 10.000 filas; lag 0 |
| 10k/s | 10 s | 1.000 | 100.000/100.000 | 9.993,5/s | 19,10 ms | 39,10 ms | 100.000 recibidos/producidos/consumidos/insertados; 0 errores; lag 0 |
| 25k/s | 10 s | 2.500 | 250.000/250.000 | 24.264,9/s | 4.354,78 ms | 4.772,77 ms | 250.000 persistidos; 0 errores; lag 0 |

En 25k/s el backend alcanzó aproximadamente 5,16 CPU y TimescaleDB cerca de 1 CPU. El problema visible no fue falta de ACK ni pérdida normal, sino acumulación de latencia/backpressure en el gateway/backend.

## Prueba de caída y recuperación

Procedimiento:

1. Se detuvo TimescaleDB.
2. Se enviaron 5.000 eventos a 1k/s; el gateway devolvió 5.000 ACK OK.
3. Se inició TimescaleDB y se envió un lote posterior de 2.000 eventos.
4. Se esperó hasta que el grupo `telemetry-writers` mostró lag total 0.
5. Se compararon métricas del backend y filas persistidas.

Resultado:

- Recibidos/producidos/consumidos: 7.000.
- Insertados: 6.770.
- Errores de flush: 10.
- Pérdida: **230 eventos (3,29%)**.
- Lag final de Kafka: 0.

Causa observada en el código: cuando COPY falla, el lote se descarta de la memoria sin confirmar su offset; el consumidor continúa procesando y un commit posterior puede confirmar offsets posteriores, saltando el lote fallido. Por eso `lag=0` no demuestra durabilidad ni ausencia de pérdidas.

## Hallazgos operativos de Docker/disco

- El mantenimiento por borrado fila a fila sobre el hypertable llegó a bloquear el API de Docker Desktop con respuestas HTTP 500, reproduciendo el problema de congelamiento reportado.
- Una cascada desde 100.000 sensores intentó revisar/descomprimir 21.476.410 filas históricas y superó `timescaledb.max_tuples_decompressed_per_dml_transaction`.
- Dos tablas auxiliares de chunks quedaron vacías pero infladas a 3.197 MB y 1.842 MB después de transacciones abortadas.
- `VACUUM FULL` aplicado exclusivamente a esas dos tablas vacías las redujo a 24 kB cada una; la base volvió de 5.618 MB a 580 MB.
- La campaña temporal se eliminó mediante `drop_chunks` sólo después de comprobar que el chunk contenía exclusivamente el tenant de benchmark.
- Validación final: 0 tenant temporal, 0 sensores temporales, 0 filas temporales; los 21.476.410 registros históricos permanecen.

## Correcciones obligatorias antes de repetir 100k/s

1. Corregir el consumidor para reintentar o pausar particiones ante fallo de COPY; nunca avanzar y confirmar offsets posteriores a un lote fallido.
2. Ejecutar varios consumidores/instancias reales con asignación de particiones; hoy hay un solo miembro y un solo hilo COPY.
3. Separar gateway/API, consumidores de telemetría y workers en procesos/servicios reales; `APP_ROLE` no está implementado en el binario actual.
4. Usar al menos tres brokers Redpanda de producción y factor de réplica adecuado; el broker único con réplica 1 no proporciona HA.
5. Redimensionar retención: 2 GB para 100k/s representa sólo minutos de buffer.
6. Rediseñar chunks/índices/retención para 8.640 millones de eventos por día y mover Timescale/Redpanda a NVMe separados.
7. Añadir idempotencia o clave de evento para detectar y resolver duplicados durante reintentos.
8. Repetir escalones 25k → 50k → 75k → 100k sólo después de las correcciones y luego ejecutar soak tests de 1 hora y 24 horas.

## Reproducción del generador

Generador: `scripts/telemetry_tls_load.js`.

Ejemplo PowerShell:

```powershell
$env:RATE='10000'
$env:DURATION_SEC='10'
$env:CONNECTIONS='1000'
$env:SENSOR_COUNT='100000'
node scripts/telemetry_tls_load.js
```

El ACK mide aceptación del gateway/productor, no persistencia durable. Toda campaña debe comparar además `received`, `produced`, `consumed`, `inserted`, errores de flush/produce, lag Kafka y conteo SQL aislado.
