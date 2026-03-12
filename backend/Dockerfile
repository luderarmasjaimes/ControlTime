FROM ubuntu:24.04
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
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build --config Release -j2
RUN chmod +x /app/entrypoint.sh

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8081
CMD ["/app/entrypoint.sh"]
