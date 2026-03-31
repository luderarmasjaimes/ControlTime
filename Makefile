.PHONY: build push up smoke deploy clean

build:
	@echo "Building backend and frontend images locally..."
	docker build -t informe-backend:local -f backend/Dockerfile backend
	docker build -t informe-frontend:local -f frontend/Dockerfile frontend

push:
	@echo "Push images to registry. For GHCR set GITHUB_ACTOR and GITHUB_TOKEN. For Docker Hub set DOCKERHUB_USERNAME and DOCKERHUB_TOKEN."
	./scripts/ci/build_and_push.sh

up:
	@echo "Start stack with docker-compose (development)"
	docker-compose up -d --build

smoke:
	@echo "Run smoke tests against local stack"
	./scripts/ci/smoke_test.sh

deploy:
	@echo "Deploy production compose (pull images then up)"
	@./scripts/ci/auto_set_namespace.sh || true
	docker-compose -f docker-compose.prod.yml pull
	docker-compose -f docker-compose.prod.yml up -d

clean:
	@echo "Stop and remove containers"
	docker-compose down --volumes --remove-orphans
