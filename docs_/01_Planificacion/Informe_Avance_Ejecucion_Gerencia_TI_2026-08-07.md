# Informe de Avance de Ejecución — Proyecto AURIXA / Beemetry

## Plataforma Integral de Telemetría, Trazabilidad y Automatización Minera con IA

**Tipo de documento:** Informe gerencial de avance, con detalle mes a mes, mapa completo de las 96 decisiones arquitectónicas (ADR) vigentes, y problemas/limitaciones/dificultades por mes — no reemplaza ni modifica el cronograma contractual v36.1 (SOW-AURIXA-2026-MAESTRO), lo audita contra el estado real de la documentación del repositorio. Actualiza el informe anterior del 27-jul-2026.
**Fecha de corte:** 7 de agosto de 2026 (Sprint S5, dentro del Release R3 — 11 días después del informe anterior; el gate de R2 (31-jul) ya transcurrió).
**Calendario vigente:** 1 jun – 30 nov 2026 (6 meses · 13 sprints · 6 gates · 2 etapas) — sin cambios respecto al SOW.
**Preparado por:** Compilación asistida por IA (Claude Code) a pedido de Arquitectura TI / PMO — ver nota metodológica (sección 0) antes de usar las cifras de este informe para una decisión de calendario.

---

## 0. Nota metodológica de esta actualización — léase antes de usar las cifras

Los tres informes anteriores (17-jul, 20-jul, 27-jul) se construyeron con **verificación en vivo**: rebuild/redeploy real de contenedores, consultas SQL directas a la base de datos, ataques cruzados reales de IDOR, corridas de `ctest`, inspección de PDF/PPTX/video generados byte a byte. Esta actualización del 7-ago **no repite esa verificación en vivo** — es una revisión de escritorio construida a partir de:

- El campo `Status`/`Estado` y fecha de cada uno de los 96 archivos en `docs/decisions/`.
- `RUNBOOK.md`, `CHANGELOG.md`, `GAP_ANALYSIS_2026-07-04.md` en su estado actual (no commiteado — ver hallazgo crítico en sección 1).
- `specs/015-dr-respaldo-continuidad/tasks.md` (backlog de Disaster Recovery, leído directo).
- El historial real de `git log`/`git status` (no un resumen de él).
- Los tres informes gerenciales previos como línea base de comparación.

**Consecuencia práctica:** los % de avance de las secciones 2 y 3 son una **estimación razonada**, no una medición re-verificada esta semana. Donde el propio ADR trae fecha y evidencia de verificación (p. ej. "verificado 2026-08-05 con fixture GeoTIFF real"), esa verificación sigue siendo válida — es evidencia del código, no una afirmación mía. Donde no hay evidencia de verificación en el ADR mismo (el caso más notorio: **ADR-089**, ver sección 6), lo marco explícitamente como pendiente de confirmar, en vez de asumir que "Aceptado" equivale a "desplegado". Antes de usar este informe para decidir sobre el gate de un release, Gerencia debería pedir una repetición de la verificación en vivo que sí hicieron los informes del 17/20/27-jul.

---

## 1. Qué cambió desde el informe del 27-jul-2026 (11 días)

- **18 decisiones arquitectónicas nuevas formalizadas** (ADR-078 a ADR-095) — total pasa de **78 a 96 ADR**. De estas, 3 (ADR-089, 090, 091) fueron agregadas el mismo día, 2026-08-05, y no siguen el formato estándar de las demás (usan tabla `Campo/Valor` en vez del bloque `**Status**`, y dos de ellas — ADR-090 y ADR-091 — no traen sección de evidencia de verificación).
- **ADR-089 es un cambio de arquitectura mayor sin evidencia de despliegue verificada**: sustituye el proveedor biométrico principal de InsightFace/ONNX (Python, open source) por un SDK comercial (Dermalog, vía subproceso CLI), con InsightFace degradado a *fallback*. Es una decisión "Aceptada" el 2026-08-05, pero el archivo no documenta ningún build, test o verificación en contenedor real — a diferencia de prácticamente todos los demás ADR desde el 24-jul en adelante, que sí traen evidencia directa. **Esto debería verificarse antes de reportarlo como "implementado" en cualquier comunicación a Gerencia.**
- **Riesgo de proceso crítico, no nuevo pero ahora mucho más grande**: el último commit real en la rama es del **2026-07-21** (`fc0dd48`). Todo el trabajo documentado entre el 21-jul y el 7-ago — **18 ADR completos** (078 a 095), el cierre de Argon2id/CSPRNG, CORS multiorigen, cookie HttpOnly+CSRF, exportación PPTX y video narrado, lectura de DNI, CRUD de empresas, rotación del certificado TLS, retiro de secretos con default — **sigue sin commitear**. `git status` muestra 742 rutas con cambios (120 modificadas, 230 eliminadas, 257 nuevas sin trackear). El propio `RUNBOOK.md` (sección 7) y `ADR-093` señalan este mismo riesgo, pero a fecha de hoy el árbol de trabajo es 17 días más grande que el último commit — cualquier pérdida del entorno local (disco, máquina, sesión) hoy perdería 17 días de trabajo documentado y no recuperable desde git.
- **Cierre real de seguridad de contraseñas**: ADR-077 confirma **inventario legacy retirado a cero** (2026-08-07) — las 41 cuentas con hash legacy que el informe del 27-jul reportaba como pendientes de migración orgánica ya no existen; todas migraron a Argon2id. Además, el envoltorio automático al arranque del backend "cierra el vector de craqueo offline" (2026-08-05), un hallazgo de hardening adicional no reportado el 27-jul.
- **Autenticación migró de Bearer token a cookie HttpOnly + CSRF double-submit** (ADR-082, 2026-08-02/03), con 32/32 pruebas unitarias de frontend pasando y validación de build repetida. Esto cierra de raíz el hallazgo de `RUNBOOK.md` que marcaba el CORS `Access-Control-Allow-Origin: *` como "aceptable solo porque la app usa Bearer token" — con cookies en juego, ese wildcard ya no sería aceptable, y en efecto **ADR-081 lo reemplaza por un allowlist de orígenes explícito** el mismo día.
- **Certificado TLS del mining gateway rotado** (2026-08-02) tras descubrir que la clave privada seguía trackeada en git desde el commit `4818805` (2026-03-31) — el `git rm --cached` de una corrección anterior nunca se había commiteado. Regenerado RSA 4096, verificado por TLS real que el puerto 8443 sirve la huella nueva. **Pendiente del equipo**: desplegar en la VPS (requiere SSH) y reconfigurar cualquier sensor/gateway externo que fije (pin) el certificado anterior.
- **Tres secretos que caían silenciosamente a valores publicados en el repo ahora fallan explícitamente si faltan** (`BEEMETRY_REPORT_EXPORT_KEY`, `PDF_OWNER_PASSWORD_SECRET`, `BEEMETRY_API_KEYS`) — corregido 2026-08-02. Los `.mreport` y PDF exportados **antes** de este cambio deben tratarse como no confidenciales.
- **Nuevas capacidades de producto entregadas fuera del alcance original de R2/R3** que valen la pena destacar a Gerencia: exportación de informe a **PPTX en modo presentación** (ADR-083, verificado 2026-08-03 inspeccionando el `.pptx` como ZIP real) y **conversión de esa PPTX a video narrado con ffmpeg** (ADR-084, verificado con muestreo de píxel en frames reales) — ninguna de las dos estaba en la tabla de ADR de R3 del informe del 27-jul.
- **CRUD completo de empresas + RBAC granular (`empresas.view`/`empresas.manage`)** (ADR-085, 086) y **seed de empresas/usuarios demo** (ADR-088) — los tres marcados "implemented" pero **explícitamente pendientes de verificación E2E contra un contenedor real** (Fase 6 de su propio plan de implementación, no ejecutada aún según el texto del ADR).
- **Lectura de DNI por cámara (PDF417 + MRZ)** (ADR-094) y **hoja de estilos autocontenida del modal de mantenimiento de usuarios** (ADR-095), ambas "verificadas" el mismo día de corte de este informe (2026-08-07) — sin margen para que esta actualización las revise de forma independiente.
- **Migración parcial a Vite 8/Rolldown con un bug de interop CJS→ESM en Plotly corregido** (ADR-093, 2026-08-05) — marcada explícitamente `partial`, y es la causante directa (junto con el resto del trabajo sin commitear) del hallazgo crítico de esta sección.

---

## 2. Avance por Release — % y ADR relacionados

**Metodología de esta cifra:** estimación razonada a partir del estado documentado de cada ADR y de los bloqueos ya conocidos, **no** una repetición de la verificación en vivo del 27-jul. Usar con la salvedad de la sección 0.

| Release | Gate | % avance (27-jul → 7-ago, estimado) | Estado | ADR nuevos/relevantes desde 27-jul |
|---|---|---|---|---|
| **R1** — Arquitectura y diseño de datos | 30-jun-2026 | **100% → 100%** ✅ cerrado | Sin cambios. | — |
| **R2** — Motor operacional + seguridad base | 31-jul-2026 (**gate ya transcurrió hace 7 días, sin acta de cierre formal encontrada**) | **94% → ~97%** 🟡 | Argon2id/CSPRNG cerrados a cero legacy, cookie HttpOnly+CSRF, CORS allowlist, alta administrada de empresa, TLS rotado, secretos sin default: todo suma a este release. **Único pendiente real sigue siendo el mismo del 27-jul**: sync AWS sin validar contra el entorno del cliente (bloqueo externo, no de desarrollo). **Hallazgo nuevo de esta revisión**: el gate del 31-jul pasó hace una semana sin que se encuentre en el repo un acta o comunicación formal de cierre de gate — solo ADR y commits informales. | 076, 077 (cierre), 078, 081, 082, 094, 095 |
| **R3** — Editor + GIS + sensores + IA base | 31-ago-2026 | **96% → ~99%** 🟢 muy adelantado | Prácticamente cerrado y con entregas fuera del alcance original (PPTX + video narrado). Único pendiente sin cambios: demo formal de 10.000 sensores no registrada. | 080, 083, 084, 092, 094 |
| **R4** — Integración e2e (fin Etapa 1) | 30-sep-2026 | **75% → ~77%** 🟡 | **Riesgo nuevo detectado esta revisión**: el catálogo de 104 casos de prueba QA (`Catalogo_Casos_Prueba_QA_2026-07-21.md`) no tiene una versión más reciente en el repo — no hay evidencia de que se haya actualizado para cubrir las 18 ADR nuevas (078-095) antes de correr la regresión de cierre de Etapa 1. Sync AWS sigue sin validar (mismo bloqueo). | Ninguno formalmente asignado a R4 desde el 27-jul; el catálogo QA que sostiene este release no se movió. |
| **R5** — Hardening + DR + optimización | 31-oct-2026 | **42% → ~55%** 🔴 | El componente de **hardening de aplicación avanzó fuerte**: CORS allowlist, cookie+CSRF, secretos sin default, TLS rotado — varios de los hallazgos que el propio `RUNBOOK.md` marcaba como pendientes o "aceptable pero mejorable" ya están cerrados. El componente de **Disaster Recovery sigue en 0/14 tareas**, sin cambios desde la última revisión del plan (2026-06-24) — ver sección 6. Pentest externo sigue sin agendar. | 081, 082 (hardening); DR sin ADR propio, ver `specs/015-dr-respaldo-continuidad/` |
| **R6** — Go-Live producción | 30-nov-2026 | **0% → 0%** (esperado) | No puede iniciar antes de cerrar R4/R5. | — |
| *Fuera de alcance contractual / valor agregado* | — | — | Roadmap futuro (035, sin cambios). Valor agregado sin gate propio: 057, 074, 075, y ahora también **083/084 (PPTX + video narrado)**. | 083, 084 |

**Total: 96 ADR** en `docs/decisions/` (000-095). Los 12 ADR originales en `specs/adr/` (001-012) quedan formalmente depreciados como fuente de contexto desde ADR-090 (2026-08-05) — no se cuentan en el total de 96 ni deberían citarse en comunicaciones nuevas.

---

## 3. Avance mes a mes (calendario 1 jun – 30 nov 2026)

| Mes | Sprints | Release del mes | Gate del mes | % avance 27-jul | % avance 7-ago (estimado) | Estado |
|---|---|---|---|---|---|---|
| **Junio 2026** | S1, S2 | R1 — Arquitectura | 30-jun | 100% | **100%** | ✅ Cerrado, sin cambios. |
| **Julio 2026** | S3, S4 | R2 — Motor operacional | 31-jul (**ya pasó**) | 94% | **~97%** | 🟡 Gate técnico prácticamente cumplido, pero transcurrió sin acta formal de cierre encontrada en el repo. Único bloqueo real: AWS (externo). |
| **Agosto 2026** *(mes en curso, corte al día 7)* | S5, S6 | R3 — Editor + GIS + IA | 31-ago | 96% | **~99%** | 🟢 Casi cerrado, con entregas adicionales no planificadas (PPTX/video). Riesgo de proceso alto por trabajo sin commitear (ver sección 1). |
| **Septiembre 2026** | S7, S8 | R4 — Integración e2e (fin Etapa 1) | 30-sep | 75% | **~77%** | 🟡 Depende de actualizar el catálogo QA a las 18 ADR nuevas antes de la regresión de cierre de etapa, y de resolver AWS. |
| **Octubre 2026** | S9, S10, S11 | R5 — Hardening + DR | 31-oct | 42% | **~55%** | 🔴 Hardening de aplicación avanza fuerte; DR sigue en 0/14 tareas desde el 24-jun. Pentest sin agendar. |
| **Noviembre 2026** | S12, S13 | R6 — Go-Live | 30-nov | 0% | **0%** *(esperado)* | ⚪ No inicia hasta cerrar R4/R5 — sin desviación de plan. |

---

## 4. Detalle mes a mes: problemas, limitaciones y dificultades

### Junio 2026 (S1-S2, R1) — Cerrado
Sin problemas pendientes registrados en la documentación disponible; R1 cerró al 100% en su gate y no ha tenido regresiones reportadas en ningún informe posterior, incluido este.

### Julio 2026 (S3-S4, R2 — y trabajo de R3/R5 adelantado)
Julio concentra el mayor volumen documentado de hallazgos reales del proyecto:

- **2 IDOR reales en gestión de usuarios** (lectura y escritura, `GET /api/auth/users`, `POST /api/auth/users/maintenance`) — corregidos y verificados con ataque cruzado real de 2 tenants (2026-07-04).
- **Auditoría no era append-only ni tenía integridad forense** — un `REVOKE` simple no habría bastado porque el rol de conexión del backend es *owner* de la tabla (ignora `REVOKE`); se requirió un trigger que rechaza incondicionalmente `UPDATE`/`DELETE` — resuelto con hash chain SHA-256.
- **Incidente de proceso repetido dos veces la misma semana**: `docker compose build` falló silenciosamente a mitad de camino (BuildKit se cayó) pero el wrapper de la tarea reportó "éxito". Se detectó comparando el hash real del bundle servido, no el código de salida del comando — un recordatorio de que "el comando no falló" no es lo mismo que "el build funcionó".
- **Documentación incorrecta que se propagó a un informe gerencial preliminar**: una versión anterior del informe del 27-jul reportó Argon2id y la separación CSPRNG como "no implementados", por citar el texto de "Contexto" de sus ADR (que describe el problema previo) en vez del campo `Status` real. Se corrigió tras verificar código y base de datos directamente. **Lección de proceso vigente**: cualquier resumen de research sobre el estado de un ADR debe validarse contra el campo `Status`, no contra el `Contexto`.
- **4 defectos reales de UI encontrados durante la certificación de reportabilidad** (formato de encabezado corrompía cursiva/subrayado; botones de lista del ribbon inertes; botón de carátula del ribbon inerte; celdas de tabla con HTML literal en el visor de solo lectura) — todos corregidos en la misma sesión.
- **1 defecto de backend fuera del alcance de reportabilidad**: el token de `POST /api/auth/register` no incluía el `tenant_id` recién aprovisionado, bloqueando la creación del primer informe hasta un login posterior.
- **Limitación de entorno, no defecto**: las verificaciones de grabación de video por cámara web y por pantalla (ADR-064, 065) llegaron hasta el límite de hardware/sandbox del entorno de pruebas — el flujo funciona y maneja errores de permiso sin caerse, pero una grabación real de punta a punta sigue pendiente de una prueba manual con hardware físico.

### Agosto 2026 (S5-S6, R3 — mes en curso, corte al día 7)

- **Riesgo de proceso crítico (nuevo, ver sección 1)**: 17 días de trabajo (78 a 95, 18 ADR completos) sin un solo commit. El equipo trabajó de forma real y verificada (evidencia de build, tests y despliegue local en cada ADR), pero esa evidencia vive solo en el disco local, no en git.
- **Cambio de arquitectura biométrica sin evidencia de verificación (ADR-089, 2026-08-05)**: a diferencia del resto de ADR desde julio, no documenta build, test o despliegue del nuevo proveedor comercial Dermalog. Es el único ADR "mayor" del período que no sigue el estándar de evidencia que el propio proyecto se autoimpuso.
- **Confusión de numeración entre `specs/adr/` (depreciado) y `docs/decisions/` (vigente)** — causaba alucinaciones de arquitectura en los agentes de IA del proyecto (p. ej. ADR-001 de microservicios en un directorio vs. ADR-002 de gateway centralizado C++ en el otro). Resuelto formalmente con ADR-090, pero exige que cualquier referencia futura a "ADR-XXX" en comunicación con Gerencia aclare a qué directorio pertenece.
- **Migración de toolchain (Vite 8/Rolldown) quedó parcial y sin commitear** (ADR-093) — el bug de interop CJS→ESM en Plotly que motivó la migración ya está corregido, pero el árbol completo de esta migración es parte de los 742 cambios sin commitear de la sección 1.
- **3 ADR marcados "implemented" pero explícitamente pendientes de verificación E2E contra un contenedor real** (085, 086, 088 — CRUD de empresas, RBAC granular, seed de datos demo): el propio texto de cada uno remite a una "Fase 6" de su plan de implementación que no se ha ejecutado. No son un hueco de diseño, pero tampoco deberían reportarse a Gerencia como "verificado en vivo" hasta que corra esa fase.
- **Módulo de reportabilidad recibió entregas por encima del alcance original**: exportación a PPTX y conversión a video narrado no estaban en el plan de R3 del informe del 27-jul.

### Septiembre 2026 (S7-S8, R4 — proyectado, mes aún no iniciado)

Riesgos identificables hoy, antes de que el mes comience:

- El catálogo de 104 casos de prueba QA que sostiene la regresión de cierre de Etapa 1 tiene fecha 2026-07-21 — **anterior** a 18 de las 96 ADR vigentes. Si no se actualiza antes de que arranque la regresión de R4, esta corre el riesgo de certificar un alcance desactualizado.
- La validación de sync AWS contra el entorno real del cliente sigue bloqueada por acceso/credenciales externas — sin cambios documentados desde el 27-jul. Es la única dependencia externa que puede correr la fecha del 30-sep.

### Octubre 2026 (S9-S11, R5 — proyectado, mes aún no iniciado)

- **Disaster Recovery, verificado directamente en `specs/015-dr-respaldo-continuidad/tasks.md`: 0 de 14 tareas iniciadas**, con la última revisión del plan fechada 2026-06-24 (sin actividad desde entonces). Las 14 tareas incluyen piezas de alto riesgo técnico si se dejan para el final: fencing anti split-brain, promoción de réplica, reanudación de consumidor Redpanda tras failover, simulacro de DR cronometrado (< 15 min) y ejecución del runbook por un operador distinto del autor. Ninguna de estas se improvisa en una semana.
- **Pentest OWASP externo sigue sin agendar** — sin cambios desde el 27-jul. Con Argon2id/CSPRNG ya cerrados y CORS/cookie-CSRF endurecidos, el momento técnico para agendarlo es ahora mejor que antes, pero la acción de agendarlo sigue sin tomarse.
- **Backup sin destino offsite configurado** — tarea operativa simple, sin dependencia técnica, sin cambios.

### Noviembre 2026 (S12-S13, R6 — proyectado)

Sin problemas propios reportables: R6 es un procedimiento de Go-Live que no puede evaluarse hasta que R4 y R5 cierren. El riesgo de noviembre es enteramente heredado: si el catálogo QA de R4 o el DR de R5 quedan incompletos, es en noviembre donde el retraso se materializa como una fecha de Go-Live movida.

---

## 5. Distribución de las 96 decisiones arquitectónicas por ámbito

| Ámbito | ADR (aprox.) | Nota |
|---|---|---|
| `plataforma` (incluye auth/security) | 38 | Incluye los 18 ADR nuevos de identidad/seguridad/empresas (076-082, 085-088, 093-095) |
| `reports` | 35 | Sigue siendo el ámbito más grande — incluye PPTX/video narrado (083, 084), marca de agua/password PDF (080) |
| `core-iot` | 7 | Incluye ADR-091 (composición OpenCV/RAII, 2026-08-05) |
| `datos` | 5 | Sin cambios de fondo desde el 27-jul |
| `ia` | 5 | Incluye ADR-089 (Dermalog) — ver salvedad de verificación en secciones 1 y 4 |
| `geo` | 4 | Sin cambios |
| `realtime` | 1 | Sin cambios |
| `gobernanza / proceso` (nuevo) | 1 | ADR-090 — deprecación de `specs/adr/` como fuente de contexto |

**Estado de implementación (agregado, 96 ADR):**

| Categoría | Cantidad | Detalle |
|---|---|---|
| Implementado y verificado con evidencia directa en el propio ADR | ~83 | Build, test, query SQL, o inspección de artefacto real citados en el texto |
| Implementado, pendiente de verificación E2E contra contenedor real | 3 | ADR-085, 086, 088 (Fase 6 de sus propios planes, no ejecutada) |
| Parcial | 4 | ADR-033, 034, 058, 093 (093 además sin commitear) |
| Diferido por diseño (no es un hueco real) | 2 | ADR-025 (biometría/EPP, restricción legal), ADR-028 (GDAL raster completo — nota: su alcance v0.1 sí cerró vía ADR-072) |
| Propuesto / fuera de alcance contractual | 1 | ADR-035 (roadmap Enterprise LATAM) |
| Aceptado, sin evidencia de verificación documentada | 1 | **ADR-089** — ver sección 6, ítem nuevo |
| Decisión de gobernanza/estándar, no aplica "implementado" en el mismo sentido | 2 | ADR-090, 091 |

---

## 6. Brechas reales que requieren decisión o seguimiento (vigentes al 7-ago)

| # | Brecha | Bloquea hoy | Cuándo se vuelve urgente | Cambio desde 27-jul |
|---|---|---|---|---|
| 1 | Pentest OWASP externo sin agendar | No | Antes de R5 (31-oct) | Sin cambios |
| 2 | Disaster Recovery en 0% (**0/14 tareas**, precisado esta revisión — el informe anterior decía 0/11) | No | Debe iniciar en sep-oct para llegar a tiempo a R5 | Sin cambios de fondo; conteo de tareas corregido a 14 tras leer `specs/015-dr-respaldo-continuidad/tasks.md` directamente |
| 3 | Sync AWS sin validar contra el entorno real del cliente | No | Antes de R4 (30-sep) | Sin cambios |
| 4 | Demo formal de 10.000 sensores no registrada | No | Antes de R3 (31-ago) si se quiere evidencia formal | Sin cambios |
| 5 | Backup sin destino offsite configurado | No | Configuración operativa simple | Sin cambios |
| 6 | **17 días de trabajo (18 ADR, 742 rutas) sin commitear en git** | No, mientras el entorno local persista | **Alta — cualquier pérdida del entorno local hoy pierde 17 días de trabajo no recuperable** | 🆕 Cuantificado esta revisión; el riesgo ya existía el 27-jul en menor escala |
| 7 | **ADR-089 (cambio de proveedor biométrico principal a Dermalog) sin evidencia de build/test/despliegue documentada** | No | Antes de reportarlo como "implementado" en cualquier comunicación externa | 🆕 Detectado esta revisión |
| 8 | **Catálogo QA (104 casos, 2026-07-21) no actualizado frente a 18 ADR nuevas** | No | Antes de la regresión de cierre de Etapa 1 (R4, 30-sep) | 🆕 Detectado esta revisión |
| 9 | Creación de empresas sin endpoint propio (hallazgo QA original) | **Resuelto** — ADR-085 agrega CRUD completo (pendiente de verificación E2E, ítem 10) | — | ✅ Cerrado en diseño desde el 27-jul/29-jul |
| 10 | 3 ADR (085, 086, 088) "implemented" pendientes de verificación E2E contra contenedor real | No | Antes de certificar R2/R3 como 100% | 🆕 Detectado esta revisión |
| 11 | Certificado TLS del mining gateway regenerado localmente pero **no desplegado en la VPS** | No | Antes de cualquier release real — sensores externos que fijen el certificado anterior dejarán de conectar tras el despliegue | 🆕 (rotación ocurrió 2026-08-02, despliegue en VPS sigue pendiente) |
| ~~12~~ | ~~41 cuentas con hash legacy pendientes de migración~~ **RESUELTO 2026-08-07** — inventario legacy retirado a cero | No aplica | Cerrado | ✅ Cerrado esta semana |
| ~~13~~ | ~~`CHANGELOG.md` desactualizado desde 2026-07-05~~ **RESUELTO** — el changelog actual documenta hasta 2026-08-02 | No aplica | Cerrado | ✅ Cerrado desde antes del 27-jul, confirmado vigente |
| ~~14~~ | ~~Carátula: 5 plantillas anunciadas, 1 solo diseño real~~ **RESUELTO 2026-07-27** | No aplica | Cerrado | Sin cambios (sigue cerrado) |

---

## 7. Resumen Gerencial

**Estado general:** el proyecto sigue técnicamente adelantado en R2 y R3, con una entrega de valor por encima del alcance original (PPTX + video narrado) y con el cierre definitivo del hardening de contraseñas (Argon2id al 100%, cero cuentas legacy). Pero esta revisión encuentra **un riesgo de proceso que no existía en esta magnitud el 27-jul**: 17 días de trabajo real y verificado — 18 decisiones arquitectónicas completas — viven únicamente en el disco local del entorno de desarrollo, sin un solo commit. Esto no es un problema de calidad de trabajo (la evidencia de verificación de cada ADR es sólida); es un problema de **custodia** de ese trabajo.

**Lo más importante para decidir esta semana:**

1. **Commitear el árbol de trabajo pendiente hoy, no al cierre de sprint.** Es la acción de menor esfuerzo y mayor reducción de riesgo de todo este informe — revertir 17 días de trabajo por una falla local es evitable con una sola acción.
2. **Pedir verificación en vivo de ADR-089** (cambio de proveedor biométrico a Dermalog) antes de darlo por implementado en cualquier reporte o decisión de producto — es el único ADR reciente sin evidencia de build/test documentada.
3. **Agendar el pentest OWASP** — sigue siendo la única variable externa que puede correr la fecha de R5, y técnicamente el proyecto está en mejor punto que nunca para agendarlo (Argon2id, CSPRNG, CORS y cookie+CSRF ya cerrados).
4. **Actualizar el catálogo de casos de prueba QA** (104 casos, fecha 21-jul) para cubrir las 18 ADR nuevas antes de que arranque la regresión de cierre de Etapa 1 en septiembre.
5. **Priorizar el arranque del plan de Disaster Recovery** (0/14 tareas) en septiembre — sin cambios respecto al informe anterior; ahora con el conteo de tareas corregido a 14, incluye piezas de alto riesgo (fencing, promoción de réplica, simulacro cronometrado) que no se improvisan.
6. **Desplegar en la VPS el certificado TLS ya rotado localmente** y coordinar con cualquier sensor/gateway externo que fije el certificado anterior — quedó pendiente desde el 2-ago.
7. **Decidir sobre el gate formal de R2** — el gate técnico (31-jul) se cumplió en sustancia, pero transcurrió hace 7 días sin un acta de cierre localizable en el repo. Gerencia debería decidir si eso requiere una comunicación formal retroactiva o si el criterio de cierre de gate no exige ese artefacto.

**Recomendación:** no hay evidencia de una brecha de calendario contractual que requiera intervención de Gerencia sobre el SOW v36.1. El foco de la próxima decisión debería ser el punto 1 (custodia del trabajo, riesgo real hoy) y el punto 3 (agendar el pentest, bajo esfuerzo y alto impacto en la certeza de la fecha final). Dado que esta actualización es una revisión de escritorio (sección 0), se recomienda que la próxima entrega de este informe vuelva al estándar de verificación en vivo de los tres informes anteriores.

---

## Anexo A — Inventario completo de las 96 decisiones arquitectónicas (`docs/decisions/000` a `095`)

| ADR | Título | Ámbito | Estado (resumen) | Fecha |
|---|---|---|---|---|
| 000 | Rebrand AURIXA → Beemetry | plataforma | implemented | 2026-07-07 |
| 001 | Despliegue soberano on-prem (VPS Lima) | plataforma | implemented | 2026-07-06 |
| 002 | Backend C++ como gateway central | plataforma | implemented | 2026-07-06 |
| 003 | Servidor HTTP/WS Boost.Beast + Asio | core-iot | implemented | 2026-07-06 |
| 004 | Arquitectura políglota C++ + sidecars | plataforma | implemented | 2026-07-06 |
| 005 | Dos bases de datos (sensors_db/formula_db) | datos | implemented | 2026-07-06 |
| 006 | TimescaleDB hypertables + retención | datos | implemented | 2026-07-07 |
| 007 | Ingesta telemetría Etapa 1: libpq | core-iot | implemented | 2026-07-06 |
| 008 | Bus de eventos Etapa 2: Redpanda | core-iot | implemented | 2026-07-07 |
| 009 | Almacenamiento objetos MinIO + Parquet | datos | implemented | 2026-07-08 |
| 010 | Modelo de documento: JSON de bloques | reports | implemented | 2026-07-17 |
| 011 | Estructura formal cover/toc | reports | implemented | 2026-07-07 |
| 012 | Binding dato→widget versionado | reports | implemented | 2026-07-07 |
| 013 | Editor Tiptap + Konva | reports | implemented | 2026-07-17 |
| 014 | Estado del editor: Zustand | reports | implemented | 2026-07-06 |
| 015 | Versionado server-autoritativo | reports | implemented | 2026-07-06 |
| 016 | Export server-side asíncrono | reports | implemented | 2026-07-06 |
| 017 | Workflow canónico del informe | reports | implemented | 2026-07-06 |
| 018 | Firma documental ≠ integridad de archivo | reports | implemented v0.1 | 2026-07-06 |
| 019 | Resolución diferida TOC/refs | reports | implemented | 2026-08-05 |
| 020 | Mapa como bloque tipado | reports | implemented v0.1 | 2026-07-06 |
| 021 | Ownership de metadatos de ciclo de vida | reports | implemented | 2026-07-07 |
| 022 | Offline: cola versionada IndexedDB | reports | implemented (parcial pendiente) | 2026-07-06 |
| 023 | Presupuestos de rendimiento y SLA | plataforma | implemented | 2026-07-07 |
| 024 | IA local: Ollama + LanguageTool | ia | implemented | 2026-07-06 |
| 025 | Biometría/EPP diferidas | ia | deferred (por diseño) | 2026-07-06 |
| 026 | Cartografía offline MBTiles/MapLibre | geo | implemented | 2026-07-07 |
| 027 | OpenCV v0.1 (visión EPP diferida) | core-iot | implemented v0.1 | 2026-07-06 |
| 028 | GDAL raster: diferido | geo | deferred (por diseño; v0.1 cerrado vía 072) | 2026-07-06 |
| 029 | RBAC multitenant + JWT híbrido | plataforma | implemented | 2026-07-06 |
| 030 | Auditoría 100% de acciones sensibles | plataforma | implemented | 2026-07-07 |
| 031 | Backend como plataforma compartida | plataforma | implemented | 2026-07-06 |
| 032 | TimescaleDB: ingesta vs réplica lectura | datos | implemented | 2026-07-06 |
| 033 | Convención de nombres y prefijos | plataforma | **partial** | 2026-07-07 |
| 034 | Core IoT propio (reemplaza ThingsBoard) | core-iot | **parcial** (protocolos diferidos por diseño) | 2026-07-09 |
| 035 | Plataforma Enterprise LATAM | plataforma/arq. | **propuesto — fuera de alcance SOW** | 2026-07-12 |
| 036 | RBAC: 7 roles unificados | plataforma | accepted/implemented | 2026-07-13 |
| 037 | Alta de usuarios sin biometría obligatoria | plataforma | accepted/implemented | 2026-07-13 |
| 038 | Delegación de acceso escopeada a tenant | plataforma | accepted/implemented | 2026-07-13 |
| 039 | Puente tenant_id ↔ company_name | reports/plataforma | implemented | 2026-07-17 |
| 040 | Sistema de diseño navegación enterprise | plataforma | accepted/implemented | 2026-07-13 |
| 041 | Resiliencia de sesión: refresh en fetch crudo | plataforma | accepted/implemented | 2026-07-13 |
| 042 | Nomenclatura de menús en lenguaje llano | plataforma | accepted/implemented | 2026-07-13 |
| 043 | Endurecimiento pre-pentest | plataforma | accepted (implementado) | 2026-07-13 |
| 044 | Exportación portátil cifrada (.mreport) | reports | accepted/implemented | 2026-07-13 |
| 045 | Edición offline SQLite cliente | reports | accepted/implemented | 2026-07-13 |
| 046 | Encabezado/pie fijos de plataforma | reports | implemented | 2026-07-17 |
| 047 | Galería de imágenes por tenant | reports | implemented | 2026-07-17 |
| 048 | Carátula a toda página | reports | implemented, revisado | 2026-07-17 |
| 049 | Ajuste de texto alrededor de objetos | reports | implemented, extendido | 2026-07-17 |
| 050 | Formato de texto por selección (spans) | reports | implemented | 2026-07-17 |
| 051 | Copiar/pegar de objetos en lienzo | reports | implemented | 2026-07-17 |
| 052 | Navegación, zoom, tamaño de página | reports | implemented | 2026-07-17 |
| 053 | Estilos visuales de tabla | reports | implemented | 2026-07-17 |
| 054 | Sync ThingsBoard legacy (AWS) | core-iot | implemented | 2026-07-17 |
| 055 | Indicador de selección propio del editor | reports | implemented | 2026-07-18 |
| 056 | CSP dedicada para tiles del mapa | geo | implemented | 2026-07-18 |
| 057 | Widgets de dashboard estilo ThingsBoard | realtime | implemented | 2026-07-19 |
| 058 | Auditoría de seguridad integral jul-2026 | plataforma | implemented, **parcial por diseño** | 2026-07-19 |
| 059 | Plan Maestro de Pruebas QA | plataforma | accepted, fase 1 implementada | 2026-07-21 |
| 060 | Framework de pruebas backend: Catch2 | plataforma | implemented, verificado caso a caso | 2026-07-21 |
| 061 | Catálogo de casos de prueba QA | plataforma | accepted, documentado | 2026-07-21 |
| 062 | Inserción de video grabado (original) | reports | **superseded por 064/065** | 2026-07-21 |
| 063 | Corrección: 7 roles asignables | plataforma | implemented, verificado | 2026-07-21 |
| 064 | Grabación video cámara web | reports | implemented (límite de hardware de prueba) | 2026-07-21 |
| 065 | Grabación video pantalla/ventana | reports | implemented (límite de sandbox de prueba) | 2026-07-21 |
| 066 | Login/tenant usa razón social de la minera | plataforma | implemented, verificado | 2026-07-21 |
| 067 | Autoregistro provisiona tenant real | plataforma | implemented, verificado | 2026-07-21 |
| 068 | IA editorial multimodelo + refs externas | ia | implemented, verificado runtime | 2026-07-24 |
| 069 | Migración frontend a TypeScript estricto | plataforma | implemented, verificado | 2026-07-24 |
| 070 | Bloques técnicos y plantillas semánticas | reports | implemented, verificado tipos/build | 2026-07-24 |
| 071 | TOC en página 2 con continuaciones | reports | implemented, verificado tipos/build | 2026-07-24 |
| 072 | Conversión GDAL runtime CLI confinada | geo | implemented, verificado E2E | 2026-08-05 |
| 073 | Modal propio reemplaza diálogos nativos | reports | implemented, ampliado y verificado | 2026-07-27 |
| 074 | Avatar biométrico local HD bajo demanda | ia | implemented, verificado | 2026-07-27 |
| 075 | País/idioma determinan interfaz de acceso | plataforma | implemented, probado y desplegado local | 2026-07-27 |
| 076 | Separación de IDs y secretos CSPRNG | plataforma | implemented, probado y desplegado local | 2026-07-29 |
| 077 | Migración Argon2id versionada | plataforma | implemented y desplegado, **legacy retirado a cero** | 2026-08-07 |
| 078 | Alta administrada de empresa con tenant real | plataforma | implemented, probado y desplegado local | 2026-07-29 |
| 079 | RBAC de workflow en informes + inmutabilidad post-firma | plataforma | implemented (backend) | 2026-08-02 |
| 080 | Marca de agua y PDF cifrado con password | reports | accepted (implementado) | 2026-08-02 |
| 081 | CORS multiorigen | auth/plataforma | accepted (implementado) | 2026-08-02 |
| 082 | Cookie HttpOnly + CSRF double-submit | auth/security/plataforma | implemented, 32/32 tests | 2026-08-02/03 |
| 083 | Exportación PPTX modo presentación | reports | implemented, verificado ZIP real | 2026-08-03 |
| 084 | Conversión PPTX → video narrado (ffmpeg) | reports | implemented, verificado por píxel | 2026-08-03 |
| 085 | CRUD de empresas + pantalla admin | plataforma | implemented, **E2E pendiente** | (sin fecha explícita, ~ago) |
| 086 | RBAC granular empresas.view/manage | plataforma | implemented, **E2E pendiente** | (sin fecha explícita, ~ago) |
| 087 | Validación de RUC (opcional, flag apagado) | plataforma | implemented | (sin fecha explícita, ~ago) |
| 088 | Seed de empresas/usuarios demo | datos | implemented, **pendiente correr en contenedor real** | (sin fecha explícita, ~ago) |
| 089 | Integración biométrica comercial Dermalog | ia | **accepted — sin evidencia de verificación documentada** | 2026-08-05 |
| 090 | Deprecación de `specs/adr/` para IA | gobernanza | accepted (autoejecutable) | 2026-08-05 |
| 091 | Composición de imágenes OpenCV/RAII | core-iot | accepted | 2026-08-05 |
| 092 | Plantilla corporativa de referencia de diseño | reports | accepted (solo documentación) | (sin fecha explícita) |
| 093 | Vite 8/Rolldown, migración parcial | plataforma | **partial — árbol sin commitear** | 2026-08-05 |
| 094 | Lectura de DNI (PDF417 + MRZ) | plataforma | implemented, verificado con datos sintéticos | 2026-08-07 |
| 095 | UserMaintenanceModal: CSS autocontenida | plataforma | implemented, verificado | 2026-08-07 |

---

### Anexo B — Fuentes de este informe

| Fuente | Uso |
|---|---|
| `docs/decisions/000-*.md` a `095-*.md` (96 archivos) | Estado, ámbito y fecha de cada decisión arquitectónica — leídos directamente, no de memoria |
| `RUNBOOK.md` (estado actual, no commiteado) | Checklist de seguridad, rotación de certificado TLS, secretos sin default, riesgo de proceso de la sección 7 |
| `CHANGELOG.md` (estado actual, no commiteado) | Entregas de agosto: CORS multiorigen, optimización de latencia frontend/backend |
| `specs/015-dr-respaldo-continuidad/tasks.md` | Estado real de Disaster Recovery: 0/14 tareas, última revisión 2026-06-24 |
| `docs_/00_SOW/SOW_Maestro_AURIXA_2026_v4.md` | Calendario contractual (1 jun-30 nov, 13 sprints, 6 releases/gates), KPI y SLA de referencia |
| `docs_/01_Planificacion/Catalogo_Casos_Prueba_QA_2026-07-21.md` | Catálogo de 104 casos de prueba QA — confirmado sin versión más reciente en el repo |
| `docs_/01_Planificacion/Informe_Avance_Ejecucion_Gerencia_TI_2026-07-27.md` | Línea base de comparación (informe anterior) |
| `git log` / `git status` (estado real del repositorio, no resumido) | Último commit real: 2026-07-21 (`fc0dd48`); 742 rutas con cambios sin commitear a la fecha de corte |
| `docs/decisions/AUDITORIA_ACCESO_I18N_2026-07-27.md` | Matriz de compatibilidad cruzada entre ADR de acceso/i18n/biometría/seguridad |

**Limitación explícita de este informe:** a diferencia de los tres informes anteriores, esta actualización no incluyó verificación en vivo (rebuild/redeploy, consultas SQL directas, ataques de prueba, inspección de artefactos exportados) durante su elaboración. Los % de avance y los estados "implementado" citados provienen de lo que cada ADR documenta sobre sí mismo. Se recomienda que la próxima actualización de este informe repita el estándar de verificación en vivo de los informes del 17/20/27-jul-2026.
