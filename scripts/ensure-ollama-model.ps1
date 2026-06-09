# Descarga el modelo Ollama usado por POST /api/text/rewrite (variable OLLAMA_MODEL, default tinyllama).
# Uso: desde la raíz del repo: .\scripts\ensure-ollama-model.ps1
$ErrorActionPreference = "Stop"
$model = if ($env:OLLAMA_MODEL) { $env:OLLAMA_MODEL } else { "tinyllama" }
Write-Host "Pulling Ollama model: $model ..."
docker compose exec -T ollama ollama pull $model
Write-Host "Done."
