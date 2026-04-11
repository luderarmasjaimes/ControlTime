C++ backend scaffold (minimal)

This directory contains a minimal scaffold for the C++ backend using Boost.Beast for HTTP and placeholders for OpenCV and libpqxx integration.

How to build locally (inside folder):

```bash
mkdir build && cd build
cmake ..
make -j4
./formula_server
```

Docker build (uses system packages for Boost/OpenCV/libpqxx):

```bash
docker build -t formula_cpp_backend:latest .
```

Notes:
- This is a starting point. Next steps: implement REST routes to match the Python backend, add WebSocket support, integrate libpqxx for Postgres, and use OpenCV to render diagrams server-side.
