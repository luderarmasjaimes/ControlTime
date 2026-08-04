#!/usr/bin/env bash
set -euo pipefail

TS=$(date -u +%Y%m%dT%H%M%SZ)
ART=artifacts/run_$TS
mkdir -p "$ART"
echo "Artifacts -> $ART"
echo "Starting build and up..." > "$ART/run.log"
docker compose -f docker-compose.yml up -d --build >> "$ART/run.log" 2>&1 || { echo "compose up failed"; cat "$ART/run.log"; exit 1; }
echo "Waiting for services to report healthy (max 180s)..." >> "$ART/run.log"
for i in $(seq 1 36); do
  docker compose -f docker-compose.yml ps --quiet | xargs -r docker inspect --format '{{.Name}} {{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' >> "$ART/run.log" || true
  ALL_HEALTHY=true
  for cid in $(docker compose -f docker-compose.yml ps -q); do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid")
    if [ "$status" != "healthy" ] && [ "$status" != "running" ]; then
      ALL_HEALTHY=false
    fi
  done
  if [ "$ALL_HEALTHY" = true ]; then
    echo 'All services healthy or running' >> "$ART/run.log"
    break
  fi
  sleep 5
done

echo "Run smoke tests..." >> "$ART/run.log"
if ./scripts/ci/smoke_test.sh >> "$ART/smoke.log" 2>&1; then
  echo 'SMOKE: OK' > "$ART/smoke_status.txt"
else
  echo 'SMOKE: FAIL' > "$ART/smoke_status.txt"
fi

echo "Running Playwright e2e (in Playwright image) and saving output to artifacts..." >> "$ART/run.log"
# Use Playwright official image (contains browsers) to avoid interactive prompts
docker run --rm -v "$(pwd):/workspace" -w /workspace/frontend mcr.microsoft.com/playwright:v1.44.0-focal bash -lc "npm ci --legacy-peer-deps >/dev/null 2>&1 || npm install --legacy-peer-deps >/dev/null 2>&1; npx playwright test --config=playwright.ci.config.ts --reporter=html || true" >> "$ART/playwright.log" 2>&1 || true

if [ -d frontend/playwright-report ]; then
  cp -r frontend/playwright-report "$ART/"
fi

echo "Collecting docker compose logs..." >> "$ART/run.log"
docker compose -f docker-compose.yml logs --no-color > "$ART/compose.log" 2>&1 || true

echo "Packaging artifacts..." >> "$ART/run.log"
tar -czf artifacts/report_$TS.tar.gz -C artifacts run_$TS || true
echo "Done. Artifacts at artifacts/report_$TS.tar.gz"
ls -la "$ART" >> "$ART/run.log"
cat "$ART/smoke_status.txt" || true
