# ADR-031 — Backend como núcleo de plataforma compartida (multi-componente)

**Status**: implemented (verificado 2026-07-06: `auth/`, `platform/`, `reports/`, `mining/` son módulos separados en `backend/src`; las rutas de auth (`auth_routes.cpp`) son agnósticas de componente, sin lógica de reportes filtrada dentro)
**Fecha**: 2026-06-24
**Autores**: EC
**Ámbito**: plataforma

> Refina ADR-002 (gateway central) y ADR-029 (identidad de plataforma) con una decisión de
> producto que reencuadra todo el proyecto.

## Contexto

Una lectura inicial podría tratar el backend como "el backend de la app de reportes", porque el componente que se está construyendo primero es ReportStudio. Pero la intención del producto es otra: **el backend es un núcleo de plataforma reutilizable** que servirá a **múltiples componentes/superficies**, no solo a reportes. El frontend de reportes incluido en `Referencias/` es el **primer componente, elegido por prioridad**; vendrán otros (visualización de data en tiempo real — ya esbozada en `MiningDashboard`/`TelemetryDashboard`/`GeotechWorkbench` — y más). Si las APIs se diseñan "para reportes", el segundo componente las encontrará acopladas y habrá que reescribir.

## Decisión

El backend se construye como **núcleo de plataforma compartido y component-agnóstico**. Sus servicios —identidad/RBAC/sesiones (ADR-029), telemetría e ingesta (ADR-007/008), auditoría (ADR-030), almacenamiento (ADR-009), gateway/proxy a sidecars (ADR-002/004)— son **transversales** y los consume **cualquier componente** del frontend. ReportStudio es el **primer componente (por prioridad)**, no el dueño del backend.

### Reglas duras
- Las APIs de plataforma (auth, perfiles, permisos, telemetría, auditoría) son **agnósticas del componente**: no se mete lógica específica de reportes en ellas.
- Lo específico de un componente vive en su propio módulo/endpoints (p.ej. `reports/`), sobre los servicios de plataforma.
- Un componente nuevo (real-time viz, etc.) **reutiliza** identidad, RBAC, telemetría y auditoría sin reimplementarlos.
- El versionado de las APIs de plataforma considera múltiples consumidores (no romper a un componente al evolucionar para otro).

### Mapa componente ↔ plataforma
- **Plataforma (compartida)**: gateway, auth/RBAC/perfiles, telemetría/ingesta, auditoría, almacenamiento de objetos, IA local.
- **Componente ReportStudio (v0.1, prioridad)**: editor de informes, workflow, export, `.miningreport`.
- **Componentes futuros**: visualización de data en tiempo real, y otros — sobre la misma plataforma.

## Consecuencias

### Positivas
- El esfuerzo de backend se capitaliza una vez y sirve a todos los componentes.
- Identidad, permisos y auditoría coherentes entre superficies (una sola verdad de acceso).
- Reencuadra el roadmap: Sprint 0 construye el core de plataforma; luego sprints por componente.

### Negativas / Trade-offs
- Diseñar APIs agnósticas exige más disciplina que resolver solo el caso de reportes — costo justificado por la reutilización.
- Riesgo de sobre-generalizar antes de tener el segundo componente — mitigado: se generaliza guiado por reportes (primer consumidor real), no en abstracto.

### Neutras
- No cambia el stack; cambia el contrato y la organización de las APIs.

## Alternativas descartadas

### Backend específico de reportes ahora, generalizar después
Tentador por velocidad, pero crea acoplamiento que el segundo componente paga caro (reescritura de auth/telemetría). Dado que ya sabemos que habrá más componentes, se diseña agnóstico desde el inicio.

### Un backend por componente (microfrontends con backends separados)
Multiplica auth/telemetría/auditoría y rompe la coherencia de identidad/permisos. Contradice la soberanía y el gateway central (ADR-002).

## Referencias
- `Referencias/frontend/src/components/Dashboard/` (MiningDashboard, TelemetryDashboard, GeotechWorkbench — superficies adicionales)
- `docs/specs/product-brief.md`
- ADR-002 (gateway central), ADR-029 (identidad), ADR-007/008 (telemetría), ADR-030 (auditoría)
