# PLAN 015 — DR, respaldo geográfico y continuidad (revisión profunda)

| Campo | Valor |
|---|---|
| **Spec** | `specs/015-dr-respaldo-continuidad/spec.md` (Aprobado) |
| **Autor** | Arquitectura TI |
| **Revisado por** | BE3 (DBA/recovery), SYS (infra/DRP), ARQ (gate R5) |
| **Sprint·Release** | S10 · R5 |
| **Constitución** | Art. 2 (0% pérdida), Art. 9 (recursos acotados), Art. 5 (observabilidad) |
| **Última revisión** | 2026-06-24 (plan revisado — arquitectura DR confirmada; consistente con specs 001/003/004) |

---

## 1. Enfoque técnico

Estrategia DR **multicapa, defensa en profundidad**, reutilizando lo ya
construido (réplica streaming, Kafka durable, MinIO):

1. **Continuidad caliente** — `db_replica` (streaming, slot `replica_slot`) como
   *standby* promovible → recuperación en minutos sin restaurar backup.
2. **PITR (Point-in-Time Recovery)** — *base backups* + **WAL archiving** a MinIO
   → reconstrucción a cualquier instante (defensa ante corrupción lógica, no solo
   ante caída de hardware).
3. **Buffer de ingesta** — Redpanda retiene la telemetría durante el corte; al
   recuperar, el consumidor hace *replay* → **RPO ≈ 0** para telemetría.
4. **Respaldo geográfico** — copia de backups + objetos a una segunda ubicación.

> Objetivos contractuales (spec): **RTO < 15 min**, **RPO ≈ 0**, uptime > 99.9%.
> Filosofía: *la réplica resuelve la mayoría de incidentes en minutos; el PITR es
> la red de seguridad ante corrupción o pérdida total.*

## 2. Topología de respaldo

```
                ┌──────────────────────── SITIO PRIMARIO (Lima VPS) ──────────────────────┐
 Sensores ─► Redpanda(durable) ─► Backend ─► PostgreSQL PRIMARIO ──streaming──► db_replica │
                                                  │  WAL archiving (continuo)       (standby)│
                                                  ▼                                          │
                                            MinIO (base backups + WAL + objetos)             │
                └───────────────────────────────────┬──────────────────────────────────────┘
                                                     │  replicación de backups (cron/rclone)
                                                     ▼
                ┌──────────────── SITIO SECUNDARIO (geográfico) ───────────────┐
                │  MinIO espejo (base backups + WAL + objetos)  → restauración  │
                └───────────────────────────────────────────────────────────────┘
```

## 3. Componentes y mecanismos

### 3.1 Base backups + WAL archiving (PITR)
- `archive_command` del primario → sube cada segmento WAL a `s3://db-backups/wal/`.
- Base backup periódico (`pg_basebackup`/`pgBackRest`) → `s3://db-backups/base/`.
- Permite restaurar a **cualquier timestamp** (`recovery_target_time`).
- **Recomendación:** usar **pgBackRest** (backups incrementales, verificación,
  retención y restore probado) en vez de scripting manual. → ADR-015-1.

### 3.2 Standby promovible (continuidad caliente)
- `db_replica` ya existe (spec 004). Para DR se le añade rol de **failover target**:
  promoción con `pg_promote()` / `pg_ctl promote`.
- **Fencing / anti split-brain:** antes de promover, **aislar** el primario
  (parar contenedor / revocar VIP) para que no haya dos primarios escribiendo.

### 3.3 Buffer Redpanda (RPO ≈ 0 telemetría)
- Durante el corte, los sensores siguen produciendo a Redpanda (durable).
- Tras promover la réplica, el consumidor reanuda desde el último offset commit →
  **replay** de lo no persistido. La telemetría no se pierde (ya probado en 001).

### 3.4 Respaldo de objetos (MinIO)
- Versionado de bucket activado; replicación a sitio secundario (rclone/mc mirror).
- Incluye `telemetry-cold` (003), `db-backups`, evidencias.

### 3.5 Respaldo geográfico
- Sincronización programada de `db-backups` y objetos a una **segunda ubicación**
  (otro datacenter / proveedor). Cifrado en tránsito y reposo.

## 4. Runbook de DR (paso a paso — debe poder ejecutarlo SYS/BE3 sin el autor)

### Escenario A — Caída del primario (hardware/proceso), réplica sana
```
1. CONFIRMAR caída real del primario (no falso positivo de red).      [≤ 2 min]
2. FENCING: detener/aislar el primario (docker stop db; revocar acceso).
3. PROMOVER réplica:  docker exec db_replica pg_ctl promote
   (o touch del trigger / pg_promote()).                              [≤ 1 min]
4. REENRUTAR la app: apuntar DATABASE_URL/pgbouncer al ex-réplica.    [≤ 2 min]
5. VERIFICAR escritura + replay de Redpanda (offsets avanzan).        [≤ 3 min]
6. LEVANTAR nueva réplica desde el nuevo primario (basebackup).       [async]
7. COMUNICAR y registrar el incidente.
   → RTO objetivo: < 15 min. RPO: ≈ 0 (streaming + Kafka).
```

### Escenario B — Corrupción lógica / pérdida total (sin réplica usable)
```
1. Provisionar instancia limpia.
2. Restaurar último base backup desde MinIO.
3. Aplicar WAL hasta recovery_target_time (justo antes del daño).     [PITR]
4. Reconectar; replay de Redpanda para telemetría posterior al target.
5. Validar integridad (conteos, checks) antes de abrir a usuarios.
```

## 5. Métricas y alertas (Art. 5)
- **Lag de replicación** (`pg_stat_replication`) → alerta si > umbral.
- **Éxito/edad del último backup** y del **último WAL archivado** → alerta si falla
  o envejece.
- **Estado del slot** `replica_slot` (no inactivo, WAL no acumulándose sin límite).
- Exponer en `/api/metrics` + panel Grafana (SOW: Prometheus/Grafana, rol SYS).

## 6. Decisiones de arquitectura (ADR)
| ADR | Decisión | Estado |
|---|---|---|
| ADR-015-1 | **pgBackRest** para base backups + PITR (vs scripting manual) | Propuesto |
| ADR-015-2 | Failover **asistido por runbook** (no automático) en esta versión | Propuesto |
| ADR-015-3 | **Fencing obligatorio** del primario antes de promover (anti split-brain) | Propuesto |
| ADR-015-4 | Redpanda como fuente de RPO≈0 para telemetría (replay) | Aceptado (heredado de 001) |
| ADR-015-5 | Backups + WAL en MinIO con replicación geográfica cifrada | Propuesto |

## 7. Plan de pruebas (cada CA con evidencia)
| CA | Escenario | Evidencia |
|---|---|---|
| CA-1 | Restaurar un base backup en entorno limpio | restore exitoso + conteos OK |
| CA-2 | **Simulacro DR**: matar primario → promover réplica → reenrutar | cronómetro **< 15 min** (RTO) |
| CA-3 | Medir pérdida en el simulacro | filas faltantes ≈ 0 (RPO); replay Kafka cubre el gap |
| CA-4 | Otro operador (no el autor) ejecuta el runbook | completa sin ayuda externa |
| CA-5 | Verificar copia en sitio secundario | backups presentes y restaurables allí |
| CA-6 | Forzar fallo de backup / lag alto | alerta se dispara |
| Edge | Promover sin fencing (prueba negativa controlada) | se detecta riesgo de split-brain → procedimiento lo impide |
| Edge | WAL faltante en PITR | restore se detiene en gap; se documenta límite de recuperación |

## 8. Despliegue / configuración
- Primario: `archive_mode=on`, `archive_command` → MinIO; `wal_level=replica` (ya).
- pgBackRest configurado (stanza, retención, cifrado).
- Cron de replicación geográfica; cron de simulacro de restore (verificación).
- Runbook versionado en `docs/09_Manuales_Operativos/`.

## 9. Costo / recursos (Art. 9)
- Almacenamiento de backups (base + WAL) acotado por **retención** (p. ej. 14 días
  PITR + mensuales a largo plazo).
- El simulacro DR se hace en ventana controlada (no afecta producción).
- Segundo sitio: costo de almacenamiento espejo (no cómputo permanente).

## 10. Dependencias y riesgos
| Riesgo (SOW §13.2) | Mitigación |
|---|---|
| Simulacro DR falla (S10) | ensayo previo, buffer S11, segundo intento, runbooks |
| Split-brain (dos primarios) | fencing obligatorio (ADR-015-3) |
| Backup corrupto | restore de verificación periódico automatizado |
| WAL crece sin archivar (disco) | monitoreo de archivado + alerta (Art. 9) |

**Depende de:** 004 (réplica), 001 (Redpanda/replay), 003 (MinIO).
