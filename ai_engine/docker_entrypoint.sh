#!/bin/sh
# Primera ejecución (o volumen vacío): descarga modelos MediaPipe desde CDN de Google.
# Luego arranca el motor Flask. Debe guardarse con finales de línea LF (Unix).
set -eu
cd /app
echo "[entrypoint] InformeCliente ai_engine — modelos MediaPipe" >&2
python -u /app/mediapipe_models_fetch.py
exec python -u /app/eye_analyzer.py
