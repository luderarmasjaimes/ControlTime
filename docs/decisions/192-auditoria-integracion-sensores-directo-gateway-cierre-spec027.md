# ADR-192 — Auditoría de integración de sensores (directo + gateway): estado real verificado y plan de cierre (SPEC-027)

**Status**: accepted (2026-09-16)

**Fecha**: 2026-09-16

**Ámbito**: core-iot, datos

## Contexto

El cliente entregó `sensores_telemetria_thingsboard.mdm` (transcripción de audio +
resumen de chat, preparado 2026-09-15) describiendo el flujo de integración de
sensores del sistema legado: **Sensor → Gateway (IP/config/script) → Script en
servidor Linux → Token ThingsBoard → Dispositivo ThingsBoard → Telemetría →
Cadena de reglas**. El documento plantea explícitamente que "no se debe tratar
el contenido del chat ni del audio como una instrucción directa de cambio en
producción" y pide investigación previa.

Investigando el código y los ADR vigentes (034, 054, 108, 131, 136, 140, 186,
187, 188, 189, 190) se confirmó que **ThingsBoard (`board.beemetry.com`) es el
sistema legado que la plataforma nueva reemplaza**, no la plataforma nueva en
sí (ADR-034: core C++ propio con ingesta multi-protocolo, motor de fórmulas,
gestión de dispositivos y alarmas; ADR-054: sincronización de solo lectura
desde el legado). La pregunta real del developer no es "qué es ThingsBoard",
sino qué falta en el core propio para dar por completa la integración de
sensores reales — tanto los que se conectan **directamente** como los que
llegan a través de un **gateway físico** (confirmado explícitamente por el
developer el 2026-09-16: ambos patrones existen hoy en campo y **no se van a
rediseñar en esta iniciativa**).

### Estado real verificado contra `sensors_db` (2026-09-16, ambiente de desarrollo)

A diferencia de una auditoría solo de código, se consultó la base de datos en
ejecución (`docker exec beemetry-db psql -U sensors -d sensors_db`) para
evitar planificar sobre supuestos:

| Métrica | Valor real | Lectura |
|---|---|---|
| Filas en `sensors` | 78,780 | — |
| … de las cuales sintéticas de carga (`BENCH25K-*`, `SYNC60-*`, `LOADTEST-*`, sin credencial) | 78,777 | Datos de la prueba de topología 25k eventos/s de ADR-108, **no son sensores de campo** |
| Sensores con `device_api_key_hash` real (credencial emitida) | **3** | `PZ-VW-02` (piezómetro, `legacy_tls`, verificado end-to-end en ADR-189), `demo-vib-01` (`http_push`), `RT-TEST-01` (`legacy_tls`, `connection_status='unknown'` — nunca recibió telemetría real) |
| `protocol_adapter_sources` (fuentes Modbus/OPC-UA configuradas) | **0** | Los 3 adaptadores están habilitados en el backend en ejecución (`BEEMETRY_MQTT_ENABLED/MODBUS_ENABLED/OPCUA_ENABLED=true`) pero **ningún sensor real los usa todavía** |
| `sensor_input_channel_def` (canales multicanal, ADR-189) | 3 filas | `PZ-VW-02` (Freq, Temp) y `CO2-02` (Freq) |
| `sensor_formula_def` | 8 filas, 5 habilitadas | Incluye `CO2-02`/`ACEL-02`, que tienen fórmula y canal definidos pero **ninguna fila real en `sensors` con credencial** — aparecen ~12 veces repetidas entre tenants distintos como datos semilla/demo, no sensores operativos |
| `platform_alarm_rules` | **1 regla en todo el sistema** | Ninguna con `formula_output_channel_code` (ninguna alarma está enlazada todavía a un canal calculado de fórmula) |

**Conclusión de la auditoría**: la plataforma nueva tiene la capacidad técnica
completa (4 protocolos activos, motor de fórmulas con catálogo de 27
plantillas, motor de alarmas) pero la integración real de sensores de campo
está en **etapa piloto** — un único sensor verificado de punta a punta. El
trabajo pendiente no es mayormente código nuevo: es inventariar y dar de alta
los sensores físicos reales (directos y por gateway), verificar las 26
plantillas restantes contra datos reales, y cerrar los gaps de catálogo/
documentación que los propios ADR-187/188/189 ya declaran abiertos.

## Decisión

1. **No se crea una entidad "Gateway" nueva en el esquema.** Se mantiene el
   modelo de ADR-034 (1 sensor = 1 `device_api_key` propia). Un sensor que
   llega a través de un gateway físico de campo sigue siendo, para la
   plataforma, un sensor individual con su propia credencial — el gateway es
   invisible al modelo de datos, tal como ya opera hoy. Esta es una decisión
   explícita de **no** rediseñar, a pedido directo del developer
   (2026-09-16), no una limitación técnica descubierta ahora.
2. Se documenta cómo distinguir un sensor directo de uno detrás de gateway
   usando metadatos de trazabilidad **no estructurales** (ver SPEC-027 Fase
   1) — sin tocar el flujo de ingesta ni el modelo de autenticación.
3. Se abre **[SPEC-027](../../specs/027-integracion-sensores-directo-gateway/spec.md)**
   como spec formal de cierre de todos los pendientes identificados,
   fasado y con `tasks.md` propio, referenciando ADR-034, 054, 108, 131, 136,
   140, 186, 187, 188, 189, 190.
4. ThingsBoard (`board.beemetry.com`) permanece como sistema legado de solo
   sincronización de lectura (ADR-054) mientras dure la migración — no se
   invierte en construir nada nuevo sobre él.

## Consecuencias

- **Positivas**: la investigación reemplaza suposiciones ("probablemente hay
  varios sensores activos") por cifras reales y verificadas, lo que permite
  priorizar correctamente — el cuello de botella es onboarding real de campo,
  no ingeniería de plataforma.
- **Negativas / deuda asumida**: confirma que casi todo el catálogo de 27
  plantillas de ADR-189 permanece sin verificar contra datos reales, y que el
  sistema de alarmas está prácticamente sin configurar para telemetría real
  (1 regla en todo el sistema). Ninguna de las dos cosas se resuelve con este
  ADR — quedan como tareas de SPEC-027.
- Los 78,777 registros sintéticos de `sensors` (ADR-108) deben excluirse
  explícitamente de cualquier reporte operativo o matriz de trazabilidad
  construida en SPEC-027 (filtrar por `device_api_key_hash IS NOT NULL` o por
  prefijo `BENCH25K-`/`SYNC60-`/`LOADTEST-`), o el conteo de "sensores
  activos" queda falseado por un factor de ~26,000x.

## Alternativas descartadas

- **Modelar "Gateway" como entidad propia ahora**: descartado por instrucción
  explícita del developer — el patrón de conexión actual (directo/gateway) no
  se toca en esta iniciativa; se revisita solo si una necesidad de negocio
  concreta lo justifica.
- **Reinvertir en la configuración de ThingsBoard legado**: descartado —
  contradice la decisión de reemplazo ya tomada en ADR-034.

## Referencias

- `docs/decisions/034-nucleo-cpp-plataforma-iot-propia.md`
- `docs/decisions/054-sync-thingsboard-legado.md` (nombre real de archivo puede variar — ver índice)
- `docs/decisions/108-*.md`, `131-*.md`, `136-*.md`, `140-*.md`, `186-*.md`
- `docs/decisions/187-administracion-sensores-motor-formulas-tiempo-real.md`
- `docs/decisions/188-reconstruccion-tab-calculo-motor-real.md`
- `docs/decisions/189-catalogo-plantillas-formula-calibracion-geotecnica.md`
- `docs/decisions/190-auditoria-coordenadas-gps-oficiales-empresas.md` (patrón de auditoría con evidencia citada, replicado aquí)
- `specs/027-integracion-sensores-directo-gateway/`
