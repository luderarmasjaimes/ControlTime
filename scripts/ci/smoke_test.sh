#!/usr/bin/env bash
set -euo pipefail

echo "Running smoke tests against local stack..."

echo "Checking frontend (http://localhost:5173/)"
if curl -sSf http://localhost:5173/ >/dev/null; then
  echo "Frontend OK"
else
  echo "Frontend FAILED"; exit 1
fi

echo "Checking backend health (http://localhost:8082/health)"
if curl -sSf http://localhost:8082/health >/dev/null; then
  echo "Backend OK"
else
  echo "Backend FAILED"; exit 1
fi

echo "Checking tileserver (http://localhost:8000/)"
if curl -sSf http://localhost:8000/ >/dev/null; then
  echo "Tileserver OK"
else
  echo "Tileserver FAILED"; exit 1
fi

echo "All smoke tests passed."
