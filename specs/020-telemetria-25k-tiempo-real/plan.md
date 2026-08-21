# PLAN 020 — Telemetría 25k/s

1. Corregir el ciclo del consumidor para no limpiar un batch fallido.
2. Reintentar COPY con backoff y confirmar offsets sólo después de persistir.
3. Separar N consumidores y N conexiones PostgreSQL dentro del proceso.
4. Habilitar idempotencia/acks=all y delivery reports del productor.
5. Devolver `ERR` ante backpressure real del productor.
6. Procesar varias líneas ya bufferizadas por sesión TLS y agrupar respuestas.
7. Ajustar lote, flush, workers, Redpanda y chunks para 25k/s.
8. Compilar, probar operación normal y repetir caída/recuperación.

## Presupuesto inicial

- Gateway I/O: 8 hilos.
- Consumidores Kafka: 3 para 6 particiones.
- COPY: 5.000 filas o 100 ms.
- Redpanda local: 2 cores / 2 GiB; retención 8 GiB / 2 h.
- Timescale: chunk de 1 hora para nuevos datos.
