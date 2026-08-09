# ADR-061 — Catálogo de casos de prueba QA (Capa 5 de ADR-059, adelantada)

**Status**: accepted, documentado (2026-07-21). No es aún ejecución — es el catálogo formal que la Capa 5 de ADR-059 necesitaba para poder ejecutarse.
**Fecha**: 2026-07-21
**Autores**: EC
**Ámbito**: plataforma

## Contexto

Gerencia pidió explícitamente controlar las pruebas de QA de 14 funcionalidades que el equipo reporta como "ya implementadas": creación de usuarios, creación de empresas, registro/login por contraseña, login facial, validación multitenant, control de acceso y permisos, uso del menú de plataforma, aplicación de reportabilidad, generación de carátula, generación de tabla de contenido, estilos de encabezado H1/H2/H3, escritura libre de texto, atributos especiales del texto, inserción de imágenes e inserción de videos.

ADR-059 (Plan Maestro de Pruebas QA) ya había planificado esto como parte de la **Capa 5** (regresión de cierre de etapa), con el checklist manual programado para el Sprint S7 (previo al gate R4, 30-sep). Este ADR adelanta esa entrega al sprint actual (S4) porque Gerencia la pidió ahora, no porque el cronograma original estuviera mal.

Antes de redactar el catálogo se verificó cada funcionalidad contra el código real (no se asumió que "ya implementado" significa lo mismo para las 14) — esa verificación encontró **dos brechas reales entre lo pedido y lo que existe**:

1. **Inserción de video: no implementada.** No existe ningún tipo de bloque "video" en el modelo de documento de ReportStudioV2 (el grupo "Contenido" del ribbon solo ofrece Texto/Imagen/Tabla/Gráfico/KPI/Mapa/Sensor). Existe captura de webcam, pero a **imagen fija**, no a video embebido.
2. **Creación de empresas: sin endpoint.** `GET /api/auth/companies` solo lee la tabla `auth_companies` (o cae a un catálogo fijo); no se encontró ningún `POST` de creación — las empresas se provisionan hoy por seed de base de datos, no por la aplicación.

De paso se encontró un **defecto real, no pedido**: `frontend/src/auth/roleConstants.ts` define 6 roles, pero el backend valida 7 (falta `viewer`) — ADR-036 documenta "7 roles unificados" como cerrado, y esta discrepancia lo contradice parcialmente (el backend sí soporta los 7; la pantalla de administración de usuarios no expone uno de ellos).

## Decisión

Publicar `docs_/01_Planificacion/Catalogo_Casos_Prueba_QA_2026-07-21.md` (+ `.docx`): **69 casos de prueba** repartidos en 15 secciones (una por funcionalidad pedida, más una sección de "hallazgo" para video), cada caso con precondición, pasos, resultado esperado, y referencia exacta a endpoint/componente/línea de código real — no pasos genéricos.

**Tratamiento explícito de las brechas encontradas**: en vez de forzar un caso de prueba "funcional" para video o creación de empresas (que fallaría contra algo que no existe), el catálogo los documenta como **hallazgos** (G1, G2) con un caso de "verificación de ausencia" — confirmar que el sistema NO ofrece esa opción hoy, para que una futura regresión que la agregue sin ADR se note. Se dejan como decisión de Gerencia: ¿son alcance nuevo a especificar, o el pedido asumía que ya existían?

**El defecto de RBAC** (6 vs 7 roles) se deja como caso de prueba obligatorio (TC-RBAC-05) marcado explícitamente "se espera fallar hoy", en vez de corregirlo unilateralmente en este ADR — es una decisión de producto (¿debe `viewer` ser seleccionable desde esa pantalla?) antes que un fix de código.

**Trazabilidad de automatización**: de los 69 casos, solo 4 corren automatizados hoy (todos en autenticación, vía `scripts/smoke-auth-e2e.ps1`, Capa 4 de ADR-059). El catálogo recomienda priorizar Playwright (ya configurado, Capa 3 de ADR-059) para los 32 casos de reportabilidad (§8-14) primero, por ser el módulo de mayor volumen y el más adelantado del proyecto (25/25 ADR).

## Consecuencias

### Positivas
- Gerencia obtiene control real y verificable de las 14 funcionalidades pedidas, con trazabilidad a código, no una lista de buenas intenciones.
- Dos brechas reales (video, creación de empresas) y un defecto real (RBAC) quedan documentados con evidencia, en vez de descubrirse tarde durante un QA manual sin plan.
- Da una hoja de ruta concreta de qué automatizar primero (reportabilidad) dentro de la Capa 3/4 ya decidida en ADR-059.

### Negativas / Trade-offs
- El catálogo es documentación de casos, no ejecución — de los 69 casos, 65 siguen sin correrse ni una vez; el catálogo no reemplaza la regresión real programada para S8 (gate R4), solo le da a esa regresión un checklist concreto en vez de tener que definirlo desde cero en septiembre.
- Los hallazgos G1/G2 quedan como decisión pendiente de Gerencia — este ADR no decide si son alcance nuevo o se descartan, solo los documenta con evidencia para que se decida con información completa.

### Neutras
- El catálogo vive en `docs_/01_Planificacion/` (junto con los informes de avance y la presentación gerencial) en vez de `docs/decisions/`, porque es un documento operativo de QA, no una decisión arquitectónica en sí — este ADR es la decisión de tenerlo y de cómo tratarlo; el catálogo mismo es su artefacto.

## Alternativas descartadas

### Escribir un caso de prueba "esperado a fallar" sin marcarlo como hallazgo, para no bloquear la entrega
Se descarta: mezclar un caso funcional real con uno que documenta una ausencia, sin distinguirlos, haría que un QA futuro no supiera si un fallo es esperado (la funcionalidad no existe) o una regresión real. Se prefiere la distinción explícita (✅/⚠️/✕) usada en el catálogo.

### Corregir el defecto de RBAC (agregar `viewer` a `roleConstants.ts`) directamente en este ADR
Se descarta: no está confirmado si `viewer` debe ser seleccionable desde esa pantalla de administración por diseño (podría ser intencional — un rol de solo lectura que se asigna por otro medio) o es un olvido real. Corregirlo sin esa confirmación arriesga un cambio de producto no solicitado.

## Referencias
- `docs_/01_Planificacion/Catalogo_Casos_Prueba_QA_2026-07-21.md` (y `.docx`)
- ADR-059 (Plan Maestro de Pruebas QA — este catálogo es su Capa 5, adelantada del Sprint S7 al S4)
- ADR-060 (framework de tests backend, Capa 2)
- `backend/src/auth/auth_routes.cpp`, `backend/src/auth/permissions.cpp` (creación de usuarios, RBAC)
- `frontend/src/auth/roleConstants.ts` (defecto de 6 vs 7 roles)
- `frontend/src/components/ReportStudioV2/components/layout/RibbonToolbar.tsx` (menú de plataforma, confirma ausencia de "Video")
- ADR-036 ("7 roles unificados" — la discrepancia de este ADR es contra esa decisión)

## Actualización 2026-08-05 — Hallazgo G2 cerrado

Gerencia decidió: implementar mantenimiento completo de empresas (no solo
alta), pantalla de administración, RBAC granular ver/mantener, y datos de
prueba multiperfil. Cuatro ADR nuevos cierran G2 por completo (ADR-078 ya
había cerrado la mitad — el alta con dedup):

- **ADR-085** (`crud-empresas-y-pantalla-administracion`): `PUT`/`DELETE`
  (soft delete) sobre `/api/auth/companies/{id}`, campo RUC, pantalla
  `CompanyManagementView.tsx` — la parte de G2 que ADR-078 había dejado
  pendiente explícitamente.
- **ADR-086** (`rbac-granular-empresas-view-manage`): permisos
  `empresas.view`/`empresas.manage` reemplazan el `role=="admin"`
  hardcodeado original de ADR-078 — responde la pregunta "¿quién autoriza?"
  que este ADR (línea 27) había dejado como decisión de producto pendiente.
- **ADR-087** (`validacion-ruc-registro-externo-opcional`): checksum de RUC
  extraído a un módulo reutilizable + fix de un bug real donde `company`
  nunca se comparaba contra nada; consulta externa opcional al padrón SUNAT
  (sin proveedor contratado todavía) documentada como excepción explícita a
  ADR-001 — responde "¿RUC?" (línea 27).
- **ADR-088** (`seed-empresas-distribuidoras-usuarios-demo`): TimeTelemetry,
  Beemetry y 4 distribuidoras reales del rubro minero peruano con RUC
  sintético marcado como tal (no verificado — no existe API oficial
  gratuita de SUNAT, ver ADR-087), 24 usuarios de prueba ficticios
  validando las 4 combinaciones RBAC de ADR-086 — responde "¿deduplicación?"
  con datos reales de prueba (el índice único que cierra la condición de
  carrera del dedup vive en ADR-085).

El caso de prueba original de este catálogo para G2 ("verificación de
ausencia": confirmar que `POST /api/auth/companies` no existía) queda
**invertido** — ahora debe verificar presencia y comportamiento correcto
del CRUD completo. G1 (inserción de video) fue cerrado por separado en
ADR-062/064/065 (ver `docs/decisions/README.md`) y no se toca en esta
actualización.
