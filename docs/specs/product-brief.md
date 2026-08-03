# Product Brief — Beemetry 2.0

> Documento de una página que captura QUÉ construimos, PARA QUIÉN, y POR QUÉ.
> Generado en Phase 0 del bootstrap. Es el ancla de todas las decisiones posteriores.
> Fecha: 2026-06-24
>
> **Nota de naming**: el producto se llama **Beemetry**. "AURIXA" es el nombre anterior
> (aún presente en código y docs de `Referencias/`) y "ControlTime" es el nombre legacy
> previo a v36. El renaming a Beemetry se formaliza en un ADR (ver `docs/decisions/`).
> Beemetry es la empresa y el producto; "Beemetry 2.0" es esta reconstrucción ordenada.

## Qué construimos

Una plataforma soberana (on-premise, VPS Linux en Lima) que le da a una operación minera **una sola fuente de verdad operativa**: integra monitoreo de sensores geotécnicos en tiempo real, un editor de informes técnicos trazable (ReportStudio), un GIS operativo con capas y zonas, y asistencia de IA local — y todo eso sigue funcionando aun cuando se cae la conectividad. Es, en una metáfora: *"un Word + Power BI + GIS mineros, pero corriendo dentro de los servidores propios de la mina, sin nube externa y sin perder un dato"*.

**Arquitectura de producto — plataforma + componentes**: Beemetry es una **plataforma** con un **backend núcleo compartido** (identidad/RBAC/perfiles, telemetría/ingesta, auditoría, almacenamiento, IA local, gateway) que sirve a **múltiples componentes/superficies**, no a una sola app. El **componente que se construye primero, por prioridad, es ReportStudio** (para el ingeniero geotécnico). Los demás componentes —visualización de data en tiempo real (ya esbozada en `MiningDashboard`/`TelemetryDashboard`/`GeotechWorkbench`) y otros— se montan después **sobre el mismo backend**, sin reimplementar auth, telemetría ni auditoría. Ver ADR-031 y ADR-002.

## Para quién

**Persona concreta**: **Daniel, ingeniero geotécnico de mina**. Monitorea sensores de estabilidad de taludes (inclinómetros, prismas de desplazamiento, piezómetros), interpreta tendencias, y al final del turno/semana debe producir un **informe técnico formal y trazable** que sustenta decisiones de seguridad operativa. Hoy arma ese informe a mano combinando exportes de varios sistemas (planillas, capturas de dashboards, mapas sueltos), sin trazabilidad de versiones ni vínculo en vivo con el dato que cita. Trabaja en condiciones de campo (tablet, poca señal, a veces sin conectividad).

**Tipo de producto**: B2B · herramienta operativa-crítica para el cliente minero (no SaaS multi-cliente comercial todavía; despliegue soberano por operación).

**Ecosistema / plataforma donde vive**: stack propio de 8 servicios sobre Docker con el **backend C++ como gateway central** — TimescaleDB (telemetría), formula_engine, ai_engine (Python/biometría), Ollama (LLM local), LanguageTool (corrección es-PE), mbtileserver (mapas), frontend React/Nginx. Integra de forma controlada con fuentes externas autorizadas (histórico), pero la verdad operativa vive on-prem.

## El dolor real

**Antes** (sin el producto):
El ingeniero consolida información dispersa de herramientas no trazables: exporta datos de sensores a planillas, captura dashboards a imágenes, pega mapas, y arma el informe en Word. Cada informe puede tomar **horas** y no hay garantía de que el número citado corresponda al dato real de ese instante, ni historial de quién cambió qué. Si se cae internet, el trabajo se frena. La reacción ante una alarma depende de mirar varias pantallas a la vez.

**Después** (con el producto):
El dato del sensor, el mapa y el informe viven en una misma plataforma. El ingeniero redacta el informe **citando widgets en vivo** (un KPI, una serie de inclinómetro, una captura de mapa) con trazabilidad y versionado; autoguardado <0.5s; exporta a PDF/Word en <5s; y puede seguir editando **sin conectividad** y reconciliar al reconectar **sin perder un dato**. La respuesta a alarmas es ordenada y la latencia de pantalla es <20 ms.

## Promesas duras

Las cosas que, si no se cumplen, no tiene sentido construir esto.

1. **Soberanía + cero pérdida de datos** — toda la información crítica reside on-prem (territorio nacional) y la operación garantiza *Zero Data Loss*. En **v0.1** esto se cumple en **operación conectada** (autoguardado <0.5s + versionado autoritativo en servidor); la **operación offline** (cola + reconciliación) es objetivo de una **versión futura**, condicionada a una PoC de almacenamiento local >5MB (ADR-022). Si el dato se pierde o sale de los servidores propios, el producto no cumple su razón de ser.
2. **Trazabilidad en vivo del dato al informe** — lo que un informe cita (sensor, KPI, mapa) está vinculado a la fuente real y versionado/auditado. Sin esto es un editor de texto más, no una "fuente de verdad".
3. **Tiempo real local <20 ms / IA local <1s** — la respuesta de pantalla y la asistencia de IA ocurren localmente, a velocidad operativa, sin depender de la nube. Esto es lo que habilita el uso en sala de control y en campo.

Estas promesas son los ejes de cada decisión arquitectónica. Cualquier propuesta que las viole se rechaza.

## Material real de referencia

- **Codebase vibecodeado completo**: `Referencias/backend` (C++ Boost.Beast) y `Referencias/frontend` (React/Vite, `ReportStudioV2`). Es la implementación de la que se rescatan los módulos probados (estrategia: **rescate híbrido**). Inventario completo en `docs/references/` (Phase 9).
- **SOW maestro**: `Referencias/docs/00_SOW/SOW_Maestro_AURIXA_2026_v4.md` — alcance, 13 sprints, 6 releases, KPIs y SLA. Fuente de las promesas duras.
- **Arquitectura v36**: `Referencias/docs/02_Arquitectura/Arquitectura_Solucion_AURIXA_v36.md`, `Arquitectura_Objetivo_Capas_AURIXA_v36.md`, `BACKEND_DISENO_ARQUITECTURA.md`, `Modelo_Datos_AURIXA_v36.md`, `Optimizacion_TiempoReal_CPP_AURIXA_v36.md`.
- **Output esperado (golden)**: el formato de informe minero `.miningreport` (`ReportStudioV2/lib/miningReportFormat.js`) y los manuales operativos en `Referencias/docs/09_Manuales_Operativos/`. Se analizan como fixture canónico en Phase 2.

## Out of scope (v0.1)

Lo que explícitamente NO hace el MVP de Beemetry 2.0 (alineado con Etapa 1 del SOW; el resto es Etapa 2 / backlog):

- **Biometría facial + visión EPP en producción** — existe como PoC/módulo (ai_engine, `face_analysis`), pero se **difiere a la versión más futura del producto**, no a Etapa 2. Razón **legal, no técnica**: persistir datos biométricos exige validar previamente los requisitos de protección de datos sensibles de cada país (Perú/LATAM). Hasta tener base legal validada, no se almacena biométrico en producción. (Login v0.1 = usuario/contraseña + RBAC; el flujo facial existente queda como capacidad latente, no activa.)
- **CCTV/HLS en vivo y avatar ONNX (cartoon)** — fuera de v0.1.
- **Visor 3D de modelos mineros** (`Viewer3D`) — fuera de v0.1.
- **Mapa como bloque tipado con geo-referencia** — v0.1 inserta el mapa como snapshot a imagen (resultado del popup `MapCaptureModal`); el bloque `map` tipado con geo-ref + capas se difiere a versión futura (ADR-020).
- **Modo offline (cola + reconciliación)** — diferido a versión futura, condicionado a una PoC de almacenamiento local >5MB (localStorage no alcanza; candidato IndexedDB). v0.1 opera conectado con autoguardado (ADR-022).
- **Conversión raster GDAL (ECW/GeoTIFF) y worker `gis-raster`** — diferido a versión futura; requiere análisis más detallado (subprocess vs librería enlazada, escalado del worker). Los mapas de v0.1 usan MBTiles/MapLibre ya servidos, sin conversión raster on-demand.
- **Carga de estrés a 10.000 sensores y DR geográfico** — son hitos de hardening (Etapa 2), no del MVP funcional.
- **App móvil nativa** — explícitamente excluida en el SOW.
- **Multi-tenant comercial / SaaS público** — el despliegue es soberano por operación; multi-tenancy se mantiene en el modelo pero no se comercializa en v0.1.
