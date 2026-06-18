# Diagramas de flujo (PlantUML) — Plataforma minera InformeCliente

Colección de **diagramas de secuencia** en el mismo estilo que `C4_secuencia_analisis_temperaturas`. Cada bloque se puede copiar a un archivo `.puml` o pegar en [PlantUML en línea](https://www.plantuml.com/plantuml/).

**Sintaxis:** `@startuml` … `@enduml`, `!theme plain`, actores y participantes con flechas `->` / `-->`.

---

## 1. Análisis de temperaturas (API + SP en `sensors_db`)

```plantuml
@startuml C4_secuencia_analisis_temperaturas
!theme plain

actor Usuario as U
participant "Frontend" as FE
participant "Backend C++" as BE
database "PostgreSQL\nsensors_db" as PG

U -> FE : selecciona mina/sensor/fechas
FE -> BE : POST /api/analysis/temperaturas\n(JSON body)
activate BE
BE -> BE : validar sesión JWT/cookie
BE -> BE : resolver empresa_id desde\ncompany_name sesión
BE -> PG : SELECT variable_id FROM mineria_sensores\nWHERE empresa_id, mina_id, sensor_id
PG --> BE : variable_id
BE -> PG : SELECT * FROM sp_proceso_temperatura\n(empresa, mina, variable, fechas)
activate PG
PG --> BE : filas (valor_original,\nvalor_procesado, …)
deactivate PG
BE --> FE : 200 JSON { rows, summary }
deactivate BE
FE --> U : gráficos / tablas

@enduml
```

---

## 2. Ingesta de telemetría y alarma en tiempo real (sin trigger por fila)

```plantuml
@startuml C4_secuencia_ingesta_alarma_tiempo_real
!theme plain

actor "Sensor / Gateway" as GW
participant "Backend C++\n(ingesta)" as BE
participant "Motor reglas\n(C++ / lotes)" as RULE
database "PostgreSQL\nsensors_db" as PG
participant "Worker\nnotificaciones" as W

GW -> BE : POST telemetría\n(batch / stream)
activate BE
BE -> PG : INSERT telemetry_raw\n(masivo)
activate PG
PG --> BE : OK
deactivate PG
BE --> GW : 202 / 200
deactivate BE

RULE -> PG : leer ventana reciente\n(sensor_id, captured_at)
activate RULE
activate PG
PG --> RULE : lecturas
deactivate PG
RULE -> RULE : evaluar umbrales /\nreglas mineras
RULE -> PG : INSERT alerts\n(alarm_category, alarm_type, …)
activate PG
PG --> RULE : alert_id
note right of PG
  Trigger en **alerts** encola
  alarm_delivery_attempt y
  org_notification_outbox (mig. 18)
end note
deactivate PG
deactivate RULE

W -> PG : SELECT … FROM org_notification_outbox\nWHERE status = pending
activate W
activate PG
PG --> W : filas
deactivate PG
W -> W : SMS / email /\nWhatsApp / push
W -> PG : UPDATE outbox\nsent / failed
activate PG
deactivate PG
deactivate W

@enduml
```

---

## 3. Guardado de informe técnico y auditoría en BD

```plantuml
@startuml C4_secuencia_guardado_informe_auditoria
!theme plain

actor Usuario as U
participant "Frontend\nReportStudio" as FE
participant "Backend C++" as BE
database "PostgreSQL\nsensors_db" as PG

U -> FE : edita documento y Guardar
FE -> BE : PUT /api/reports/{id}\n(content_json, title, …)
activate BE
BE -> BE : validar sesión y permisos\n(report_acl / roles)
BE -> PG : SELECT fn_audit_context_set\n(tenant, user, username, session)
activate PG
PG --> BE : OK
deactivate PG
BE -> PG : UPDATE reports SET …
activate PG
PG --> BE : OK
note right of PG
  Trigger **trg_audit_reports_row**
  → INSERT platform_audit_log
end note
deactivate PG
opt historial de versiones
  BE -> PG : INSERT report_content_revision\n(version_number, content_json)
  activate PG
  deactivate PG
end
BE --> FE : 200 JSON { id, … }
deactivate BE
FE --> U : confirmación

@enduml
```

---

## 4. Login con validación de sesión y registro en `auth_audit_logs`

```plantuml
@startuml C4_secuencia_login_auth_audit
!theme plain

actor Usuario as U
participant "Frontend" as FE
participant "Backend C++" as BE
database "PostgreSQL\nsensors_db" as PG

U -> FE : usuario / contraseña\n(o flujo biométrico)
FE -> BE : POST /api/auth/login
activate BE
BE -> BE : verificar hash /\nreglas de cuenta
BE -> PG : INSERT auth_audit_logs\n(event_action, success, …)
activate PG
PG --> BE : OK
note right of PG
  Si falla login relevante,
  trigger puede encolar
  **org_notification_outbox**
  (rutas seguridad)
end note
deactivate PG
BE --> FE : JWT / cookie / 401
deactivate BE
FE --> U : dashboard o error

@enduml
```

---

## 5. Editor FORMULA (lienzo) vía `formula_engine` y `formula_db`

```plantuml
@startuml C4_secuencia_formula_engine_lienzo
!theme plain

actor Usuario as U
participant "Frontend" as FE
participant "formula_engine\nC++" as FENG
database "PostgreSQL\nformula_db" as FDB
database "PostgreSQL\nsensors_db" as PDB

U -> FE : abre análisis /\neditor diagram_id=empX_minaY
FE -> FENG : GET /blocks?diagram_id=…
activate FENG
FENG -> FDB : SELECT blocks, connections\nWHERE diagram_id
activate FDB
FDB --> FENG : filas
deactivate FDB
FENG --> FE : JSON bloques / aristas
deactivate FENG

FE -> FENG : POST guardar bloques\n(diagram_id, payload)
activate FENG
FENG -> FDB : UPSERT blocks / connections
activate FDB
FDB --> FENG : OK
deactivate FDB
FENG --> FE : 200
deactivate FENG

note over PDB
  Datos históricos mineria_*
  y SP suelen vivir en **sensors_db**;
  el lienzo solo en **formula_db**.
end note

@enduml
```

---

## 6. Motor de IA (biometría / imagen) — llamada desde backend

```plantuml
@startuml C4_secuencia_ai_engine_biometria
!theme plain

actor Usuario as U
participant "Frontend" as FE
participant "Backend C++" as BE
participant "ai_engine\nPython" as AI
database "PostgreSQL\nsensors_db" as PG

U -> FE : captura rostro /\nimagen
FE -> BE : POST /api/…\n(imagen o embedding)
activate BE
BE -> AI : HTTP\ninferencia / validación
activate AI
AI --> BE : resultado /\nscores
deactivate AI
BE -> PG : UPDATE auth_users /\nauth_face_templates\n(opcional)
activate PG
deactivate PG
BE --> FE : 200 / 403
deactivate BE
FE --> U : acceso concedido / denegado

@enduml
```

---

## 7. ETL / sincronización con plataforma externa

```plantuml
@startuml C4_secuencia_etl_sync_externo
!theme plain

participant "Scheduler\n(Cron / K8s)" as SCH
participant "Worker ETL\nC++" as W
database "PostgreSQL\nsensors_db" as PG
participant "API plataforma\nexterna" as EXT

SCH -> W : disparar job\n(bulk / incremental)
activate W
W -> PG : SELECT etl_sync_peer,\netl_sync_state\n(watermark)
activate PG
PG --> W : cursor / URL / credenciales
deactivate PG

alt modo bulk
  W -> PG : SELECT lotes desde watermark
  activate PG
  PG --> W : filas
  deactivate W
  W -> EXT : POST / ingest\n(batch)
  activate EXT
  EXT --> W : 200 + ack
  deactivate EXT
else modo incremental / near real-time
  EXT -> W : webhook / poll\nnuevos registros
  W -> PG : INSERT / UPDATE\nen tablas destino
  activate PG
  deactivate PG
end

W -> PG : INSERT etl_sync_run\n(status, stats)
activate PG
deactivate PG
W -> PG : UPDATE etl_sync_state\n(nueva marca de agua)
activate PG
deactivate PG
deactivate W

@enduml
```

---

## 8. Acción sensible en informe (biométrico + autorización remota)

```plantuml
@startuml C4_secuencia_informe_accion_sensible
!theme plain

actor Usuario as U
participant "Frontend" as FE
participant "Backend C++" as BE
participant "ai_engine\n(opcional)" as AI
database "PostgreSQL\nsensors_db" as PG

U -> FE : solicita eliminar /\nmodificar informe crítico
FE -> BE : POST … / DELETE …\n+ intención de acción
activate BE
BE -> BE : leer reports.risk_policy
BE -> AI : validar biométrico\n(si aplica)
activate AI
AI --> BE : verified / fail
deactivate AI
BE -> PG : INSERT report_sensitive_action_log\n(biometric_ok, …)
activate PG
deactivate PG

opt requiere autorización remota
  BE -> PG : INSERT authz_case +\npasos workflow
  activate PG
  deactivate PG
  BE --> FE : 202 pendiente aprobación
else aprobado / no requerida
  BE -> PG : DELETE logico reports /\nUPDATE …
  activate PG
  note right of PG
    Trigger auditoría
    en **reports** si aplica
  end note
  deactivate PG
  BE --> FE : 200
end
deactivate BE
FE --> U : resultado

@enduml
```

---

## 9. Consulta de telemetría v2 (multitenant) para dashboard

```plantuml
@startuml C4_secuencia_dashboard_telemetry_v2
!theme plain

actor Usuario as U
participant "Frontend" as FE
participant "Backend C++" as BE
database "PostgreSQL\nsensors_db" as PG

U -> FE : elige tenant / sitio /\nsensor / rango fechas
FE -> BE : GET /api/telemetry…\n(tenant_id, sensor_id, from, to)
activate BE
BE -> BE : validar sesión y\námbito tenant
BE -> PG : SELECT telemetry_raw\nWHERE tenant_id, sensor_id,\ncaptured_at BETWEEN …
activate PG
PG --> BE : series / agregados
deactivate PG
BE --> FE : JSON series
deactivate BE
FE --> U : gráficos dashboard

@enduml
```

---

*Índice alineado a `DIAGRAMA_ARQUITECTURA_BD.md`, migraciones `db_scripts/` y despliegue típico Docker.*
