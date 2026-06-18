# ARQUITECTURA DE LA SOLUCIÓN — PLATAFORMA AURIXA

## Telemetría, Trazabilidad y Automatización Minera con IA — Vista de Arquitectura v36

**Versión:** v36 — sincronizada con el SOW Maestro v3.0 (SOW_Maestro_AURIXA_2026_v4)
**Fecha:** 18 de junio de 2026
**Audiencia:** Gerencia General, Líderes Técnicos y Gerencia TI
**Fuente de verdad técnica:** código real del repositorio (`docker-compose.yml`, `backend/`, `ai_engine/`, `formula_engine/`, `db_scripts/`) + SOW v4

> Este documento es la **vista maestra de arquitectura**. Reemplaza y consolida las versiones previas (branding "ControlTime", documentos de marzo–abril) que ya no reflejan el estado real de la solución. Los diagramas de detalle vigentes (BD, PlantUML del motor FORMULA y de login/biometría) se conservan como anexos técnicos en esta misma carpeta.

---

## 1. Resumen ejecutivo de la arquitectura

AURIXA dejó de ser una idea de plataforma para convertirse en un **sistema real, modular y en contenedores**, compuesto por **ocho servicios** que colaboran entre sí. No es un monolito: es una arquitectura de microservicios donde cada pieza tiene una responsabilidad clara (datos, aplicación, GIS, IA, motor de fórmulas, corrección de texto y experiencia de usuario).

La dirección estratégica del proyecto es clara: **migrar de la nube internacional (AWS) a una arquitectura soberana sobre infraestructura en Lima**, donde la información crítica reside en territorio nacional, con baja latencia y control operativo propio. La plataforma actual en AWS se mantiene únicamente como **fuente externa de datos** durante la transición.

Para gerencia, el mensaje es: la solución ya tiene una base técnica funcional y verificable; el proyecto la **industrializa, asegura y lleva a producción soberana** bajo gobierno formal.

---

## 2. Vista de componentes (arquitectura real desplegada)

La solución se orquesta con Docker Compose y se compone de los siguientes servicios reales:

| Servicio | Tecnología | Responsabilidad | Puerto |
|---|---|---|---|
| `db` | **TimescaleDB** (PostgreSQL 15 + series temporales) | Datos operativos, telemetría, usuarios, auditoría, KPIs | 5432 |
| `web` | **Backend C++** (mining gateway) | Núcleo de negocio, APIs REST, canal en vivo, seguridad, TLS | 8081 / 8443 |
| `formula_db` + `formula_engine` | **Motor FORMULA** (C++ + PostgreSQL 15) | Editor de lógica por bloques, fórmulas y SP, scope multi-tenant | 8020 |
| `ai_engine` | **Python** (InsightFace + ONNX + OpenCV) | Biometría facial, embeddings, control de calidad de rostro (EPP/gafas) | 5000 |
| `ollama` | **Ollama** (LLM local) | Reescritura y redacción asistida on-premise (`/api/text/rewrite`) | 11434 |
| `languagetool` | **LanguageTool** self-hosted (es-PE) | Corrección ortográfica y gramatical sin depender de la nube | 8010 |
| `tileserver` | **mbtileserver** (MBTiles) | Servidor de mapas/cartografía GIS offline | 8000 |
| `frontend` | **React + Nginx** | Editor ReportStudio, mapas, dashboards, experiencia de usuario | 5173 |

**Lectura de arquitectura:** el backend C++ actúa como **gateway central**: orquesta la base de datos, delega biometría al `ai_engine`, corrección de texto a `languagetool`, redacción premium a `ollama`, y consume el motor `formula_engine` y los mapas del `tileserver`. El frontend solo habla con el gateway. Este patrón concentra seguridad y trazabilidad en un único punto de control.

---

## 3. Capa de datos (TimescaleDB + 28 migraciones)

La base de datos no es un esquema plano: es un modelo **multi-tenant, auditado y orientado a telemetría**, construido mediante **28 migraciones versionadas** (`db_scripts/01..28`). Hitos del modelo de datos ya implementados:

- **Multi-tenant LATAM con i18n, RBAC y auditoría** (migración 16): el mismo sistema sirve a varias empresas/minas; cada tenant solo ve sus datos.
- **Telemetría multivariada y especificaciones de sensores** (17), **triggers de notificación y ETL** (18).
- **Informe técnico minero enterprise** (19) y **motor de fórmulas para informes** (09–10).
- **Trazabilidad y auditoría forzada** (20) con **contexto de auditoría derivado del login** (21): toda acción queda registrada con su responsable.
- **Telemetría de vigilancia y demo segura** (22–23), **marcadores geográficos oficiales** (24).
- **KPIs de runtime minero** (26), **zonas de sensores** (27) y **telemetría con UUID por tenant** (28).

El motor de series temporales (TimescaleDB) habilita el almacenamiento masivo de lecturas de sensores, alineado con el objetivo O4 (10,000 sensores simultáneos).

---

## 4. Seguridad y trazabilidad

- **Mining Gateway con TLS** (puerto 8443, certificados en `/certs`): canal cifrado para integraciones y operación.
- **RBAC multi-tenant** y segregación por empresa/mina (migración 16), con usuarios, perfiles y niveles de acceso.
- **Biometría facial en dos capas:** SDK **Dermalog** (CLI) + **red neuronal ONNX** de control de calidad de rostro (`face_qc.onnx`: detecta gafas, gorro, mascarilla, ojos cerrados, rostro no frontal), con umbrales de confianza configurables.
- **Auditoría forzada** (migraciones 20–21): el contexto de auditoría se deriva del login, garantizando trazabilidad de quién hizo qué (objetivo O7).
- **Objetivo de hardening (Etapa 2):** Zero-Trust, WireGuard site-to-site, pentest OWASP y cifrado de grado bancario (ver §7 y SOW Etapa 2).

---

## 5. Inteligencia Artificial local (sin nube)

La IA **vive en los servidores propios**, no envía datos a la nube:

- **`ai_engine` (Python):** InsightFace para embeddings faciales, clasificador ONNX de gafas con fusión CV+ONNX (`glasses_fusion`), análisis de ojos (liveness) y MediaPipe para landmarks.
- **`ollama` (LLM local):** redacción y reescritura asistida de informes on-premise.
- **`languagetool` (es-PE):** corrección ortográfica/gramatical autohospedada (objetivo O6, <1 s por párrafo).
- **Objetivo Etapa 2:** visión EPP por CCTV (casco/chaleco), STT (dictado por voz), OCR y biometría ONNX de producción.

---

## 6. Motor FORMULA y capa GIS

- **Motor FORMULA** (`formula_engine`, microservicio C++ con BD propia y *scope registry* multi-tenant): permite construir lógica de negocio "por bloques" (como un organigrama de decisiones), mapearla a procedimientos almacenados y ejecutar análisis ligados a esa lógica. Es un diferenciador de la plataforma.
- **GIS soberano:** `tileserver` (mbtileserver + MBTiles) sirve cartografía **sin internet**; el backend expone `/api/map/markers`, `/api/map/official-zones` y `/api/map/compliance-intersections` sobre GeoJSON de polígonos oficiales. Mapas de la mina con sensores que cambian de estado en vivo.

---

## 7. Arquitectura objetivo de infraestructura (VPS Lima soberana)

La meta de infraestructura (Etapa 2) es un esquema **primario–secundario en Lima**, no un VPS aislado:

- **Sitio primario:** clúster de virtualización dedicada (recomendación: Cirion LIM1).
- **Sitio secundario / DR:** segundo data center con réplica continua (recomendación: GTD Lurin).
- **Continuidad:** replicación continua de BD, VPN site-to-site, backups externos, failover controlado, objetivo de RTO agresivo.
- **Seguridad de borde:** anti-DDoS, firewall administrado, segmentación por VLAN, MFA de administración, NOC 24x7.

Detalle completo en `Arquitectura_Final_AURIXA_Datacenter_Lima` (.docx/.md) de esta carpeta.

---

## 8. ANÁLISIS DETALLADO DE CAMBIOS EN LA ARQUITECTURA

Esta sección es el núcleo del documento: qué cambió respecto a la concepción anterior y por qué.

### 8.1 Cambios estructurales

| Dimensión | Arquitectura anterior | Arquitectura actual / objetivo v36 | Impacto |
|---|---|---|---|
| Infraestructura | Nube AWS (cloud internacional) | **VPS/virtualización soberana en Lima**; AWS solo como fuente de datos | Soberanía, baja latencia, costo previsible |
| Estilo | Concepción monolítica | **Microservicios en contenedores** (8 servicios) | Escalabilidad y aislamiento de fallas |
| Base de datos | PostgreSQL genérico | **TimescaleDB** + 28 migraciones multi-tenant auditadas | Telemetría masiva y trazabilidad real |
| Corrección de texto | Dependencia de API externa | **LanguageTool self-hosted (es-PE)** | Disponibilidad y soberanía |
| Redacción IA | No definida / externa | **Ollama LLM local** on-premise | IA sin enviar datos a la nube |
| Biometría | Conceptual | **Dermalog CLI + ONNX face_qc** (capa real) | Control de acceso por rostro con QC |
| Lógica de negocio | Embebida en backend | **Motor FORMULA** (microservicio + BD propia) | Configuración por bloques, diferenciador |
| GIS | Mapas genéricos | **mbtileserver + GeoJSON oficial** offline | Cartografía soberana sin internet |
| Multi-tenant | Brecha identificada (pendiente) | **Implementado** (RBAC + i18n + audit, migr. 16) | Operación multi-cliente coherente |
| Cliente móvil | App móvil nativa (iOS/Android) | **Descartada**: web responsive + modo offline en tablet | Menor complejidad, foco en alcance |
| Marca | "ControlTime v3.0" | **AURIXA** | Identidad unificada del proyecto |

### 8.2 Implementado vs objetivo (honestidad de ingeniería)

No todo el stack objetivo del SOW está aún desplegado; la Etapa 2 cierra la brecha:

| Componente del SOW | Estado actual | Plan |
|---|---|---|
| TimescaleDB (series temporales) | **Desplegado** (`db`) | — |
| Ollama / IA local | **Desplegado** (`ollama`, `ai_engine`) | Afinamiento Etapa 2 (S11) |
| GIS offline | **Desplegado** (`tileserver`) | Capas operativas adicionales |
| **Redpanda** (ingesta 10k/seg) | **No desplegado aún** | Incorporar en hardening de carga (Etapa 2, S9–S12) para escalar ingesta a 10k sensores |
| **MinIO** (almacenamiento objeto) | **No desplegado aún** | Incorporar como almacén soberano de archivos en Etapa 2 |
| **WireGuard** (túnel seguro) | **No desplegado aún** | Parte del hardening de red en VPS Lima (S9–S11) |
| Visión EPP / STT voz | Base en `ai_engine` | Producción en Etapa 2 (S6, S11) |

> Esta diferenciación es deliberada: la Etapa 1 consolida el núcleo funcional ya existente; la Etapa 2 introduce los componentes de escala (Redpanda), almacenamiento (MinIO) y seguridad de red (WireGuard) bajo la infraestructura soberana de Lima.

### 8.3 Por qué estos cambios (lectura gerencial)

1. **De la nube a la soberanía:** reduce dependencia externa en procesos core y mejora el control del dato minero.
2. **De monolito a microservicios:** permite endurecer y escalar cada pieza sin arriesgar el conjunto.
3. **IA y corrección locales:** eliminan el envío de datos sensibles (rostros, informes) a terceros.
4. **Multi-tenant real:** habilita operar varias empresas/minas con un solo sistema, base para escalar el negocio.
5. **Descartar móvil nativo:** concentra el esfuerzo en la web responsive + offline, alineado al alcance y al presupuesto aprobados.

---

## 9. Mapeo arquitectura → KPIs y etapas del SOW

| KPI | Componente arquitectónico que lo soporta | Etapa |
|---|---|---|
| O1 <20 ms render | Backend C++ + frontend optimizado | E2 (S9, S11) |
| O3 <5 s reportes | Editor ReportStudio + export backend | E1 (S7) |
| O4 10,000 sensores | TimescaleDB + (objetivo) Redpanda | E1 sim (S6) / E2 estrés (S12) |
| O5 >99.9% uptime | DR primario-secundario Lima + monitoreo | E2 (S10, S13) |
| O6 <1 s IA/párrafo | Ollama + LanguageTool locales | E1 (S6) / E2 (S11) |
| O7 trazabilidad 100% | Auditoría forzada (migr. 20–21) | E1 (S4, S8) |

---

## 10. Anexos técnicos vigentes (en esta carpeta)

- `DIAGRAMA_ARQUITECTURA_BD.md` — vista de despliegue y BD (componentes reales).
- `DISENO_BD_PRESENTACION_GERENCIAS.md` — auditoría, trazabilidad y orden de migraciones.
- `DIAGRAMAS_PLANTUML_FORMULA_Y_BACKEND.puml` — 13 vistas del motor FORMULA, SP y backend.
- `DIAGRAMAS_PLANTUML_LOGIN_BIOMETRIA.puml` — flujo de login y biometría.
- `DIAGRAMA_TEXTO_SP_DESDE_LIENZO_FORMULA.md` — mapeo lienzo → procedimientos almacenados.
- `DIAGRAMAS_FLUJO_PLATAFORMA_MINERA.md` — flujos operativos.
- `BACKEND_DISENO_ARQUITECTURA.md` — diseño técnico detallado del backend.
- `BACKEND_EXPLICACION_SENCILLA.md` — explicación no técnica del backend.
- `Arquitectura_Final_AURIXA_Datacenter_Lima.docx/.md` — infraestructura y DR en Lima.
- `INFORME_ARQUITECTURA_NUEVA_PLATAFORMA_DETALLADO.pdf` — informe de arquitectura detallado.

---

## 11. Conclusión

La arquitectura de AURIXA es hoy una solución **modular, soberana y trazable**, con una base funcional real (ocho servicios, 28 migraciones, IA y biometría locales, motor de fórmulas y GIS offline). El proyecto la lleva a producción endureciéndola con escala (Redpanda), almacenamiento (MinIO) y seguridad de red (WireGuard) sobre infraestructura primario-secundario en Lima. Cada cambio responde a tres prioridades de dirección: **soberanía del dato, continuidad del negocio y trazabilidad ejecutiva.**
