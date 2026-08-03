# PLAN NNN — <Nombre de la feature>

> **Plantilla de PLAN TÉCNICO.** Responde el CÓMO. Deriva del `spec.md` aprobado.
> Cada decisión irreversible se documenta como **ADR**.

| Campo | Valor |
|---|---|
| **Spec** | `specs/NNN-*/spec.md` (Aprobado) |
| **Autor** | (Arquitecto / Tech Lead) |
| **Revisado por** | (DBA + DevOps) |
| **Fecha** | |

## 1. Enfoque técnico
*Resumen de la solución y por qué, en 3-5 líneas.*

## 2. Arquitectura / componentes afectados
```
(diagrama o lista: gateway C++, TimescaleDB, Redpanda, réplica, S3, frontend…)
```

## 3. Modelo de datos
- Tablas / hypertables / agregados continuos nuevos o modificados.
- `tenant_id` y aislamiento (Art. 1).
- Índices y su justificación (cada índice cuesta en escritura).
- Retención / compresión / tiering (Art. 4, Art. 9).

## 4. Contratos / interfaces
- Endpoints (método, ruta, auth/RBAC, request/response).
- Protocolo de ingesta / formato de mensaje (si aplica).
- Métricas expuestas (Art. 5).

## 5. Concurrencia / performance
- Modelo de hilos, pooling, backpressure.
- Objetivos de §6 del spec y cómo se alcanzan.

## 6. Seguridad
- Roles, `statement_timeout`, separación lectura/escritura (Art. 3, Art. 6).

## 7. Decisiones de arquitectura (ADR)
| ADR | Decisión | Estado |
|---|---|---|
| ADR-NNN-1 | … | Propuesto / Aceptado |

## 8. Plan de pruebas (cómo se verifica cada CA)
| Criterio (spec) | Cómo se prueba | Evidencia esperada |
|---|---|---|
| CA-1 | | |
| CA-2 | | |

## 9. Plan de despliegue / rollback
- Cambios en `docker-compose.yml`, migraciones SQL, variables de entorno.
- Cómo se revierte si falla.

## 10. Costo / recursos
- Límites CPU/mem de los contenedores afectados (Art. 9).
- Estimación de almacenamiento (bytes/fila × volumen).
