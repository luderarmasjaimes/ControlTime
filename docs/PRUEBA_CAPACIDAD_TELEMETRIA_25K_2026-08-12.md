# Prueba de capacidad de telemetría — 25.000 sensores/s

Fecha: 2026-08-12. Entorno: Docker Desktop local, gateway TLS C++, Redpanda,
TimescaleDB 15 y PgBouncer. SPEC: `SPEC-020`.

## Resultado ejecutivo

La plataforma sostuvo 25.000 sensores enviando una lectura por segundo durante
60 segundos, con persistencia completa y latencia p99 inferior a 1 segundo al
usar gateways agregadores. También recuperó una caída de TimescaleDB sin pérdida
ni reinicio, y deduplicó una reentrega explícita de 5.000 offsets.

| Prueba | Resultado |
|---|---:|
| 10k/s, 10 s, 1.000 conexiones | 100.000/100.000, p99 29,0 ms |
| 25k/s, 10 s, 2.500 conexiones | 250.000/250.000, p99 4.783 ms |
| 25k/s, 15 s, 250 conexiones | 375.000/375.000, p99 56,3 ms |
| 25k/s, 60 s, 250 conexiones, COPY directo | 1.500.000/1.500.000, p99 61,9 ms |
| 25k/s, 60 s, binario final idempotente | 1.500.000/1.500.000, 24.960,2/s, p99 149,8 ms, máx. 226,2 ms |
| Caída DB, 5.000 eventos | 5.000 recuperados, lag final 0, reinicios 0 |
| Replay de offsets | 5.000 consumidos, 0 insertados, 5.000 deduplicados |

La prueba con 2.500 conexiones demuestra que el fan-out TLS/ACK por sensor no
es una topología recomendable: conserva todos los datos, pero el generador Node
de un solo hilo y las respuestas individuales acumulan segundos. Con 250
gateways/concentradores (100 sensores por conexión), el mismo volumen cumple el
SLA con amplio margen.

## Recursos observados durante 25k/s

- API: pico final aproximado 254% CPU y 105 MiB RAM.
- TimescaleDB: pico final aproximado 313% CPU y 598 MiB RAM.
- Redpanda: pico aproximado 61% CPU y 503 MiB RAM.
- Tres consumidores estables sobre seis particiones; lag final cero.
- Redpanda limitado a 2 GiB de memoria interna / 3 GiB de contenedor.

## Correcciones verificadas

- Tres consumidores Kafka con tres conexiones PostgreSQL independientes.
- Lote retenido y reintentado con backoff cuando COPY falla; offset confirmado
  sólo después de la transacción durable.
- Staging temporal + índice único `(captured_at, kafka_partition, kafka_offset)`
  para hacer idempotente el replay entre persistencia y commit.
- Productor idempotente, `acks=all`, compresión LZ4, backpressure real y un hilo
  dedicado para delivery reports.
- Gateway procesa varias líneas ya bufferizadas y agrupa las respuestas.
- Topic de seis particiones y retención local acotada a dos horas / 9 GiB total.
- Chunk futuro de TimescaleDB reducido de seis horas a una hora.
- Capa Docker separada para vcpkg/OpenCV: cambios C++ ya no reinstalan esas
  dependencias pesadas.

## Limpieza y seguridad de datos

El tenant de benchmark fue aislado. En la primera campaña se limpiaron
2.485.002 filas temporales preservando 30 filas reales. La validación final del
binario idempotente añadió 1.500.000 filas: su chunk compartía 660 filas reales
de 22 tenants, que se preservaron y restauraron exactamente. Estado final del
benchmark: 0 filas, 0 sensores y 0 tenants; no se eliminó el histórico.

Para iniciar únicamente el núcleo de telemetría y detener auxiliares que
compiten por recursos se añadió `scripts/start-telemetry-core.ps1`.

## Comandos reproducibles

```powershell
$env:CONNECTIONS='250'
$env:RATE='25000'
$env:DURATION_SEC='60'
$env:SENSOR_COUNT='25000'
$env:SENSOR_PREFIX='BENCH25K-'
node scripts/telemetry_tls_load.js
```

La aceptación exige comparar `/api/metrics`, conteo SQL por tenant y `rpk group
describe telemetry-writers`; un ACK aislado no demuestra persistencia.
