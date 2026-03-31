FROM ubuntu:24.04 AS builder
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    pkg-config \
    libboost-all-dev \
    libopencv-dev \
    libpq-dev \
    gdal-bin \
    ca-certificates \
    bash \
    python3 \
    python3-opencv \
    python3-numpy \
    binutils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -j$(nproc) \
    && find build -type f -executable -exec strip --strip-all {} + || true

# Runtime image must match builder distro/version so that
# Boost and other shared libraries are compatible with the
# compiled binary (Boost 1.83 on Ubuntu 24.04).
FROM ubuntu:24.04 AS runtime
ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       wget \
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
       libboost-all-dev \
       libopencv-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/build /app/build
COPY --from=builder /app/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh \
    && mkdir -p /data /opt/dermalog || true
VOLUME ["/data"]

EXPOSE 8081
ENV LD_LIBRARY_PATH=/opt/dermalog/lib64:/opt/dermalog/lib:$LD_LIBRARY_PATH
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -q --spider http://localhost:8081/health || exit 1
CMD ["/app/entrypoint.sh"]
