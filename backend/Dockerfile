FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    ninja-build \
    pkg-config \
    libboost-all-dev \
    libopencv-dev \
    libgdal-dev \
    gdal-bin \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app

RUN cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -j

EXPOSE 8081

ENV MAPAS_DATA_ROOT=/data
ENV MAPAS_BIND_ADDRESS=0.0.0.0
ENV MAPAS_PORT=8081
ENV GDAL_DRIVER_PATH=/opt/ecw

CMD ["/app/build/mapas_backend"]
