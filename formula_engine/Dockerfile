FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git pkg-config \
    libboost-all-dev libopencv-dev libpq-dev libpqxx-dev curl ca-certificates \
    nlohmann-json3-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . /app
RUN mkdir -p build && cd build && cmake .. && make -j$(nproc)

EXPOSE 8020
CMD ["/app/build/formula_server"]
