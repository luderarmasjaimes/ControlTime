# syntax=docker/dockerfile:1.7
FROM python:3.10-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx \
    libglib2.0-0 \
    ffmpeg \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-torch.txt requirements.txt ./
RUN --mount=type=cache,target=/root/.cache/pip pip install --timeout 300 --retries 12 -r requirements-torch.txt
# --no-build-isolation a propósito: basicsr (GFPGAN) resuelve sus
# "setup_requires" contra el entorno real de build, no un sandbox PEP 517
# aislado -- así ve el torch ya instalado arriba en vez de intentar bajar el
# suyo propio (causa real de un fallo de build, ver requirements-torch.txt).
RUN --mount=type=cache,target=/root/.cache/pip pip install --timeout 300 --retries 12 --no-build-isolation -r requirements.txt

# Parche real (hallazgo del segundo build, 2026-09-04), no cosmético:
# torchvision>=0.17 eliminó `torchvision.transforms.functional_tensor` (su
# API pública se fusionó en `torchvision.transforms.functional`) -- rotura
# de compatibilidad ampliamente documentada entre basicsr==1.4.2 (2022) y
# cualquier torchvision moderno, afecta a GFPGAN/Real-ESRGAN en general, no
# es específico de esta imagen. basicsr no tiene un release que lo corrija
# para esta versión pineada; el remedio estándar de la comunidad es este
# parche de una línea sobre el paquete ya instalado.
RUN grep -rl "torchvision.transforms.functional_tensor" /usr/local/lib/python3.10/site-packages/basicsr \
    | xargs -r sed -i 's/torchvision\.transforms\.functional_tensor/torchvision.transforms.functional/g'

# SadTalker (Fase A, ADR-150) vendorizado por commit pineado -- no reescrito
# a mano. El proyecto está congelado desde 2023-10-10 (último commit real),
# así que fijar un SHA exacto es estable y reproducible, no un compromiso
# temporal como los "revision=" flotantes de HF Hub que sí cambian con el
# tiempo si alguien empuja al mismo repo.
ARG SADTALKER_COMMIT=cd4c0465ae0b54a6f85af57f5c65fec9fe23e7f8
RUN git clone https://github.com/OpenTalker/SadTalker.git /opt/sadtalker \
    && cd /opt/sadtalker \
    && git checkout ${SADTALKER_COMMIT}

# Parche real (hallazgo del tercer intento de smoke test, 2026-09-04), mismo
# tipo de bug que ya documentó ADR-097 para InsightFace: SadTalker es código
# de 2023 que todavía usa los alias `np.float`/`np.int`/`np.bool`/`np.object`/
# `np.str`, eliminados por NumPy 1.24+ (tenemos 1.26.4). Reemplazo mecánico y
# seguro por el tipo builtin equivalente -- la propia nota de deprecación de
# NumPy confirma "usar float por sí solo... no modifica ningún comportamiento
# y es seguro". `\b` en los dos lados evita tocar variantes válidas como
# np.float32/np.float64/np.int32/np.bool_ (siguen existiendo, no son alias
# deprecados).
RUN find /opt/sadtalker -name "*.py" -print0 \
    | xargs -0 sed -i -E \
        -e 's/\bnp\.float\b/float/g' \
        -e 's/\bnp\.int\b/int/g' \
        -e 's/\bnp\.bool\b/bool/g' \
        -e 's/\bnp\.object\b/object/g' \
        -e 's/\bnp\.str\b/str/g'

# Parche real (hallazgo del quinto smoke test, 2026-09-04), misma familia que
# el anterior pero un caso que sed de alias no cubre: `POS()` en
# src/face3d/util/preprocess.py devuelve `t` con shape (2,1), asi que `t[0]`
# es un array de un elemento, no un escalar. `np.array([w0, h0, s, t[0], t[1]])`
# construia entonces un array ragged -- NumPy lo toleraba con VisibleDeprecation
# Warning hasta 1.23 y lo rechaza desde 1.24 ("inhomogeneous shape"). Se toma
# el escalar explicito; `s` ya es escalar (norma) y no se toca. El `grep -q`
# posterior es deliberado: si upstream cambiara y la sustitucion no aplicara,
# el build falla ahi en vez de producir una imagen que revienta recien en la
# primera inferencia real (modo de fallo observado en esta misma sesion).
RUN sed -i 's/np\.array(\[w0, h0, s, t\[0\], t\[1\]\])/np.array([w0, h0, s, t[0][0], t[1][0]])/' \
        /opt/sadtalker/src/face3d/util/preprocess.py \
    && grep -q 't\[0\]\[0\], t\[1\]\[0\]' /opt/sadtalker/src/face3d/util/preprocess.py

COPY . .

# Pesos (SadTalker checkpoints + BFM_Fitting + enhancer GFPGAN/facexlib) NO
# horneados en la imagen -- varios GB, se descargan una sola vez hacia el
# volumen montado (docker-compose.yml: avatar_animation_cache), mismo patrón
# que avatar_engine/diffusion_avatar_cache. Ver backends/sadtalker_backend.py
# para las URLs/revisiones exactas.
ENV HF_HOME=/app/.hf_cache
ENV SADTALKER_HOME=/opt/sadtalker
ENV SADTALKER_MODEL_CACHE=/app/.model_cache/sadtalker
RUN mkdir -p /app/.hf_cache /app/.model_cache/sadtalker

# Preload síncrono al arrancar (server.py::_preload), igual criterio que
# avatar_engine (ADR-141: "precargar modelos antes del readiness") -- si
# faltan pesos o GPU, el proceso no llega a abrir el puerto y el healthcheck
# falla desde el primer chequeo (restart: unless-stopped reintenta).
EXPOSE 5003
HEALTHCHECK --interval=15s --timeout=5s --retries=10 --start-period=1200s \
    CMD curl -sf http://localhost:5003/health || exit 1
CMD ["python", "-u", "server.py"]
