# Architecture Decision Records (ADRs)

Memoria arquitectónica persistente de Beemetry 2.0. Una decisión arquitectónica sin ADR **no existe**.

> Este es el **único log vigente**. Existe un segundo directorio,
> [`specs/adr/`](../../specs/adr/README.md) (12 registros, metodología SDD
> temprana bajo la marca "AURIXA"), que se conserva por trazabilidad histórica
> pero **no recibe decisiones nuevas** — marcado como tal desde 2026-07-13.

## Convención

- Numerados sin gaps: `NNN-slug.md`, **log único cronológico** (orden de decisión, no por tema).
- Cada ADR lleva un campo **`Ámbito`** que indica el dominio al que pertenece: `plataforma`,
  `core-iot`, `datos`, `reports`, `ia`, `geo` (y, a futuro, ámbitos de componentes nuevos como
  `realtime`). El índice de abajo se **agrupa por ámbito**; la numeración sigue siendo global.
- Plantilla mínima: **Contexto / Decisión / Consecuencias / Alternativas descartadas / Referencias**.
- Status: `proposed` | `accepted` | `implemented` | `superseded by NNN` | `deferred` | `partial`.
- Cambiar una decisión NO edita el ADR original: crea uno nuevo con `Supersedes ADR-NNN`, o agrega
  un bloque de "Actualización"/"Corrección de auditoría" fechado ARRIBA del texto original (nunca
  se borra la nota anterior — ver ejemplo real en ADR-022/034).
- Numeración cronológica: una decisión fundacional puede tener número alto (p.ej. ADR-031/034 refinan/reencuadran ADR-002).

> ¿Por qué log único + ámbito y no carpetas por dominio? Las carpetas fragmentarían la
> numeración global y la vista de orden, y complicarían las refs cruzadas entre dominios. El
> campo `Ámbito` da ownership de dominio sin romper el log único, y escala a componentes futuros.

## Índice de ADRs

> **Auditado al 2026-07-13**: 46 ADRs (000-045). La columna Status de esta
> tabla se corrigió para reflejar el estado REAL verificado en cada archivo
> (antes decía "proposed" para casi todos los ADRs 000-035, aunque la
> mayoría ya estaban implementados y verificados en sesiones anteriores —
> la tabla índice había quedado desactualizada respecto al contenido real
> de cada ADR). `implemented` = verificado contra código/stack real
> (rebuild, logs, DB, o navegador real), no solo "se escribió el código".
> Ver el reporte de progreso del proyecto de reportabilidad más abajo.
>
> **Actualización 2026-07-17**: 46 → **54 ADRs**. Se agregaron 8 (046-053),
> todos ámbito `reports`: 4 formalizan decisiones que el código ya tenía
> implementadas desde antes de esta fecha pero sin ADR escrito (046-049 —
> encabezado/pie fijos, galería de imágenes, carátula, ajuste de texto), y
> 4 documentan trabajo nuevo de esta sesión (050-053 — formato de texto por
> selección, copiar/pegar, navegación/zoom/página, estilos de tabla). De
> paso se corrigió una divergencia real entre documentación y código:
> ADR-010/013 declaraban Tiptap/ProseMirror-JSON para el texto de
> ReportStudioV2, pero el código real (desde antes de esta sesión) usa
> string plano — ver el bloque de "Actualización 2026-07-17" agregado a
> ambos ADR (no se editó el texto original, según la convención de este
> log) y el detalle completo en ADR-050.
>
> **Actualización 2026-07-17 (segunda pasada, mismo día)**: 54 → **55 ADRs**.
> Se agregó ADR-054 (`sync-thingsboard-legacy-aws`, ámbito `core-iot`),
> implementando el entregable "sync inicial con AWS" del release R2 —
> confirmado como una instancia ThingsBoard real, no un servicio AWS
> genérico. No hay conflicto con ADR-034: esa decisión ya anticipaba
> explícitamente que "ThingsBoard puede convivir detrás del gateway mientras
> se estrangula" y solo descartaba el híbrido *permanente*, no la
> coexistencia transitoria — ADR-054 es la implementación concreta de esa
> coexistencia. De paso se encontró y corrigió un bug real preexistente en
> `TelemetryIngestor::enqueue()` (ADR-008): en modo Kafka nunca producía al
> bus, dejando filas varadas en memoria sin insertar ni reportar error — ver
> el bloque de "Actualización 2026-07-17" agregado arriba del texto original
> de ADR-008. Ambos hallazgos se verificaron con una prueba de carga real de
> 6.000.000 de puntos en 10 minutos (~10.000/seg sostenidos) contra un
> ThingsBoard local aislado: 0 errores, 0 pérdida en cola, réplica
> `db_replica` sincronizada al 100% al cierre.
>
> **Actualización 2026-07-20**: 55 → **59 ADRs**. `CHANGELOG.md` ya
> documentaba, con fecha y evidencia de verificación E2E, cuatro bloques de
> trabajo de los días 2026-07-18/19 citándolos como "ADR-055" a "ADR-058" —
> pero ninguno tenía todavía un archivo real en este directorio ni fila en
> este índice (brecha de trazabilidad detectada en la auditoría de
> arquitectura del 2026-07-20, ver el informe de avance de esa fecha). Se
> formalizaron los cuatro con esos mismos números, sin reordenar ni
> renumerar nada ya citado en commits/changelog: **055**
> (`editor-indicador-seleccion-propio`, ámbito `reports`, 2026-07-18),
> **056** (`csp-service-worker-tiles-mapa`, ámbito `geo`, 2026-07-18),
> **057** (`dashboard-widgets-estilo-thingsboard`, ámbito `realtime` —
> primer ADR real de ese ámbito, reservado desde 2026-07-13 sin ADR propio
> hasta hoy, 2026-07-19), **058**
> (`auditoria-seguridad-integral-jul2026`, ámbito `plataforma`, 2026-07-19).
> Se revisó cada uno contra los ADR ya existentes buscando contradicciones:
> ninguna encontrada — 056 extiende el hardening de ADR-043 sin reabrirlo,
> 057 inaugura `realtime` sin chocar con ADR-031, y 058 documenta (dentro de
> su propio bloque PENDIENTE) la misma divergencia de ADR-029 (refresh token
> en `localStorage`) que ya se había cerrado ese mismo día con su propia
> actualización — ver ADR-058 § PENDIENTE para la referencia cruzada
> explícita entre ambos.
>
> **Actualización 2026-07-21**: 59 → **61 ADRs**. Se agregaron **059**
> (`plan-maestro-pruebas-qa`) y **060** (`framework-pruebas-backend-catch2`),
> ambos ámbito `plataforma`, cerrando el entregable contractual "plan
> maestro de pruebas QA" del Sprint S4/R2. No quedaron solo en papel: se
> compiló y corrió el primer target de tests automatizados del backend
> (`beemetry_backend_tests`, Catch2 v3, 27 aserciones/7 test cases, 100%
> passed), y — más importante — se detectó y corrigió un hallazgo real de
> resiliencia operativa: el contenedor `beemetry-api` en ejecución corría
> una imagen construida el 2026-07-20T21:37, **antes** del fix de
> cookies/CSRF de ADR-029 — verificado desde una imagen de prueba aislada
> pero nunca desplegado al sistema real. Se reconstruyó (`docker compose
> build web`) y redesplegó, y se corrió `scripts/smoke-auth-e2e.ps1`
> completo (registro→login→refresh con cookie+CSRF→logout) contra el
> contenedor real ya actualizado: `Resultado: OK`. De paso se corrigieron 2
> bugs reales preexistentes en ese mismo script (campo `token` desactualizado
> tras el cambio a `access_token`; lectura de cookies con un `Path` de URI
> incorrecto que nunca iba a encontrar las cookies de sesión).
>
> **Actualización 2026-07-21 (segunda pasada, mismo día)**: 61 → **62 ADRs**.
> Se agregó **061** (`catalogo-casos-prueba-qa`, ámbito `plataforma`) — 69
> casos de prueba sobre las 14 funcionalidades que Gerencia pidió controlar
> (usuarios, empresas, auth password/facial, multitenant, RBAC, menú,
> reportabilidad completa, carátula, TOC, encabezados, texto libre,
> atributos de texto, imágenes, video), es la Capa 5 de ADR-059 adelantada
> del Sprint S7 al sprint actual. Al verificar cada funcionalidad contra
> código real (no se asumió "implementado" por igual para las 14) se
> encontraron 2 brechas reales — inserción de video **no existe** como tipo
> de bloque en ReportStudioV2 (solo hay captura de webcam a imagen fija, no
> video embebido); creación de empresas **no tiene endpoint** (`GET
> /api/auth/companies` solo lee, no hay `POST` — se provisionan por seed de
> BD) — y 1 defecto real no pedido: `frontend/src/auth/roleConstants.ts`
> define 6 roles pero el backend valida 7 (falta `viewer`), lo que matiza
> parcialmente el cierre de ADR-036 ("7 roles unificados"): el backend sí
> soporta los 7, la pantalla de administración de usuarios no expone uno.
> Ninguna de las tres queda "corregida" en este ADR — se documentan con
> evidencia como decisión pendiente de Gerencia/producto, no se resuelven
> unilateralmente.
>
> **Actualización 2026-07-21 (tercera pasada, mismo día)**: 62 → **64 ADRs**.
> De las 3 brechas/defecto que dejó ADR-061 documentadas como pendientes,
> Gerencia pidió cerrar 2 el mismo día: **062**
> (`insercion-video-grabado-webcam-pantalla`, ámbito `reports`) cierra el
> hallazgo G1 — nuevo tipo de bloque `video` con grabación por cámara web o
> pantalla/ventana, insertable en el lienzo (verificado en vivo hasta el
> límite de hardware del entorno de pruebas: no se pudo grabar una toma real
> por sandboxing, pero sí el flujo completo de UI y manejo de errores).
> **063** (`correccion-rbac-siete-roles-asignables`, ámbito `plataforma`)
> cierra TC-RBAC-05 — `ADMIN_ASSIGNABLE_ROLES` (7 roles) reemplaza el uso de
> `USER_ROLES` (6) en las 3 pantallas de administración, y se corrigió un
> bug real independiente en el backend (`notification_routes.cpp`) que solo
> devolvía 4 de 7 roles en la matriz de permisos. La brecha de creación de
> empresas (G2, sin endpoint) y la auditoría completa del flujo RUC/tenant
> quedaron en un documento aparte
> (`Auditoria_Registro_RUC_Tenant_2026-07-21.md`, no un ADR — es un hallazgo
> pendiente de decisión de producto, no una decisión ya tomada).
>
> **Actualización 2026-07-21 (cuarta pasada, mismo día)**: 64 → **67 ADRs**.
> Gerencia tomó dos decisiones más el mismo día sobre lo que había quedado
> pendiente en la pasada anterior: (1) separar ADR-062 en dos ADR
> independientes por origen de grabación — **064** (`grabacion-video-camara-
> web-lienzo`) y **065** (`grabacion-video-pantalla-ventana-lienzo`); ADR-062
> queda `superseded`, su contenido no se editó, se conserva íntegro. (2)
> **066** (`login-usa-razon-social-minera-no-contratista`, ámbito
> `plataforma`) resuelve el hallazgo principal de
> `Auditoria_Registro_RUC_Tenant_2026-07-21.md`: el registro de un
> contratista ya no sobreescribe `company` con su propia razón social —
> conserva la de la empresa MINERA asociada, que es la que determina el
> tenant real. Verificado contra el backend real: un registro con el nuevo
> comportamiento resuelve `tenant_id` real (antes de este fix, el mismo
> escenario resolvía vacío). El hallazgo G2 (creación de empresas sin
> endpoint) sigue sin decisión — no se tocó en esta pasada.
>
> **Actualización 2026-07-21 (quinta pasada, mismo día)**: 67 → **68 ADRs**.
> Durante la verificación con login real (commit `9782c09`) se detectó que
> `POST /api/auth/register` nunca creaba una fila real en `auth_user_tenant`
> — 23 de 28 usuarios reales de la base caían en un tenant de "fallback"
> compartido que resultó ser el tenant REAL de otra empresa (Compañía Minera
> Antamina), no un tenant demo aislado como sugería su nombre de constante.
> **067** (`autoregistro-provisiona-tenant-real`, ámbito `plataforma`) agrega
> `findOrCreateTenantForCompanyPg` (tenant dedicado + membresía real en el
> registro, backend reconstruido y redesplegado) y hace backfill de los 23
> usuarios legacy (5 empresas) con su propio tenant aislado
> (`db_scripts/48_...sql`). Verificado: una empresa nunca antes vista se
> autoregistra y crea un informe en el primer login, sin intervención manual.
> El hallazgo G2 (creación de empresas sin endpoint dedicado, deduplicación
> de nombres) sigue sin decisión — este ADR corrige el aislamiento, no
> reemplaza ese flujo pendiente.
>
> **Auditoría integral 2026-07-24**: 68 → **73 ADRs**. Se formalizaron:
> **068** IA editorial multimodelo + referencia externa acotada; **069**
> migración de producción frontend a TypeScript estricto; **070** bloques y
> plantillas técnicas por composición; **071** TOC fijo en página 2 con
> continuaciones; **072** conversión GDAL runtime administrada, que supersede
> el diferimiento de ADR-028. Se corrigieron contradicciones reales:
> `specs/adr` era histórico pero RAG/agents/CI aún lo trataban como vigente;
> O6 `<1s` no coincidía con los benchmarks LLM; el índice afirmaba
> `sections[]` y MapLibre aunque el runtime usa páginas planas y Leaflet; y
> los documentos de brecha seguían declarando TypeScript 0%. La fuente
> canónica queda `docs/decisions/`, sin renumerar ni borrar historia.
>
> **Auditoría integral 2026-07-25**: 73 → **74 ADRs**. Se agregó **073**
> (`modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon`, ámbito
> `reports`): modal propio (`SaveTitleModal`, mismas clases `ra-*` que el
> resto de la plataforma) reemplaza `window.prompt()` al nombrar un informe
> nuevo; contraste corregido en la barra flotante contextual; `.ribbon-body`
> pasa a `flex-wrap` para que los grupos de ADR-070 no queden ocultos tras
> scroll horizontal. Se auditó el código real contra 3 ADRs que YA
> afirmaban decisiones específicas, y se encontraron 3 divergencias reales
> entre lo documentado y el runtime (no solo trabajo nuevo sin ADR, sino
> ADRs cuyo texto no coincidía con el código):
> - **ADR-053** declaraba solo estilos de tabla; el control funcional
>   (resize de columnas, autoajuste, insertar/eliminar fila/columna,
>   auto-crecimiento) se había implementado el 2026-07-22 sin ADR, junto con
>   dos bugs reales cerrados (bucle de versión descontrolado v1→v103 por
>   realimentación de `colWidths`; controles nuevos bloqueados por el shield
>   CSS `pointer-events:none`) — documentado retroactivamente en su propia
>   actualización.
> - **ADR-068** (§1, "Corrección fiel") afirmaba que LanguageTool era la
>   autoridad de la corrección rápida — el código real usaba un reemplazo de
>   13 palabras hardcodeadas sin relación con LanguageTool. Cerrado:
>   `handleCorrectQuick` ahora sí llama a LanguageTool. Además se verificó
>   Tavily con una API key real del usuario (antes solo se había probado el
>   camino "no configurado").
> - **ADR-071** afirmaba "Ribbon y biblioteca llaman al mismo
>   `addTocElement()`" — el botón del ribbon en realidad solo abría un panel
>   de navegación flotante sin insertar nada. Cerrado: ambos disparan la
>   misma acción real.
>
> Ninguna de las tres era un conflicto *entre* ADRs (ninguna decisión previa
> quedó contradicha por otra) — las tres eran **el ADR afirmando algo que el
> código no hacía todavía**, encontrado únicamente al probar la aplicación
> real en navegador (no por lectura de código ni de la documentación misma).
> No se dejó ningún hallazgo de esta pasada sin cerrar en su propio ADR.
>
> **Actualización 2026-07-27**: 74 → **75 ADRs**. Se agregó **074**
> (`avatar-biometrico-local-hd-bajo-demanda`, ámbito `ia`): avatar generado
> localmente, miniatura de sesión separada del maestro 4K, endpoint
> autenticado self-only y visor accesible bajo demanda. ADR-074 reconcilia
> explícitamente las frases históricas de ADR-004/027 (“biometría latente”)
> con el runtime y con la actualización vigente de ADR-025: login/avatar
> facial existen, pero EPP continúa diferida y el gate legal no se elimina.
>
> **Actualización 2026-07-27 (segunda pasada)**: 75 → **76 ADRs**. Se agregó
> **075** (`internacionalizacion-pais-idioma-acceso`, ámbito `plataforma`):
> selector inicial país/idioma, cuatro locales, acceso/registro y navegación
> traducidos, teléfonos E.164 y validación fiscal por país. Se revisó
> compatibilidad con ADR-035/040/042/066/067/073; no cambia tenant, RBAC,
> soberanía ni alcance biométrico.
>
> **Actualización 2026-07-27 (tercera pasada)**: 76 → **78 ADRs**. La
> verificación E2E descubrió un fallo intermitente de UUID y una revisión de
> seguridad mostró que `makeId()` también alimentaba secretos. Se agregaron
> **076** (`separacion-identificadores-secretos-csprng`, implemented) y **077**
> (`migracion-password-argon2id-versionada`, implemented). El primero separa IDs
> DB-safe de secretos CSPRNG; el segundo convierte el pendiente de salt/
> `std::hash` de ADR-043 en una migración gradual ejecutable. La matriz
> completa está en `AUDITORIA_ACCESO_I18N_2026-07-27.md`.
>
> **Actualización 2026-07-27 (cuarta pasada)**: 78 → **79 ADRs**. ADR-078
> cierra el alta administrada de empresas: autorización admin, deduplicación
> case-insensitive, tenant real y auditoría.
>
> **Nota de auditoría 2026-08-03 (antes de la pasada de abajo)**: al llegar a
> esta sesión ya existían **081 archivos reales** (000-081, sin huecos) pero
> este log narrativo y las tablas por ámbito seguían citando 79 — **079**
> (`rbac-workflow-informes-inmutabilidad-firma`), **080**
> (`marca-de-agua-y-password-pdf`) y **081**
> (`cors-multiorigen-frontend-externo`) nunca se agregaron acá ni a la tabla
> de `reports`/`plataforma` correspondiente, pese a tener contenido completo
> y `Status: implemented/accepted` en su propio archivo. Brecha de
> trazabilidad preexistente, no introducida en esta pasada — se documenta acá
> (mismo criterio que este log ya usó para el hallazgo G2 de ADR-061: nombrar
> el gap con evidencia, no resolverlo unilateralmente fuera de su propio
> alcance) para que quien haga la próxima auditoría integral las incorpore a
> las tablas. No se tocó el contenido de 079/080/081, solo se deja constancia
> de que existen y de que el índice está desactualizado respecto a ellas.
>
> **Actualización 2026-08-03**: 79 (narrativa) → **85 ADRs de archivo**
> (existían 81 sin gaps + ADR-082 formalizado + 2 nuevos de esta pasada; ver
> nota de arriba sobre 079-081). Se agregaron **083**
> (`exportacion-pptx-modo-presentacion-sidecar-hibrido`) y **084**
> (`conversion-pptx-video-narracion-diapositiva`), ambos ámbito `reports`:
> exportación del informe a PPTX en modo presentación (mismo sidecar
> Chromium del PDF, texto de bloques `text` editable/buscable en PowerPoint
> vía overlay nativo) y conversión de ese PPTX a video con narración opcional
> por diapositiva (`ffmpeg`, audio grabado o notas de orador). También se
> formalizó **082**
> (`autenticacion-cookie-httponly-csrf-double-submit`), decisión ya
> implementada y citada en el código pero sin archivo propio: access token
> en cookie `HttpOnly`, CSRF double-submit en mutaciones y compatibilidad
> Bearer para integraciones.
>
> Dos correcciones de auditoría se agregaron a ADR previos (sin editar su
> texto original, con bloque fechado arriba, según la convención de este
> log): **ADR-016** — declaraba almacenamiento en MinIO para el export server
> side; verificado que el PDF nunca persistió a MinIO (proxy síncrono puro,
> bytes reenviados en la misma respuesta) — ADR-083/084 son el primer export
> que sí persiste un artefacto, y usan disco local confinado
> (`BEEMETRY_EXPORT_DATA_ROOT`), el mismo patrón ya real de ADR-047/072, no
> MinIO. **ADR-023** — el presupuesto O3 (`<5s`) no encaja tal cual con un
> export asíncrono de job+polling (PPTX hasta 60s, video hasta 180s
> configurados); se propone (sin implementar todavía) un código de
> presupuesto separado para este tipo de export, mismo criterio que ADR-068
> ya usó para partir O6. Ninguna de las dos es un conflicto *entre* ADRs —
> ambas son el mismo patrón ya varias veces encontrado en este log: el ADR
> afirmando algo (MinIO, un presupuesto único) que el código real no hacía o
> no podía cumplir tal cual.
>
> De paso se encontró y cerró una brecha RBAC real durante la propia
> implementación de ADR-084 (mismo criterio de ADR-079/063 — cerrar el
> hallazgo en el mismo cambio que lo detecta): subir narración de audio/notas
> a una diapositiva usaba el mismo umbral `informes.view` que exportar un
> PDF/PPTX de solo lectura; como contribuye contenido nuevo al informe, se
> corrigió a exigir `informes.edit`, dejando la generación/descarga de
> export sin cambios. Se encontraron además dos defectos reales durante la
> verificación de ADR-084 (documentados en su propio archivo, no aquí):
> `pptxgenjs` no nombra las imágenes de forma secuencial simple como se
> supuso al principio, y mezclar el video mudo con audio usando `-c:v copy`
> truncaba contenido visual real pese a que la duración reportada por
> `ffprobe` parecía correcta — ambos verificados y corregidos contra
> herramientas reales (`ffmpeg`/`ffprobe`, inspección de un `.pptx` real),
> no solo por lectura de código.
>
> **Actualización 2026-08-05**: se cierra la brecha de trazabilidad señalada
> en la nota de auditoría del 2026-08-03 — **ADR-079**
> (`rbac-workflow-informes-inmutabilidad-firma`) recibe su fila en la tabla
> de ámbito `plataforma` (no tenía ninguna hasta ahora, pese a tener
> contenido completo y `Status: implemented` en su propio archivo desde
> 2026-08-02). El subtotal de `plataforma` se recalcula a **29/31
> implemented, 1 partial, 1 proposed** (los 27 ya contados + ADR-081, que ya
> tenía fila pero no se sumaba al subtotal, + ADR-079 ahora agregado). No se
> modificó el contenido de ADR-079 ni de ningún otro ADR — solo se corrigió
> el índice para que refleje lo que ya existía como archivo.
>
> **Actualización 2026-08-05 (segunda pasada)**: 85 → **88 ADRs**. Se cierra
> por completo el Hallazgo G2 de ADR-061 (creación/mantenimiento de empresas
> sin endpoint dedicado), que ADR-078 (2026-07-29) solo había resuelto a
> medias (alta con dedup, sin mantenimiento ni RBAC granular). Se agregaron
> **085** (`crud-empresas-y-pantalla-administracion`, ámbito `plataforma`):
> `PUT`/`DELETE` (soft delete) sobre empresas, RUC, pantalla de
> administración; **086** (`rbac-granular-empresas-view-manage`, ámbito
> `plataforma`): permisos `empresas.view`/`empresas.manage` reemplazan el
> `role=="admin"` hardcodeado original; **087**
> (`validacion-ruc-registro-externo-opcional`, ámbito `plataforma`): fix de
> un bug real (el nombre de empresa nunca se comparaba en
> `validate-company`) + consulta externa opcional al padrón SUNAT
> documentada como excepción explícita y acotada a ADR-001 (no existe API
> oficial gratuita de SUNAT — se investigó antes de asumirlo); **088**
> (`seed-empresas-distribuidoras-usuarios-demo`, ámbito `datos`): datos de
> prueba (empresas reales con RUC sintético marcado como tal, usuarios
> ficticios) validando las 4 combinaciones RBAC de 086. Se agregó el bloque
> de "Actualización 2026-08-05" a ADR-061 (no se editó su texto original)
> marcando G2 como cerrado. Ver el detalle completo de hallazgos técnicos
> (condición de carrera en el dedup original, semántica de override
> completo de `role_permissions`, restricción del `CHECK` de hash de
> ADR-077 sobre el seed) en cada ADR individual.
>
> **Actualización 2026-08-07**: auditoría solicitada por Gerencia sobre
> ADRs pendientes de resolución, conflictos, respuestas pendientes y
> trabajo implementado sin ADR. 88 → **92 ADRs** (colisión de numeración
> resuelta) → **95 ADRs**. Hallazgos, de mayor a menor severidad:
>
> 1. **Colisión de numeración real en 089**: dos archivos distintos
>    reclamaban el mismo número (`089-biometria-dermalog-cli-integration.md`
>    y `089-plantilla-corporativa-timetelemetry-referencia-diseno.md`, este
>    último creado en la sesión anterior). Se renumeró el segundo a
>    **ADR-092** (mismo contenido, solo cambia el número — ninguno de los
>    dos estaba commiteado, así que el rename no afecta historial de git).
> 2. **~739 archivos sin commitear en `frontend/`** desde al menos el
>    2026-07-24 — la migración JS→TS completa que **ADR-069** ya declara
>    "implemented, verificado" citando `npm run build: OK`, pero ese estado
>    nunca llegó a un commit real. Sobre ese árbol, cambios más recientes
>    (2-3 de agosto, sin ADR): Vite 5→8 (nuevo bundler Rolldown), Vitest
>    1→4, y un swap de `plotly.js` completo por `plotly.js-basic-dist-min`
>    — **rompían el módulo Informes para cualquier usuario/tenant** (bug de
>    interop CJS→ESM, distinto entre el esbuild de dev y el Rolldown de
>    build). Verificado en vivo y corregido — ver **ADR-093**
>    (`vite8-rolldown-migracion-parcial-interop-plotly`). Esto también
>    **descarta** la hipótesis sin confirmar de la sección "3 specs siguen
>    fallando" de la nota de 2026-08-05 arriba (gate de permisos de
>    ADR-079): verificado por SQL directo que `operator`/`manager` sí tienen
>    `informes.edit`; la causa real era este árbol roto sirviéndose en
>    dev/dist, no un problema de RBAC. El árbol de 739 archivos **sigue sin
>    commitear** — queda fuera del alcance de este ADR (gestión de
>    repositorio, no arquitectura) pero es la brecha más grande encontrada:
>    todo ese trabajo se pierde ante cualquier `git checkout`/`reset`/clon
>    nuevo mientras no se commitee.
> 3. Dos features ya implementadas y verificadas en sesiones anteriores sin
>    ADR: lectura de DNI por cámara (PDF417+MRZ, sin consulta a RENIEC) —
>    **ADR-094** (`lectura-dni-camara-pdf417-mrz`) — y el fix real de
>    code-splitting de `UserMaintenanceModal` (se montaba sin su CSS la
>    primera vez, justo tras login) — **ADR-095**
>    (`usermaintenancemodal-css-autocontenida-marca`).
> 4. Fila de ADR-058 corregida: decía "pendiente `echarts@6`" pese a que el
>    propio archivo de ADR-058 ya registraba ese CVE cerrado el 2026-07-27
>    (migrado a 6.1.x) — desalineación entre el texto del ADR y la fila del
>    índice, no un hallazgo de código nuevo.
> 5. Mismo patrón que la brecha de ADR-079 cerrada el 2026-08-05: **ADR-089
>    (`biometria-dermalog-cli-integration`), 090
>    (`deprecacion-adr-tempranos-ia`) y 091 (`opencv-composicion-raii`)** ya
>    existían como archivos completos (2026-08-05, ámbito `ia`) pero sin fila
>    en esta tabla — agregadas, sin editar su texto original. De paso se
>    verificó que la supersesión que declara ADR-089 sobre
>    `specs/adr/ADR-005` (InsightFace/ONNX) es real y ya tiene su banner
>    `SUPERSEDED` correcto — no es una referencia rota.
> 6. No se encontraron conflictos reales entre decisiones arquitectónicas
>    vigentes en el resto del set (ADR-033/035 revisados: sus estados
>    `partial`/`proposed` son honestos y deliberados, no brechas).

### Ámbito `plataforma` — fundaciones transversales
| # | Slug | Status | Resumen |
|---|---|---|---|
| 000 | `rebrand-aurixa-a-beemetry` | ✅ implemented (2026-07-07) | El producto se llama Beemetry; AURIXA/ControlTime/`mapas_backend` deprecados. |
| 001 | `despliegue-soberano-on-prem` | ✅ implemented (2026-07-06) | Todo on-prem (VPS Lima, Docker); sin nube externa para dato crítico. |
| 002 | `backend-cpp-gateway-central` | ✅ implemented (2026-07-06) | Gateway C++ único autenticado; proxy a sidecars (refinado por 031). |
| 004 | `arquitectura-poliglota-cpp-sidecars` | ✅ implemented (2026-07-06) | Hot path C++; IA/ML/CV en sidecars (Python/Ollama/LanguageTool) por HTTP. |
| 023 | `presupuestos-rendimiento-slas` | ✅ implemented, refinado por 068 (2026-07-24) | SLAs como restricciones; O6 <1s aplica a corrección automática. Rewrite/APA local son asíncronos con latencia medida (p50 ~7s/~18s). |
| 029 | `rbac-identidad-plataforma-jwt` | ✅ implemented, corregido (2026-07-19) | Identidad de plataforma: RBAC multitenant + JWT; login user/pass en v0.1. Refresh token migrado de `localStorage` a cookie `HttpOnly`+CSRF double-submit — ver actualización en el ADR. |
| 030 | `auditoria-100-acciones-server` | ✅ implemented (2026-07-07) | Auditoría 100% autoritativa en servidor, transversal, con hash encadenado. |
| 031 | `backend-plataforma-compartida-multicomponente` | ✅ implemented (2026-07-06) | Backend = plataforma compartida; ReportStudio es el primer componente por prioridad. |
| 033 | `convencion-nombres-prefijos` | ⚠️ partial (2026-07-07) | Estándar de prefijos: `beemetry-*` contenedores, APIs `/api/v1/...`, DBs/tablas/buckets/env. |
| 035 | `plataforma-enterprise-latam` | 📋 proposed (2026-07-12) | Topología edge+hub de 3 niveles para escalar a todas las unidades mineras de LATAM. |
| 036 | `rbac-siete-roles-unificados` | ✅ implemented (2026-07-13) | Reconcilia el RBAC de 4 roles con los 6 de `roleConstants.ts` + `viewer` = 7 roles únicos. |
| 037 | `alta-usuarios-administrada-sin-biometria` | ✅ implemented (2026-07-13) | Admin crea usuarios remotos sin biometría; enrolamiento diferido al primer login presencial. |
| 038 | `delegacion-acceso-tenant-activo-emisor` | ✅ implemented (2026-07-13) | Otorgar/revocar acceso multitenant siempre escopeado al tenant activo de quien lo emite. |
| 040 | `sistema-diseno-navegacion-enterprise` | ✅ implemented, mejorado (2026-07-27) | Cabecera compacta; carriles contiguos de Áreas/Opciones con iconos grandes, flechas automáticas, scroll y relieve 3D sutil. |
| 041 | `resiliencia-token-fetch-crudo` | ✅ implemented (2026-07-13) | Refresco automático de token en `fetch()` crudo del dashboard; documenta triplicación de la lógica (consolidada 2026-07-13). |
| 042 | `nomenclatura-menus-lenguaje-llano-minero` | ✅ implemented, mejorado (2026-07-27) | Etiquetas operativas cortas: Gestión, Control, Terreno, Mapas, Permisos, Informes; Usuarios, Accesos y Umbrales. |
| 043 | `endurecimiento-seguridad-pre-pentest` | ✅ controles internos implementados | Cierra IDOR/endpoints sin auth/CORS; CSPRNG y Argon2id cerrados por ADR-076/077. Pentest externo sigue independiente. |
| 058 | `auditoria-seguridad-integral-jul2026` | ✅ implemented (2026-07-19) | XSS almacenado e IDOR sin auth cerrados; CVEs altas llevadas a 0 y HSTS agregado. `echarts@6` cerrado 2026-07-27 (migrado a 6.1.x). Pendiente: pentest externo. |
| 059 | `plan-maestro-pruebas-qa` | ✅ accepted, primera fase implementada (2026-07-21) | 5 capas de prueba formalizadas (unit frontend, unit backend, e2e frontend, smoke/integración backend, regresión de cierre de etapa) con cronograma y exit criteria por gate. Verificado en vivo: `smoke-auth-e2e.ps1` extendido corrido de punta a punta contra el `beemetry-api` real, `Resultado: OK`. |
| 060 | `framework-pruebas-backend-catch2` | ✅ implemented, verificado (2026-08-05) | Catch2 v3 (apt) como framework de tests del backend; target `beemetry_backend_tests`. Corrida real contra el contenedor `beemetry-api`: **610 aserciones en 20 test cases, todas passed** (crecimiento real desde las 27/7 de 2026-07-21). |
| 061 | `catalogo-casos-prueba-qa` | ✅ accepted, documentado (2026-07-21) | Catálogo de 69 casos de prueba QA (Capa 5 de ADR-059, adelantada) sobre 14 funcionalidades pedidas por Gerencia. Encontró 2 brechas reales (video no implementado; creación de empresas sin endpoint) y 1 defecto (RBAC: 6 vs 7 roles en `roleConstants.ts`). |
| 063 | `correccion-rbac-siete-roles-asignables` | ✅ implemented, verificado (2026-07-21) | `ADMIN_ASSIGNABLE_ROLES` (7 roles) reemplaza `USER_ROLES` (6) en las 3 pantallas de administración de roles; corrige matriz de permisos del backend que solo devolvía 4 de 7 roles. Cierra TC-RBAC-05 de ADR-061. |
| 066 | `login-usa-razon-social-minera-no-contratista` | ✅ implemented, verificado (2026-07-21) | El registro/login de un contratista usa la razón social de la EMPRESA MINERA asociada (no la propia) para determinar `company`/tenant — antes se sobreescribía con `contractorLegalName`, dejando al contratista sin tenant real. Verificado: `tenant_id` ahora resuelve real. Cierra el hallazgo de `Auditoria_Registro_RUC_Tenant_2026-07-21.md`. |
| 067 | `autoregistro-provisiona-tenant-real` | ✅ implemented, verificado (2026-07-21) | `POST /api/auth/register` nunca creaba una fila real en `auth_user_tenant` — 23/28 usuarios reales caían en un fallback compartido que resultó ser el tenant REAL de otra empresa (Antamina), no un tenant demo aislado. Se agrega `findOrCreateTenantForCompanyPg` (tenant dedicado + membresía real en el registro) y se hace backfill de los 23 usuarios legacy con su propio tenant. Verificado: empresa nunca antes vista se autoregistra y crea un informe en el primer login sin intervención manual. |
| 069 | `migracion-frontend-typescript-estricto` | ✅ implemented, verificado (2026-07-24) | Producción frontend migrada a TypeScript estricto: 111 `.ts/.tsx`; los 6 `.js/.jsx` restantes son tests/config. `tsc`, build y Vitest verdes. |
| 075 | `internacionalizacion-pais-idioma-acceso` | ✅ implemented · probado · desplegado | País→idioma ES/EN/FR/PT-BR, fiscal/prefijo y diálogos propios; imágenes activas y smoke aprobado. |
| 076 | `separacion-identificadores-secretos-csprng` | ✅ implemented · probado · desplegado | OpenSSL CSPRNG para ID/refresh/`jti`/API keys; Catch2 y E2E aprobados. |
| 077 | `migracion-password-argon2id-versionada` | ✅ implemented · inventario legacy en cero, verificado (2026-08-07) | Argon2id + rehash oportunista; 82/82 cuentas `$argon2id$`, 0 legacy — reset administrado de las 40 restantes con la misma función Argon2id real (`libargon2` vía ctypes), verificado con login real end-to-end y reinicio del backend sin ningún hallazgo de migración pendiente. |
| 078 | `alta-administrada-empresa-tenant-deduplicada` | ✅ implemented · probado · desplegado | POST admin, deduplicación de razón social, tenant real y auditoría; smoke E2E aprobado el 2026-07-29. |
| 079 | `rbac-workflow-informes-inmutabilidad-firma` | ✅ implemented (backend), 2026-08-02 *(fila agregada 2026-08-05 — el ADR ya existía sin fila en esta tabla, ver nota de auditoría arriba)* | Permiso por transición de workflow en `/api/reports/*` (`draft`/`rejected` → `informes.edit`; `in_review`/`approved` → `informes.sign`), resuelto bajo el mismo lock de fila que la máquina de estados; inmutabilidad absoluta de `signed`/`archived` sin excepción de rol (ni `admin`); hook `usePermissions()` reutilizable en frontend. Cierra el hallazgo donde cualquier rol autenticado (incluido `viewer`) podía aprobar, firmar o eliminar un informe técnico minero. |
| 081 | `cors-multiorigen-frontend-externo` | ✅ implemented (2026-08-02) | `BEEMETRY_CORS_ALLOWED_ORIGIN` admite lista separada por comas; `router::Router::dispatch()` refleja por request el origen que matchea. Habilita una segunda app frontend (repo propio) contra el mismo backend, sin tocar cookies/CSRF (despliegue same-site). |
| 085 | `crud-empresas-y-pantalla-administracion` | ✅ implemented (2026-08-05) | `PUT`/`DELETE` (soft delete) sobre `/api/auth/companies/{id}`, campo RUC, `company_id` surrogate, pantalla `CompanyManagementView.tsx` — cierra la mitad de G2 (ADR-061) que ADR-078 había dejado pendiente. |
| 086 | `rbac-granular-empresas-view-manage` | ✅ implemented (2026-08-05) | Permisos `empresas.view`/`empresas.manage` reemplazan el `role=="admin"` hardcodeado de ADR-078; propagación a tenants con matriz de permisos propia. |
| 087 | `validacion-ruc-registro-externo-opcional` | ✅ implemented (2026-08-05) | Checksum de RUC extraído a módulo reutilizable + fix de bug real (nombre de empresa nunca se comparaba); consulta externa opcional al padrón SUNAT documentada como excepción explícita y acotada a ADR-001 (apagada por defecto, sin proveedor contratado aún). |
| 093 | `vite8-rolldown-migracion-parcial-interop-plotly` | ✅ implemented (cerrado 2026-08-08) | Vite 8/Rolldown + swap a `plotly.js-basic-dist-min` encontrados sin ADR y sin commitear (junto con toda la migración TS de ADR-069); rompían el módulo Informes para cualquier usuario (bug de interop CJS→ESM entre esbuild dev y Rolldown build). Corregido y verificado en ambos bundlers. Cerrado tras commitear el árbol completo de `frontend/` (750 archivos, sesión de 2026-08-08). |
| 094 | `lectura-dni-camara-pdf417-mrz` | ✅ implemented, verificado con datos sintéticos (2026-08-07) | Lectura de DNI (antiguo PDF417 + MRZ de todas las versiones) vía cámara web en sidecar `ai_engine`, sin consulta a RENIEC. Alternativa elegida tras descartar validación online por riesgo de cumplimiento. QR del DNI-e 3.0 diferido. Falta prueba contra documento físico real. |
| 095 | `usermaintenancemodal-css-autocontenida-marca` | ✅ implemented, verificado (2026-08-07) | Fix real de code-splitting: el modal se monta desde `App.tsx` fuera del chunk lazy de ReportStudioV2 y no cargaba su CSS; hoja propia autocontenida + marca corporativa `#F07E41`. |
| 096 | `opencv-4-12-vcpkg-backend` | ✅ implemented, verificado (2026-08-08) | Backend C++ compila OpenCV 4.12.0 estático vía vcpkg manifest, reemplazando `libopencv-dev` 4.6.0 (apt/Ubuntu, congelado desde 2022). Runtime sin cambios (cascades Haar del pipeline legacy). |
| 101 | `fix-bucle-reintento-registro` | ✅ implemented, verificado (2026-08-08) | El `useEffect` de auto-envío de registro reintentaba cada ~2.7s con los mismos datos tras cualquier error del servidor, borrando el mensaje casi al instante (`setError('')`) — se veía como pantalla parpadeando sin error visible. Un rechazo confirmado del servidor ya no rearma el auto-reintento. |

**Ámbito `plataforma`: 37/39 implemented, 1 partial, 1 proposed** (recalculado 2026-08-08 tras agregar ADR-096/101 y cerrar ADR-093; ADR-033 sigue partial deliberadamente, ADR-035 sigue proposed a la espera de decisión de negocio — ver ADRs individuales).

### Ámbito `core-iot` — plataforma IoT del core C++
| # | Slug | Status | Resumen |
|---|---|---|---|
| 003 | `servidor-http-ws-boost-beast` | ✅ implemented (2026-07-06) | HTTP/WS async con Boost.Beast+Asio (C++20), pool ~15k WS. |
| 007 | `ingesta-telemetria-etapa1-libpq` | ✅ implemented (2026-07-06) | Etapa 1: gateway TLS C++ + libpq directo (simulación 10k). |
| 008 | `bus-eventos-redpanda-etapa2` | ✅ implemented (2026-07-07) | Etapa 2: Redpanda + librdkafka + COPY binario para 10k/seg. |
| 027 | `opencv-procesamiento-imagenes` | ✅ implemented, alcance v0.1 (2026-07-06) | OpenCV en v0.1 = imágenes de informe + captura de mapa; EPP diferida (por diseño). |
| 034 | `core-plataforma-iot-reemplazo-thingsboard` | ✅ implemented (actualizado 2026-07-13) | Core C++ = plataforma IoT propia: ingesta + fórmulas + gestión de dispositivos + alarmas + adaptadores MQTT/Modbus/OPC-UA (los adaptadores, dados por diferidos el 2026-07-09, se confirmaron implementados y corriendo el 2026-07-13). |
| 054 | `sync-thingsboard-legacy-aws` | ✅ implemented (2026-07-17) | Conector backfill REST + tiempo real WS que sincroniza el ThingsBoard legacy (hoy AWS) hacia la plataforma propia durante la transición de ADR-034; probado con 6M puntos/10min a 10k/seg. |

**Ámbito `core-iot`: 6/6 implemented.**

### Ámbito `datos` — bases de datos y almacenamiento
| # | Slug | Status | Resumen |
|---|---|---|---|
| 005 | `dos-bases-de-datos-sensors-formula` | ✅ implemented (2026-07-06) | `sensors_db` (TimescaleDB) + `formula_db`/operacional (PostgreSQL). |
| 006 | `timescaledb-hypertables-retencion` | ✅ implemented (2026-07-07) | Hypertables + retención/compresión + continuous aggregates. |
| 009 | `almacenamiento-objetos-minio-parquet` | ✅ implemented (2026-07-08) | MinIO (S3 on-prem) + archivado Parquet del histórico frío. |
| 032 | `timescaledb-instancias-ingesta-lectura` | ✅ implemented (2026-07-06) | Dos instancias Timescale: primaria (ingesta) + réplica read-only vía streaming replication. |
| 088 | `seed-empresas-distribuidoras-usuarios-demo` | ✅ implemented (2026-08-05) | TimeTelemetry, Beemetry y 4 distribuidoras reales del rubro minero peruano con RUC sintético marcado como tal; 24 usuarios de prueba ficticios (4 perfiles × 6 empresas) validando la matriz RBAC de ADR-086. |

**Ámbito `datos`: 5/5 implemented.**

### Ámbito `reports` — componente ReportStudio ("proyecto de reportabilidad", primero por prioridad)
| # | Slug | Status | Resumen |
|---|---|---|---|
| 010 | `modelo-documento-json-bloques` | ✅ implemented, premisa de texto corregida (2026-07-17) | Documento = JSON tipado de bloques. Texto: string plano + spans (ADR-050) — la premisa original ("ProseMirror-JSON") no aplicaba a ReportStudioV2, ver actualización en el ADR. |
| 011 | `estructura-formal-secciones-cover-toc` | ✅ implemented, alcance revisado (2026-07-07) | `cover`/`toc` serializables + `headingStyle`; no existe árbol `sections[]`, el modelo sigue en páginas planas. |
| 012 | `binding-dato-widget-referencia-versionada` | ✅ implemented, alcance acotado (2026-07-07) | Widget = referencia + snapshot versionado; snapshot al firmar (no en cada tick). |
| 013 | `editor-tiptap-konva` | ✅ implemented, alcance corregido (2026-07-17) | Layout de página con Konva (vigente). Texto: Tiptap solo en el módulo "Report" v1 (fuera de ReportStudioV2) — Report v2 usa el modelo de ADR-050, ver actualización en el ADR. |
| 014 | `estado-editor-zustand` | ✅ implemented (2026-07-06) | Store Zustand único (no Redux); límite claro cliente↔servidor. |
| 015 | `versionado-informe-server-autoritativo` | ✅ implemented (2026-07-06) | Versiones/auditoría autoritativas en servidor (`report_content_revision`). Pendiente menor: política de retención del historial. |
| 016 | `export-server-side-asincrono` | ✅ implemented (2026-07-06) | Export canónico server-side (Chromium headless); cliente solo fallback. |
| 017 | `workflow-canonico-informe` | ✅ implemented (2026-07-06) | Máquina de estados única front↔BD (draft→in_review→approved→signed→archived). |
| 018 | `firma-documental-vs-integridad-archivo` | ✅ implemented, alcance v0.1 (2026-07-06) | Firma de aprobación humana (v0.1); hash SHA-256 de integridad diferido a futuro por diseño. |
| 019 | `resolucion-diferida-numeracion-toc-refs` | ✅ implemented (2026-08-05) | Numeración/TOC/"Página X de Y" implementados; referencias cruzadas automáticas cerradas — ancla (`span.ref.targetId`) resuelta en render vía `generateTocData`, verificado con test que inserta una sección en el medio y confirma el renumerado automático. |
| 020 | `mapa-bloque-tipado-georeferencia` | ✅ implemented, alcance v0.1 (2026-07-06) | v0.1: snapshot a imagen (popup); bloque tipado con geo-ref real diferido a futuro por diseño. |
| 021 | `ownership-metadatos-ciclo-vida` | ✅ implemented (2026-07-07) | `document.meta.version` (contador local) vs `version_number` (BD, autoritativo) — separación resuelta en la UI. |
| 022 | `offline-cola-versionada-indexeddb` | ✅ implemented — cierre completo (2026-07-13) | Persistencia offline real (SQLite/WASM en vez de IndexedDB) + resolución de conflicto real: concurrencia optimista server-side (`expected_version`/409), prompt de reconciliación al reconectar, y elección sobrescribir-vs-guardar-como-nuevo al guardar. Más: checkpoint forzado cada 3 min en línea (pedido de negocio adicional). |
| 039 | `puente-tenant-id-company-name-informes` | ✅ implemented — migración completa (2026-07-13) | `reports` migrado por completo a `tenant_id` (UUID) como única clave de aislamiento; `company_name` queda solo como display legacy. De paso se corrigió un hallazgo real: `session.tenantId` podía traer un tenant DEMO de fallback para usuarios sin tenant real, evadiendo el chequeo `tenant_required` — cerrado con `userHasRealTenantMembership`. |
| 044 | `exportacion-portatil-cifrada-informes` | ✅ implemented (2026-07-13) | Export/import `.mreport` cifrado AES-256-GCM server-side; mismo tenant sin cambios, otro tenant solo estructura. |
| 045 | `edicion-offline-sqlite-cliente` | ✅ implemented (2026-07-13) | Edición offline: SQLite (sql.js/WASM) local descargada del servidor, banner con fecha/hora del corte, reconciliación al reconectar. |
| 046 | `encabezado-pie-elementos-plataforma-fijos` | ✅ implemented (formalizado 2026-07-17) | Header/footer fijos, no editables; datos de empresa/unidad/usuario calculados en vivo de sesión, nunca en `props`. |
| 047 | `galeria-imagenes-tenant` | ✅ implemented (formalizado 2026-07-17) | Galería de fotos JPEG por tenant, insertable bajo demanda en cualquier página del informe. |
| 048 | `caratula-toda-pagina-imagen-libre` | ✅ implemented (formalizado 2026-07-17) | Carátula ocupa toda la hoja; la foto de empresa es un bloque `image` libre (movible/redimensionable), no un fondo fijo. |
| 049 | `ajuste-texto-alrededor-objetos` | ✅ implemented, extendido (2026-07-17) | 7 modos de ajuste de texto estilo Word alrededor de objetos; extendido para soportar formato mixto (spans, ADR-050) dentro del texto que envuelve. |
| 050 | `formato-texto-por-seleccion-spans` | ✅ implemented (2026-07-17) | Negrita/cursiva/subrayado/color/tamaño/fuente aplicables solo al texto seleccionado (spans sobre string plano) — corrige la premisa ProseMirror de ADR-010/013. |
| 051 | `copiar-pegar-objetos-lienzo` | ✅ implemented (2026-07-17) | Copiar/pegar de bloques dentro del mismo lienzo (portapapeles interno de la app, no del sistema operativo). |
| 052 | `navegacion-zoom-tamano-pagina` | ✅ implemented (2026-07-17) | Navegación de teclado (PageUp/PageDown/flechas), zoom 10%-400%, tamaño de hoja/orientación configurable por página individual. |
| 053 | `estilos-visuales-tabla` | ✅ implemented (2026-07-17) | Galería de temas de color, filas alternadas, bordes configurables, título de tabla; formato por selección en celdas (`contentEditable`+`execCommand`). |
| 055 | `editor-indicador-seleccion-propio` | ✅ implemented (2026-07-18) | Indicador de selección propio (ya no el nativo del navegador) para que el resaltado escale correctamente con tamaño de fuente mixto por tramo; resaltado y ciclo de mayúsculas llevados al mismo criterio "selección o bloque completo" de ADR-050. |
| 062 | `insercion-video-grabado-webcam-pantalla` | 🔄 superseded by 064, 065 (2026-07-21) | Decisión original de inserción de video (ambos orígenes juntos). Separada a pedido de Gerencia en dos ADR independientes por origen de grabación — contenido conservado sin editar, ver nota en el archivo. |
| 064 | `grabacion-video-camara-web-lienzo` | ✅ implemented (2026-07-21) | Grabación de video por cámara web (`getUserMedia`, nuevo — no existía ninguna grabación de video por cámara antes), insertable en el lienzo. Mitad de ADR-062, separada. |
| 065 | `grabacion-video-pantalla-ventana-lienzo` | ✅ implemented (2026-07-21) | Grabación de pantalla/ventana (`getDisplayMedia`, reutiliza el mecanismo del botón "Grabar" preexistente — antes solo exportaba/descargaba), insertable en el lienzo. Mitad de ADR-062, separada. |
| 070 | `bloques-tecnicos-plantillas-semanticas-composicion` | ✅ implemented (2026-07-24) | Callouts, KPI, captions, 10 secciones y 3 gráficos por composición de `text/table/chart`; tablas con semántica/tamaño natural compartidos por editor y visor. |
| 071 | `toc-pagina-dos-continuaciones-automaticas` | ✅ implemented, corregido (2026-07-25) | TOC único en página 2, paginado automáticamente en continuaciones serializadas. El botón del ribbon SÍ inserta el bloque real ahora (antes solo abría un panel de navegación, ver actualización). |
| 073 | `modal-propio-reemplaza-dialogos-nativos-consistencia-ribbon` | ✅ implemented, ampliado (2026-07-27) | `SaveTitleModal` y host global accesible reemplazan todos los `prompt/alert/confirm` activos; contraste corregido y ribbon con `flex-wrap`. |
| 080 | `marca-de-agua-y-password-pdf` | ✅ accepted (2026-08-02) | Vista previa de impresión real, marca de agua por tenant/usuario/fecha y PDF cifrado con contraseña generada por descarga (`qpdf`). *(Fila agregada 2026-08-03 — el ADR ya existía sin fila en esta tabla, ver nota de auditoría arriba.)* |
| 083 | `exportacion-pptx-modo-presentacion-sidecar-hibrido` | ✅ implemented (2026-08-03) | Export a PPTX (modo presentación, mismo sidecar Chromium del PDF): captura por página + overlay de texto NATIVO editable/buscable para bloques `text`, gateado por `layoutMode`, job asíncrono real sobre `report_export_job`. Corrige de paso un bug preexistente en `ReadOnlyViewer` (sin `layoutMode`) que también afectaba al PDF. |
| 084 | `conversion-pptx-video-narracion-diapositiva` | ✅ implemented (2026-08-03) | Convierte el PPTX de ADR-083 a MP4 (`ffmpeg`, corte o fundido) con narración opcional por diapositiva (audio grabado o notas de orador, TTS diferido). Bug real de truncado de video corregido (`-c:v copy` con VFR) y brecha RBAC cerrada (narración exige `informes.edit`, no solo `informes.view`). |
| 092 | `plantilla-corporativa-timetelemetry-referencia-diseno` | ✅ accepted (2026-08-07) | Registro de referencia de diseño (no una decisión de arquitectura): colores, tipografía (Roboto, no Aptos), estilo de tabla e inventario de 26 layouts extraídos de `Plantilla Telemetry.potx` (entregada por Gerencia). Insumo directo para una futura generación de PPTX con identidad visual oficial (ADR-083/084). |

**Ámbito `reports`: 33/34 implemented/accepted y 1 superseded** (ADR-019 pasó de partial a implemented el 2026-08-05, ver su actualización; ADR-079 es ámbito `plataforma`, no `reports` — su fila ya está reconciliada en la tabla de `plataforma` arriba). Ver "Progreso del proyecto de reportabilidad" abajo (cálculo no recalculado en esta pasada para 080/083/084 — cubre 010-073 + 019).

### Ámbito `ia` — inteligencia artificial local
| # | Slug | Status | Resumen |
|---|---|---|---|
| 024 | `ia-local-ollama-languagetool` | ✅ implemented, refinado por 068 | Redacción/corrección local con Ollama + LanguageTool; ADR-068 agrega búsqueda bibliográfica externa acotada, no IA cloud para redactar. |
| 025 | `biometria-vision-epp-diferidas` | 🚫 EPP deferred; login facial activo con gate legal (2026-07-24) | Se reconcilia el runtime: login facial existe; visión EPP y ampliaciones biométricas siguen diferidas. |
| 068 | `ia-editorial-multimodelo-referencias-externas-controladas` | ✅ implemented (2026-07-24) | LanguageTool + `gemma2:2b` rewrite + `qwen2.5:7b` APA. Búsqueda bibliográfica externa opt-in, explícita y acotada; nunca cuerpo del informe/telemetría. |
| 074 | `avatar-biometrico-local-hd-bajo-demanda` | ✅ implemented, verificado (2026-07-27) | MediaPipe/OpenCV local + fallback ONNX, miniatura en sesión y maestro 2880×3840 privado bajo demanda; modal doble clic/cierre exterior. |
| 089 | `biometria-dermalog-cli-integration` | ✅ accepted (2026-08-05) *(fila agregada 2026-08-07 — el ADR ya existía sin fila en esta tabla, ver nota de auditoría arriba)* | SDK comercial Dermalog Face (`BiometricProvider::DermalogCli`, subproceso vía `dermalog-face-cli`) como validador biométrico principal por exigencia de cumplimiento/certificación; InsightFace (ArcFace) pasa a fallback automático si el binario Dermalog falla. Sustituye formalmente `specs/adr/ADR-005` (que ya tiene el banner `SUPERSEDED` correcto apuntando aquí). |
| 090 | `deprecacion-adr-tempranos-ia` | ✅ accepted (2026-08-05) *(fila agregada 2026-08-07)* | Formaliza que `specs/adr/` (metodología SDD temprana) queda deprecado como fuente para el router de IA/RAG a favor de `docs/decisions/` — consistente con la nota ya existente de este mismo README (2026-07-24, "`docs/decisions/` pasa a ser la fuente canónica efectiva para RAG, agentes y CI"). |
| 091 | `opencv-composicion-raii` | ✅ accepted (2026-08-05) *(fila agregada 2026-08-07)* | Procesamiento/composición de imágenes en C++ con OpenCV vía patrón RAII (gestión determinista de recursos nativos); implementa CANDIDATE E6. |
| 097 | `numpy2-onnxruntime-opencv-python-ai-engine` | ✅ implemented, verificado (2026-08-08) | `ai_engine` migrado a NumPy 2.x, onnxruntime 1.23.2, opencv-python-headless 4.14.x; mediapipe e insightface se mantienen sin cambio (releases mayores demasiado recientes, sin ciclo de prueba). Shim de compatibilidad `np.int` para InsightFace 0.7.3 (bug confirmado upstream, sin release en PyPI). |
| 098 | `aislamiento-sesion-captura-biometrica` | ✅ implemented, verificado (2026-08-08) | `X-Capture-Session-Id` por pestaña, propagado frontend→backend→ai_engine. `gBiometricCaptureState` y la histéresis de lentes/EAR en `eye_analyzer.py` eran globales de proceso compartidas por todas las capturas concurrentes. |
| 099 | `fallback-insightface-no-bloqueante` | ✅ implemented, verificado (2026-08-08) | `analyzeFaceImage()` intentaba InsightFace primero y, si fallaba, retornaba sin caer al pipeline legacy — contradecía ADR-089 (InsightFace es motor secundario). Fallback real restaurado. |
| 100 | `onnxruntime-thread-limit-insightface` | ✅ implemented, verificado (2026-08-08) | `/face_embedding` tardaba 4-7s con 398% CPU por sobre-suscripción de hilos de onnxruntime (host vs. cuota de cgroup del contenedor). `intra_op_num_threads=2` inyectado vía parche de `InferenceSession`: 0.6-0.8s, 8.7% CPU. |

**Ámbito `ia`: 10 implemented/accepted y 1 deferred por diseño (EPP no cuenta como pendiente v0.1).**

### Ámbito `geo` — cartografía y geoespacial
| # | Slug | Status | Resumen |
|---|---|---|---|
| 026 | `cartografia-offline-mbtiles-maplibre` | ✅ implemented (2026-07-07) | Mapas offline MBTiles + mbtileserver + Leaflet; capas externas solo como enriquecimiento conectado/cachable, no dependencia operativa. |
| 028 | `gdal-conversion-raster-diferida` | 🔄 superseded by 072 (2026-07-24) | Decisión histórica de diferimiento; dejó de reflejar el runtime. |
| 056 | `csp-service-worker-tiles-mapa` | ✅ implemented (2026-07-18) | CSP dedicada para el Service Worker de cacheo de tiles (`tile-cache-sw.js`) — la CSP general de la SPA rompía el 100% de los tiles externos; timeout adaptativo + catálogo WMS saneado. |
| 072 | `gdal-cli-runtime-admin-confinado` | ✅ implemented, verificado E2E (2026-08-05) | GDAL CLI on-demand admin-only, rutas confinadas a `/data`, parámetros allowlist y jobs autenticados/tenant-owned. Pipeline `gdal_translate`+`gdaladdo` verificado contra fixture GeoTIFF real dentro del contenedor: MBTiles válido, tile extraído confirmado JPEG 256×256 real. |

**Ámbito `geo`: 3 activos implementados y 1 superseded (ADR-028).**

### Ámbito `realtime` — visualización de datos en tiempo real
| # | Slug | Status | Resumen |
|---|---|---|---|
| 057 | `dashboard-widgets-estilo-thingsboard` | ✅ implemented (2026-07-19) | Gauge radial, tarjetas de agregación y doughnut de estado en Monitoreo→Sensores, alimentados por `/api/sensors/data` real (no telemetría simulada). Primer ADR de este ámbito. |

**Ámbito `realtime`: 1/1 implemented.**

### Ámbitos futuros (componentes por venir)
- *(otros componentes se agregan acá a medida que surgen)*

---

## Progreso del proyecto de reportabilidad (ámbito `reports`)

Cálculo basado **en los 30 ADRs activos de ámbito `reports` redactados hasta
hoy** (010-022, 039, 044-053, 055, 064, 065, 070, 071, 073 — no cuenta
ADR-062, superseded por 064/065) — no incluye trabajo futuro sin ADR
todavía, ni los gates de release que no son decisiones arquitectónicas
(pentest, QA funcional, GO-LIVE — ver más abajo, se rastrean aparte).

| Estado | ADRs | Peso |
|---|---|---|
| Implementado sin reservas (incl. alcance v0.1 explícitamente reducido por diseño) | 010, 011, 012, 013, 014, 015, 016, 017, 018, 019, 020, 021, 022, 039, 044, 045, 046, 047, 048, 049, 050, 051, 052, 053, 055, 064, 065, 070, 071, 073 | 30 × 1.0 = 30.0 |
| Parcial | — | 0 |
| **Total** | **30 ADRs** | **30.0 / 30** |

### → **Avance del proyecto de reportabilidad: 100%** (30 / 30 ADRs activos)

**Actualización 2026-08-05**: ADR-019 cierra el último pendiente
arquitectónico del proyecto (referencias cruzadas automáticas) — ancla
(`TextStyleSpan.ref.targetId`) resuelta en render contra `generateTocData`,
con test que verifica explícitamente el requisito del propio ADR: insertar
una sección en el medio del documento renumera y actualiza la referencia sin
tocarla. **100% arquitectónico no es lo mismo que listo para producción**:
el backlog operativo de abajo (pentest externo sin agendar, QA funcional
firmado pendiente, dominio de producción sin decidir) sigue condicionando el
release real — ver esa sección, sin cambios por este cierre.

**Actualización 2026-07-25**: ADR-073 cierra tres divergencias reales entre
ADR y runtime encontradas al probar la aplicación en vivo (no por lectura de
código): ADR-053 no documentaba el control funcional de tabla ni dos bugs ya
cerrados (bucle de versión, shield CSS bloqueando controles); ADR-068
afirmaba corrección fiel por LanguageTool pero el botón rápido usaba un stub
de 13 palabras; ADR-071 afirmaba que ribbon y biblioteca llamaban a la misma
acción de TOC, pero el botón del ribbon solo abría un panel de navegación.
Las tres quedan corregidas y verificadas en navegador real. Ninguna es un
conflicto *entre* ADRs — todas eran el ADR describiendo una intención que el
código todavía no cumplía.

**Actualización 2026-07-24**: ADR-070 formaliza bloques/plantillas técnicas
por composición y ADR-071 la paginación real del TOC. Ambos reutilizan el
modelo existente y pasan tipos/build. La reclasificación honesta de ADR-019
evita contar referencias cruzadas como terminadas; el porcentaje tampoco
sustituye el gate manual de QA ni el pentest.

**Actualización 2026-07-21 (segunda pasada, mismo día)**: ADR-062 (inserción
de video, ambos orígenes juntos) se separó a pedido de Gerencia en **ADR-064**
(cámara web) y **ADR-065** (pantalla/ventana) — dos decisiones independientes,
cada una con su propio contexto/trade-offs/verificación. ADR-062 queda
`superseded`, contenido conservado sin editar. Ambos ADR nuevos verificados
en vivo hasta el límite de hardware del sandbox de pruebas (no hay cámara ni
posibilidad de compartir pantalla en ese entorno) — una grabación real de
punta a punta de cada origen queda pendiente de prueba manual antes de
certificación QA plena (ADR-061, Capa 5). En el cálculo de esa fecha no
cambiaba el 100%; ADR-019 fue reclasificado partial el 2026-07-24.

**Actualización 2026-07-21 (primera pasada)**: se agregó ADR-062 (inserción
de video grabado por cámara web/pantalla, insertable en el lienzo). Se marcó
"implementado, verificado parcialmente" — el flujo completo de UI se
verificó en vivo contra el backend real, pero una grabación de punta a punta
con hardware real de cámara/pantalla quedó pendiente de una prueba manual.
No cambiaba el 100% calculado entonces porque el propio ADR-059 (Capa 5) ya contempla
la regresión manual completa antes del gate R4 como paso posterior a la
implementación.

**Actualización 2026-07-20**: se agregó ADR-055 (`editor-indicador-seleccion-propio`,
formalizando un bug fix del 2026-07-18 que no tenía ADR escrito — ver §
"Actualización 2026-07-20" arriba del índice). El proyecto de reportabilidad
siguió al 100% en el corte de esa fecha; no cambió el avance, solo el conteo total de ADRs que lo
respaldan.

**Actualización 2026-07-17 (tercera pasada)**: se agregaron 8 ADRs nuevos
(046-053) — 4 formalizan decisiones ya implementadas sin ADR escrito
(encabezado/pie fijos, galería de imágenes, carátula, ajuste de texto), y 4
documentan trabajo nuevo de esta sesión: formato de texto por selección
(negrita/color/tamaño/fuente solo en la porción seleccionada, corrigiendo
de paso una premisa incorrecta de ADR-010/013 sobre Tiptap/ProseMirror),
copiar/pegar de objetos en el lienzo, navegación de teclado + zoom
10%-400% + tamaño de hoja por página, y estilos visuales de tabla. Los 24
ADRs de `reports` quedaron al 100% en ese corte. ADR-019 fue reclasificado
partial en la auditoría posterior del 2026-07-24.

**Actualización 2026-07-13 (segunda pasada, misma fecha)**: ADR-022 se cerró
por completo — era el único ADR de `reports` que quedaba parcial. El negocio
pidió explícitamente resolver el pendiente documentado ("falta resolución de
conflicto por version-base"): ahora, si otra terminal actualiza un informe
mientras esta edita sin conexión, al reconectar se detecta el conflicto real
(concurrencia optimista server-side, `409 version_conflict`, verificado
contra el backend real) y se pregunta explícitamente al usuario si quiere
traer la versión del servidor o seguir con su copia offline — y si sigue,
al guardar puede elegir sobrescribir o guardar como informe nuevo (nunca se
pierde trabajo silenciosamente). Se agregó además un checkpoint forzado cada
3 minutos en línea, pedido de negocio adicional no contemplado en el ADR
original. Ver ADR-022 para el detalle técnico completo y la verificación
end-to-end (backend real + navegador real, sin recargar la página, con una
"segunda terminal" real vía HTTP directo).

**Con esto, los 29 ADRs activos quedan registrados con evidencia de
implementación.** Las excepciones, riesgos de release y verificaciones manuales
se mantienen declaradas abajo; el índice no usa el conteo para ocultar trabajo
pendiente.

Fuera del cálculo de ADRs (no son decisiones arquitectónicas) pero
**bloqueante para el release real** — backlog operativo:
- ~~**Retirar el verificador legacy ADR-077** cuando su inventario llegue a
  cero.~~ **Cerrado 2026-08-07**: inventario en 0/82 (antes 40 legacy) —
  reset administrado de las 40 cuentas restantes (35 fixtures QA + 3 posibles
  DNI reales + la cuenta del propio usuario, decisión explícita suya, no
  unilateral) con la misma función Argon2id real del backend
  (`libargon2` vía ctypes, mismos parámetros configurados). Verificado con
  login real end-to-end y reinicio del backend sin ningún log de migración
  pendiente. Ver actualización en ADR-077 para el detalle completo. La rama
  de código `legacy1:`/verificador legado en sí **sigue existiendo** — su
  eliminación de código es un cambio aparte, ya sin ninguna fila real que
  la ejercite en este entorno. El código de envoltura automática (ADR-077,
  actualización 2026-08-05) sigue sin commitear en la rama actual — no se
  commiteó unilateralmente en esta pasada.
- **Configurar el dominio real de producción** en
  `BEEMETRY_CORS_ALLOWED_ORIGIN`; el compose productivo ya falla si falta,
  pero el valor depende del DNS/HTTPS definitivo del despliegue.
- Pentest de seguridad pre-release (pendiente, no iniciado).
- QA funcional formal v0.1 (cobertura parcial vía smoke tests repetidos;
  falta un pase exhaustivo firmado). *(Actualización 2026-08-05: la
  conversión raster GDAL con inspección visual ya se verificó E2E — ver
  actualización en ADR-072. Suites automatizadas corridas reales:
  Catch2 backend 610/610 aserciones, Vitest frontend 35/35, `tsc` 0 errores
  — ver actualización en ADR-059/ADR-060. Playwright e2e pasó de 1/8 a 5/8
  tras corregir 2 regresiones reales de navegación (categoría "Reportes"→
  "Informes" de ADR-042, labels "Report"/"Report v2"→"Reporte"/"Informes" de
  i18n ADR-075) sin tocar código de producción, solo los specs desactualizados.
  3 specs con la cuenta real `operator` siguen fallando más adentro del
  editor — posible gate de permiso real de ADR-079, sin confirmar por falta
  de Browser pane disponible en esta sesión; ver detalle en ADR-059. Sigue
  pendiente una grabación real de cámara/pantalla con hardware físico — no
  ejecutable en un entorno sin cámara ni posibilidad de compartir pantalla
  real — y la firma formal exhaustiva del resto del catálogo de 69 casos de
  ADR-061. *(Actualización 2026-08-07: hipótesis del gate de ADR-079
  **descartada** — verificado por SQL directo que tanto `operator` como
  `manager` (rol real de `larmas`/Alpayana, no `operator` como decía este
  párrafo) tienen `informes.edit` en la matriz por defecto y no hay override
  de tenant para Alpayana. La causa real: el árbol de `frontend/` tenía un
  bug de interop CJS→ESM sin commitear que crasheaba el módulo Informes para
  **cualquier** usuario/tenant — corregido, ver ADR-093.)*
- ~~Implementar las referencias cruzadas automáticas pendientes de ADR-019.~~
  Cerrado 2026-08-05 — ver actualización en ADR-019 y el 100% recalculado arriba.
- Release v0.1: Deploy + Documentación + GO-LIVE formal.

### Fecha referencial de término

**Estimado anterior: fines de julio 2026 (referencial, no comprometido).**
La auditoría del 2026-07-24 invalidó tratar esa fecha como lista para
producción por el 1.7% arquitectónico pendiente de ADR-019 más los gates y
bloqueantes del backlog anterior. **Actualización 2026-08-05: el 1.7% de
ADR-019 ya cerró (100% arquitectónico, ver arriba)** — lo único que sigue
condicionando la fecha es el backlog operativo, no decisiones de diseño sin
tomar:
- Pentest externo: típicamente 1-2 semanas de calendario una vez agendado
  (no iniciado a la fecha de este reporte y uno de los factores principales
  de incertidumbre).
- QA funcional + GO-LIVE: 3-5 días una vez el pentest no tenga hallazgos
  críticos abiertos.

La fecha **2026-07-31** solo puede mantenerse como objetivo condicionado, no
como compromiso: Argon2id, ECharts y ADR-019 ya están cerrados, pero exige
completar QA funcional firmado, decidir el dominio de producción y no
recibir hallazgos críticos del pentest (sin agendar aún).

---

## Cómo agregar un ADR nuevo

1. Numerar al siguiente disponible (sin reciclar números, aunque haya ADRs `superseded`).
2. Crear archivo `NNN-slug-corto.md` con el campo **`Ámbito`** en la cabecera.
3. Agregar fila al índice, en el grupo de su ámbito.
4. Mencionar en el commit con `Refs ADR-NNN`.
5. Si supersede uno anterior: editar el anterior agregando `Status: superseded by ADR-NNN` y la fecha.
