# SPEC-023 — Portabilidad, despliegue reproducible y recuperación del stack

| Campo | Valor |
|---|---|
| **Estado** | Utilidad implementada; aceptación operativa pendiente |
| **ADR** | ADR-111 |
| **Gate** | R5-R6 |
| **Última revisión** | 2026-08-18 |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-023**; fuente ADR: `docs/decisions/`.

- **ADR-033** — [`033-convencion-nombres-prefijos.md`](../../docs/decisions/033-convencion-nombres-prefijos.md)
- **ADR-035** — [`035-plataforma-enterprise-latam.md`](../../docs/decisions/035-plataforma-enterprise-latam.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-111** — [`111-portabilidad-stack-export-import-perfil-telemetria.md`](../../docs/decisions/111-portabilidad-stack-export-import-perfil-telemetria.md)

## Objetivo

Trasladar o reconstruir el stack en un host limpio con artefactos verificables,
secretos gobernados, restauración comprobada y rollback medible.

## Criterios de aceptación

- [x] **CA-1:** Exporta dumps lógicos, volúmenes seleccionados e imágenes.
- [x] **CA-2:** Genera manifiesto con fecha, proyecto, commit y opciones.
- [x] **CA-3:** Importa en orden controlado y usa hooks de restore TimescaleDB.
- [x] **CA-4:** Tiene paridad funcional PowerShell/Bash.
- [x] **CA-5:** Excluye e inventaría secretos/archivos host del paquete automático.
- [ ] **CA-6:** Incluye checksums, firma/SBOM y verificación antes de importar.
- [ ] **CA-7:** Cifra el paquete y documenta custodia/retención/borrado.
- [ ] **CA-8:** Restore completo en host limpio pasa health, smoke, CTest y E2E.
- [ ] **CA-9:** Simulacro registra RTO/RPO y valida rollback.
- [ ] **CA-10:** CI ejecuta lint/smoke de scripts y publica artefacto versionado.
- [ ] **CA-11:** Despliegue progresivo/rollback productivo aprobado por Operaciones.

La SPEC no sustituye SPEC-015: portabilidad es un mecanismo; DR es un resultado
demostrado bajo falla y objetivos de tiempo/pérdida.
