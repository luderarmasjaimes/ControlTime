# PLAN-023 — Portabilidad y recuperación

1. Congelar el contrato de paquete y manifest JSON versionado.
2. Añadir checksum/firma, SBOM, cifrado y gestión externa de secretos.
3. Restaurar en host limpio y ejecutar health/smoke/unit/E2E.
4. Automatizar publicación, despliegue progresivo y rollback.
5. Ejecutar simulacro con RTO/RPO y vincular evidencia a SPEC-015.
