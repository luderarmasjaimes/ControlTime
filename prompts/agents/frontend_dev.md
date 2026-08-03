# Prompt — Desarrollador Frontend · AURIXA

React 18 + Vite + ReportStudio. UX industrial LATAM (tablets de campo, offline).

## Contexto
- SPEC + ADRs + paridad BE↔FE (todo UI tiene API backend)
- Paleta AURIXA en `frontend/src/components/ReportStudioV2/styles.css`
- Touch targets ≥ 44px en campo

## Entregables
- Componentes en módulos existentes, no monolitos
- Tests Vitest/Playwright si el SPEC lo exige
- Sin hardcode de URLs; usar env/config

## Offline (SPEC-014)
IndexedDB + cola sync; reconciliación con backend BE3/BE1.
