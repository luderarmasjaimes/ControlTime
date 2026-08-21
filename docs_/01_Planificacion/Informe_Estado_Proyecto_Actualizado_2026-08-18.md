# Informe de estado actualizado — Plataforma Minera Beemetry

**Empresa:** TimeTelemetry

**Corte:** 18 de agosto de 2026, America/Lima

**Base:** código y stack local, ADR-000–111, SPEC-001–023, cronograma v36.1

**Objetivo:** establecer una línea base creíble antes de la presentación gerencial.

## 1. Conclusión ejecutiva

La plataforma tiene una base técnica sustancial, pero **no está al 77–97% como
producto completo**. Ese rango de informes previos medía principalmente
decisiones/código de ciertos releases y estaba sesgado por la alta cantidad de
ADR de reportabilidad. Con tareas normalizadas de todas las funciones, el
avance documentado es **106 de 196 = 54,1%**.

La preparación por etapa es desigual: R2 está en 90,9%, R3 en 75,8%, R4 en
58,1% y R5 en 37,7%. Operaciones de campo inicia en 0% de implementación y
requiere reprogramación; hoy solo existe diseño conceptual. La capacidad de
telemetría comprobada es **25.000 eventos/s por edge**, con cero pérdida en la
prueba final; **100.000 eventos/s no está aprobado**.

La cobertura documental queda actualizada a **112 ADR sin gaps y 23 SPEC**.
Se resolvió el conflicto biométrico ADR-089/105, se formalizaron telemetría
25k, analítica multiserie y operaciones de campo, y se separaron las copias
históricas que antes podían duplicar el avance.

## 2. Método de medición

### 2.1 Avance de ejecución

Se cuenta cada tarea canónica de `tasks.md` una sola vez. SPEC-019 y SPEC-020
usan tablas y se normalizan explícitamente; los aliases históricos de 004 y
005 no cuentan. El cálculo se reproduce con:

```powershell
./scripts/project-status-metrics.ps1
```

**Resultado:** 106/196 = 54,1%. Esta métrica no equivale a horas consumidas,
presupuesto ganado ni aceptación productiva; mide ejecución documentada.

### 2.2 Estado de decisión

- `proposed`: existe dirección, pero puede cambiar y no cuenta como producto.
- `accepted`: decisión aprobada; no prueba implementación.
- `implemented`: existe código/configuración; no prueba aceptación integral.
- Criterio de aceptación cerrado: existe prueba/artefacto verificable.

Los ADR miden cobertura y coherencia. **No se suman como porcentaje de avance**.

### 2.3 Readiness mensual

Los porcentajes de julio–octubre son tareas terminadas/planificadas de las
SPEC asignadas al release. Junio usa el gate documental R1. Noviembre usa diez
controles de salida enumerados en §4. El alcance compartido R3/R4 se muestra en
ambos para que cada gate sea autocontenido; no se suma entre gates.

## 3. Avance mes a mes y por etapa

| Mes | Etapa / gate | Alcance principal | Avance al corte | Interpretación |
|---|---|---|---:|---|
| Junio | Etapa 1 · R1 | Arquitectura, SDD, modelo de datos y plan | **100%** | Línea base de decisiones creada; no significa producto completo |
| Julio | Etapa 1 · R2 | Core, ingesta, auth/RBAC y seguridad base | **90,9%** (10/11) | Gate técnico casi completo; falta cierre formal/dependencias de integración |
| Agosto | Etapa 1 · R3 | Editor, dashboards, GIS, sensores, IA base, 25k | **75,8%** (50/66) | En curso; build frontend verde, pero aceptación integrada no cerrada |
| Septiembre | Etapa 1 · R4 | Export, offline, alertas, CCTV, RP/AWS, regresión | **58,1%** (36/62) | Readiness actual, no avance futuro ganado; offline y alertas son críticos |
| Octubre | Etapa 2 · R5 | HA/DR, histórico, seguridad, IA avanzada, portabilidad | **37,7%** (26/69) | Scripts existen; riesgo alto sin restore, DR, pentest y calibraciones |
| Noviembre | Etapa 2 · R6 | estrés, UAT, marcha blanca, go-live | **40%** (4/10 controles) | Preparación técnica temprana; no habilita producción |
| Rebaseline | Extensión campo | App offline, formularios, ERP, PDA e IA de campo | **0%** (0/14) | Diseño conceptual formalizado; fuera del R6 sin recursos/fechas nuevos |

> Los meses futuros muestran **preparación disponible al 18-ago**, no una
> proyección de trabajo que todavía no ocurrió. Esto evita reportar avance por
> calendario o por intención.

## 4. Controles de salida R6

| # | Control | Estado al corte |
|---|---|---|
| 1 | TypeScript sin errores | Cumplido 18-ago |
| 2 | Unit tests frontend | Cumplido: 47/47 |
| 3 | Build productivo frontend | Cumplido, con advertencias no bloqueantes |
| 4 | Build + CTest backend del árbol actual | Cumplido 18-ago: build 100%, CTest 1/1 |
| 5 | E2E Playwright de flujos críticos | No ejecutado en esta auditoría |
| 6 | Pentest externo y P0/P1 cerrados | Pendiente |
| 7 | Simulacro DR con RTO<15 min/RPO≈0 | Pendiente |
| 8 | UAT firmado por operadores | Pendiente |
| 9 | Despliegue productivo/rollback automatizado probado | Pendiente |
| 10 | Marcha blanca 48–72 h y acta go-live | Pendiente |

Readiness R6 verificado: 4/10 = **40%**. Los controles técnicos aprobados no
sustituyen pentest, DR, UAT, despliegue/rollback ni marcha blanca.

## 5. Estado por frente funcional

| Frente | Evidencia actual | Estado | Pendiente decisivo |
|---|---|---|---|
| Ingesta/telemetría | 1,5M/1,5M a 25k/s; recuperación y replay | Verde a 25k | Soak 1h/24h y nueva topología para 100k |
| Dashboard/realtime | Dashboard, WS/SSE, réplica y widgets | Amarillo | Regresión, SLA e integración de sitio |
| Reportabilidad | Editor, workflow, export, firma, IA, mapas | Amarillo | Regresión completa, export multigráfico, UAT |
| Sensores/zonas | Catálogo, zonas, consulta y diez gráficos | Amarillo | Anti-IDOR, contrato API, render/export CI |
| GIS/3D | Mapas offline, GDAL, Viewer3D y heatmaps | Amarillo | Datos reales, performance y aceptación operacional |
| Auth/RBAC/auditoría | JWT, cookies/CSRF, Argon2id, CSPRNG, multitenant | Amarillo-verde | Pentest externo, runbooks y evidencia productiva |
| Biometría | DeepFace+SilentFace default, Dermalog secundario | Amarillo | FMR/FNMR, PAD, DPIA, hardware real, reenrolamiento |
| RP/Odoo | 2.108 equipos, backfill/poll/WS reales | Amarillo-verde | CA-4: create/write productivo autorizado |
| AWS/ThingsBoard legacy | Conector y 6M puntos en entorno controlado | Amarillo | Validación contra entorno/credenciales del cliente |
| Alertas | Componentes en plataforma | Rojo | SPEC-016 0/5 y prueba extremo a extremo |
| Offline | SW/mapas y patrones parciales | Rojo | SPEC-014 0/10 como flujo integral |
| DR/HA | Réplica saludable | Rojo para gate | SPEC-015 0/11; promoción, restore, RTO/RPO |
| EPP | Documentado | Gris/deferred | ADR-025: no reactivar sin dataset/privacidad/umbrales |
| Operaciones de campo | Dos presentaciones y ADR/SPEC propuesta | Rojo | Producto 0/14; aprobar ADR-110 y reprogramar |
| Enterprise LATAM | Topología edge/hub propuesta | Gris/propuesta | ADR-035 F1-F4 sin código ni decisión comercial |

## 6. Pruebas, calidad y evidencia actual

### Ejecutado el 18-ago

- `npm run type-check`: aprobado.
- Vitest: **11 archivos, 47 pruebas, 47 aprobadas**. JSDOM emitió mensajes de
  navegación/URL, pero el proceso terminó exitosamente.
- `npm run build`: aprobado. Advertencias: dos `@apply` no interpretados por
  Lightning CSS, import dinámico inefectivo y chunks de ECharts/Plotly/Three
  >500 kB. Son deuda de performance/mantenibilidad, no fallo de build.
- Stack Docker: servicios principales en ejecución y healthchecks verdes.
- Build aislado backend `Dockerfile.verify`: **aprobado**; compiló el backend
  completo, incluidos RP y `sensor_telemetry_wizard`, y CTest terminó 1/1,
  0 fallos. El target actual agrupa la suite en un solo test CTest, por lo que
  conviene publicar también el detalle de casos/aserciones en CI.

### Brechas de automatización

- El workflow CI compila y prueba frontend, pero no incorpora explícitamente
  `backend/Dockerfile.verify`/CTest como job obligatorio.
- El catálogo QA histórico no cubre formalmente todas las ADR 096–110 ni
  SPEC-019–022.
- No hay evidencia reciente de Playwright completo sobre el árbol actual.
- No existe corredor automatizado único para resiliencia: caída DB, broker,
  red WAN, disco lleno, replay, corrupción y recuperación.
- Falta prueba de despliegue progresivo/rollback en un ambiente equivalente a
  producción y firma del artefacto/SBOM.

## 7. ADR nuevos y conflictos resueltos

### ADR-108 — Telemetría 25k y frontera 100k

Formaliza la única capacidad demostrada, topología, criterios de pérdida y el
plan obligatorio para escalar. Evita convertir una prueba fallida de 100k en
una afirmación comercial.

### ADR-109 — Zonas y analítica multiserie

Cubre código que no tenía decisión: catálogo por zona/dispositivo, consulta
histórica acotada y diez gráficos. Distingue radar como sensor de radar como
tipo de gráfico y no promete exportación 3D inexistente.

### ADR-110 — Operaciones de campo

Documenta el límite ERP/Plataforma/cliente offline, outbox, artefactos y
gobierno de IA. Permanece propuesto porque faltan decisiones contractuales,
PDA/MDM, privacidad, matriz ERP y piloto.

### ADR-111 — Portabilidad del stack

Formaliza los scripts export/import y perfil mínimo de telemetría. Los clasifica
como utilidad de portabilidad, no como DR o despliegue automatizado aceptado:
faltan cifrado, firma/checksum, restore en host limpio, RTO/RPO, rollback y CI.

### Conflictos

1. **ADR-089 vs ADR-105:** resuelto; ADR-105 manda en prioridad, ADR-089 queda
   parcialmente superseded.
2. **ADR-104 vs ADR-105:** ADR-104 superseded; SeetaFace solo rollback legado.
3. **ADR-025 vs SPEC-017:** EPP sigue deferred; una SPEC planificada no
   reactiva una decisión diferida.
4. **ADR-035 vs planes multipaís:** solo F0 existe; F1-F4 son propuesta.
5. **100k vs prueba real:** ADR-108 fija 25k como única cifra aprobada.
6. **Copias ADR:** `docs/decisions` es el único log vigente; se excluyen
   `specs/adr` y `docs/docs/decisions` del conteo.

## 8. Funcionalidades sin cobertura suficiente antes de esta auditoría

Quedan formalizadas zonas/multiserie y operaciones de campo. Aun requieren
SPEC separadas cuando se aprueben: predicción de fallas por activo, detección
de anomalías/alertas predictivas, gemelo digital 3D, OCR de certificados,
asistente de campo, cada modelo EPP, sincronización edge→hub LATAM, GitOps por
sitio y conectores de sensores específicos del piloto. No deben tratarse como
una sola «función IA» porque tienen datos, riesgos y criterios diferentes.

## 9. Riesgos gerenciales

| Prioridad | Riesgo | Impacto | Acción/decisión |
|---|---|---|---|
| P0 | 234 entradas locales (79 modificadas, 1 eliminada, 154 no rastreadas) | Pérdida de trabajo/trazabilidad | Segmentar ramas/commits por SPEC y respaldar de inmediato |
| P0 | Offline, alertas y DR casi sin tareas cerradas | R4/R5 no alcanzables por inercia | Equipo dedicado y plan semanal con evidencia |
| P0 | Sin pentest externo/UAT/DR | No habilita go-live | Agendar proveedores/usuarios y ventanas ahora |
| P1 | AWS real depende de acceso del cliente | Puede bloquear R4 | Responsable, credenciales, ventana y dataset de aceptación |
| P1 | Escritura Odoo no probada productivamente | Integración solo parcialmente aceptada | Ventana controlada con registro de rollback |
| P1 | Uso intensivo de IA limitado por tokens/cuentas | Reduce velocidad de ingeniería/QA/docs | Capacidad IA por rol, presupuesto y política de uso |
| P1 | Operaciones de campo fuera del cronograma actual | Sobrecarga R6 y expectativas | Aprobar rebaseline, personal y piloto separados |
| P1 | Biometría sin calibración/cumplimiento | Riesgo seguridad/privacidad | Dataset representativo, laboratorio y DPIA |
| P2 | Bundles >500 kB y warnings CSS | UX en enlaces lentos/PDA | Code splitting, limpiar `@apply`, presupuesto de bundle |

## 10. Plan de recuperación propuesto

### 18–31 agosto — cerrar R3 con evidencia

- Terminar CA pendientes de SPEC-021 y regresión de ReportStudio.
- Incorporar build/CTest backend y Playwright crítico a CI.
- Cerrar warnings CSS/bundle prioritarios y publicar acta R3.
- Crear tablero de evidencias por CA, no por número de commits/ADR.

### Septiembre — R4 integrado

- Equipo A: SPEC-014 offline y pruebas WAN/replay.
- Equipo B: SPEC-016 alertas, sensores reales e integración dashboard/informe.
- Equipo C: AWS/ThingsBoard real + CA-4 Odoo autorizada.
- QA independiente: catálogo actualizado, E2E, export y seguridad de tenant.

### Octubre — R5 sin negociación de evidencia

- Simulacro failover/restore con cronómetro y conteos.
- Pentest externo; cierre P0/P1 y retest.
- Soak de telemetría, capacidad de almacenamiento y pruebas de resiliencia.
- Calibración biométrica o exclusión formal de alcance productivo.

### Noviembre — R6

- UAT con operadores, marcha blanca 48–72 h, rollback y actas.
- Go-live solo si los diez controles de §4 están completos.

### Operaciones de campo — proyecto derivado

- No absorber en los sprints restantes. Aprobar ADR-110 y SPEC-022, asignar
  product owner, arquitecto, backend, móvil, QA, seguridad/MDM e integrador ERP.
- Ejecutar MVP/piloto y medir ROI real antes de afirmar porcentajes del material
  conceptual.

## 11. Implicación para la solicitud de IA

La carga pendiente no es solo generar informes. Incluye especificación,
arquitectura, C++/React/Python/SQL, contratos ERP/AWS, test automation,
ciberseguridad, resiliencia, CI/CD, operación, documentación y modelos IA.
El riesgo actual de quedarse sin tokens es verificable como interrupción de
capacidad, pero la compra debe acompañarse de:

- asignación nominal por rol/equipo y regla de no compartir credenciales;
- presupuesto de uso, límites y continuidad cuando se agota una ventana;
- revisión humana obligatoria, secretos fuera de prompts y trazabilidad ADR/SPEC;
- métricas: CA cerrados, defectos escapados, tiempo de ciclo y cobertura, no
  «tokens consumidos» como productividad;
- ampliación proporcional a personal: un único plan individual no resuelve un
  equipo creciente ni trabajo paralelo.

## 12. Fuentes de verdad posteriores a esta actualización

- ADR: `docs/decisions/README.md` y ADR-000–111.
- Matriz: `specs/REGISTRY.md`.
- Backlog y métrica: `specs/BACKLOG.md` y
  `scripts/project-status-metrics.ps1`.
- Capacidad: `docs/PRUEBA_CAPACIDAD_TELEMETRIA_25K_2026-08-12.md` y
  `docs/PRUEBA_CAPACIDAD_TELEMETRIA_100K_2026-08-11.md`.
- Cronograma contractual: `docs_/01_Planificacion/Cronograma_Maestro_AURIXA_v36.md`.

---

**Regla de actualización:** cada viernes se ejecuta el script de métricas, se
adjunta evidencia de pruebas y se cambia un porcentaje solo cuando cambia una
tarea/CA. Los avances futuros no se contabilizan antes de ocurrir.
