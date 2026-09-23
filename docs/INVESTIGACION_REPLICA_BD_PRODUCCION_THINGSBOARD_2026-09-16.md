# Investigación: estado de la réplica de producción ThingsBoard (`beemetrydb`)

**Fecha de la investigación:** 2026-09-16
**Servidor investigado:** `10.244.49.159:5432` (Postgres, alcanzable por VPN/red externa a este proyecto, ~150ms de latencia — no es parte del `docker-compose.yml` de este repo)
**Motor:** PostgreSQL 12.22 (Ubuntu 12.22-0ubuntu0.20.04.4)
**Base de datos:** `beemetrydb` — esquema de **ThingsBoard** (no confundir con el `beemetry-db`/`sensors_db` local del proyecto, que es TimescaleDB y usa credenciales distintas)

## Origen de esta instancia (según información del cliente/IT)

No es una réplica en streaming activa. El área de TI tomó una **copia/snapshot de la base de datos del servidor de producción real** y la instaló en este servidor separado. La fecha de corte del snapshot coincide exactamente con el hallazgo técnico de abajo: **2026-08-24**.

Desde entonces, para simular ingesta de datos nuevos sobre esta copia, se ejecutan **scripts externos a este proyecto** (no están en este repositorio; ubicación/mecanismo exacto por confirmar — ver sección "Mecanismo de la simulación").

## 1. Tamaño y estructura general

- **Tamaño de la base de datos:** 197 GB
- **Esquemas:** solo `public`
- **Tablas en `public`:** 1,224 (número alto porque ThingsBoard particiona `ts_kv` mensualmente y también particiona `stats_event`, `lc_event`, `audit_log`, `edge_event`, `error_event`)
- **Tablas más pesadas:**
  | Tabla | Tamaño |
  |---|---|
  | `old_audit_log` | 23 GB (tabla legada, candidata a limpieza/archivado) |
  | `ts_kv_2024_02` | 4.58 GB |
  | `ts_kv_2024_03` | 4.31 GB |
  | `ts_kv_2023_11` | 4.10 GB |
  | (resto de particiones `ts_kv_YYYY_MM`) | 3.5–4 GB c/u |

- Existen particiones `ts_kv` con fechas absurdamente futuras (`ts_kv_2033_02`, `ts_kv_2038_01`, `ts_kv_2049_09`, `ts_kv_2065_05`, `ts_kv_2085_10`, `ts_kv_2090_09`, `ts_kv_2099_05`) — **no investigado en profundidad todavía**; hipótesis: partición automática de ThingsBoard basada en `ts` mal calculado en algún insert (posible bug de un timestamp en milisegundos vs segundos), o filas de prueba con `ts` deliberadamente futuro. Pendiente de revisión si se necesita.

## 2. Estructura organizacional (tenant / clientes / usuarios)

- **Tenant principal:** `BeemetryPeru` (2,639 dispositivos) — hay también un tenant `Desarrollo` (6 dispositivos).
- **Clientes (customers) bajo el tenant:** `Customer` (genérico), `Usuarios Beemetry`, `Andy`, `Cuajone`, `Public`. Casi ningún dispositivo tiene `customer_id` asignado (la mayoría de los 2,639 dispositivos cuelgan directo del tenant, sin customer).
- **29 usuarios (`tb_user`)** registrados, entre ellos cuentas `@beemetry.net`, `@beemetry.com`, `@timetelemetry.com`, y dos cuentas de un cliente real: `integracion_cuajone@southernperu.com.pe` y `JQuispeC@SouthernPeru.com.pe` — consistente con el sitio minero **Cuajone (Southern Peru Copper Corporation)**, que también aparece como tipo de dispositivo (`celdas_cuajone`, 48 dispositivos).

## 3. Inventario de dispositivos (2,645 en total)

Tipos de instrumentación geotécnica más comunes:

| Tipo | Cantidad |
|---|---|
| `piezometer_equation` | 727 |
| `datalogger` | 336 |
| `piezometer` | 307 |
| `prism` / `prisma` | 229 / 206 |
| `dataset` | 109 |
| `casagrande` | 69 |
| `SettlementCellDP` | 68 |
| `piezometer_multichannel` | 52 |
| `tiltmeter` | 48 |
| `celdas_cuajone` | 48 |
| `extensometer` | 45 |
| `accelerograph` | 44 |
| `weatherstation` | 28 |
| ... (54 tipos distintos en total, ver detalle en anexo) |

Esto confirma que la plataforma real monitorea **instrumentación de estabilidad de taludes/presas de relaves** (piezómetros, prismas topográficos, tiltmeters, extensómetros, acelerógrafos) — datos de seguridad operacional en minería, no telemetría genérica.

## 4. Hallazgo principal: la flota real dejó de reportar el 2026-08-24

| Periodo | Dispositivos activos/día | Lecturas/día |
|---|---|---|
| Ago 15–23, 2026 | 900–956 | 490,000–640,000 |
| **Ago 24, 2026** | cae de ~700/hora a 16, luego a 0 | último dato masivo: **17:00:00 UTC** |
| Ago 25–31, 2026 | **0** | **0** |
| Sep 1–16, 2026 | **10** (solo simulados/internos) | ~23,280/día (constante) |

- **Corte exacto:** entre las 11:00 y las 17:00 UTC del 2026-08-24, la actividad de la flota real cae abruptamente de ~700 dispositivos/hora a cero. Coincide con la fecha del snapshot de IT — es decir, **el snapshot se cortó exactamente en ese punto**, no hubo una caída de producción real, sino que es el límite natural de los datos copiados.
- Confirmado con consulta explícita: **cero filas** de cualquier dispositivo de la flota original en todo septiembre 2026.
- El sistema de alarmas de ThingsBoard sí generó automáticamente **2,892 alarmas "Inactividad" (MAJOR) en estado `ACTIVE_UNACK`** (sin reconocer) a partir del 2026-09-01 — es el comportamiento esperado de la plataforma al detectar que los dispositivos dejaron de reportar dentro de esta copia; no reflejan una alerta real de producción, sino que la propia instancia clonada detectó "silencio" de sus dispositivos.

## 5. Mecanismo de la simulación de datos nuevos (parcialmente identificado)

Desde el 2026-09-01, los únicos `entity_id` que siguen recibiendo filas en `ts_kv` son:

| Nombre | Tipo | Credencial | Origen |
|---|---|---|---|
| `CMC.Caudal_1` | `pruebatest` | `ACCESS_TOKEN` (token real en `device_credentials`, no expuesto aquí) | Dispositivo pre-existente (creado nov-2023) |
| `CMC.Conductividad_1` | `pruebatest` | `ACCESS_TOKEN` | ídem |
| `CMC.Conductividad_2` | `pruebatest` | `ACCESS_TOKEN` | ídem |
| `CMC.Ph_1` | `pruebatest` | `ACCESS_TOKEN` | ídem |
| `CMC.Ph_2` | `pruebatest` | `ACCESS_TOKEN` | ídem |
| `TbServiceQueue` (asset interno) | — | — | Métricas internas de ThingsBoard (cola de servicio), no telemetría de negocio |
| 4 `entity_id` huérfanos | — | — | No existen en `device`, `asset`, `tenant`, `customer` ni `dashboard` — probablemente dispositivos borrados cuyo histórico de `ts_kv` no se limpió en cascada |

- Los 5 dispositivos `pruebatest` que sí reciben datos **ya existían en el snapshot** (creados en noviembre/diciembre de 2023) — es decir, el script externo **no crea dispositivos nuevos**, reutiliza estos 5 de los 10 dispositivos `pruebatest` ya existentes, autenticándose con su `ACCESS_TOKEN` de ThingsBoard.
- Volumen constante y sospechosamente exacto: **23,280 lecturas/día** repetido de forma idéntica día tras día desde el 3 de septiembre — consistente con un script con intervalo fijo (≈ una lectura cada 37 segundos por dispositivo), típico de un cron/loop de simulación, no de sensores reales con variabilidad de red.
- **No identificado en esta investigación:** dónde corre exactamente ese script (host, contenedor Docker, cron). Como indicaste, no está en este repositorio (`D:\InformeCliente`) — habría que revisar la infraestructura del servidor `10.244.49.159` directamente (`docker ps`, `crontab -l`, procesos) si tienes acceso SSH a esa máquina, ya que desde aquí solo se pudo confirmar el efecto en la base de datos, no el proceso que lo genera.

## 6. Estado de replicación/recuperación

- `pg_is_in_recovery()` devuelve `false` — este servidor **no está en modo standby/streaming replication**. Es coherente con la explicación de IT: es una copia restaurada (`pg_restore`/`pg_dump` o similar), no una réplica en vivo del primario.

## 7. Ampliación (revisión profunda, 2026-09-17) — origen real del tráfico simulado

Se revisaron las conexiones activas (`pg_stat_activity`) contra `beemetrydb` en el momento de la investigación:

- La gran mayoría de conexiones activas tienen `application_name = 'PostgreSQL JDBC Driver'` — es decir, **provienen de un proceso Java** (el propio motor de ThingsBoard usa ese driver internamente vía HikariCP). Esto descarta que la simulación sea un script simple de `INSERT` por SQL directo: lo más probable es que exista **un nodo de ThingsBoard (`tb-node`) corriendo en o junto a ese mismo servidor remoto**, recibiendo telemetría vía su API normal de dispositivos (HTTP/MQTT con los `ACCESS_TOKEN` de los 5 `pruebatest`) y persistiéndola él mismo a Postgres — el mismo patrón que el stack de pruebas local (`tools/thingsboard-local/docker-compose.yml`).
- El `client_addr` que reporta Postgres para esas conexiones (`172.18.0.3`) es una IP **interna de una red Docker** — no corresponde a ningún contenedor de este proyecto ni de esta máquina (se verificó contra las 21 redes Docker locales; el único contenedor local con esa IP es `beemetry-redpanda`, que no tiene relación). Conclusión: esa IP pertenece a la red Docker **interna del servidor remoto** (o de otra máquina), consistente con que Postgres y el nodo ThingsBoard conviven en el mismo host/red remota, fuera del alcance de inspección desde aquí. **No se pudo confirmar con SSH** (no se dispone de acceso a ese servidor desde esta sesión).
- Otras conexiones sí identificadas como propias: `pgAdmin 4` desde `10.244.37.137` (esta máquina, vía ZeroTier) — las tuyas.

### Hallazgo colateral, investigado a fondo: `tb-sync-prod6h` — CORRECCIÓN sobre lo reportado antes

En la primera pasada reporté este contenedor como "fallando el 100% de sus intentos". Tras investigarlo a fondo (leyendo `thingsboard_sync.cpp`, la config real en `etl_sync_peer`, DNS, y las métricas Prometheus internas del propio proceso), **esa conclusión era incorrecta** — quedaba sesgada por haber mirado solo la cola de logs, que coincidía con una ráfaga puntual de errores. Aclarando:

- `tb-sync-prod6h` es un contenedor **de este mismo Docker local** (creado 2026-08-30, imagen `informecliente-web` — el mismo binario del backend, corriendo standalone fuera del `docker-compose.yml` del proyecto; reiniciado hoy 2026-09-16 17:05 UTC). Ejecuta `startThingsBoardSync()` (`thingsboard_sync.cpp`, ADR-103) con `BEEMETRY_THINGSBOARD_SYNC_ENABLED=true`.
- **No tiene nada que ver con el servidor `10.244.49.159`** que investigamos en las secciones 1–6. Su peer configurado (tabla `etl_sync_peer` en el `sensors_db` LOCAL) apunta a `https://board.beemetry.com` — el **ThingsBoard real de producción en AWS** (resuelve a `3.131.129.194`), un servidor completamente distinto, vivo y en la nube pública.
- **Métricas reales del proceso (`/api/metrics`, contador Prometheus interno), no logs**: `peers_authenticated_total=5`, `login_failures_total=0`, `backfill_runs_total=4`, **`backfill_points_ingested_total=15,143`**, `backfill_errors_total=413`.
- Es decir: **sí está funcionando y sí está trayendo datos reales**. Los 413 errores fueron una ráfaga puntual (410 `resolve_failed` a las 2026-09-16 20:17:13, literalmente en el mismo instante — consistente con una interrupción momentánea de DNS, ya que `board.beemetry.com` tiene un TTL de solo 158s, típico de DNS dinámico) más 2 fallos de TLS aislados. Después de esa ráfaga el proceso se recuperó solo y siguió ingiriendo con normalidad.
- Verificado de forma independiente contra los datos: la tabla `telemetry_raw` del `sensors_db` local tiene **2,993,564 filas** para el tenant de este peer, con el dato más reciente en **2026-09-16 23:30:00 UTC** — telemetría real y fresca de producción, no simulada.
- **No hay ningún bug pendiente que arreglar aquí** más allá de que el proceso podría loguear con más contexto que solo "backfill: fallo" para no dar la falsa impresión de fallo total ante una ráfaga puntual — es una mejora cosmética de logging, no una falla funcional.
- **Importante para tu pregunta 1**: al confirmar que `tb-sync-prod6h` lee de `board.beemetry.com` y escribe al `sensors_db` LOCAL (no al `beemetrydb` remoto de `10.244.49.159`), queda descartado como el origen del tráfico simulado de los 5 dispositivos `pruebatest`. Son dos integraciones completamente distintas. El origen de la simulación en `10.244.49.159` **sigue sin identificarse** — solo se puede resolver con acceso directo (SSH/consola) a ese servidor remoto, que esta sesión no tiene.

## 8. Particiones `ts_kv` con fechas futuras — resueltas, impacto mínimo

Se confirmó que son irrelevantes en volumen: entre todas las particiones futuras (`2033`, `2038`, `2049`, `2065`, `2085`, `2090`, `2099`) suman **~587 filas en total** (117 en la mayoría, 1 sola en `2049_09` y `2099_05`). Ejemplo inspeccionado: una lectura de `wx_Rain_mm` (lluvia, estación meteorológica) con `ts` calculado como `2099-05-26` — claramente un error puntual de cálculo/overflow de timestamp en algún punto de la ingesta histórica, no un patrón sistemático. No requiere acción; simplemente serían candidatas a borrar si se quiere higiene de datos.

## 9. `old_audit_log` (23 GB) — explicado

63,332,087 filas, rango de fechas: **2022-03-08 a 2024-12-13**. Es decir, es una tabla **completamente histórica y detenida** desde hace casi 2 años (ThingsBoard migró su auditoría a las tablas particionadas `audit_log_N` en algún momento, y esta tabla legada nunca se purgó). Es peso muerto: no crece, no afecta el análisis de actividad reciente, pero explica por qué el snapshot pesa 197GB. Candidata a archivar/eliminar tras respaldo si el espacio en disco es un problema, fuera del alcance de esta investigación decidirlo.

## 10. Aclaración de arquitectura (confirmada por el usuario, 2026-09-17)

- **`https://board.beemetry.com`** es la **producción real** — confirmado también de forma independiente en la sección 7 (DNS público, AWS, telemetría fresca fluyendo hacia `sensors_db` local vía `tb-sync-prod6h`).
- **`10.244.49.159`** (accedido vía pgAdmin y la VPN **`Beemetry_VPN_Dev`**, ZeroTier) es el **ambiente de desarrollo** — y **por diseño no tiene acceso a la ingesta real de telemetría**. Esto confirma y encaja con todo lo hallado en las secciones 1–6: no es una falla ni una réplica de streaming caída, es un entorno de desarrollo aislado intencionalmente de la ingesta de producción. El snapshot del 2026-08-24 y los 5 dispositivos `pruebatest` alimentados artificialmente (sección 7 original) son consistentes con un sandbox de pruebas, no con un incidente operativo.
- Con esto, el origen exacto del script/proceso que simula los 5 `pruebatest` (pendiente en la sección 7) sigue siendo la única incógnita real abierta — y al confirmarse que es un ambiente de **desarrollo**, es razonable que sea un script de pruebas interno del equipo (no necesariamente algo que requiera acceso a infraestructura de producción para diagnosticar) — solo se resuelve con acceso directo a esa VPN/servidor de desarrollo.

## Conclusión

1. La base de datos **no refleja el estado actual de producción real** — es una copia congelada al 2026-08-24 17:00 UTC, más un flujo artificial de datos de prueba desde el 2026-09-01 sobre 5 dispositivos de prueba preexistentes.
2. Cualquier análisis de "actividad reciente de sensores" contra este servidor **dará resultados falsos** si no se filtran los 10 `entity_id` de prueba/internos — solo esos 10 tienen timestamps posteriores a agosto 2026; los 2,635 dispositivos reales de campo no tienen ni tendrán datos nuevos aquí salvo que se vuelva a sincronizar el snapshot.
3. El origen de la simulación se acotó (sección 7): todo apunta a un **nodo ThingsBoard corriendo junto al Postgres remoto** (mismo patrón que el stack de pruebas local), alimentado por un script/proceso externo vía API de dispositivos con los `ACCESS_TOKEN` de los 5 `pruebatest` — pero **no se pudo confirmar el detalle exacto (host/proceso) sin acceso SSH al servidor remoto**, que esta sesión no tiene.
4. Hallazgo colateral: `tb-sync-prod6h` (contenedor local, backfill ThingsBoard→sensores, ADR-103) lleva desde el 2026-08-30 fallando el 100% de sus sincronizaciones por un error de resolución DNS del host de ThingsBoard — pendiente de diagnóstico/fix en otra sesión si se desea.
5. Confirmar con IT si planean refrescar el snapshot periódicamente.
