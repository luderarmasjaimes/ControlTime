# Manual Operativo — Ingesta de Telemetría Durable (Spec 001)

| Campo | Valor |
|---|---|
| **Componente** | `mining_gateway` + `TelemetryIngestor` + Redpanda |
| **Sprint·Release** | S2-S3 · R1 |
| **Última revisión** | 2026-06-24 (Luder Armas / BE1) |
| **Destinatario** | Equipo OPS / BE3 |

---

## 1. Arquitectura de ingesta

```
Sensores TLS 8443
      │
      ▼
mining_gateway (C++ TLS)
      │ parsea línea CSV "tenant_id,sensor_id,valor,ts"
      │
      ├─[TELEMETRY_MODE=kafka]──► Redpanda ──► consumer C++ ──► COPY PostgreSQL
      │
      └─[TELEMETRY_MODE=direct]─────────────────────────────► INSERT PostgreSQL
```

El modo **kafka** (default en producción) desacopla la recepción de la escritura:
si la BD está temporalmente lenta, los datos se acumulan en Redpanda (retención 24 h).
El modo **direct** se usa en desarrollo o como fallback de emergencia.

---

## 2. Arranque nominal

```bash
# 1. Levantar todo el stack
docker compose up -d redpanda db db_replica backend

# 2. Esperar healthchecks (~30 s)
docker compose ps

# 3. Verificar que la ingesta está viva
curl http://localhost:8080/api/metrics | grep telemetry_received
```

Condiciones de éxito en `/api/metrics`:
- `telemetry_received > 0` — el gateway está recibiendo líneas
- `telemetry_dropped_full = 0` — la cola interna no está llena
- `kafka_produce_ok > 0` (si modo kafka) — Redpanda acepta mensajes
- `telemetry_flushed > 0` — COPY batch llegó a la BD

---

## 3. Parámetros configurables

| Variable de entorno | Default | Descripción |
|---|---|---|
| `TELEMETRY_MODE` | `kafka` | Modo de ingesta: `kafka` o `direct` |
| `TELEMETRY_BATCH_SIZE` | `1000` | Filas por COPY batch |
| `TELEMETRY_FLUSH_MS` | `200` | Intervalo máximo de flush (ms) |
| `TELEMETRY_MAX_QUEUE` | `200000` | Tamaño máximo de la cola interna |
| `KAFKA_BROKERS` | `redpanda:9092` | Broker(s) Redpanda (CSV) |
| `KAFKA_TOPIC` | `telemetry` | Tópico de ingesta |
| `GATEWAY_TLS_PORT` | `8443` | Puerto TLS del gateway |
| `GATEWAY_IDLE_TIMEOUT_S` | `30` | Timeout idle de conexión de sensor |
| `GATEWAY_MAX_LINE_SIZE` | `1024` | Tamaño máximo de línea en bytes |

Todos los parámetros se leen en arranque; **reiniciar el backend** para que tomen efecto.

---

## 4. Rollback a modo Direct

Si Redpanda falla o no está disponible:

```bash
# 1. Editar .env (o docker-compose.yml):
TELEMETRY_MODE=direct

# 2. Reiniciar solo el backend (sin perder BD):
docker compose restart backend

# 3. Verificar:
curl http://localhost:8080/api/metrics | grep telemetry_mode
# Debe mostrar: telemetry_mode{mode="direct"} 1
```

En modo direct, cada línea se inserta individualmente (mayor latencia, mayor carga en BD).
Adecuado como medida de emergencia; retornar a modo kafka en cuanto Redpanda esté sano.

---

## 5. Señales de alarma y acciones correctivas

| Métrica | Umbral de alarma | Causa probable | Acción |
|---|---|---|---|
| `telemetry_dropped_full` | > 0 | Cola interna saturada | Aumentar `TELEMETRY_MAX_QUEUE` o reducir carga de sensores |
| `telemetry_flush_errors` | > 0 | Conexión a BD caída | Verificar `docker compose ps db`; revisar logs `backend` |
| `kafka_produce_errors` | > 0 | Redpanda no disponible | `docker compose restart redpanda`; si persiste, switch a direct |
| `telemetry_received` = 0 por > 60 s | — | Gateway no recibe datos | Verificar conectividad TLS sensores → `8443` |
| `cpu_backend` > 80% | — | Carga extrema | Verificar `max_connections` Redpanda; revisar tamaño de batch |

Ver métricas en tiempo real:
```bash
watch -n 5 "curl -s http://localhost:8080/api/metrics | grep telemetry"
```

---

## 6. Gateway TLS — operación

El gateway minero escucha en `TLS 8443`. Los certificados se montan en:
```
/etc/mining-gateway/certs/
  ├── server.crt
  └── server.key
```

Para rotar certificados sin downtime:
```bash
# 1. Copiar nuevos certs al contenedor o bind-mount
# 2. Reiniciar el gateway:
docker compose restart backend
```

Para depurar recepción de líneas:
```bash
docker logs -f backend 2>&1 | grep "\[gateway\]"
```

---

## 7. Durabilidad ante caída del backend

**Escenario:** el backend se reinicia mientras los sensores envían datos.

- Redpanda retiene los mensajes no consumidos (retención configurada: `24h`).
- Al reiniciar, el consumer retoma desde el último `offset` comprometido.
- Los sensores reintentarán la conexión TLS automáticamente (retry configurable en el firmware).
- **No se pierden datos** siempre que el reinicio sea < 24 h y Redpanda esté sano.

```bash
# Verificar que Redpanda retiene mensajes durante el downtime:
docker exec -it redpanda rpk topic describe telemetry
```

---

## 8. Prueba de durabilidad (kill → replay)

```bash
# 1. Verificar baseline:
curl http://localhost:8080/api/metrics | grep telemetry_received
# Nota el valor N1

# 2. Matar el backend:
docker compose stop backend

# 3. Esperar 60 s (sensores siguen enviando, Redpanda acumula)

# 4. Reiniciar:
docker compose start backend

# 5. Esperar ~10 s y verificar:
curl http://localhost:8080/api/metrics | grep telemetry_received
# Debe mostrar N1 + filas acumuladas durante el downtime
```

---

## 9. Monitoreo integrado

El endpoint `/api/metrics` expone contadores en formato Prometheus:

```
# HELP telemetry_received_total Total de líneas recibidas por el gateway
telemetry_received_total 1842304
# HELP telemetry_flushed_total Total de filas escritas en BD (COPY batch)
telemetry_flushed_total 1841900
# HELP telemetry_dropped_full_total Líneas descartadas por cola llena
telemetry_dropped_full_total 0
# HELP kafka_produce_ok_total Mensajes enviados a Redpanda correctamente
kafka_produce_ok_total 1842300
# HELP kafka_produce_errors_total Errores de producción a Redpanda
kafka_produce_errors_total 0
```

Para integrar con Prometheus + Grafana:
```yaml
scrape_configs:
  - job_name: aurixa-backend
    static_configs:
      - targets: ['backend:8080']
    metrics_path: /api/metrics
    scrape_interval: 15s
```

---

## 10. Contacto y escalamiento

| Nivel | Contacto | Cuando |
|---|---|---|
| L1 (reinicio) | OPS de guardia | `dropped_full > 0`, flush_errors transitorios |
| L2 (config) | BE3 / DBA | Cambio de `BATCH_SIZE`, rotación certs, rollback modo |
| L3 (código) | BE1 | Fallo persistente, bugs en ingesta, cambio de arquitectura |
