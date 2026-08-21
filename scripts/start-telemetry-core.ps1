$ErrorActionPreference = 'Stop'
$env:BEEMETRY_RP_SYNC_ENABLED = 'false'

# Perfil operativo mínimo para telemetría 25k/s. Evita que tareas de IA,
# render, réplica y frontend compitan por CPU/RAM durante ingesta o pruebas.
$optionalServices = @(
    'formula_db', 'formula_engine', 'tileserver', 'ai_engine',
    'languagetool', 'minio', 'frontend', 'mailpit', 'pdf_export',
    'db_replica', 'ollama'
)

docker compose stop @optionalServices
docker compose up -d --no-deps db redpanda mqtt

function Wait-Healthy([string]$container, [int]$timeoutSeconds = 180) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    do {
        $status = docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $container 2>$null
        if ($status -eq 'healthy' -or $status -eq 'running') { return }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Timeout esperando que $container quede saludable (estado: $status)"
}

Wait-Healthy 'beemetry-db'
Wait-Healthy 'beemetry-redpanda'
Wait-Healthy 'beemetry-mqtt'

docker compose up -d --no-deps pgbouncer
Wait-Healthy 'beemetry-pgbouncer'

docker compose up -d --no-deps web
Wait-Healthy 'beemetry-api'

docker compose ps
