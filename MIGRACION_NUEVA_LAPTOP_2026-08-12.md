# Guía de migración — nueva instalación completa (cambio de laptop)

Análisis del estado real del repo (`docker-compose.yml`, `.env.example`,
`db_scripts/`, `.gitignore`, Dockerfiles) para llevar toda la plataforma
Beemetry/AURIXA a una laptop nueva. Complementa a `RUNBOOK.md` (que asume que
la VPS/host ya tiene todo desplegado y solo cambia código) — esto es un
**despliegue desde cero**.

## 0. Diagnóstico de ESTA máquina (2026-08-12) — bloqueante actual

Se verificó el estado real de esta laptop (donde ya está el repo con `.env`,
`dermalog-sdk/`, `biometric-models/`, `data/`, `certs/` presentes). Docker
Desktop **no está instalado todavía**. Antes de poder ejecutar cualquier
`docker compose build/up` hay un bloqueo de firmware que solo se resuelve
manualmente:

| Check | Resultado | Acción requerida |
|---|---|---|
| CPU | Intel i9-14900HX, 24 núcleos / 32 hilos | Ninguna — supera la referencia de 20C usada en `docker-compose.yml` |
| RAM | 63.7 GB | Ninguna — supera la referencia de ~15-16 GB |
| GPU | NVIDIA GeForce RTX 5060 (laptop) | El bloque `deploy.resources.reservations.devices` de `ai_engine` **sí se puede dejar** (hay GPU real) — falta confirmar driver NVIDIA + soporte WSL2/CUDA una vez WSL2 esté activo |
| Docker Desktop | No instalado (ni binario, ni servicio, ni proceso) | Instalar desde docker.com **después** de resolver WSL2 |
| WSL2 | **No puede iniciar**: *"la virtualización no está habilitada en esta máquina"* | **Reiniciar y habilitar virtualización (Intel VT-x) en la BIOS/UEFI.** Esto es un ajuste de firmware — no se puede activar por software ni remotamente. Menú típico: `Advanced` / `CPU Configuration` / `Intel Virtualization Technology` → `Enabled` |
| Espacio libre en `D:` (donde vive el repo) | **26.9 GB libres** de 475 GB | Insuficiente para instalar ahí Docker Desktop + WSL2 + las imágenes que se van a construir (backend compila OpenCV/vcpkg, `ai_engine` compila SeetaFace6 desde fuente — el build cache solo puede consumir 10-20 GB). **Instalar Docker Desktop y configurar el disco virtual de WSL2 en `C:` (847 GB libres)**, no en `D:`. |
| Conectividad a internet | OK (GitHub responde 200) | Ninguna — alcanza para los `git clone`/`pull` de build (onnxruntime, open62541, SeetaFace6, modelos Ollama) |
| `.env` | Las variables obligatorias del compose (`${VAR:?...}`) están todas definidas y no vacías | Ninguna — no hace falta tocar `.env` |

**Orden exacto para desbloquear, de tu lado (no lo puedo hacer yo — requiere
BIOS y privilegios de administrador):**

1. Reiniciar → entrar a BIOS/UEFI → habilitar `Intel VT-x` / `Intel
   Virtualization Technology` → guardar y arrancar Windows normal.
2. Como administrador en PowerShell:
   ```powershell
   dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
   dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
   ```
   Reiniciar Windows.
3. Verificar: `wsl --status` ya no debe quejarse de virtualización.
4. Instalar Docker Desktop (docker.com) → durante la instalación, backend
   **WSL 2**. En *Settings → Resources → Advanced*, verificar que el disco
   virtual de WSL2 quede en `C:` (Docker Desktop lo hace por defecto salvo
   que se mueva `%LOCALAPPDATA%\Docker` a mano).
5. En *Settings → Resources*, activar soporte de GPU si Docker Desktop lo
   ofrece (requiere driver NVIDIA actualizado con soporte WSL2/CUDA).
6. Avisar — desde ahí retomo con `docker compose build` (§7) y la validación
   end-to-end completa.

Todo lo que **no depende de Docker** ya se verificó/dejó listo (ver checklist
arriba). El resto de esta guía (§§1-9) sigue siendo el plan de referencia
para cuando el bloqueo de §0 esté resuelto.

## 1. Resumen ejecutivo

La plataforma son **18 contenedores** orquestados por `docker-compose.yml`
(1053 líneas). De eso, **lo que está en git es solo el código fuente y la
receta** (`docker-compose.yml`, `Dockerfile`s, `db_scripts/01-29`). Todo lo
demás — secretos, modelos biométricos, SDK comercial, certificados TLS, datos
de la base — vive **fuera de git** (`.gitignore`) y solo existe físicamente en
la laptop actual. Si esa laptop se apaga/formatea antes de copiar esas
carpetas, esos datos **no son recuperables desde el repositorio**.

Hallazgo crítico encontrado durante el análisis: **la carpeta
`biometric-models/deepface` y `biometric-models/deepface_silentface` no
existen en esta máquina**, aunque `BEEMETRY_BIOMETRIC_PROVIDER` por defecto
apunta a `deepface_silentface` y lo marca `REQUIRED=true`. Hay que confirmar
si la biometría facial está realmente operativa hoy antes de asumir que "ya
funciona" y replicarlo tal cual en la laptop nueva (sección 8).

## 2. Inventario de servicios (`docker-compose.yml`)

| Servicio | Rol | Imagen / build | Persistencia | Notas |
|---|---|---|---|---|
| `redpanda` | Broker Kafka-compatible (ingesta telemetría) | `redpandadata/redpanda` | vol. `redpanda_data` | |
| `redpanda_init` | Crea topic `telemetry` (una vez) | idem | — | job, no persiste |
| `mailpit` | SMTP dev + bandeja web `:8025` | `axllent/mailpit` | — | solo dev; en prod se reemplaza por SMTP real |
| `mqtt` | Broker MQTT (Mosquitto) `:1883` | `eclipse-mosquitto:2` | — | user/pass generados desde `.env` al arrancar |
| `db` | TimescaleDB (Postgres 15) primario | `timescale/timescaledb` | vol. `db_data` | tuning para ~10K sensores; ver §5 |
| `db_replica` | Réplica de lectura (streaming) | idem | vol. `db_replica_data` | se auto-provisiona con `pg_basebackup` del primario |
| `pgbouncer` | Pool de conexiones delante de `db` | `edoburu/pgbouncer` | — | |
| `minio` | Object storage S3 (archivado frío) | `minio/minio` | vol. `minio_data` | puertos 9000/9001 solo `127.0.0.1` |
| `minio_init` | Crea bucket `beemetry-archive` | `minio/mc` | — | job |
| `formula_db` | Postgres del motor de fórmulas | `postgres:15` | vol. `formula_db_data` | init scripts en `formula_engine/*.sql` |
| `formula_engine` | Motor de fórmulas (editor embebido `/formula`) | build `./formula_engine` | — | sin puerto al host, proxificado por nginx |
| `web` (`beemetry-api`) | **Backend C++** (API + mining gateway TLS) | build `./backend` | usa `./data`, `./certs`, `./dermalog-sdk`, `./biometric-models`, `./IMAGENES` (bind mounts) | puertos `127.0.0.1:8082` y `8443` público |
| `tileserver` | Sirve MBTiles | `ghcr.io/consbio/mbtileserver` | bind `./data:/tilesets:ro` | `:8000` |
| `ai_engine` (`beemetry-ai-vision`) | Biometría facial (SeetaFace6 + DeepFace + InsightFace) | build `./ai_engine/Dockerfile.ai` | vol. `insightface_models` + binds de modelos | build **compila SeetaFace6 desde fuente**; GPU opcional |
| `ollama` (`beemetry-llm`) | LLM local (reescritura de texto / chatbot) | `ollama/ollama` | vol. `ollama_data` | descarga `gemma2:2b` + `qwen2.5:7b` al primer arranque (~requiere internet) |
| `frontend` (`beemetry-web`) | SPA + nginx (proxy inverso) | build `./frontend` | — | `:5173` |
| `pdf_export` | Chromium headless (export PDF/PPTX/MP4) | build `./pdf-export-service` | comparte `./data` | |
| `languagetool` | Corrector ortográfico self-hosted | `erikvl87/languagetool` | — | |

Volúmenes Docker nombrados (datos que Docker gestiona internamente, **no son
archivos sueltos** — hay que exportarlos/copiarlos como volumen, ver §5):
`redpanda_data`, `db_data`, `db_replica_data`, `minio_data`,
`formula_db_data`, `insightface_models`, `ollama_data`.

También existen `docker-compose.prod.yml` (overlay para imágenes ya
publicadas en un registry, no build local) y `docker-compose.scale.yml`
(referencia con Traefik/TLS público + Prometheus/Grafana/Loki — no es el
target de esta migración, pero sirve de ejemplo si más adelante se expone la
laptop nueva a internet).

## 3. Qué copiar manualmente (NO está en git)

Todo lo siguiente está en `.gitignore` — un `git clone` en la laptop nueva
**no trae nada de esto**. Es la parte que realmente hay que "subir a los
Dockers":

| Ruta | Tamaño aprox. | Por qué no está en git | Acción |
|---|---|---|---|
| `.env` | 4.7 KB | Contiene contraseñas/JWT/claves reales | **Copiar el archivo real** (no regenerar, ver §4) |
| `certs/server.key`, `certs/server.crt` | ~5 KB | Clave privada TLS del mining gateway (`:8443`) | Copiar, o regenerar con `scripts/gen-mining-gateway-cert.sh` si los sensores externos toleran un cert nuevo |
| `dermalog-sdk/` | **2.3 GB** | SDK comercial licenciado (WIBU), binarios de terceros | Copiar carpeta completa, **o** volver a descargar de support.dermalog.com con la cuenta de licencia — confirmar si la licencia está atada a esta laptop |
| `biometric-models/seetaface6/` | 302 MB | Pesos de modelo, no versionados | Copiar carpeta |
| `biometric-models/deepface/`, `biometric-models/deepface_silentface/` | — | **No existen ni en esta laptop** (ver §8) | Generar/descargar antes del primer arranque en la laptop nueva, siguiendo `docs/integration/DEEPFACE_SILENTFACE_LOCAL_DOCKER.md` |
| `ai_engine/models/glasses_classifier.onnx` (+ `_meta.json`) | 8.5 MB | Modelo entrenado localmente, el build de `ai_engine` **falla sin este archivo** | Copiar |
| `data/` | 2.4 GB | Datos operativos (tiles, ECW de prueba, auth, demo) | Ver desglose abajo — no todo es necesario |
| `RP/` | — | Scripts con credenciales de TimeTelemetry/Odoo en texto plano | Copiar solo si se sigue usando esa integración; regenerar credenciales si se puede |
| `ai_engine_probe_logs/` | — | Logs de depuración | No crítico, se puede omitir |

Desglose de `./data` (2.4 GB) — decidir qué realmente hace falta:
- `data/incoming` (2.0 GB): en su mayoría **archivos de prueba** de la
  conversión ECW→MBTiles (`smoke_test*`, `warp_test2*`, `raura_mbtiles3_*`) —
  no parece dato de producción real, candidato a **no copiar**.
- `data/tiles` (94 MB), `data/auth` (12 MB), `data/Image` (8.9 MB),
  `data/demo` (2 MB), `data/map_official_polygons.geojson`: sí parecen
  operativos (tiles publicados, datos de auth/biometría, GeoJSON de zonas
  oficiales) — copiar.
- `data/glasses_dataset`: excluido por `.gitignore` a nivel de imágenes
  sueltas; solo relevante si se va a re-entrenar el clasificador de lentes.

`IMAGENES/` (2.6 MB, logos/galería por empresa) **sí está en git** — no hace
falta copiarla aparte.

## 4. Secretos (`.env`) — checklist

`.env.example` documenta 25 variables. Las que tienen `${VAR:?...}` en
`docker-compose.yml` son **obligatorias** — el `docker compose up` falla
explícito si faltan (protección agregada 2026-07-10, ver `RUNBOOK.md` §8):

**Obligatorias:**
`BEEMETRY_DB_PASSWORD`, `BEEMETRY_MINIO_ROOT_USER`,
`BEEMETRY_MINIO_ROOT_PASSWORD`, `BEEMETRY_FORMULA_DB_PASSWORD`,
`BEEMETRY_FORMULA_AUTH_TOKEN`, `BEEMETRY_JWT_SECRET`,
`BEEMETRY_MQTT_USERNAME`, `BEEMETRY_MQTT_PASSWORD`.

**Obligatorias en la práctica (sin ellas, features clave quedan cerradas por
fail-closed, auditoría 2026-08-02):** `BEEMETRY_REPORT_EXPORT_KEY`,
`PDF_OWNER_PASSWORD_SECRET`.

**Importante — NO regenerar estos tres al migrar**, o se pierde continuidad
con lo ya generado en la laptop vieja:
- `BEEMETRY_JWT_SECRET`: cambiarlo invalida todas las sesiones activas (no
  grave, la gente re-loguea).
- `BEEMETRY_REPORT_EXPORT_KEY`: cambiarlo vuelve **ilegibles** los `.mreport`
  ya exportados con la clave anterior.
- `PDF_OWNER_PASSWORD_SECRET`: cambiarlo afecta la contraseña de propietario
  de PDFs ya exportados.

Por eso lo correcto es **copiar el `.env` real tal cual**, no llenar
`.env.example` con valores nuevos — salvo que la migración sea intencional
para "empezar de cero" (nueva base de datos, sin datos históricos).

**Opcionales** (con default seguro si se dejan vacías):
`BEEMETRY_DASHBOARD_RO_PASSWORD`, `BEEMETRY_TAVILY_API_KEY`,
`BEEMETRY_WHATSAPP_*` (el token de WhatsApp ya está documentado como
caduco en `RUNBOOK.md` §8-bis — no asumir que "copiarlo" lo deja
funcionando), `BEEMETRY_RP_WEBHOOK_KEY`, `BEEMETRY_OLLAMA_MODEL`.

**Escotillas de desarrollo** (`BEEMETRY_ALLOW_DEV_SECRETS`,
`PDF_ALLOW_DEV_SECRETS`, `BEEMETRY_API_AUTH_OPTIONAL`): deben quedar
**vacías** siempre, según la propia auditoría del repo.

## 5. Migración de la base de datos — estrategia recomendada

Este es el punto más delicado. `docker-entrypoint-initdb.d` **solo corre en
un volumen `db_data` vacío** (primer arranque), y monta únicamente
`db_scripts/01` a `29` + `64_telemetry_ingest_optimization.sql` +
`67_telemetry_25k_hardening.sql` — `docker-compose.yml` fue actualizado el
2026-08-20 al resolver una colisión real de numeración (dos archivos
distintos reclamaban `29` y dos reclamaban `56`; ver
`docs/decisions/README.md`): el ex-`29_telemetry_ingest_optimization.sql`
pasó a `64` y el ex-`56_telemetry_25k_hardening.sql` pasó a `67`, ambos con
su línea de montaje corregida al nuevo nombre. Los scripts `15` y `30` a
`63` (más `65` y `66`, ~30 archivos, incluyendo cosas no triviales como
Argon2id, hash-chain de auditoría, RBAC granular, CRUD de empresas) están
pensados para aplicarse **manualmente y en orden histórico** sobre una base
que ya existía — replayarlos a mano en una base nueva es frágil y no es lo
que hizo el equipo originalmente.

**Recomendación: no reconstruir el esquema desde cero.** En vez de eso:

1. En la laptop vieja, con el stack corriendo:
   ```bash
   docker compose exec -T db pg_dump -U sensors -Fc sensors_db > sensors_db.dump
   docker compose exec -T formula_db pg_dump -U formula -Fc formula > formula_db.dump
   ```
   (`scripts/backup_db.sh` ya hace esto con rotación — revisar si hay un
   backup reciente antes de correr uno manual.)
2. Copiar ambos `.dump` a la laptop nueva.
3. Levantar solo `db`/`formula_db` en la laptop nueva (volumen `db_data`
   vacío, initdb corre igual — no hace daño, las tablas del dump las
   pisa el restore).
4. Restaurar:
   ```bash
   docker compose exec -T db pg_restore -U sensors -d sensors_db --clean --if-exists < sensors_db.dump
   docker compose exec -T formula_db pg_restore -U formula -d formula --clean --if-exists < formula_db.dump
   ```
5. Verificar con la consulta de `RUNBOOK.md`:
   ```bash
   docker compose exec db psql -U sensors -d sensors_db -c "SELECT * FROM auth_password_algo_status;"
   ```

Alternativa más simple si el volumen Docker se puede copiar tal cual (mismo
SO/arquitectura, Docker Desktop en ambas laptops): exportar el volumen con
`docker run --rm -v informecliente_db_data:/from -v /ruta/backup:/to alpine tar czf /to/db_data.tar.gz -C /from .`
y restaurarlo igual en destino antes del primer `up`. `pg_dump`/`pg_restore`
es más portable y es el método que ya tiene script de soporte en el repo.

**Rol `dashboard_ro`** (usado por la réplica para el SSE de KPIs) no vive en
ningún `db_scripts/*.sql` — se crea con `scripts/provision-dashboard-ro.sh`.
Ejecutarlo una vez en la laptop nueva después del restore.

## 6. Requisitos de la laptop nueva

Los `deploy.resources.limits` del compose y los comentarios en el propio
archivo dan una pista directa del tamaño de host que se usó para calibrar
esto — está pensado para un **host de ~20 núcleos / ~15-16 GB de RAM
dedicados solo a Docker**:

| Servicio | CPU límite | RAM límite |
|---|---|---|
| `web` (backend) | 8 | 6144M |
| `db` | 6 | 8192M |
| `db_replica` | 4 | 4096M |
| `ollama` | 6 | 12288M |
| `ai_engine` | 4 | 6144M |
| `redpanda` | 4 | 3072M |
| resto (pgbouncer, tileserver, formula, pdf_export, languagetool, minio, mqtt, mailpit) | ~5 combinado | ~5 GB combinado |

Sumando límites (no reservas): ronda **~35+ CPU / ~45+ GB** si todo pica
techo simultáneamente — Docker no exige tener eso físico (son *límites*, no
reservas), pero si la laptop nueva tiene bastante menos que los ~20C/16G de
referencia, hay que **bajar estos números antes de levantar el stack**
(sobre todo `ollama` y `db`), o esperar swapping/OOM-kill.

Otros requisitos:
- Docker Desktop con backend **Linux containers** (WSL2 en Windows) — todas
  las imágenes son `linux/amd64`.
- Bloque `deploy.resources.reservations.devices` (GPU) en `ai_engine`: si la
  laptop nueva no tiene GPU NVIDIA + `nvidia-container-toolkit`, **hay que
  quitar ese bloque completo** del compose o `docker compose up` lo rechaza
  directamente (no degrada solo, falla el `up`).
- Espacio en disco: contar ~2.3 GB (Dermalog) + ~300 MB (biometric-models) +
  ~2.4 GB (`data/`, evaluar recorte de `incoming`) + tamaño de los dumps de
  BD + las imágenes Docker construidas (el build de `web` compila OpenCV vía
  vcpkg y el de `ai_engine` compila SeetaFace6 desde fuente — cada imagen
  final puede rondar varios GB, sumado a las capas intermedias de build).
- **Internet en el primer build**: `backend` descarga onnxruntime, open62541
  y un modelo ONNX de GitHub raw en build-time; `ai_engine` clona y compila
  SeetaFace6 desde GitHub; `ollama` hace `pull` de `gemma2:2b` y `qwen2.5:7b`
  la primera vez que arranca. Sin internet esos tres pasos fallan.

## 7. Procedimiento paso a paso

1. **Instalar en la laptop nueva:** Docker Desktop (Linux containers/WSL2),
   Git.
2. **Traer el código:** `git clone` del repositorio (o copiar el working
   tree si hay cambios sin commitear — ver aviso en `RUNBOOK.md` §7 sobre
   trabajo pendiente de commitear).
3. **Copiar manualmente** todo lo listado en §3 a las mismas rutas relativas
   dentro del repo (`.env`, `certs/`, `dermalog-sdk/`, `biometric-models/`,
   `ai_engine/models/*.onnx`, `data/` recortado, `RP/` si aplica).
4. **Resolver el gap de DeepFace/SilentFace** (§8) antes de asumir que la
   biometría va a funcionar igual que "antes".
5. Si la laptop nueva no tiene GPU NVIDIA: editar `ai_engine.deploy.resources.reservations.devices`
   en `docker-compose.yml` (quitar el bloque).
6. Si la laptop nueva tiene menos CPU/RAM que la referencia de §6: ajustar
   los `deploy.resources.limits` de `db`, `ollama`, `web`, `ai_engine`.
7. **Build:**
   ```bash
   docker compose build
   ```
   (primer build largo — vcpkg/OpenCV y SeetaFace6 compilan desde fuente).
8. **Base de datos:** levantar `db` y `formula_db`, restaurar los dumps
   (§5), provisionar `dashboard_ro`, **antes** de levantar el resto.
9. **Levantar todo:**
   ```bash
   docker compose up -d
   ```
   El propio compose ya define el orden de dependencias vía `depends_on` +
   healthchecks (Kafka → mailpit/mqtt → db/pgbouncer → ai_engine/languagetool
   → web → tileserver/formula_engine → frontend/pdf_export).
10. **Verificar salud:** `docker compose ps` — todo `healthy`.
11. **Smoke test** — usar el checklist de `RUNBOOK.md` §5 (login, crear
    informe, exportar PDF, verificar `platform_audit_log`).

## 8. Riesgos y decisiones pendientes detectadas en el análisis

- **Biometría DeepFace/SilentFace confirmada como NO operativa hoy en esta
  laptop.** Se verificó el `.env` real: no sobreescribe
  `BEEMETRY_BIOMETRIC_PROVIDER` ni `BEEMETRY_DEEPFACE_SILENTFACE_REQUIRED`,
  así que corre con los defaults del compose — proveedor
  `deepface_silentface`, `REQUIRED=true` — y las carpetas de pesos
  (`biometric-models/deepface/`, `biometric-models/deepface_silentface/`)
  **no existen en el disco**. Esto es un gap ya presente en esta máquina, no
  algo que la migración vaya a introducir — pero replicar la laptop "tal
  cual" replica también este gap. Antes de dar el login biométrico por
  funcional en la laptop nueva, seguir
  `docs/integration/DEEPFACE_SILENTFACE_LOCAL_DOCKER.md` §"Preparar los
  modelos" para descargar y verificar (SHA-256) los pesos de Silent-Face y
  DeepFace, o cambiar explícitamente `BEEMETRY_BIOMETRIC_PROVIDER=seetaface6`
  en el `.env` (esos pesos sí están presentes, 302 MB) mientras se resuelve.
- **Licencia Dermalog (WIBU).** El propio `.gitignore` la describe como
  "binarios licenciados WIBU" que "cada máquina que lo necesite debe
  descargar... con su propia cuenta". Confirmar con Dermalog si la licencia
  es reutilizable en la laptop nueva o si hace falta reactivar/re-emitir.
- **Secretos sin backup fuera de esta laptop.** `.env`, `certs/*.key`, y las
  claves de cifrado (`BEEMETRY_REPORT_EXPORT_KEY`,
  `PDF_OWNER_PASSWORD_SECRET`) no están en git a propósito. Si esta laptop
  se pierde antes de copiarlos, los `.mreport`/PDF ya exportados con esas
  claves quedan indescifrables permanentemente.
- **Certificado del mining gateway (`:8443`).** Si hay sensores físicos
  externos ya configurados para confiar en el certificado actual (pinning),
  regenerarlo en la laptop nueva los deja sin poder conectar — mismo
  problema documentado en `RUNBOOK.md` §8-bis para la rotación en VPS.
- **Token de WhatsApp ya documentado como caduco** (`RUNBOOK.md` §8-bis) —
  copiarlo no lo deja funcional; hace falta un token de System User nuevo.
- **`docker-compose.scale.yml`** es una referencia de escalamiento
  (Traefik/TLS público + Prometheus/Grafana/Loki) — no se usó en este
  análisis porque no es el compose activo (`docker-compose.yml`), pero si la
  laptop nueva va a exponerse a internet, revisar ese archivo para HTTPS.
- **Trabajo sin commitear.** `RUNBOOK.md` §7 ya advertía que había cambios de
  sesión sin commitear en git — confirmar `git status` en la laptop vieja
  antes de darla de baja, para no perder código.

## 9. Verificación post-instalación (resumen de `RUNBOOK.md` §5)

- `docker compose ps` → todos los servicios con healthcheck en `healthy`.
- `GET /api/auth/companies` → 200 con lista de empresas (confirma que el
  restore de BD trajo datos reales).
- Login real → token válido.
- Crear informe → transición de workflow → aparece en `platform_audit_log`
  con hash correcto (confirma integridad de auditoría tras el restore).
- `GET /api/reports/{id}/export/pdf` → 200, `Content-Type: application/pdf`.
- `fn_audit_log_verify_chain()` → 0 filas rotas.
- `docker compose exec ai_engine curl -s http://localhost:5000/health` →
  revisar específicamente el bloque `deepface_silentface` (ver §8).
