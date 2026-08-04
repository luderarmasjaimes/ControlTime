#!/usr/bin/env bash
set -euo pipefail

echo "Building images locally..."
docker build -t informe-backend:local -f backend/Dockerfile backend
docker build -t informe-frontend:local -f frontend/Dockerfile frontend

echo "Starting stack with docker-compose..."
docker-compose pull || true
docker-compose up -d --build

echo "Stack started. Use 'docker-compose ps' to check services."
