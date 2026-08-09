# ADR-012 — Trazabilidad dato→widget: referencia versionada + snapshot

**Status**: implemented, alcance acotado a la firma (completado 2026-07-07). Decisión de diseño: en vez de que `MiningKpiWidget`/`SensorWidget` escriban un snapshot en cada tick de su polling (lo que habría disparado el pipeline de autosave/versionado en cada 5-30s, violando la propia regla del ADR de que solo un "refresh explícito" debe crear versión), el snapshot se captura **una sola vez, justo antes de confirmar la transición a `signed`** (`ReportStudioV2/App.tsx::captureLiveSnapshotsForSigning`, invocado desde `handleWorkflowTransition`): re-consulta el valor actual de cada kpi/sensor citado (mismas funciones de API que ya usan los propios widgets — `fetchMiningKpis`/`fetchMineSensors`) y lo escribe en `element.props.snapshot` antes de guardar. Los widgets en el lienzo de edición NO se tocaron — siguen 100% en vivo mientras el informe está en `draft`/`in_review`/`approved`, que es el comportamiento correcto mientras se construye el informe; solo al firmar se congela.

**Hallazgo real durante la implementación** (más grave que lo que describía este ADR): ni `ReadOnlyViewer.tsx` ni `exportEngine.ts` (DOCX) tenían NINGÚN caso para `element.type === 'sensor'` en su switch de renderizado — un informe con un widget de sensor se veía completamente vacío (ni siquiera un "—") al abrirlo en solo-lectura o exportarlo, incluso ya firmado. El caso `'kpi'` sí existía pero leía `props.value`, un campo que el editor nunca escribía. Ambos corregidos para leer `props.snapshot.value`/`unit`/`capturedAt` (con fallback a `props.value` para KPI, por compatibilidad).

**Verificado**: build de producción con 0 errores de TypeScript; nombres de campo de la API (`code`, `current_value`, `unit`, `updated_at`, `trend_direction`, `trend_percent` para KPI; `id`, `current_value` para sensor) confirmados leyendo directamente `backend/src/mining/kpi_service.cpp`/`sensor_service.cpp` (no asumidos desde el código del widget). No se pudo completar una prueba E2E en vivo con usuario real en esta sesión — el registro de usuario nuevo exige biometría facial (`face_template`/`face_image_base64`), no disponible vía curl en este entorno; el mecanismo de guardado de `content_json` arbitrario ya fue probado E2E en ADR-021 (mismo pipeline genérico, sin lógica especial por campo).
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: reports

## Contexto

La promesa dura #2 es "trazabilidad en vivo del dato al informe": lo que un informe cita (un sensor, un KPI, una serie) debe estar vinculado a la fuente real y ser auditable. Pero un informe firmado/aprobado también debe ser **reproducible**: mostrar exactamente lo que se citó cuando se firmó, aunque el dato cambie después. El código actual resuelve KPI/sensor/chart en runtime (consulta API en cada apertura), sin snapshot — lo que haría que un informe firmado cambiara retroactivamente.

## Decisión

Cada widget de dato (`sensor`, `kpi`, `chart`) guarda **dos cosas**: (a) una **referencia** a la query/sensor de origen (sensorId/kpiCode/query), y (b) un **snapshot versionado** del valor citado, con `timestamp` y `version`. Al abrir el informe se muestra el snapshot (reproducible); "refrescar" es una acción **explícita** del usuario que re-consulta la fuente y **crea una nueva versión** del informe (ADR-015).

### Contrato del widget
```jsonc
"props": {
  "ref": { "kind": "sensor|kpi|query", "id": "...", "query": "..." },
  "snapshot": { "value": <...>, "capturedAt": "ISO-8601", "sourceVersion": "..." }
}
```

### Reglas duras
- Un widget nunca se renderiza solo con live-query: siempre tiene snapshot. Si falta snapshot (offline), se muestra estado "sin dato" explícito, no un valor inventado.
- Refrescar un widget genera una entrada de versión + auditoría (ADR-015, ADR-030).
- La relación sensor↔informe es la "integridad referencial cross-DB" que ADR-005 delega a la aplicación: se valida acá.

## Consecuencias

### Positivas
- Reproducibilidad de informes firmados (muestran lo citado) + trazabilidad (linkea a la fuente).
- Refresh explícito evita que un informe "cambie solo".

### Negativas / Trade-offs
- Duplicación de dato (snapshot) — aceptable y deseable: es el costo de la reproducibilidad; los snapshots son chicos.
- Hay que detectar "dato desactualizado" y ofrecer refresh — UX adicional, pero alineada con la trazabilidad.

### Neutras
- El snapshot vive en el bloque (`.miningreport`), portátil offline.

## Alternativas descartadas

### Snapshot puro al insertar (sin referencia)
Simple y reproducible, pero pierde el vínculo vivo: no se puede re-consultar la fuente ni saber si cambió. Rompe la promesa de trazabilidad viva.

### Live query siempre (sin snapshot)
Es el comportamiento actual. Un informe firmado cambiaría retroactivamente → rompe reproducibilidad y la firma. Rechazado.

## Referencias
- `Referencias/frontend/src/components/ReportStudioV2/components/document/SensorWidget.jsx`, `MiningKpiWidget.jsx`
- ADR-010 (modelo de bloques), ADR-015 (versionado), ADR-030 (auditoría)
