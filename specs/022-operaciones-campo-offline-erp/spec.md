# SPEC-022 — Automatización de operaciones de campo offline e integración ERP

| Campo | Valor |
|---|---|
| **Estado** | **Aprobado como proyecto derivado (2026-09-11)**, separado del alcance/presupuesto de la plataforma minera; 0% implementación de producto |
| **ADR** | ADR-110 (proposed; rebaseline aprobado, ver actualización 2026-09-11), ADR-103 |
| **Sprint / release** | Fuera del cronograma v36.1 (S1-S13/R1-R6) — construcción prevista para etapas posteriores de la plataforma minera, sin fecha de inicio |
| **Product owner / presupuesto** | Propios del proyecto derivado, pendientes de asignar |
| **Dirección de arquitectura** | Reutilizar el backend de Beemetry como componentes de servicios web (API), no una plataforma paralela — ver ADR-110 punto 1 y actualización 2026-09-11 |
| **Última revisión** | 2026-09-11 |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-022**; fuente ADR: `docs/decisions/`.

- **ADR-022** — [`022-offline-cola-versionada-indexeddb.md`](../../docs/decisions/022-offline-cola-versionada-indexeddb.md)
- **ADR-025** — [`025-biometria-vision-epp-diferidas.md`](../../docs/decisions/025-biometria-vision-epp-diferidas.md)
- **ADR-026** — [`026-cartografia-offline-mbtiles-maplibre.md`](../../docs/decisions/026-cartografia-offline-mbtiles-maplibre.md)
- **ADR-045** — [`045-edicion-offline-sqlite-cliente.md`](../../docs/decisions/045-edicion-offline-sqlite-cliente.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-103** — [`103-integracion-rp-timetelemetry-replica-xmlrpc.md`](../../docs/decisions/103-integracion-rp-timetelemetry-replica-xmlrpc.md)
- **ADR-110** — [`110-operaciones-campo-offline-integracion-erp.md`](../../docs/decisions/110-operaciones-campo-offline-integracion-erp.md)

## Objetivo

Digitalizar la instalación, lectura y cierre de dispositivos geotécnicos en
campo, funcionando con conectividad intermitente y sincronizando de forma
auditable con Plataforma Minera y el ERP.

## Flujo mínimo

1. ERP publica proyecto, dispositivos y certificados de calibración.
2. Supervisor asigna trabajo y reglas; técnico descarga el paquete de campo.
3. Técnico completa formularios independientes de operatividad, saturación,
   post-saturación, coordenadas/elevación y post-instalación, con evidencia.
4. Outbox sincroniza de forma idempotente; conflictos quedan visibles.
5. Plataforma genera PDF por dispositivo y devuelve estado/referencia al ERP.

## Criterios de aceptación

- [ ] **CA-1:** Matriz ERP↔Beemetry y fuentes autoritativas aprobadas.
- [ ] **CA-2:** Login, descarga y consulta funcionan sin conectividad.
- [ ] **CA-3:** Los cinco formularios guardan borrador y validan obligatoriedad.
- [ ] **CA-4:** Fotos, ubicación, firma y bitácora se cifran y sincronizan.
- [ ] **CA-5:** Doble envío/reintento no duplica trabajos ni artefactos.
- [ ] **CA-6:** Conflictos de versión se detectan y requieren resolución explícita.
- [ ] **CA-7:** PDF por dispositivo cumple formato y aprobación contractual.
- [ ] **CA-8:** ERP recibe estado e identificadores mediante outbox de ADR-103.
- [ ] **CA-9:** Prueba de 24 h offline recupera 100% al reconectar.
- [ ] **CA-10:** MDM, cifrado, borrado remoto, privacidad y roles aprobados.
- [ ] **CA-11:** Piloto en una unidad mide tiempo, retrabajo y tasa de error.

## IA planificada, no implementada

OCR de placas/certificados, dictado, detección EPP, asistencia técnica local,
alarmas y mantenimiento predictivo. Cada capacidad requiere SPEC/modelo/dataset,
umbrales, fallback y aprobación humana; no se agrupa bajo una promesa genérica.
