#!/usr/bin/env bash
set -euo pipefail

echo "== Preflight checks =="

echo -n "Checking git remote... "
git config --get remote.origin.url >/dev/null 2>&1 && echo "ok" || echo "no remote configured"

echo -n "Checking docker... "
if command -v docker >/dev/null 2>&1; then
  # verify daemon accessible
  if docker version >/dev/null 2>&1; then
    docker --version || true
    echo "ok"
  else
    echo "docker CLI present but daemon not accessible"
    if command -v wsl.exe >/dev/null 2>&1; then
      echo "If using WSL, enable Docker Desktop WSL integration and restart the distro."
      echo "Open Docker Desktop → Settings → Resources → WSL Integration → Enable for your distro."
    else
      echo "Start Docker daemon or Docker Desktop: https://docs.docker.com/get-docker/"
    fi
    exit 1
  fi
else
  echo "missing"
  if command -v wsl.exe >/dev/null 2>&1; then
    echo "Detected WSL. Ensure Docker Desktop WSL integration is enabled and Docker is available in this distro."
    echo "Open Docker Desktop → Settings → Resources → WSL Integration → Enable for your distro."
  else
    echo "Install Docker Engine or Docker Desktop: https://docs.docker.com/get-docker/"
  fi
  exit 1
fi

echo -n "Checking docker compose... "
if docker compose version >/dev/null 2>&1 || command -v docker-compose >/dev/null 2>&1; then
  if docker compose version >/dev/null 2>&1 || docker-compose --version >/dev/null 2>&1; then
    docker compose version 2>/dev/null || docker-compose --version 2>/dev/null || true
    echo "ok"
  else
    echo "docker-compose present but not functional"
    echo "Ensure Docker is running and Docker Desktop integration is enabled."
    exit 1
  fi
else
  echo "missing"
  echo "Install Docker Compose or enable Docker Desktop integration."
  exit 1
fi

echo "Preflight checks passed."
