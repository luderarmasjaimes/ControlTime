# Diseño de bases de datos — Presentación para gerencias

Documento en **dos niveles**: (A) **vista ejecutiva** para dirección de áreas de negocio y (B) **vista detallada TI** para implementación, operación y cumplimiento. Los diagramas técnicos ER completos siguen en [`DIAGRAMA_ARQUITECTURA_BD.md`](DIAGRAMA_ARQUITECTURA_BD.md).

**Estado del repositorio (scripts SQL):** migraciones `01` … `20` en `db_scripts/`, más `formula_engine/02_multitenant_scope_registry.sql` en la base **formula**. La **activación completa** de auditoría en producción exige además que el **backend C++** invoque `fn_audit_context_set` por request y `fn_platform_audit_insert` en rutas que aún no tengan trigger.

---

## A. Vista ejecutiva (gerencia de negocio / no TI)

### A.1 Qué problema resuelve la plataforma

La operación minera genera **datos de sensores**, **informes técnicos**, **acceso de personas** y **decisiones de seguridad**. La base de datos centraliza esas piezas para que se puedan **consultar**, **proteger por cliente (multitenant)** y **auditar** quién hizo qué y cuándo.

### A.2 Dónde vive la información (concepto simple)

| Necesidad de negocio | Dónde queda guardado (nombre lógico) |
|----------------------|--------------------------------------|
| Quién entró al sistema y si falló el acceso | Registro de **acceso y biometría** |
| Informes técnicos (contenido, versiones, permisos) | **Informes** y tablas de **permisos / envíos a revisión** |
| Lecturas de sensores y alarmas | **Telemetría** y **alarmas** |
| Análisis de temperaturas / fórmulas por mina | **Datos de minería** y **sesiones de análisis** |
| Quién cambió datos sensibles a nivel plataforma | **Auditoría central** (bitácora única de referencia) |
| Envío de avisos (correo, SMS, etc.) | **Cola de notificaciones** (la entrega la hace un servicio) |

Hay **dos bases PostgreSQL** en el diseño habitual: una principal (**sensors_db**) y otra del editor de diagramas (**formula**), para no mezclar el lienzo técnico con la operación diaria.

### A.3 Trazabilidad y auditoría — qué está garantizado hoy a nivel de datos

| Tema | ¿Hay estructura en BD? | Comentario para negocio |
|------|-------------------------|-------------------------|
| Intentos de login y eventos de autenticación | Sí | Historial de acceso e intentos fallidos |
| Cambios en informes (crear / editar / borrado lógico) | Sí | Registro automático en auditoría central al cambiar contenido o estado relevante |
| Uso del análisis FORMULA (quién consultó qué mina/variable) | Sí | Cada sesión de análisis deja huella en auditoría |
| Cambios sensibles en usuarios (rol, contraseña, plantilla facial, activo) | Sí | Registro en auditoría central |
| Acciones de alto riesgo sobre informes (borrado, biométrico, aprobación remota) | Sí | Tabla dedicada de **acciones sensibles**; la aplicación debe registrar el resultado del desafío |
| Telemetría sensor por sensor (millones de filas) | Parcial | **No** se escribe una línea de auditoría por cada lectura (sería inviable); se auditan **alarmas**, **exportaciones** y **procesos** desde la aplicación o reglas |

En resumen: la trazabilidad de **personas, documentos y configuración crítica** está **modelada y, en parte, automatizada con triggers**. El volumen masivo de señales físicas se audita por **eventos** (alarmas, exportaciones, jobs), no por cada muestra.

### A.4 Riesgos o pendientes que debe conocer la gerencia

1. **El backend debe usar** el contexto de usuario en cada operación; sin eso, la bitácora puede quedar con usuario anónimo aunque el trigger haya corrido.
2. **Retención y archivo** de logs (cuántos años, anonimización) es decisión de **política corporativa**, no solo de la BD.
3. **formula_db** (editor): conviene alinear políticas de backup y acceso con **sensors_db**.

---

## B. Vista detallada TI (gerencia TI / arquitectura / seguridad)

### B.1 Orden recomendado de aplicación de scripts (`sensors_db`)

| Orden | Archivo | Dominio principal |
|------|---------|-------------------|
| 01 | `01_init.sql` | Proyectos, informes base, PostGIS opcional |
| 02 | `02_seed_demo.sql` | Datos demo (opcional) |
| 03 | `03_auth_biometric.sql` | Usuarios, rostros, **auth_audit_logs** |
| 04 | `04_telemetry_schema_v2.sql` | Tenants, sites, sensors, **telemetry_raw**, alertas, dashboards |
| 05 | `05_reports_admin.sql` | Informes: autoría, soft delete, shares, notifications |
| 06–08 | seeds / diccionario | Según entorno |
| 09 | `09_formula_mining_reports.sql` | **mineria_***, SP temperatura, **formula_sessions** |
| 10–13 | seeds / fixes / reset | Operación |
| 12 | `12_sp_proceso_temperatura_inicio_fix.sql` | SP |
| **16** | `16_platform_multitenant_latam_i18n_rbac_audit.sql` | País, i18n, RBAC, **platform_audit_log**, authz, alarm routing, ETL jobs |
| **17** | `17_telemetry_multivariate_sensor_specs.sql` | Parámetros/canales sensor, **telemetry_multivariate** |
| **18** | `18_tb_sensor_model_notify_etl_triggers.sql` | Perfil sensor, notificaciones org, sync externo, triggers alarmas |
| **19** | `19_report_technical_mining_enterprise.sql` | Informe enterprise: ACL, revisiones, export, IA, **report_sensitive_action_log** |
| **20** | `20_audit_traceability_enforcement.sql` | **fn_audit_context_set**, índices, triggers → **platform_audit_log** |
| **21** | `21_audit_context_from_login.sql` | **fn_audit_context_from_login** (UUID + tenant desde username/empresa) para API sin exponer formato de id interno |

**formula_db:** `formula_engine/init.sql` + `02_multitenant_scope_registry.sql` (y migraciones que aplique el `formula_engine` en C++).

### B.2 Inventario de trazabilidad por tipo de registro

| Origen | Tabla / mecanismo | Tipo |
|--------|-------------------|------|
| Autenticación | `auth_audit_logs` | Insert por backend (login/register/biometría) |
| Plataforma (API, acciones genéricas) | `platform_audit_log` + `fn_platform_audit_insert` | Insert por aplicación |
| Contexto por request | `fn_audit_context_set` / `fn_audit_context_clear` | GUC transaccional (`app.audit_*`) |
| Resolución usuario/tenant desde sesión | `fn_audit_context_from_login(username, company, session)` (migración **21**) | El **backend C++** la invoca dentro de `BEGIN` antes de modificar `reports` o `auth_users` (avatar), usando el token Bearer/query |
| Informes | Trigger `trg_audit_reports_row` → `platform_audit_log` | Automático BD |
| Usuarios (campos sensibles) | Trigger `trg_audit_auth_users_sensitive` | Automático BD |
| Análisis FORMULA | Trigger `trg_audit_formula_sessions_insert` | Automático BD |
| Fallos auth → notificación | Trigger en `auth_audit_logs` (mig. 18) | `org_notification_outbox` |
| Alarmas operativas | `alerts` + triggers (mig. 18) | Integraciones + outbox |
| Informe riesgo / biométrico | `report_sensitive_action_log` | Insert por aplicación (obligatorio en flujo de riesgo) |
| Exportaciones informe | `report_export_job` | Estado por job |
| IA sobre informe | `report_ai_run` | Histórico por ejecución |
| Jobs ETL | `etl_job_run`, `etl_sync_run` | Por ejecución programada o sync |

### B.3 Cobertura explícita **no** cubierta por trigger SQL (responsabilidad aplicación)

- Inserción masiva en **`telemetry_raw`** / **`telemetry_multivariate`**.
- Mayoría de rutas REST en **`main.cpp`** sin llamada explícita a **`fn_platform_audit_insert`** (pendiente de instrumentar).
- **`formula_db`**: bloques/diagramas — auditar en app o añadir triggers allí si se exige el mismo estándar.
- **`ai_engine`**: trazas de inferencia fuera de PG salvo que se persistan vía API.

### B.4 Recomendaciones operativas TI

1. **Transacciones API:** `SELECT fn_audit_context_set(tenant, user, username, session);` al abrir la transacción que modifica datos auditados.
2. **Consultas forenses:** índices `idx_platform_audit_entity_time`, `idx_platform_audit_session` (migración 20).
3. **Retención:** política de partición/archivo para `platform_audit_log` y `auth_audit_logs` antes de producción a gran escala.
4. **Permiso de lectura:** rol solo lectura con `sec_permission` **`audit.read`**.

### B.5 Referencias de diagramas

- Despliegue lógico y módulos: **§1** de [`DIAGRAMA_ARQUITECTURA_BD.md`](DIAGRAMA_ARQUITECTURA_BD.md) (diagrama C1 actualizado con módulo de auditoría).
- ER y multitenant: **§2–6** del mismo documento.
- Extensiones 16–20 y ThingsBoard: **§7–11**.
- **Secuencias / flujos** (PlantUML, estilo `C4_secuencia_*`): [`DIAGRAMAS_FLUJO_PLATAFORMA_MINERA.md`](DIAGRAMAS_FLUJO_PLATAFORMA_MINERA.md).

---

*Última revisión alineada a `db_scripts/20_audit_traceability_enforcement.sql` y estructura del repositorio.*
