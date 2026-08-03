# Descarga el modelo Ollama usado por POST /api/text/rewrite (variable OLLAMA_MODEL, default gemma2:2b).
# tinyllama (default anterior) alucinaba contenido sin relación con el texto
# de entrada -- verificado en vivo 2026-07-22, ver ADR pendiente.
# Uso: desde la raíz del repo: .\scripts\ensure-ollama-model.ps1
$ErrorActionPreference = "Stop"
$model = if ($env:OLLAMA_MODEL) { $env:OLLAMA_MODEL } else { "gemma2:2b" }
Write-Host "Pulling Ollama model: $model ..."
docker compose exec -T ollama ollama pull $model
Write-Host "Done."
