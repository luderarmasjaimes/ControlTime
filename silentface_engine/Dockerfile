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

EXPOSE 5002
HEALTHCHECK --interval=10s --timeout=5s --retries=8 --start-period=60s \
    CMD curl -sf http://localhost:5002/health || exit 1
CMD ["python", "-u", "server.py"]
