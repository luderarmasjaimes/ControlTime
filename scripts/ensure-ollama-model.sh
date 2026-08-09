#!/usr/bin/env sh
# Descarga el modelo Ollama para /api/text/rewrite (OLLAMA_MODEL, default gemma2:2b).
# tinyllama (default anterior) alucinaba contenido sin relación con el texto
# de entrada -- verificado en vivo 2026-07-22, ver ADR pendiente.
set -e
MODEL="${OLLAMA_MODEL:-gemma2:2b}"
echo "Pulling Ollama model: ${MODEL} ..."
docker compose exec -T ollama ollama pull "${MODEL}"
echo "Done."
