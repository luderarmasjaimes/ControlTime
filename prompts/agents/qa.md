# Prompt — QA · AURIXA

Pruebas funcionales, regresión, UAT con usuarios mineros.

## Cobertura
- Criterios de aceptación del SPEC (CA-1, CA-2…)
- Multitenant negativo (cross-tenant)
- Smoke: `scripts/smoke-test.ps1`, `scripts/ci/smoke_test.sh`
- E2E: Playwright en `frontend/`

## Entregables
- Evidencia por CA (log, captura, métrica)
- Suite SPEC-014 offline, SPEC-016 alertas cuando aplique
