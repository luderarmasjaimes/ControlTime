# SPEC 027 — Cierre de integración de sensores (directo + gateway) con la plataforma IoT propia

| Campo | Valor |
|---|---|
| **ID** | 027 |
| **Estado** | **Aprobado** (alcance, 2026-09-16) — en ejecución |
| **Autor** | Investigación 2026-09-16, a pedido del developer |
| **Aprobado por** | Developer (Luder Armas) |
| **Fecha** | 2026-09-16 |
| **Sprint / Cronograma** | Sin ventana formal asignada — prioridad interna |
| **SOW relacionado** | N/A (auditoría técnica interna, no entregable contractual directo) |

## 1. Problema / Oportunidad

El documento del cliente `sensores_telemetria_thingsboard.mdm` (transcripción
de audio + chat, 2026-09-15) describe el flujo de integración de sensores del
sistema legado ThingsBoard y deja preguntas abiertas sobre cómo se relacionan
sensores, tramas de telemetría y fórmulas. La investigación de 2026-09-16
confirmó que la plataforma nueva (Beemetry, core C++) ya reemplaza a
ThingsBoard en capacidad técnica (ADR-034, 187, 188, 189), pero que la
integración real de sensores de campo sigue en etapa piloto — ver
[ADR-192](../../docs/decisions/192-auditoria-integracion-sensores-directo-gateway-cierre-spec027.md)
para las cifras verificadas contra la base de datos real: **3 sensores reales
con credencial emitida** (de 78,780 filas totales, 78,777 sintéticas de
prueba de carga), **0 fuentes Modbus/OPC-UA configuradas**, **1 sola regla de
alarma en todo el sistema**.

Afecta directamente la capacidad de dar de alta sensores reales de campo (los
que se conectan directo y los que llegan por gateway físico existente) sin
depender de conocimiento tácito del operador ("nosotros sabemos cuáles
agarrar", cita del audio del cliente).

## 2. Objetivo

Cerrar, de forma medible y verificada contra datos reales (no solo contra
código), todos los pendientes que impiden dar por completa la integración de
sensores con la infraestructura de ingesta/catálogo/fórmulas/alarmas ya
construida — sin rediseñar el modelo de conexión directo/gateway existente.

## 3. Usuarios y contexto

- **Rol(es)**: administrador de dispositivos (`dispositivos.manage`), editor
  de fórmulas (`formula.edit`), Gerencia (para las decisiones de negocio de
  Fase 5/6 — priorización de cadenas legado, calidad de datos del sync).
- **Multitenant**: sí. El aislamiento por `tenant_id` ya existe en `sensors`,
  `sensor_formula_def`, `platform_alarm_rules` — esta spec no lo modifica,
  solo lo audita.
- **Volumen/escala real hoy**: 3 sensores reales, 13 tenants con al menos una
  fila en `sensors` (mezcla real/sintético/semilla), 27 plantillas de fórmula
  disponibles, 8 fórmulas configuradas.

## 4. Alcance

**Incluye:**
- Inventario y trazabilidad real de sensores de campo (directos y por
  gateway), excluyendo explícitamente los datos sintéticos de carga
  (ADR-108) y de semilla/demo.
- Cierre de los 3 gaps de catálogo/frontend declarados pendientes en
  ADR-188/189 (`sensor_type` texto libre, catálogo de tipos no consumido).
- Verificación end-to-end de las 26 plantillas de ADR-189 aún no probadas
  contra datos reales (26 de 27 — solo `PZ-VW-02` está verificado).
- Matriz/endpoint de trazabilidad sensor → canal → fórmula → regla de alarma
  → estado, la "primera entrega útil" que el propio documento del cliente
  recomienda.
- Metadatos ligeros de conexión (directo/gateway) para trazabilidad, sin
  crear entidad nueva.
- Inventario de las 7 cadenas hijas del legado ThingsBoard no analizadas
  (ADR-189), para decidir cuáles portar.
- Investigación de la causa de timestamps corruptos en el sync legado
  (ADR-054).

**No incluye:**
- Rediseñar el modelo de datos de "gateway" como entidad propia — decisión
  explícita de no tocarlo ahora (ADR-192).
- Tocar rule-chains de ThingsBoard en producción (`board.beemetry.com`).
- Nuevos protocolos de ingesta sin caso de uso de campo confirmado (CoAP,
  adaptador dedicado LoRaWAN/ChirpStack — hoy llegan como clientes MQTT
  genéricos, suficiente mientras no se demuestre lo contrario).
- Migrar dispositivos legado específicos por nombre (Boroo Misquichilca,
  GF.PZ VW-1703, Yauricocha) más allá de dejar el mecanismo de override listo
  — la migración de cada dispositivo real es un evento operativo separado,
  no una tarea de esta spec.

## 5. Criterios de aceptación

- **CA-1**: Existe un reporte/endpoint de trazabilidad que, para cada sensor
  con credencial real (excluyendo sintéticos/semilla), muestra: tipo,
  protocolo, modo de conexión (directo/gateway), canales declarados,
  fórmulas activas, reglas de alarma asociadas y último dato recibido.
- **CA-2**: `SensorManagementView.tsx` selecciona `sensor_type` desde el
  catálogo real (`sensor_type_def`), no texto libre.
- **CA-3**: Cada una de las 27 plantillas de ADR-189 tiene un veredicto
  explícito de verificación (verificado contra dato real / pendiente de
  sensor real para probarla / descartado) — no laguna de "no se sabe".
- **CA-4**: Cada sensor real dado de alta queda anotado con su modo de
  conexión (directo/gateway) sin cambios al flujo de autenticación/ingesta
  existente.
- **CA-5**: Las 7 cadenas hijas del legado ThingsBoard quedan inventariadas
  con una decisión explícita por cadena (portar a `platform_alarm_rules` /
  no aplica / diferido), aunque no se implementen todas en esta spec.
- **CA-6**: Causa raíz de los timestamps corruptos del sync ADR-054
  identificada y documentada (corrección puede quedar como tarea separada si
  su alcance lo amerita).

## 6. Fuera de alcance / decisiones pendientes de Gerencia

- Presupuesto/ventana para migrar sensores legado reales identificados en
  ADR-189 (Boroo Misquichilca, GF.PZ VW-1703, Yauricocha).
- Decisión de negocio sobre si portar las 7 cadenas hijas del legado antes o
  después de dar de baja el ThingsBoard legado.

## Referencias

- [ADR-192](../../docs/decisions/192-auditoria-integracion-sensores-directo-gateway-cierre-spec027.md) — auditoría y cifras reales que originan esta spec.
- ADR-034, 054, 108, 131, 136, 140, 186, 187, 188, 189, 190.
- `sensores_telemetria_thingsboard.mdm` (documento fuente del cliente, 2026-09-15) — insumo de análisis, no instrucción directa de cambio en producción.
