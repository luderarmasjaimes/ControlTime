# Imagen de PRUEBA aislada -- valida la Opción A del ADR-141 (subir
# TensorFlow a una linea que ya pida cuDNN 9.x + instalación dividida para
# esquivar el choque de pins exactos que pip ve, dejando que torch provea
# cudnn/nccl a los dos frameworks). NO es el Dockerfile.ai productivo, no lo
# reemplaza ni lo toca.
FROM python:3.10-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1-mesa-glx libglib2.0-0 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-base.txt .
RUN pip install --timeout 300 --retries 12 -r requirements-base.txt

# Paso separado, --no-deps, SOLO los paquetes CUDA de TF que no chocan por
# nombre con torch (se excluyen a propósito nvidia-cudnn-cu12 y
# nvidia-nccl-cu12 -- los provee torch, versión más nueva del mismo major).
RUN pip install --no-deps \
    nvidia-cublas-cu12==12.5.3.2 \
    nvidia-cuda-cupti-cu12==12.5.82 \
    nvidia-cuda-nvcc-cu12==12.5.82 \
    nvidia-cuda-nvrtc-cu12==12.5.82 \
    nvidia-cuda-runtime-cu12==12.5.82 \
    nvidia-cufft-cu12==11.2.3.61 \
    nvidia-curand-cu12==10.3.6.82 \
    nvidia-cusolver-cu12==11.6.3.83 \
    nvidia-cusparse-cu12==12.5.1.3 \
    nvidia-nvjitlink-cu12==12.5.82

RUN pip install --extra-index-url https://download.pytorch.org/whl/cu128 torch==2.11.0+cu128

# Mismo LD_LIBRARY_PATH que Dockerfile.ai (necesario para que cuDNN
# encuentre libnvrtc.so vía dlopen en GPUs nuevas -- ver comentario
# original en Dockerfile.ai, confirmado en runtime con esta misma GPU).
ENV LD_LIBRARY_PATH=/usr/local/lib/python3.10/site-packages/nvidia/cuda_runtime/lib:/usr/local/lib/python3.10/site-packages/nvidia/cuda_cupti/lib:/usr/local/lib/python3.10/site-packages/nvidia/nvjitlink/lib:/usr/local/lib/python3.10/site-packages/nvidia/cudnn/lib:/usr/local/lib/python3.10/site-packages/nvidia/cusolver/lib:/usr/local/lib/python3.10/site-packages/nvidia/cuda_nvrtc/lib:/usr/local/lib/python3.10/site-packages/nvidia/curand/lib:/usr/local/lib/python3.10/site-packages/nvidia/nccl/lib:/usr/local/lib/python3.10/site-packages/nvidia/cusparse/lib:/usr/local/lib/python3.10/site-packages/nvidia/nvtx/lib:/usr/local/lib/python3.10/site-packages/nvidia/cuda_nvcc/lib:/usr/local/lib/python3.10/site-packages/nvidia/cufft/lib:/usr/local/lib/python3.10/site-packages/nvidia/cublas/lib

COPY runtime_test.py .
CMD ["python", "-u", "runtime_test.py"]
