# syntax=docker/dockerfile:1.7
FROM python:3.10-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install --timeout 300 --retries 12 -r requirements.txt

COPY . .

# Modelos de PaddleOCR (detección/reconocimiento/layout/tabla, ~300-400MB) se
# descargan en el primer arranque a $OCR_ENGINE_MODEL_DIR -- montado como
# volumen en docker-compose.yml (paddleocr_model_cache) para no repetir la
# descarga en cada recreación del contenedor, mismo criterio que
# diffusion_avatar_cache en avatar_engine.
ENV OCR_ENGINE_MODEL_DIR=/root/.paddleocr

EXPOSE 5003
# start-period generoso: el primer arranque sin caché descarga los modelos
# de PaddleOCR antes de quedar listo (ver _preload en server.py).
HEALTHCHECK --interval=10s --timeout=5s --retries=8 --start-period=180s \
    CMD curl -sf http://localhost:5003/health || exit 1
CMD ["python", "-u", "server.py"]
