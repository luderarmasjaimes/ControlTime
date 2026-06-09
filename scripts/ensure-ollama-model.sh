#!/usr/bin/env sh
# Descarga el modelo Ollama para /api/text/rewrite (OLLAMA_MODEL, default tinyllama).
set -e
MODEL="${OLLAMA_MODEL:-tinyllama}"
echo "Pulling Ollama model: ${MODEL} ..."
docker compose exec -T ollama ollama pull "${MODEL}"
echo "Done."
