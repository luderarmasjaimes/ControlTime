# Documento de diseño técnico — Backend (plataforma de automatización minera)

**Versión:** 1.0  
**Audiencia:** Gerencia de TI / Arquitectura / Operaciones  
**Alcance:** Componentes de **backend** y servicios asociados (incluye módulo **FORMULA**). El frontend se menciona solo como borde de enrutamiento y consumo de APIs.

**Rol del autor (demo):** Arquitecto principal senior — visión integrada de automatización minera, multi-tenant y despliegue en contenedores.

**Lectura en lenguaje sencillo (TI y no TI):** ver `BACKEND_EXPLICACION_SENCILLA.md`.

---

## 1. Propósito del documento

Este documento describe la **arquitectura lógica y de despliegue** de los servicios backend que soportan la plataforma: API principal, motor de fórmulas mineras (FORMULA), motor de IA asistencial, bases de datos, mapas y proxies HTTP. Incluye **diagramas en texto** (bloques con líneas `===`) exportables a herramientas de diagramación para presentaciones ejecutivas.

---

## 2. Visión general (una frase)

La solución separa **datos operativos y autenticación** (API principal + PostgreSQL/Timescale `sensors_db`) del **motor de diagramas de bloques y análisis de temperatura** (servicio C++ dedicado + PostgreSQL `formula`), con un **servicio de visión/IA** para flujos biométricos y asistencia por imagen, y un **servidor de teselas** para mapas.

---

## 3. Arquitectura lógica — capas

```
                    ┌─────────────────────────────────────────────────────────┐
                    │              CLIENTES (navegador / integraciones)        │
                    └───────────────────────────┬─────────────────────────────┘
                                                │
                    ┌───────────────────────────▼─────────────────────────────┐
                    │  FRONTEND ESTÁTICO (nginx) — puerto publicado ej. 5173   │
                    │  • SPA React + assets estáticos (/formula, etc.)        │
                    │  • Enrutamiento inverso (reverse proxy) — ver §6          │
                    └───────────────┬─────────────────────┬───────────────────┘
                                    │                     │
              ┌─────────────────────▼──────┐    ┌──────────▼──────────────────────┐
              │  /api/*  → backend:8081    │    │  /formula-api/* → formula:8020 │
              │  (API principal)           │    │  (motor FORMULA)               │
              └───────────────┬────────────┘    └──────────┬──────────────────────┘
                              │                            │
    ┌─────────────────────────▼────────────┐   ┌──────────▼──────────────────────┐
    │  SERVICIO WEB (backend — C++)        │   │  FORMULA_ENGINE (C++ Boost.Beast) │
    │  • Auth, informes, métricas,        │   │  • Estado del diagrama (blocks/   │
    │    biométrica vía proxy a IA,       │   │    connections), análisis temp.,   │
    │    catálogos mineros para análisis  │   │    sesiones formula_sessions       │
    │  • DATABASE_URL → sensors_db       │   │  • DATABASE_URL → formula_db       │
    └─────────────────────────┬────────────┘   └──────────┬──────────────────────┘
                              │                         │
              ┌───────────────▼────────────┐   ┌────────▼────────────┐
              │  PostgreSQL + Timescale   │   │  PostgreSQL 15      │
              │  sensors_db               │   │  formula            │
              │  (telemetría, auth,       │   │  (bloques, conex.,  │
              │   informes, diccionario   │   │   minería, SP)      │
              │   fórmula catálogo)       │   │                     │
              └───────────────────────────┘   └─────────────────────┘

              ┌───────────────────────────┐
              │  AI_ENGINE (Python) :5000 │
              │  • Salud facial, ONNX,    │
              │    embeddings (Insight)   │
              └─────────────┬─────────────┘
                            │  llamado por web (HTTP)
                            ▼
              ┌───────────────────────────┐
              │  TILESERVER (MBTiles)     │
              │  :8000 — mapas base       │
              └───────────────────────────┘
```

---

## 4. Topología de despliegue (Docker Compose — referencia)

Los nombres de servicio son los habituales en el repositorio; los puertos **host** pueden variar según `docker-compose.yml`.

```
┌──────────────┐     ┌──────────────┐     ┌─────────────────┐
│   frontend   │────▶│     web      │────▶│       db        │
│   (nginx)    │     │  (backend)   │     │  (Timescale)    │
└──────┬───────┘     └──────┬───────┘     │  sensors_db     │
       │                    │             └─────────────────┘
       │                    │
       │                    ├──────────────────┐
       │                    ▼                  ▼
       │             ┌──────────────┐   ┌─────────────┐
       │             │  ai_engine   │   │ tileserver  │
       │             │   :5000      │   │   :8000     │
       │             └──────────────┘   └─────────────┘
       │
       ├──────────────────────────────┐
       ▼                              ▼
┌──────────────┐              ┌──────────────┐
│formula_engine│─────────────▶│ formula_db   │
│   :8020      │              │  PostgreSQL  │
└──────────────┘              └──────────────┘
```

**Relación de dependencias (salud):** el `frontend` espera `web`, `tileserver` y `formula_engine` listos; `web` depende de `db` y `ai_engine`.

---

## 5. Módulo: API principal (`backend` / servicio `web`)

### 5.1 Responsabilidad

- Punto único HTTP para rutas **`/api/*`** expuestas al navegador vía nginx del frontend.
- Autenticación (login empresa / usuario, flujos biométricos coordinados).
- CRUD de informes, proyectos, métricas de dashboard, sensores, mapas, vigilancia.
- **Catálogo minero para FORMULA/análisis:** rutas como `/api/analysis/catalogos` que leen vistas/tablas en `sensors_db` filtradas por tenant (empresa).
- Diccionario de datos de fórmulas: `/api/formula/dictionary` sobre tablas sembradas por scripts SQL.

### 5.2 Datos

- Conexión: **`DATABASE_URL` → `sensors_db`** (usuario `sensors`).

### 5.3 Integración con IA

- Variable **`AI_ENGINE_URL=http://ai_engine:5000`**: el backend reenvía o procesa frames según endpoints (`/api/process_frame`, flujos biométricos documentados en código).

### 5.4 TLS / gateway

- Puerto **8443** y certificados para **MINING_GATEWAY** (según variables de entorno del servicio).

---

## 6. Borde HTTP: nginx del `frontend` (relevante para backend)

No es un microservicio de negocio, pero **define el encaminamiento** hacia los backends:

| Prefijo URI        | Destino interno        | Uso |
|--------------------|------------------------|-----|
| `/api/`            | `web:8081`             | API principal |
| `/formula-api/`    | `formula_engine:8020`| Motor FORMULA (REST + estado) |
| `/formula-api/ws`  | WebSocket del motor  | Eventos en tiempo real (si aplica) |
| `/ws`              | `web:8081`             | WebSocket del backend principal |

El editor estático FORMULA (`/formula/…`) configura **`window.FORMULA_API_PREFIX = '/formula-api'`** para que las llamadas a `/api/state`, `/api/block`, etc. se resuelvan contra el motor **a través del prefijo**, no contra la API principal.

---

## 7. Módulo: FORMULA (`formula_engine` + `formula_db`)

### 7.1 Responsabilidad

- **Persistencia del diagrama:** tablas `blocks`, `connections`, `rules`, etc., con columna **`diagram_id`** para aislar diagramas por tenant (`emp{id}_mina{id}`).
- **API REST** para el editor: estado, bloques, conexiones, variables, operadores, reglas, render opcional.
- **Análisis de temperaturas:** `POST /api/analysis/temperaturas` ejecuta el procedimiento almacenado **`sp_proceso_temperatura`** sobre lecturas mineras.
- **Historial de sesiones:** `formula_sessions` en la base **`formula`** (auditoría de guardados con `formula_json` snapshot).
- **Restaurar sesión:** `POST /api/analysis/sesiones/:id/restaurar` reaplica el snapshot JSON al `diagram_id` canónico del tenant.

### 7.2 Datos

- Base dedicada: **`formula`** en PostgreSQL 15 (`formula_db`).
- Scripts de inicialización: `formula_engine/init.sql`, `init_minas.sql`, `add_sensores.sql` (montaje en `docker-entrypoint-initdb.d`).

### 7.3 Puerto

- Contenedor escucha **8020**; en compose típico se publica **`18020:8020`** al host.

### 7.4 Coherencia multi-tenant

- El editor y el SP usan el mismo criterio de **`diagram_id`** canónico por empresa+mina.
- Snapshots de historial deben obtenerse con **`GET /api/state?diagram_id=…`** para no guardar JSON vacío.

---

## 8. Módulo: AI Engine (`ai_engine`)

### 8.1 Responsabilidad

- Servicio **Python** (puerto interno **5000**): inferencia ONNX (p. ej. clasificación de gafas), modelos faciales (InsightFace), rutas `/health` y procesamiento de imagen según Dockerfile y variables.
- **No** persiste el núcleo de negocio minero; actúa como **motor de inferencia** invocado por el backend.

### 8.2 Volúmenes

- Caché de modelos InsightFace en volumen nombrado; logs opcionales en host.

---

## 9. Módulo: Tileserver (`tileserver`)

### 9.1 Responsabilidad

- Servir **MBTiles** / catálogo de servicios para mapas base usados por la SPA (puerto **8000** típico).
- Solo lectura de datos montados desde `./data`.

---

## 10. Bases de datos — resumen

```
┌─────────────────────────────────────────────────────────────────┐
│                        sensors_db (Timescale/PostgreSQL)         │
│  • Autenticación, auditoría, usuarios por empresa               │
│  • Telemetría, lecturas, entidades mineras (empresa, mina, var.) │
│  • Informes, proyectos                                           │
│  • Catálogos/vistas para análisis (v_mineria_catalogos, etc.)   │
│  • Diccionario fórmula (formula_data_dictionary, …)             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        formula (PostgreSQL 15)                   │
│  • blocks, connections, rules — diagram_id multitenant            │
│  • mineria_* tablas y lecturas para el SP                        │
│  • formula_sessions (historial JSON + metadatos)                 │
│  • sp_proceso_temperatura, funciones de evaluación de expresiones │
└─────────────────────────────────────────────────────────────────┘
```

---

## 11. Diagramas de flujo (texto, líneas ===)

### 11.1 Flujo: usuario edita diagrama FORMULA y guarda estado

```
[Usuario en navegador]
        │
        ▼
[SPA carga /formula/index.html]
        │
        ▼
===  JS editor (app.js)  ===
        │
        │  HTTP GET/POST con prefijo /formula-api
        ▼
[Nginx frontend]
        │
        │  proxy_pass → formula_engine:8020
        ▼
[formula_engine]
        │
        │  SQL read/write
        ▼
[formula_db  —  tabla blocks / connections por diagram_id]
```

---

### 11.2 Flujo: análisis de temperatura (gráfico / SP)

```
[Usuario en analisis.html]
        │
        │  POST /api/analysis/temperaturas  (vía apiBase o ruta configurada)
        ▼
[formula_engine]
        │
        │  SELECT … FROM sp_proceso_temperatura(empresa, mina, variable, fechas)
        ▼
[formula_db]
        │
        │  • Lee mineria_lecturas
        │  • Recorre grafo blocks/connections del diagram_id del tenant
        ▼
[Filas resultado → JSON al cliente]
```

---

### 11.3 Flujo: guardar fórmula en historial (snapshot)

```
[Usuario: modal Guardar en analisis.html]
        │
        │  GET /api/state?diagram_id=emp{X}_mina{Y}   ← snapshot correcto
        │  POST /api/analysis/guardar  →  formula_engine
        ▼
[formula_db.formula_sessions]
        │
        │  INSERT formula_json (blocks + connections + captured_at)
        ▼
[Registro disponible en búsqueda de historial]
```

---

### 11.4 Flujo: restaurar sesión desde historial

```
[Usuario: doble clic en fila del historial]
        │
        │  POST /api/analysis/sesiones/:id/restaurar
        ▼
[formula_engine]
        │
        │  Lee empresa_id, mina_id de formula_sessions
        │  diagram_id destino = emp{e}_mina{m}
        │  DELETE scoped + INSERT desde formula_json
        ▼
[formula_db actualizado para ese diagram_id]
        │
        ▼
[Cliente: refreshState() — lienzo alineado al tenant]
```

---

### 11.5 Flujo: login / biométrica (alto nivel)

```
[Cliente]
        │
        │  /api/auth/*  y/o  /api/process_frame
        ▼
[backend web]
        │
        ├──────────────────────┐
        │                      │
        ▼                      ▼
[sensors_db]            [ai_engine]
  persistencia            inferencia imagen
```

---

## 12. Matriz de trazabilidad (módulo → artefacto)

| Módulo            | Código / imagen      | Base de datos | Expone (ejemplos) |
|-------------------|----------------------|---------------|-------------------|
| API principal     | `backend/` Docker    | `sensors_db`  | `/api/*` |
| FORMULA           | `formula_engine/`    | `formula`     | vía `/formula-api/` |
| IA                | `ai_engine/`         | —             | interno `:5000` |
| Mapas             | `tileserver` imagen  | —             | `:8000` |
| SQL evolutivo     | `db_scripts/`        | ambas / seed  | migraciones init |

---

## 13. Riesgos y decisiones de arquitectura (resumen)

1. **Dos bases de datos:** separa carga operativa general (`sensors_db`) del dominio pesado del grafo FORMULA (`formula`), facilitando backup y escalado independiente.
2. **Proxy explícito `/formula-api`:** evita colisionar con `/api` del monolito C++ principal y deja claro el límite del motor de diagramas.
3. **diagram_id obligatorio en estado:** cualquier herramienta que serialice el lienzo debe incluir el tenant en la query de estado para no persistir snapshots vacíos.
4. **SP en base `formula`:** la lógica de negocio de recorrido del grafo vive cerca de los datos del diagrama, reduciendo round-trips.

---

## 14. Cómo reutilizar los diagramas en presentaciones

- Copiar los bloques entre líneas `===` o los recuadros ASCII de las secciones **3**, **4**, **10** y **11** a herramientas tipo **PlantUML** (activity/block), **Mermaid**, **draw.io** (import texto) o editores que acepten **ASCII art**.
- Para **Gerencia de TI → Gerencia general**, recomendar una sola lámina “**Arquitectura lógica (§3)**” y otra “**Flujo FORMULA guardar/restaurar (§11.3–11.4)**”.

---

## 15. Control de documento

| Fecha      | Versión | Notas |
|------------|---------|--------|
| 2026-04-08 | 1.0     | Baseline alineado al repositorio InformeCliente (docker-compose, nginx, módulos backend). |

---

*Fin del documento.*
