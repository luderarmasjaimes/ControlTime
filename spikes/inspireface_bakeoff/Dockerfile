# Spike aislado (no producción) -- bake-off de InspireFace (Opción C) contra
# el proveedor biométrico actual (DeepFace/Facenet512 + Silent-Face, ADR-105).
# No se integra a ai_engine/ ni a backend/: contenedor separado, solo para
# obtener números reales de precisión de reconocimiento y latencia.
#
# IMPORTANTE (ver README.md de este directorio): los packs de modelos
# gratuitos de InspireFace son "solo uso académico, prohibido uso comercial"
# según su propio README (misma licencia que InsightFace base) -- esto es
# I+D interno para decidir con datos, nunca una ruta a producción sin
# licencia comercial de InsightFace.
#
# Uso: docker build -t inspireface-bakeoff spikes/inspireface_bakeoff
#      docker run --rm -v "$(pwd)/spikes/inspireface_bakeoff/data:/data" inspireface-bakeoff
FROM python:3.10-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bakeoff_lfw.py .

# El script descarga el pack "Pikachu" directo del GitHub Release oficial
# (bypassea el downloader por defecto de isf.launch(), que apunta a
# ModelScope/OSS -- fuera del allowlist de red usado para armar este spike)
# y las imágenes LFW de un mirror en HuggingFace (Apache-2.0, ver README.md)
# hacia /data (volumen), nunca hacia la imagen -- no se redistribuyen pesos
# de licencia académica ni fotografías de terceros dentro de un artefacto
# versionado.
VOLUME ["/data"]

ENTRYPOINT ["python", "bakeoff_lfw.py"]
