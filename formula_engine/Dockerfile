FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ARG BOOST_VERSION=1.91.0
ARG BOOST_VERSION_UNDERSCORE=1_91_0
ARG BOOST_SHA256=5734305f40a76c30f951c9abd409a45a2a19fb546efe4162119250bbe4d3a463
ARG FORMULA_BUILD_JOBS=2
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git pkg-config wget \
    libopencv-dev libpq-dev libpqxx-dev curl ca-certificates \
    nlohmann-json3-dev \
  && rm -rf /var/lib/apt/lists/*

RUN wget -q -O /tmp/boost.tar.gz \
      "https://archives.boost.io/release/${BOOST_VERSION}/source/boost_${BOOST_VERSION_UNDERSCORE}.tar.gz" \
    && echo "${BOOST_SHA256}  /tmp/boost.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/boost.tar.gz -C /tmp \
    && cd "/tmp/boost_${BOOST_VERSION_UNDERSCORE}" \
    && ./bootstrap.sh --prefix=/opt/boost --with-libraries=thread \
    && ./b2 -j"${FORMULA_BUILD_JOBS}" --layout=system variant=release link=shared \
         threading=multi cxxstd=17 install \
    && cp -a /opt/boost/lib/. /usr/local/lib/ \
    && ldconfig \
    && rm -rf /tmp/boost.tar.gz "/tmp/boost_${BOOST_VERSION_UNDERSCORE}"

WORKDIR /app
COPY . /app
RUN cmake -S . -B build -DCMAKE_BUILD_TYPE=Release \
      -DBOOST_ROOT=/opt/boost -DBoost_ROOT=/opt/boost \
      -DBoost_NO_SYSTEM_PATHS=ON -DCMAKE_PREFIX_PATH=/opt/boost \
    && cmake --build build -j"${FORMULA_BUILD_JOBS}"

EXPOSE 8020
CMD ["/app/build/formula_server"]
