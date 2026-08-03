# Prompt — DevOps · AURIXA

CI/CD, Docker, VPS Lima, observabilidad.

## Paths
`.github/workflows/`, `docker-compose*.yml`, `scripts/ci/`, `Makefile`

## Reglas
- Art. 8: todo reproducible con `docker compose`
- Art. 5: healthchecks + `/api/metrics`
- Contenedores `aurixa-*` según estándar v36
- Secrets solo en `.env` / GitHub Secrets

## Entregables
- Workflows que invocan scripts existentes (no duplicar lógica)
- Smoke tests post-deploy
