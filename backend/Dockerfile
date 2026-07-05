FROM ubuntu:24.04 AS builder
ARG DEBIAN_FRONTEND=noninteractive
ARG ONNXRUNTIME_VERSION=1.19.2

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    pkg-config \
    libboost-all-dev \
    libopencv-dev \
    libpq-dev \
    librdkafka-dev \
    gdal-bin \
    ca-certificates \
    bash \
    python3 \
    python3-opencv \
    python3-numpy \
    binutils \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN wget -q -O /tmp/onnxruntime.tgz \
      "https://github.com/microsoft/onnxruntime/releases/download/v${ONNXRUNTIME_VERSION}/onnxruntime-linux-x64-${ONNXRUNTIME_VERSION}.tgz" \
    && tar -xzf /tmp/onnxruntime.tgz -C /opt \
    && mv "/opt/onnxruntime-linux-x64-${ONNXRUNTIME_VERSION}" /opt/onnxruntime \
    && rm -f /tmp/onnxruntime.tgz

RUN mkdir -p /opt/cartoon-models \
    && wget -q -O /opt/cartoon-models/anime-gan-v2.onnx \
      "https://raw.githubusercontent.com/josephrocca/anime-gan-v2-web/main/anime-gan-v2.onnx"

WORKDIR /app
COPY . /app
RUN rm -rf /app/build \
    && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
        -DONNXRUNTIME_ROOT=/opt/onnxruntime \
    && cmake --build build --config Release -j$(nproc) \
    && (find build -type f -executable -exec strip --strip-all {} + || true)

# Runtime image must match builder distro/version so that
# Boost and other shared libraries are compatible with the
# compiled binary (Boost 1.83 on Ubuntu 24.04).
FROM ubuntu:24.04 AS runtime
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       wget \
       curl \
       ffmpeg \
       python3 \
       python3-opencv \
       python3-numpy \
       gdal-bin \
       libstdc++6 \
       libgcc-s1 \
       libgomp1 \
       libgstreamer1.0-0 \
       libgstreamer-plugins-base1.0-0 \
       libpq5 \
       librdkafka++1 \
       librdkafka1 \
       libboost-all-dev \
       libopencv-dev \
       opencv-data \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/build /app/build
COPY --from=builder /app/scripts/surveillance_camera_snapshot.py /app/scripts/surveillance_camera_snapshot.py
COPY --from=builder /app/entrypoint.sh /app/entrypoint.sh
COPY --from=builder /opt/onnxruntime/lib/ /usr/local/lib/
COPY --from=builder /opt/cartoon-models /opt/cartoon-models
RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /data /opt/dermalog || true \
    && ldconfig
ENV CARTOON_ONNX_MODEL=/opt/cartoon-models/anime-gan-v2.onnx
VOLUME ["/data"]

EXPOSE 8081
# ONNX Runtime (.so en /usr/local/lib) + SDK Dermalog opcional
ENV LD_LIBRARY_PATH=/usr/local/lib:/opt/dermalog/lib64:/opt/dermalog/lib:${LD_LIBRARY_PATH}
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -q --spider http://localhost:8081/health || exit 1
CMD ["/app/entrypoint.sh"]
