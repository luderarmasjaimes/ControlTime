# ADR-111 — Portabilidad del stack: export/import y perfil mínimo de telemetría

> **Actualización 2026-09-02 (2)**: se corrigen dos bugs reales encontrados en
> una migración real a una segunda laptop, ambos con el mismo patrón —
> "el checksum pasa pero el archivo/paso está roto":
>
> 1. **Imágenes Docker corruptas al exportar en Windows.**
>    `export-stack.ps1` comprimía cada imagen con
>    `tar -czf out.tar.gz -C dir img.tar`, que NO gzipea los bytes del
>    `.tar` de `docker save` — los ENVUELVE como entrada de un tar nuevo y
>    gzipea eso (tar-dentro-de-tar). `docker load` descomprime bien pero no
>    encuentra `manifest.json` en la raíz y falla con
>    `"unrecognized image format"`. Afectaba a **las 15 imágenes de
>    cualquier export hecho con la versión PowerShell** (confirmado
>    reproduciendo el fallo con una imagen de 28 MB, no solo con la más
>    grande). Corregido usando `System.IO.Compression.GZipStream` de .NET
>    directo sobre el archivo (mismo criterio "nunca por pipe/redirección de
>    PowerShell" que ya regía para `pg_dump`). La versión Bash
>    (`export-stack.sh`) nunca tuvo este bug — usa `docker save | gzip`
>    directo. Aparte, independientemente de este bug estructural, también se
>    confirmó en la misma sesión un caso de truncamiento real por disco casi
>    lleno en el host de origen (gzip cortado a mitad de escritura,
>    "corrupted -- incomplete deflate data") — dos causas de corrupción
>    distintas, ambas posibles con un `checksums.sha256` que "coincide"
>    porque valida el archivo tal como quedó escrito, no que el contenido
>    sea el correcto.
> 2. **`dashboard_ro` nunca provisionado en el destino →  500 silencioso.**
>    Los roles de Postgres son objetos de **clúster**, no de base de datos:
>    `pg_dump -d sensors_db` nunca incluye al rol `dashboard_ro` (creado por
>    `db_scripts/40_dashboard_ro_role.sql`, ver ADR de hardening 2026-07-10).
>    `BEEMETRY_REPLICA_DATABASE_URL` (docker-compose.yml) usa ese rol contra
>    `db_replica` — sin provisionarlo, cualquier endpoint que lea de la
>    réplica (wizard de telemetría en `sensor_telemetry_wizard.cpp`, KPIs)
>    devuelve 500 `db_unavailable` **sin ninguna traza en logs** (es un
>    `return` controlado en el handler cuando `PQstatus != CONNECTION_OK`,
>    no una excepción). Antes esto quedaba como pasos manuales "3" y "4"
>    documentados en la cabecera de `import-stack.ps1`/`.sh` pero no
>    ejecutados por el script — fáciles de saltarse, y exactamente lo que
>    pasó. Ahora `import-stack.ps1`/`.sh`, al final de restaurar la BD (con
>    `IncludeDb`/`INCLUDE_DB` en su default `1`), automáticamente: levantan
>    el stack completo (`docker compose up -d`), esperan a que `db_replica`
>    esté `healthy`, aplican `40_dashboard_ro_role.sql` (la versión
>    PowerShell lo reimplementa nativo, sin invocar el `.sh`, mismo criterio
>    de no depender de Git Bash del resto del archivo), y reinician `web`
>    con `--force-recreate`. Fail-soft: si algún paso de este bloque final
>    falla, avisa y sigue (la BD/volúmenes/imágenes ya se restauraron, no
>    vale la pena abortar todo el import por esto).
>
> **Lección para próximas migraciones**: un checksum válido certifica que el
> archivo no cambió en tránsito, no que el proceso que lo generó fue
> correcto. La única prueba real de que una imagen Docker exportada sirve es
> cargarla con `docker load` y ver que no tire error — se agregó esa
> verificación en vivo a la sesión de corrección (no está automatizada
> todavía en el script; sigue siendo manual/ad-hoc).

> **Actualización 2026-08-30**: se cierra el sub-pendiente de **checksum**
> (uno de los cuatro citados en "Alternativas descartadas": "faltan
> checksum, cifrado, restore limpio, RTO/RPO y CI/CD"). Los 4 scripts
> (`export-stack.ps1`/`.sh`, `import-stack.ps1`/`.sh`) ahora escriben/leen
> `checksums.sha256` (SHA-256 por archivo, formato compatible con
> `sha256sum -c` en ambos sistemas — se corrigió de paso un bug real
> encontrado durante la propia verificación: `Set-Content` de PowerShell
> escribe CRLF por defecto en Windows, y `sha256sum -c` en Linux/Git Bash
> interpreta el `\r` final como parte del nombre de archivo y falla con
> "No such file or directory" pese a que el contenido es idéntico —
> corregido escribiendo el archivo con LF explícito). `import-stack.ps1`/
> `.sh` verifican **antes** de tocar Docker/BD y abortan con throw/exit 1 si
> algo no coincide (fail-closed, mismo criterio de "nunca fallar en
> silencio" que ya rige el resto de este log). Verificado en vivo contra el
> stack real corriendo: export de `sensors_db`/`formula` con
> `-IncludeImages:$false -IncludeVolumes:$false` (más rápido, solo BD),
> checksum válido pasa ambos verificadores (PowerShell y `sha256sum -c`), y
> una prueba de corrupción deliberada (byte agregado a un dump) es
> detectada y aborta el import antes de cualquier operación Docker/BD —
> confirmado con un harness de prueba aislado que nunca llegó a tocar
> contenedores reales. **Cifrado, restore limpio en host nuevo y CI/CD
> siguen sin resolver** — no se atacaron en esta pasada; cifrar requiere una
> decisión de gestión de claves que no corresponde tomar unilateralmente
> (ver "Pendiente" abajo, sin cambios).

**Status**: implemented como utilidad (con verificación de integridad desde 2026-08-30); aceptación operativa pendiente

**Fecha**: 2026-08-18

**Ámbito**: plataforma, despliegue, continuidad

**Relación**: SPEC-015, SPEC-020, SPEC-023; complementa ADR-033 y ADR-035.

## Contexto

Existen scripts PowerShell/Bash para exportar imágenes Docker, volúmenes y
dumps lógicos, restaurarlos en otra máquina y arrancar un perfil mínimo de
telemetría 25k. La capacidad no tenía ADR/SPEC y podía confundirse con backup
DR o despliegue productivo automatizado, aun cuando archivos del host, secretos
y modelos requieren copia manual y no existe evidencia de restore integral.

## Decisión

1. Adoptar `export-stack`/`import-stack` como paquete de **portabilidad y
   recuperación asistida**, con implementaciones equivalentes PowerShell/Bash.
2. PostgreSQL se transporta mediante dump lógico; la réplica se reconstruye.
   TimescaleDB usa `timescaledb_pre_restore/post_restore`.
3. Imágenes y volúmenes se exportan de manera optativa. Redpanda no se incluye
   por defecto porque es buffer, no sistema de registro permanente.
4. `.env`, certificados, SDK/modelos biométricos, datos y secretos del host no
   se incorporan automáticamente. Deben inventariarse, transferirse cifrados y
   validarse por canal separado.
5. `start-telemetry-core.ps1` es un perfil de prueba/capacidad; detener servicios
   opcionales no es procedimiento productivo normal.
6. No se denominará «DR aprobado», «backup completo» ni «despliegue
   automatizado» hasta cerrar SPEC-023: checksum/firma, cifrado, restore en host
   limpio, smoke/CTests, medición RTO/RPO, rollback y CI.

## Consecuencias

- Reduce dependencia de una laptop y hace visible qué no está respaldado.
- Añade un camino concreto hacia DR, pero no cierra SPEC-015.
- Los paquetes pueden contener datos sensibles; deben cifrarse y contar con
  retención, custodia y borrado definidos antes de uso real.

## Evidencia

- `scripts/export-stack.ps1`, `scripts/import-stack.ps1`
- `scripts/export-stack.sh`, `scripts/import-stack.sh`
- `scripts/start-telemetry-core.ps1`
- `scripts/provision-dashboard-ro.sh`, `db_scripts/40_dashboard_ro_role.sql`
  (invocados automáticamente por `import-stack.ps1`/`.sh` desde 2026-09-02)

## Alternativas descartadas

- Copiar volúmenes Postgres en crudo: menos portable y riesgoso entre versiones.
- Incluir secretos en el paquete: amplía el impacto de una filtración.
- Tratar la existencia del script como prueba DR: no mide restauración ni RTO.
