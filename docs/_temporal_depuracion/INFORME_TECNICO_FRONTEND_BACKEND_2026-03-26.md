# Informe tecnico integral - Frontend/Backend

## 1) Objetivo

Este documento consolida el estado real del proyecto para:

- Guiar al equipo Frontend en la implementacion de funcionalidades ya soportadas por Backend.
- Identificar brechas funcionales entre UI, API y Base de Datos.
- Presentar a Gerencia TI una hoja de ruta ejecutable para cerrar las funcionalidades pendientes.

## 2) Resumen ejecutivo (estado actual)

Estado global del sistema:

- La plataforma tiene base funcional en autenticacion, dashboard, sensores, reportes y conversion ECW/MBTiles.
- Existen funcionalidades visibles en Frontend que aun dependen de **fallback localStorage/mock** por falta de endpoints o contratos incompletos en Backend.
- Existen brechas de seguridad y gobierno de datos (credenciales en compose, llave TLS en repo, filtros de multiempresa incompletos en reportes).
- El backend ya expone endpoints clave para auth, auditoria, reportes, mapa, sensores y conversion, pero faltan endpoints de mantenimiento avanzado de usuarios y comparticion de informes persistente.

Conclusiones para Gerencia TI:

- Se puede pasar a etapa de consolidacion en 3 fases (4-8 semanas) sin reescritura total.
- Prioridad alta: cerrar brechas de seguridad y trazabilidad multiempresa.
- Prioridad alta: eliminar fallback local en frontend para funciones administrativas criticas.

## 3) Arquitectura funcional observada

### 3.1 Backend (C++)

Backend principal en `backend/src/main.cpp` con rutas:

- `GET /health`
- `GET /api/capabilities`
- `GET /api/auth/companies`
- `GET /api/auth/biometric/status` (admin)
- `POST /api/auth/biometric/verify-frame`
- `POST /api/auth/register`
- `POST /api/auth/login/password`
- `POST /api/auth/login/face`
- `GET /api/auth/audit` (admin)
- `GET /api/auth/audit/export.csv` (admin)
- `GET /api/dashboard/metrics`
- `GET /api/sensors/data`
- `GET /api/surveillance/cameras`
- `GET /api/map/markers`
- `GET /api/projects`
- `GET /api/reports`
- `POST /api/reports`
- `PUT /api/reports/{id}`
- `DELETE /api/reports/{id}`
- `GET /api/auth/validate-company`
- `POST /api/convert`
- `GET /api/jobs/{id}`
- `POST /api/analyze-core`

### 3.2 Frontend (React)

Interfaz central en `frontend/src/App.jsx`:

- Dashboard principal.
- Modulo de autenticacion biometrica/password.
- Dashboard KPI y sensores.
- Mapa base y mapa detallado con captura para insertar en reporte.
- ReportStudio v2 con editor multipagina, gestion de informes y mantenimiento de usuarios.

### 3.3 Base de datos (PostgreSQL/Timescale)

Scripts principales:

- `db_scripts/01_init.sql` (projects, reports, geometric_data)
- `db_scripts/03_auth_biometric.sql` (auth_users, auth_face_templates, auth_audit_logs)
- `db_scripts/04_telemetry_schema_v2.sql` (tenants/sites/assets/sensors/telemetry/dashboards)
- `db_scripts/05_reports_admin.sql` (ciclo de vida reportes, report_shares, notifications)

## 4) Estado por funcionalidad (implementado vs pendiente)

## 4.1 Registro usuario/empresa y validacion usuario/empresa

Implementado:

- Registro con biometria y password via `POST /api/auth/register`.
- Login por password y por rostro.
- Validacion de compania/RUC via `GET /api/auth/validate-company`.
- Auditoria de login/registro via `auth_audit_logs`.

Brechas:

- No existe endpoint backend para listar usuarios por compania (`GET /api/auth/users`) pese a que frontend lo consume.
- No existe endpoint backend para mantenimiento de usuarios (`POST /api/auth/users/maintenance`).
- No existe endpoint backend para auditoria de mantenimiento (`GET /api/auth/users/maintenance/audit`).
- Frontend hace fallback localStorage (`userBootstrap`, `userMaintenanceStorage`), no persistente ni auditable de forma central.

Impacto:

- Operacion administrativa no confiable para produccion.
- Riesgo de inconsistencias entre navegadores/equipos.

## 4.2 Control de imagenes desde mapa e insercion en informe tecnico

Implementado:

- `DetailedMap` permite cargar capas MBTiles y capturar imagen (canvas/html2canvas fallback).
- `MapCaptureModal` permite vista previa e insercion.
- ReportStudio inserta imagen capturada como bloque `type: image`.

Brechas:

- Captura depende de capas y CORS de tiles; no hay pipeline backend para guardar evidencia de captura (metadata, usuario, timestamp, georreferencia).
- Insercion se guarda dentro de `content_json`, pero sin versionado de evidencia visual como entidad separada.

Impacto:

- Funciona para demo/operacion basica.
- Trazabilidad forense y cumplimiento documental incompletos.

## 4.3 Diagramas y sensores mostrados (control, almacenamiento, visualizacion)

Implementado:

- `GET /api/dashboard/metrics` y `GET /api/sensors/data`.
- Frontend `MiningDashboard` y `AdvancedSensors` consumen telemetria.
- Esquema Timescale para telemetria existe en `04_telemetry_schema_v2.sql`.

Brechas:

- Frontend mezcla datos reales con datos hardcodeados/fallback visual.
- No hay API unificada por tenant/sitio para gobernanza multiempresa en UI.
- Falta contrato de cache, paginacion y filtros avanzados para historicos de sensores.

Impacto:

- Visualizacion valida para monitoreo inicial.
- Reportabilidad ejecutiva avanzada aun parcial.

## 4.4 Control, almacenamiento y recompilacion de informes tecnicos

Implementado:

- CRUD basico de reportes (`/api/reports`).
- Editor multipagina con bloques y guardado JSON.
- Modal de administracion de informes con filtros locales.
- Esquema DB extendido con campos de ciclo de vida (`created_by`, `reviewed_by`, `deleted_at`, etc.).

Brechas criticas:

- Backend `GET /api/reports` retorna campos minimos y no devuelve `content_json`, `created_by`, `reviewed_by`, `version_number`, `company_name` etc.
- `createReportPg` no inserta `created_by`, `company_name`, `last_modified_by`.
- `listReportsPg` no filtra por empresa (comentario en codigo lo reconoce).
- Comparticion de informes en frontend esta mock (simulada), no persiste en `report_shares`.
- `ShareReportModal` importa `shareReport`, pero el storage define `shareReportAsync` (desacople potencial).

Impacto:

- Flujo de informe funcional en minimo viable.
- Gobierno documental (quien creo, reviso, versiono y compartio) incompleto para auditoria TI.

## 5) Matriz de brechas priorizadas

### P0 - Critico (bloquea salida productiva)

1. Seguridad operativa:
   - Remover secretos hardcodeados y llave privada TLS del repositorio.
   - Externalizar credenciales DB y rotar certificados.
2. Multiempresa en reportes:
   - Filtrado estricto por empresa/tenant en backend.
3. Mantenimiento de usuarios:
   - Implementar endpoints reales para listar usuarios, aplicar mantenimiento y auditar.

### P1 - Alto (requerido para operacion formal)

1. Contrato completo de reportes:
   - Devolver/guardar metadatos de ciclo de vida y contenido JSON completo.
2. Comparticion de informes:
   - Persistir en `report_shares` y registrar notificaciones.
3. Auditoria extendida:
   - Registrar acciones de mantenimiento, comparticion y cambios de estado de informes.

### P2 - Medio (optimizacion y escalabilidad)

1. Endpoints de sensores con filtros por rango/tenant.
2. Versionado formal de contenido de informe.
3. Evidencia de mapa como activo con metadata geoespacial.

## 6) Plan de implementacion para equipo Frontend (alineado a backend)

## Fase A (semana 1-2): Estabilizacion de contratos

Entregables frontend:

- Migrar `ReportStudioV2/lib/reportsStorage.js` a DTO backend definitivo.
- Eliminar dependencias de localStorage para operaciones criticas de mantenimiento/comparticion.
- Corregir invocacion de API en modales para usar funciones reales y tipadas.

Dependencias backend:

- Exponer `GET /api/auth/users`.
- Exponer `POST /api/auth/users/maintenance`.
- Exponer `GET /api/auth/users/maintenance/audit`.
- Enriquecer payload `GET /api/reports`.

## Fase B (semana 3-4): Ciclo documental completo

Entregables frontend:

- Estados de informe (`draft`, `in_review`, `approved`, `archived`) con reglas por rol.
- Vista de historial/auditoria por informe.
- Comparticion real con confirmaciones y seguimiento de lectura.

Dependencias backend:

- Persistencia de `report_shares` y `notifications`.
- Endpoints de cambio de estado con validacion por rol.
- Auditoria de cada transicion.

## Fase C (semana 5-8): Madurez operacional y BI

Entregables frontend:

- Dashboard de cumplimiento (SLAs, tiempos de revision, indicadores de calidad).
- Vistas avanzadas de sensores y correlacion con eventos de reporte.

Dependencias backend/DB:

- Consultas analiticas optimizadas y materializadas.
- Endpoints agregados por tenant/sitio/rango temporal.

## 7) Recomendaciones tecnicas concretas

1. Definir contrato OpenAPI unico para auth/reportes/sensores antes de seguir agregando UI.
2. Aplicar control de acceso por rol en todas las rutas de administracion.
3. Incluir `company_name`/tenant en todas las tablas y queries de dominio (si aplica).
4. Estandarizar campos de respuesta (`snake_case` o `camelCase`) y mantener consistencia end-to-end.
5. Mover fallback local solo a modo demo/controlado por feature flag.
6. Agregar pruebas e2e reales contra backend (no solo localStorage bootstrap).

## 8) Riesgos para Gerencia TI

- Riesgo de seguridad: exposicion de secretos y certificados.
- Riesgo de cumplimiento: trazabilidad incompleta de acciones administrativas.
- Riesgo de datos: operaciones multiempresa sin aislamiento robusto.
- Riesgo operativo: divergencia entre estado visual del frontend y estado persistido real.

## 9) KPI de cierre recomendados

- 100% de operaciones administrativas sin fallback localStorage.
- 100% de endpoints criticos con control de rol y auditoria.
- 0 secretos en repositorio.
- 95% de flujos P0/P1 cubiertos por pruebas E2E sobre backend real.
- Tiempo de guardado/apertura de informe < 2s en p95 (entorno objetivo).

## 10) Proximo paso sugerido (inmediato)

Abrir 4 epicas:

1. EPIC-SEC: saneamiento de secretos/certificados y hardening.
2. EPIC-USER-MAINT: mantenimiento de usuarios full backend + frontend.
3. EPIC-REPORT-LIFECYCLE: ciclo de vida y comparticion de informes.
4. EPIC-DATA-GOV: aislamiento multiempresa y contratos API definitivos.

