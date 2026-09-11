# syntax=docker/dockerfile:1.7
FROM python:3.10-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt requirements-gfpgan.txt .
RUN --mount=type=cache,target=/root/.cache/pip pip install --timeout 300 --retries 12 -r requirements.txt
# --no-build-isolation: basicsr (dependencia de gfpgan) necesita ver el
# torch ya instalado arriba en vez de resolver el suyo propio en un entorno
# de build aislado -- ver requirements-gfpgan.txt.
RUN --mount=type=cache,target=/root/.cache/pip pip install --timeout 300 --retries 12 --no-build-isolation -r requirements-gfpgan.txt

# Parche real (hallazgo 2026-09-10, continuación del pin de
# requirements-gfpgan.txt): el pin ahí NO alcanzó -- facexlib depende de
# `opencv-python` (no headless, sin version fija) y pip, al resolver TODO
# requirements-gfpgan.txt en una sola pasada, instaló esa dependencia
# transitiva DESPUÉS de mi pin explícito (pip no ordena por posición en el
# archivo, ordena por grafo de dependencias) -- confirmado en vivo:
# `pip show` después del build listaba AMBOS paquetes instalados
# (opencv-python 5.0.0.93 Y opencv-python-headless 4.11.0.86), y el import
# real de `cv2` seguía resolviendo al primero (mismo directorio en
# site-packages, gana quien escribió sus archivos último). Un paso aparte,
# DESPUÉS de todo lo anterior, que desinstala el paquete no-headless y
# reinstala el pineado con --force-reinstall dejar el estado final
# determinístico sin importar el orden de resolución de pip.
RUN pip uninstall -y opencv-python \
    && pip install --force-reinstall --no-deps opencv-python-headless==4.11.0.86

# Parche real (hallazgo sesión 2026-09-08, mismo bug ya resuelto en
# avatar_animation_engine/Dockerfile): torchvision>=0.17 eliminó
# `torchvision.transforms.functional_tensor` (fusionado en
# `torchvision.transforms.functional`) -- basicsr==1.4.2 (2022) todavía lo
# importa. Reemplazo mecánico de una línea, mismo criterio documentado ahí.
RUN grep -rl "torchvision.transforms.functional_tensor" /usr/local/lib/python3.10/site-packages/basicsr \
    | xargs -r sed -i 's/torchvision\.transforms\.functional_tensor/torchvision.transforms.functional/g'

COPY . .

# Caché de Hugging Face (SD1.5 + ControlNet-Canny) -- NO horneada en la
# imagen (varios GB), se descarga una sola vez hacia el volumen montado acá
# (docker-compose.yml: diffusion_avatar_cache). Sin ese volumen se
# re-descargaría en cada recreación del contenedor.
ENV HF_HOME=/app/.hf_cache
RUN mkdir -p /app/.hf_cache

# Preload síncrono al arrancar (server.py::_preload) ANTES de aceptar tráfico
# -- ver ADR-141: "precargar modelos antes del readiness". Si falla (sin
# pesos descargables, sin GPU con AVATAR_ENGINE_REQUIRE_GPU=1, etc.), el
# proceso no llega a levantar el puerto y el healthcheck falla desde el
# primer chequeo -- restart: unless-stopped en docker-compose reintenta.
EXPOSE 5001
HEALTHCHECK --interval=10s --timeout=5s --retries=8 --start-period=600s \
    CMD curl -sf http://localhost:5001/health || exit 1
CMD ["python", "-u", "server.py"]
