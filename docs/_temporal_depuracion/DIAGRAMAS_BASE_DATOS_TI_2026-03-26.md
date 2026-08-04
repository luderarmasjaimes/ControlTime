# Diagramas de Base de Datos - Presentacion Gerencia TI

Este documento representa la arquitectura de datos actualmente implementada en los scripts SQL del proyecto.

## 1) Modelo ER principal (Auth + Reportes + Comparticion)

```mermaid
erDiagram
    AUTH_USERS {
        uuid id PK
        varchar company_name
        varchar first_name
        varchar last_name
        varchar dni UK
        varchar username
        varchar role
        text password_hash
        boolean is_active
        timestamptz created_at
        timestamptz updated_at
        varchar ruc
        varchar phone
        varchar mobile
        varchar email
    }

    AUTH_FACE_TEMPLATES {
        uuid id PK
        uuid user_id FK
        varchar template_version
        jsonb template_vector
        timestamptz created_at
    }

    AUTH_AUDIT_LOGS {
        bigint id PK
        timestamptz event_time
        varchar event_action
        varchar company_name
        varchar username
        boolean success
        text detail
        varchar source_ip
    }

    PROJECTS {
        uuid id PK
        varchar name
        text description
        timestamptz created_at
        timestamptz updated_at
    }

    REPORTS {
        uuid id PK
        uuid project_id FK
        varchar title
        jsonb content_json
        varchar status
        timestamptz created_at
        timestamptz updated_at
        uuid created_by FK
        uuid reviewed_by FK
        timestamptz reviewed_at
        timestamptz deleted_at
        int version_number
        uuid last_modified_by FK
        varchar company_name
    }

    REPORT_SHARES {
        uuid id PK
        uuid report_id FK
        uuid sent_by FK
        uuid sent_to FK
        text message
        timestamptz sent_at
        timestamptz read_at
    }

    NOTIFICATIONS {
        uuid id PK
        uuid user_id FK
        varchar type
        jsonb payload
        boolean is_read
        timestamptz created_at
    }

    GEOMETRIC_DATA {
        uuid id PK
        uuid report_id FK
        varchar name
        varchar data_type
        geometry location
        text binary_data_url
        jsonb metadata
        timestamptz created_at
    }

    AUTH_USERS ||--o{ AUTH_FACE_TEMPLATES : has
    AUTH_USERS ||--o{ REPORTS : creates
    AUTH_USERS ||--o{ REPORTS : reviews
    AUTH_USERS ||--o{ REPORTS : modifies
    PROJECTS ||--o{ REPORTS : owns
    REPORTS ||--o{ GEOMETRIC_DATA : contains
    REPORTS ||--o{ REPORT_SHARES : shared_as
    AUTH_USERS ||--o{ REPORT_SHARES : sends
    AUTH_USERS ||--o{ REPORT_SHARES : receives
    AUTH_USERS ||--o{ NOTIFICATIONS : receives
```

## 2) Modelo ER de telemetria y dashboards (Timescale v2)

```mermaid
erDiagram
    TENANTS {
        uuid tenant_id PK
        text tenant_name UK
        text legal_name
        char country_code
        text timezone
        timestamptz created_at
    }

    SITES {
        uuid site_id PK
        uuid tenant_id FK
        text site_code
        text site_name
        text region
        double latitude
        double longitude
        timestamptz created_at
    }

    ASSETS {
        uuid asset_id PK
        uuid tenant_id FK
        uuid site_id FK
        text asset_code
        text asset_name
        text asset_type
        uuid parent_asset_id FK
        jsonb metadata
        boolean is_active
        timestamptz created_at
    }

    SENSORS {
        uuid sensor_id PK
        uuid tenant_id FK
        uuid site_id FK
        uuid asset_id FK
        text sensor_code
        text sensor_name
        text sensor_type
        text unit
        jsonb metadata
        boolean is_active
        timestamptz created_at
    }

    TELEMETRY_RAW {
        bigint telemetry_id PK
        timestamptz captured_at PK
        uuid tenant_id FK
        uuid site_id FK
        uuid asset_id FK
        uuid sensor_id FK
        timestamptz ingested_at
        double value_numeric
        text value_text
        smallint quality_code
        text raw_payload
        jsonb tags
    }

    ALERT_RULES {
        uuid rule_id PK
        uuid tenant_id FK
        uuid site_id FK
        uuid sensor_id FK
        text rule_name
        text condition_type
        double threshold_value
        text severity
        boolean is_active
        jsonb config
        timestamptz created_at
    }

    ALERTS {
        bigint alert_id PK
        uuid tenant_id FK
        uuid site_id FK
        uuid sensor_id FK
        uuid rule_id FK
        text severity
        text title
        text description
        text status
        timestamptz triggered_at
        timestamptz acknowledged_at
        timestamptz resolved_at
        jsonb metadata
    }

    DASHBOARDS {
        uuid dashboard_id PK
        uuid tenant_id FK
        text dashboard_name
        text description
        jsonb layout
        jsonb theme
        boolean is_public
        int version
        text created_by
        timestamptz created_at
        timestamptz updated_at
    }

    DASHBOARD_WIDGETS {
        uuid widget_id PK
        uuid dashboard_id FK
        text widget_type
        text widget_title
        jsonb position
        jsonb options
        text data_source_kind
        text data_source_ref
        int refresh_interval_ms
        timestamptz created_at
        timestamptz updated_at
    }

    WIDGET_QUERIES {
        uuid query_id PK
        uuid widget_id FK
        text query_name
        text query_sql
        jsonb parameters
        boolean is_enabled
        timestamptz created_at
        timestamptz updated_at
    }

    TENANTS ||--o{ SITES : owns
    TENANTS ||--o{ ASSETS : owns
    TENANTS ||--o{ SENSORS : owns
    TENANTS ||--o{ TELEMETRY_RAW : owns
    TENANTS ||--o{ ALERT_RULES : owns
    TENANTS ||--o{ ALERTS : owns
    TENANTS ||--o{ DASHBOARDS : owns

    SITES ||--o{ ASSETS : groups
    SITES ||--o{ SENSORS : hosts
    SITES ||--o{ TELEMETRY_RAW : locates

    ASSETS ||--o{ SENSORS : has
    ASSETS ||--o{ TELEMETRY_RAW : source
    ASSETS ||--o{ ASSETS : parent_of

    SENSORS ||--o{ TELEMETRY_RAW : emits
    SENSORS ||--o{ ALERT_RULES : monitored_by
    SENSORS ||--o{ ALERTS : triggers

    ALERT_RULES ||--o{ ALERTS : generates

    DASHBOARDS ||--o{ DASHBOARD_WIDGETS : contains
    DASHBOARD_WIDGETS ||--o{ WIDGET_QUERIES : executes
```

## 3) Flujo de datos operacional (alto nivel)

```mermaid
flowchart LR
    A[Frontend UI] -->|Auth/Register/Login| B[Backend API]
    A -->|Dashboard/Sensores| B
    A -->|Reportes CRUD| B
    A -->|Mapa y capas| TS[TileServer MBTiles]

    B -->|SQL Auth| DB[(PostgreSQL/Timescale)]
    B -->|SQL Reportes| DB
    B -->|SQL Telemetria| DB
    B -->|Jobs ECW MBTiles| FS[(Storage /data)]

    FS --> TS
```

## 4) Observaciones para Gerencia TI

- El modelo de datos para auth, reportes y telemetria esta presente y extensible.
- Ya existen tablas para comparticion (`report_shares`) y notificaciones (`notifications`), pero su uso en API/Frontend aun no esta cerrado end-to-end.
- El esquema telemetrico esta preparado para crecimiento multi-tenant con Timescale.
- Se recomienda formalizar diccionario de datos y politicas de retencion por dominio (auth, reportes, telemetria).

