# PLAN 027 — Cierre de integración de sensores (directo + gateway)

| Campo | Valor |
|---|---|
| **Spec** | `specs/027-integracion-sensores-directo-gateway/spec.md` (Aprobado) |
| **Autor** | Investigación 2026-09-16 |
| **Revisado por** | Developer (Luder Armas) |
| **Fecha** | 2026-09-16 |

## 1. Enfoque técnico

No se construye una plataforma nueva: el core IoT (ADR-034) y el motor de
fórmulas (ADR-187/188/189) ya existen y funcionan (verificado end-to-end con
`PZ-VW-02`). El trabajo es de **cierre de brechas** en tres frentes
independientes que pueden avanzar en paralelo:

1. **Trazabilidad y catálogo** (bajo riesgo, sin tocar producción real —
   solo lectura + wiring de frontend ya construido).
2. **Verificación de fórmulas** (requiere datos reales de sensores de campo
   o, en su defecto, datasets de referencia del ThingsBoard legado para
   comparar salida vieja vs. nueva).
3. **Metadatos de conexión directo/gateway** (cambio de esquema mínimo,
   aditivo, sin afectar el flujo de ingesta existente).

Cada fase que toque el modelo de datos productivo pasa primero por
`db_scripts/` numerado + verificación en el ambiente de desarrollo antes de
tocar producción, siguiendo la disciplina ya establecida (ver memoria de
proyecto: "db_scripts 30+ requieren aplicación manual vía psql").

## 2. Arquitectura / componentes afectados

```
Frontend: SensorManagementView.tsx (catálogo real), nueva vista/tab de
          trazabilidad (o extensión de la existente)
Backend:  device_alarm_routes.cpp (nuevo endpoint de trazabilidad,
          extensión de PUT device con connection_mode)
DB:       sensors (columna nueva connection_mode + gateway_label, ambas
          nullable/aditivas), vista SQL de trazabilidad
Sin cambios: telemetry_ingest.cpp, protocol_adapters.cpp, formula engine,
             alarm engine — el flujo de ingesta/autenticación NO se toca.
```

## 3. Modelo de datos

- **Columna nueva en `sensors`** (aditiva, nullable, sin default obligatorio
  — no rompe filas existentes): `connection_mode TEXT CHECK (connection_mode
  IN ('direct','gateway'))`, `gateway_label TEXT` (identificador/alias libre
  del gateway físico, solo para trazabilidad — no FK, no entidad nueva).
- **Vista de trazabilidad** (`v_sensor_traceability` o equivalente): JOIN de
  `sensors` (filtrando `device_api_key_hash IS NOT NULL` para excluir
  sintéticos/semilla) con `sensor_input_channel_def`, `sensor_formula_def`,
  `platform_alarm_rules`, y último valor de `telemetry_fact`/
  `telemetry_multivariate`.
- Aislamiento por `tenant_id`: heredado de `sensors`, sin cambio.
- Sin nuevos índices de escritura en el hot path de ingesta — la columna
  `connection_mode` no participa en `resolveSensor()`.

## 4. Contratos / interfaces

- `GET /api/mining/devices/traceability` (nuevo, permiso `dispositivos.manage`
  o `dispositivos.view` si existe distinción de solo lectura) — devuelve la
  matriz de CA-1.
- `PUT /api/mining/devices/{id}` — se extiende para aceptar `connection_mode`
  y `gateway_label` (mismo patrón COALESCE ya usado para `zone_id`/`label`).
- Sin cambios de protocolo de ingesta (HTTP/MQTT/Modbus/OPC-UA/TLS).

## 5. Fases (ver `tasks.md` para el desglose accionable)

| Fase | Nombre | Riesgo | Bloqueada por |
|---|---|---|---|
| 0 | Auditoría e inventario base | Ninguno (solo lectura) | — |
| 1 | Metadatos de conexión directo/gateway | Bajo (columna aditiva) | Fase 0 |
| 2 | Catálogo de tipos en frontend | Bajo (wiring de endpoint ya existente) | — |
| 3 | Verificación de plantillas de fórmula | Medio (requiere datos reales o de referencia legado) | Acceso a datos de campo o export ThingsBoard |
| 4 | Alarmas: cadenas hijas del legado | Medio (decisión de negocio sobre cuáles portar) | Decisión de Gerencia |
| 5 | Calidad de datos del sync legado | Bajo-medio (investigación + fix acotado) | — |
| 6 | Documentación de cierre | Ninguno | Fases 0-5 |

## 6. Riesgos / mitigación

- **Confundir datos sintéticos con sensores reales**: mitigado exigiendo en
  CA-1 el filtro `device_api_key_hash IS NOT NULL` en cualquier reporte —
  documentado explícitamente en ADR-192 tras encontrarlo real (factor de
  ~26,000x de sobreestimación si no se filtra).
- **Verificar plantillas de fórmula sin datos reales**: si no hay acceso a
  sensores de campo nuevos ni al ThingsBoard legado real, la Fase 3 se limita
  a validación algebraica (comparar contra el JS legado ya transcrito) sin
  poder cerrar el CA-3 al 100% — se documenta el veredicto real por
  plantilla, sin inventar verificación que no ocurrió.
