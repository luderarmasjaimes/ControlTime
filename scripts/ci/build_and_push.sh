#!/usr/bin/env bash
set -euo pipefail

if [ -n "${DOCKERHUB_USERNAME:-}" ] && [ -n "${DOCKERHUB_TOKEN:-}" ]; then
  echo "Using Docker Hub credentials to push images..."
  echo "$DOCKERHUB_TOKEN" | docker login -u "$DOCKERHUB_USERNAME" --password-stdin
  echo "Building backend image..."
  docker build -t "$DOCKERHUB_USERNAME/informe-backend:latest" -f backend/Dockerfile backend
  echo "Building frontend image..."
  docker build -t "$DOCKERHUB_USERNAME/informe-frontend:latest" -f frontend/Dockerfile frontend
  echo "Pushing images to Docker Hub..."
  docker push "$DOCKERHUB_USERNAME/informe-backend:latest"
  docker push "$DOCKERHUB_USERNAME/informe-frontend:latest"
  echo "Done."
  exit 0
fi

# Fallback to GHCR if GitHub credentials are present
if [ -n "${GITHUB_ACTOR:-}" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "Using GitHub Container Registry (GHCR) to push images..."
  echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
  GHCR_REPO="ghcr.io/${GITHUB_ACTOR}"
  echo "Building backend image..."
  docker build -t "$GHCR_REPO/informe-backend:latest" -f backend/Dockerfile backend
  echo "Building frontend image..."
  docker build -t "$GHCR_REPO/informe-frontend:latest" -f frontend/Dockerfile frontend
  echo "Pushing images to GHCR..."
  docker push "$GHCR_REPO/informe-backend:latest"
  docker push "$GHCR_REPO/informe-frontend:latest"
  echo "Done."
  exit 0
fi

echo "No registry credentials found. Set DOCKERHUB_USERNAME/DOCKERHUB_TOKEN for Docker Hub, or GITHUB_ACTOR/GITHUB_TOKEN for GHCR." 
exit 1
