# SPEC 007 — Editor documental ReportStudio + exportación

| Campo | Valor |
|---|---|
| **ID** | 007 · **Estado** | **Aprobado (refleja código existente)** |
| **SOW** | KPI **O2** (auto-guardado < 0.5 s), **O3** (export PDF/Word < 5 s) · S5, S7 (R3-R4) |
| **Constitución** | Art. 1 (multitenant), Art. 6 (trazabilidad/versionado) |

## ADRs globales aplicables

> Trazabilidad automática desde [`specs/REGISTRY.md`](../REGISTRY.md) para **SPEC-007**; fuente ADR: `docs/decisions/`.

- **ADR-009** — [`009-almacenamiento-objetos-minio-parquet.md`](../../docs/decisions/009-almacenamiento-objetos-minio-parquet.md)
- **ADR-010** — [`010-modelo-documento-json-bloques.md`](../../docs/decisions/010-modelo-documento-json-bloques.md)
- **ADR-011** — [`011-estructura-formal-secciones-cover-toc.md`](../../docs/decisions/011-estructura-formal-secciones-cover-toc.md)
- **ADR-012** — [`012-binding-dato-widget-referencia-versionada.md`](../../docs/decisions/012-binding-dato-widget-referencia-versionada.md)
- **ADR-013** — [`013-editor-tiptap-konva.md`](../../docs/decisions/013-editor-tiptap-konva.md)
- **ADR-014** — [`014-estado-editor-zustand.md`](../../docs/decisions/014-estado-editor-zustand.md)
- **ADR-015** — [`015-versionado-informe-server-autoritativo.md`](../../docs/decisions/015-versionado-informe-server-autoritativo.md)
- **ADR-016** — [`016-export-server-side-asincrono.md`](../../docs/decisions/016-export-server-side-asincrono.md)
- **ADR-017** — [`017-workflow-canonico-informe.md`](../../docs/decisions/017-workflow-canonico-informe.md)
- **ADR-018** — [`018-firma-documental-vs-integridad-archivo.md`](../../docs/decisions/018-firma-documental-vs-integridad-archivo.md)
- **ADR-019** — [`019-resolucion-diferida-numeracion-toc-refs.md`](../../docs/decisions/019-resolucion-diferida-numeracion-toc-refs.md)
- **ADR-020** — [`020-mapa-bloque-tipado-georeferencia.md`](../../docs/decisions/020-mapa-bloque-tipado-georeferencia.md)
- **ADR-021** — [`021-ownership-metadatos-ciclo-vida.md`](../../docs/decisions/021-ownership-metadatos-ciclo-vida.md)
- **ADR-046** — [`046-encabezado-pie-elementos-plataforma-fijos.md`](../../docs/decisions/046-encabezado-pie-elementos-plataforma-fijos.md)
- **ADR-047** — [`047-galeria-imagenes-tenant.md`](../../docs/decisions/047-galeria-imagenes-tenant.md)
- **ADR-048** — [`048-caratula-toda-pagina-imagen-libre.md`](../../docs/decisions/048-caratula-toda-pagina-imagen-libre.md)
- **ADR-049** — [`049-ajuste-texto-alrededor-objetos.md`](../../docs/decisions/049-ajuste-texto-alrededor-objetos.md)
- **ADR-050** — [`050-formato-texto-por-seleccion-spans.md`](../../docs/decisions/050-formato-texto-por-seleccion-spans.md)
- **ADR-051** — [`051-copiar-pegar-objetos-lienzo.md`](../../docs/decisions/051-copiar-pegar-objetos-lienzo.md)
- **ADR-052** — [`052-navegacion-zoom-tamano-pagina.md`](../../docs/decisions/052-navegacion-zoom-tamano-pagina.md)
- **ADR-053** — [`053-estilos-visuales-tabla.md`](../../docs/decisions/053-estilos-visuales-tabla.md)
- **ADR-055** — [`055-editor-indicador-seleccion-propio.md`](../../docs/decisions/055-editor-indicador-seleccion-propio.md)
- **ADR-064** — [`064-grabacion-video-camara-web-lienzo.md`](../../docs/decisions/064-grabacion-video-camara-web-lienzo.md)
- **ADR-065** — [`065-grabacion-video-pantalla-ventana-lienzo.md`](../../docs/decisions/065-grabacion-video-pantalla-ventana-lienzo.md)
- **ADR-068** — [`068-ia-editorial-multimodelo-referencias-externas-controladas.md`](../../docs/decisions/068-ia-editorial-multimodelo-referencias-externas-controladas.md)
- **ADR-069** — [`069-migracion-frontend-typescript-estricto.md`](../../docs/decisions/069-migracion-frontend-typescript-estricto.md)
- **ADR-070** — [`070-bloques-tecnicos-plantillas-semanticas-composicion.md`](../../docs/decisions/070-bloques-tecnicos-plantillas-semanticas-composicion.md)
- **ADR-071** — [`071-toc-pagina-dos-continuaciones-automaticas.md`](../../docs/decisions/071-toc-pagina-dos-continuaciones-automaticas.md)
- **ADR-072** — [`072-gdal-cli-runtime-admin-confinado.md`](../../docs/decisions/072-gdal-cli-runtime-admin-confinado.md)
- **ADR-073** — [`073-modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon.md`](../../docs/decisions/073-modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon.md)
- **ADR-079** — [`079-rbac-workflow-informes-inmutabilidad-firma.md`](../../docs/decisions/079-rbac-workflow-informes-inmutabilidad-firma.md)
- **ADR-080** — [`080-marca-de-agua-y-password-pdf.md`](../../docs/decisions/080-marca-de-agua-y-password-pdf.md)
- **ADR-081** — [`081-cors-multiorigen-frontend-externo.md`](../../docs/decisions/081-cors-multiorigen-frontend-externo.md)
- **ADR-082** — [`082-autenticacion-cookie-httponly-csrf-double-submit.md`](../../docs/decisions/082-autenticacion-cookie-httponly-csrf-double-submit.md)
- **ADR-083** — [`083-exportacion-pptx-modo-presentacion-sidecar-hibrido.md`](../../docs/decisions/083-exportacion-pptx-modo-presentacion-sidecar-hibrido.md)
- **ADR-084** — [`084-conversion-pptx-video-narracion-diapositiva.md`](../../docs/decisions/084-conversion-pptx-video-narracion-diapositiva.md)
- **ADR-090** — [`090-deprecacion-adr-tempranos-ia.md`](../../docs/decisions/090-deprecacion-adr-tempranos-ia.md)
- **ADR-092** — [`092-plantilla-corporativa-timetelemetry-referencia-diseno.md`](../../docs/decisions/092-plantilla-corporativa-timetelemetry-referencia-diseno.md)
- **ADR-097** — [`097-numpy2-onnxruntime-opencv-python-ai-engine.md`](../../docs/decisions/097-numpy2-onnxruntime-opencv-python-ai-engine.md)
- **ADR-098** — [`098-aislamiento-sesion-captura-biometrica.md`](../../docs/decisions/098-aislamiento-sesion-captura-biometrica.md)


## 1. Problema
La operación minera produce informes técnicos en herramientas dispersas, sin
trazabilidad ni control de versiones. Se necesita un editor tipo Word, embebido,
con plantillas, datos de sensores y exportación, todo dentro de la plataforma.

## 2. Objetivo
Editor documental (ReportStudio) con experiencia familiar tipo Word: estilos,
tablas, plantillas, widgets de KPI/sensores, **auto-guardado < 0.5 s** y
**exportación a PDF/Word < 5 s**, con versionado y trazabilidad.

## 3. Usuarios y contexto
- **Roles:** analista, supervisor, gerente. **Multitenant:** informes por empresa.
- **Frontend:** `frontend/src/components/ReportStudioV2/`.

## 4. Alcance
**Incluye:** CRUD de proyectos/informes, edición rica, plantillas, widgets de
datos (KPI minero, sensores), auto-guardado, exportación, versionado.
**NO incluye:** colaboración en tiempo real multi-cursor, firma digital.

## 5. Criterios de aceptación
- [ ] **CA-1:** Auto-guardado de una operación de edición en **< 0.5 s** (O2).
- [ ] **CA-2:** Exportación de un informe a PDF/Word en **< 5 s** (O3).
- [ ] **CA-3:** (multitenant) Un usuario solo ve/edita informes de su empresa.
- [ ] **CA-4:** El informe puede incrustar **widgets de KPI/sensores** que reflejan dato real (vía 002).
- [ ] **CA-5:** Cada guardado crea versión trazable (quién, cuándo, qué cambió).
- [ ] **CA-6:** CRUD funciona: crear, listar, abrir, actualizar, borrar informe.

## 6. Requisitos no funcionales
| Atributo | Objetivo |
|---|---|
| Auto-guardado | < 0.5 s (O2) |
| Exportación | < 5 s (O3) |
| Retraso de edición | < 20 ms (O1) |

## 7. Contratos (endpoints reales)
- `GET /api/projects`, `GET /api/reports`, `GET /api/reports/{id}`
- `POST /api/reports`, `PUT /api/reports/{id}`, `DELETE /api/reports/{id}`

## 8. Riesgos
| Riesgo | Mitigación |
|---|---|
| Export pesado bloquea el hilo | export asíncrono / worker; medir contra O3 |
| Pérdida de cambios sin conexión | integrar con modo offline (spec 014) |
