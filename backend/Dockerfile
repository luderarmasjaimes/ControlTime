FROM ubuntu:24.04 AS builder
ARG DEBIAN_FRONTEND=noninteractive
ARG ONNXRUNTIME_VERSION=1.19.2

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    ninja-build \
    pkg-config \
    libboost-all-dev \
    libpq-dev \
    librdkafka-dev \
    libmosquitto-dev \
    libmodbus-dev \
    gdal-bin \
    ca-certificates \
    bash \
    python3 \
    python3-opencv \
    python3-numpy \
    binutils \
    wget \
    git \
    curl \
    zip \
    unzip \
    nasm \
    && rm -rf /var/lib/apt/lists/*

# OpenCV 4.12.0 via vcpkg (backend/vcpkg.json), en vez del libopencv-dev
# 4.6.0 que trae Ubuntu 24.04 (congelado por la distro, 6 releases atras).
# La imagen de RUNTIME sigue instalando libopencv-dev/opencv-data por apt
# a proposito -- ahi no compilamos nada, solo necesitamos los cascades
# Haar de /usr/share/opencv4/haarcascades que usa el pipeline legacy de
# respaldo (face_analysis.cpp), y ese paquete es independiente de con que
# OpenCV se linkeo el binario.
ARG VCPKG_BASELINE=2f8d9f7d3f041e70643c18954cee799459e7eb75
RUN git clone https://github.com/microsoft/vcpkg.git /opt/vcpkg \
    && cd /opt/vcpkg \
    && git checkout "${VCPKG_BASELINE}" \
    && ./bootstrap-vcpkg.sh -disableMetrics
ENV VCPKG_ROOT=/opt/vcpkg

# Separado para conservar la capa pesada de dependencias nativas en caché.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libargon2-dev catch2 \
    && rm -rf /var/lib/apt/lists/*

RUN wget -q -O /tmp/onnxruntime.tgz \
      "https://github.com/microsoft/onnxruntime/releases/download/v${ONNXRUNTIME_VERSION}/onnxruntime-linux-x64-${ONNXRUNTIME_VERSION}.tgz" \
    && tar -xzf /tmp/onnxruntime.tgz -C /opt \
    && mv "/opt/onnxruntime-linux-x64-${ONNXRUNTIME_VERSION}" /opt/onnxruntime \
    && rm -f /tmp/onnxruntime.tgz

RUN mkdir -p /opt/cartoon-models \
    && wget -q -O /opt/cartoon-models/anime-gan-v2.onnx \
      "https://raw.githubusercontent.com/josephrocca/anime-gan-v2-web/main/anime-gan-v2.onnx"

# ADR-034: open62541 (OPC UA, IEC 62541) — no está empaquetado en Ubuntu 24.04,
# se compila estático desde el tag oficial (mismo patrón que onnxruntime/duckdb:
# dependencia pineada, sin tocar el runtime porque queda linkeada al binario).
ARG OPEN62541_VERSION=1.3.10
ARG BACKEND_BUILD_JOBS=2
RUN wget -q -O /tmp/open62541.tar.gz \
      "https://github.com/open62541/open62541/archive/refs/tags/v${OPEN62541_VERSION}.tar.gz" \
    && tar -xzf /tmp/open62541.tar.gz -C /tmp \
    && cmake -S "/tmp/open62541-${OPEN62541_VERSION}" -B /tmp/open62541-build \
        -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
        -DUA_ENABLE_ENCRYPTION=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
    && cmake --build /tmp/open62541-build -j"${BACKEND_BUILD_JOBS}" \
    && cmake --install /tmp/open62541-build \
    && rm -rf /tmp/open62541*

WORKDIR /app
COPY . /app
RUN rm -rf /app/build \
    && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
        -DONNXRUNTIME_ROOT=/opt/onnxruntime \
        -DCMAKE_TOOLCHAIN_FILE=/opt/vcpkg/scripts/buildsystems/vcpkg.cmake \
        -DVCPKG_OVERLAY_TRIPLETS=/app/vcpkg-triplets \
    && cmake --build build --config Release -j"${BACKEND_BUILD_JOBS}" \
    && ctest --test-dir build --output-on-failure \
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
       unzip \
       ffmpeg \
       python3 \
       python3-opencv \
       python3-numpy \
       gdal-bin \
       postgresql-client \
       libstdc++6 \
       libgcc-s1 \
       libgomp1 \
       libgstreamer1.0-0 \
       libgstreamer-plugins-base1.0-0 \
       libpq5 \
       librdkafka++1 \
       librdkafka1 \
       libmosquitto1 \
       libmodbus5 \
       libboost-all-dev \
       libopencv-dev \
       opencv-data \
    && rm -rf /var/lib/apt/lists/*

# Separado para no invalidar la capa runtime de ~2 GB al incorporar Argon2.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libargon2-1 \
    && rm -rf /var/lib/apt/lists/*

# ADR-009: DuckDB CLI (binario único estático, mismo patrón ya usado para
# onnxruntime arriba) — motor real de exportación a Parquet + subida directa
# a MinIO vía su extensión httpfs (protocolo S3), sin añadir una dependencia
# pesada de Arrow/Parquet al backend C++ (pyarrow tampoco existe como
# paquete apt en Ubuntu 24.04). Ver scripts/archive_telemetry_to_parquet.sh.
ARG DUCKDB_VERSION=1.5.4
RUN wget -q -O /tmp/duckdb.zip \
      "https://github.com/duckdb/duckdb/releases/download/v${DUCKDB_VERSION}/duckdb_cli-linux-amd64.zip" \
    && unzip -q /tmp/duckdb.zip -d /usr/local/bin \
    && chmod +x /usr/local/bin/duckdb \
    && rm -f /tmp/duckdb.zip

WORKDIR /app
COPY --from=builder /app/build /app/build
COPY --from=builder /app/scripts/surveillance_camera_snapshot.py /app/scripts/surveillance_camera_snapshot.py
COPY --from=builder /app/scripts/archive_telemetry_to_parquet.sh /app/scripts/archive_telemetry_to_parquet.sh
COPY --from=builder /app/entrypoint.sh /app/entrypoint.sh
COPY --from=builder /opt/onnxruntime/lib/ /usr/local/lib/
COPY --from=builder /opt/cartoon-models /opt/cartoon-models
RUN chmod +x /app/entrypoint.sh /app/scripts/archive_telemetry_to_parquet.sh \
    && mkdir -p /data /opt/dermalog || true \
    && ldconfig
ENV CARTOON_ONNX_MODEL=/opt/cartoon-models/anime-gan-v2.onnx
VOLUME ["/data"]

EXPOSE 8081
# ONNX Runtime (.so en /usr/local/lib) + SDK Dermalog opcional
ENV LD_LIBRARY_PATH=/usr/local/lib:/opt/dermalog/lib64:/opt/dermalog/lib
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -q --spider http://localhost:8081/health || exit 1
CMD ["/app/entrypoint.sh"]
