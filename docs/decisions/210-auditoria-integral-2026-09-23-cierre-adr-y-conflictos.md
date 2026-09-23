# ADR-210 — Auditoría integral de plataforma (corte 2026-09-23): cierre de ADR abiertos y verificación de conflictos ADR ↔ implementación

**Status**: implemented (auditoría ejecutada y documentada 2026-09-23). Los hallazgos H1-H3 requieren una acción operativa del developer (ver "Acciones abiertas"); no se ejecutaron desde esta sesión porque el clasificador de permisos bloqueó toda escritura sobre la BD compartida.

**Fecha**: 2026-09-23

**Autores**: Luder Armas (pedido explícito de análisis integral y cierre de ADR) con Claude Code

**Ámbito**: plataforma / gobierno

**Relación**: cierra la reconciliación pendiente de ADR-176 (catálogo de deuda) a nivel de inventario; enlaza ADR-211 (migraciones) y ADR-212 (plan maestro y decisiones de Gerencia). Actualiza la lectura del corte 2026-09-17 (`plan_avance_plataforma_minera_gerencia_2026-09-17.html`). Referencias de método: ADR-090 (log único), `specs/CONSTITUTION.md`, `scripts/project-status-metrics.ps1`.

## Contexto

El developer pidió (2026-09-23) el mejor análisis posible de toda la plataforma: plan completo actualizado mes a mes, pendientes, riesgos, decisiones de Gerencia abiertas, cierre de todos los ADR cerrables, reubicación de pendientes en ADR apropiados y verificación de que no hay conflicto entre lo decidido y lo implementado.

Desde el último corte gerencial (2026-09-17) se sumaron ADR-197 a ADR-209 (importación ThingsBoard, motor de fórmulas multi-salida, importación PDF con OCR y modo réplica, latencia en tiempo real, export XLSX/PPTX nativo, fidelidad DOCX, TTS neuronal del avatar, recorte de cabeza y catálogo de cuerpo, fotocheck rediseñado, CRUD de zonas). Ninguno tiene `tasks.md` propio, por lo que la métrica oficial no los ve.

## Método (qué se verificó y con qué evidencia)

Todo lo siguiente se ejecutó el 2026-09-23 contra el repositorio y el stack vivo (23 contenedores `healthy`), solo con lecturas:

1. **Integridad del log ADR** (script sobre `docs/decisions/`): 210 archivos, ADR-000 a ADR-209, sin huecos, sin duplicados, ninguna referencia a un ADR inexistente (los números 151/152 son retirados y están cubiertos por archivo mínimo).
2. **Estado de cada ADR** (extracción del campo `Status`): 167 `implemented`, 24 `accepted`, 5 `partial`, 4 `proposed`, 2 `deferred`, 2 `N/A` (retirados), 1 `superseded`, y 5 con estados descriptivos (evaluado/no adoptado 144, descartado 160, en evaluación 150, medido 183, y 116).
3. **Métrica oficial**: `scripts/project-status-metrics.ps1` → 148/204 = **72,5%**, 24 SPEC canónicas.
4. **Ledger de migraciones** (`schema_migrations` en `sensors_db`): 96 versiones registradas, máxima 114; 116 archivos en `db_scripts/`.
5. **Estado físico de la BD** para migraciones no registradas (existencia de tablas/columnas/permisos).
6. **Estado de git**: `git status`, `git log`.
7. **Contraste código ↔ ADR** por lectura directa (uso de `authSessionManager.ts`, `pnpm-workspace.yaml`, columnas usadas por el backend, permisos sembrados).

Lo que **no** se hizo: no se recompiló el backend, no se corrió la suite de tests y no se repitieron pruebas de carga en esta sesión. Las afirmaciones "verificado en vivo" de otros ADR se conservan tal como cada uno las documenta y no se reprueban aquí.

## Hallazgos: conflictos y desfases reales

### H1 — Migraciones 115 y 116 no están aplicadas en la BD viva, y el backend ya las usa (severidad alta)
- `db_scripts/116_report_pdf_share_recipients_column.sql` agrega `report_document_settings.pdf_share_recipients_json`; el backend (`report_document_settings.cpp`, `report_routes.cpp`, `report_export_jobs.cpp`) ya lee y escribe esa columna. Consulta a `information_schema.columns` en la BD viva: **la columna no existe**.
- `115_pdf_export_sin_marca_agua_permission.sql` siembra `informes.export_sin_marca_agua`; en `platform_permissions` solo existe `informes.export_sin_clave` (migración 112). Falta el permiso.
- Efecto esperado: la lista de correos del envío de PDF (ADR-205) falla al guardarse/leerse en este entorno, y ningún rol puede exportar sin marca de agua. Ambos scripts son aditivos e idempotentes (`ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO NOTHING`), por lo que aplicarlos es de bajo riesgo.
- **No se corrigió**: el intento de aplicarlos fue bloqueado por el clasificador de permisos (modificación de recurso compartido). Comando exacto en "Acciones abiertas".

### H2 — El runner de migraciones se detiene en la versión 81 y el ledger tiene huecos (severidad alta para despliegue)
- Existen dos archivos con prefijo 81: `81_mfa_totp.sql` (registrado) y `81_seed_alpayana_massive_sensor_expansion.sql` (nunca registrado). `schema_migrations.version` es `INTEGER PRIMARY KEY`, y `scripts/apply_migrations.sh` aborta con `exit 1` al detectar la versión 81 ya registrada con otro checksum. Cualquier `db-migrate` posterior a 81 quedaría bloqueado (ADR-131).
- Faltan en el ledger las versiones 82-92, 95-99, 115 y 116 (los objetos de 82-92 y 95-96 sí existen físicamente: `telemetry_fact_calc`, `report_pdf_share_links`, `avatar_animation_job`, `fotocheck_share_links`, `sensor_input_channel_def`). Los scripts 11 y 14 nunca existieron.
- Decisión y plan de saneamiento en **ADR-211**.

### H3 — 400 cambios sin commitear; ADR-171 a 209 y migraciones 93-116 fuera de git (severidad alta, riesgo de pérdida)
- `git status`: 206 archivos modificados, 183 sin seguimiento, 11 eliminados. Último commit: 2026-09-11 (`7230b71`). `git diff HEAD --stat`: 190 archivos, +27.273/-13.787 líneas.
- Sin seguimiento: los ADR-171 a 209 (todos los posteriores al último commit), las migraciones `93_` a `116_`, y buena parte del trabajo de sensores/fórmulas. Un fallo de disco o del equipo perdería 12 días de trabajo y la trazabilidad exigida por la Constitución (Art. 1: ningún merge sin SPEC/ADR).
- Es el riesgo más barato de eliminar: commit por bloques temáticos. Ver ADR-212 (tarea A1).

### H4 — La métrica oficial subestima el trabajo pendiente y no ve SPEC-027 (severidad media, credibilidad del reporte)
- El script cuenta checkboxes de "Definition of Done". SPEC-027 usa tabla de tareas: el script lee 0/5 mientras que la tabla tiene 14/22 cerradas (+1 parcial).
- SPEC-015, 017 y 018 (sin iniciar) aparecen con 11, 5 y 7 unidades normalizadas, pero sus tablas detalladas tienen 14, 20 y 21 tareas. La cifra normalizada es válida como convención, pero **no debe leerse como esfuerzo restante**.
- Cifras a presentar: oficial **72,5%** (148/204); auditada estricta **73,3%** (162/221, SPEC-027 recalculada); y alcance de salida a producción pendiente ≈ 47 tareas detalladas (ver ADR-212 §Backlog fino).
- SPEC-007: `tasks.md` conserva T12/T13 (editor de texto rico y autosave) como ☐ aunque el editor Tiptap/Konva (ADR-013) y el autoguardado con versionado (ADR-014/015/045) figuran implementados; es bookkeeping por confirmar contra el código, no trabajo nuevo.

### H5 — SPEC-025 y SPEC-026 figuran en el REGISTRY sin carpeta `specs/025-*` ni `specs/026-*` (severidad media, trazabilidad)
- `specs/REGISTRY.md` y `BACKLOG.md` citan SPEC-025 (Soporte/WhatsApp, 9 ADR) y la propuesta SPEC-026 (sitio público), pero no existe directorio ni `spec.md`/`tasks.md`. Se registra como tarea documental en ADR-212 (D2).

### H6 — Texto de gobierno desactualizado (severidad baja)
- `docs/decisions/README.md` §"Fecha referencial de término" aún cita el objetivo 2026-07-31. `specs/REGISTRY.md` cabecera cubre "ADR-000 a ADR-200" y no lista ADR-187 a ADR-212 en la matriz por SPEC. `docs/decisions/README.md` marca los 3 pendientes de infraestructura solo hasta ADR-170. Se corrigen en esta pasada (ver "Cambios aplicados").

### H7 — Deuda catalogada por ADR-176 sigue intacta
- `frontend/src/auth/authSessionManager.ts` sigue sin importarse en ningún archivo (verificado por búsqueda en `frontend/src`); `frontend/pnpm-workspace.yaml` sigue presente. ADR-176 exige una decisión por ítem; no es un conflicto de comportamiento, pero cada mes que pasa acumula deuda. Recomendación en ADR-212 (decisión G-11).

### H8 — Datos reales de campo siguen siendo mínimos (severidad alta para el go-live, no un bug)
- BD viva: 81.050 filas en `sensors`, solo **4** con credencial de dispositivo real (eran 3 el 2026-09-16); **1** regla de alarma en `platform_alarm_rules`; 71 tenants/52 empresas/143 usuarios. Es coherente con ADR-192 y confirma que la integración de campo sigue en piloto. No hay contradicción entre ADR e implementación; es una brecha de operación.

### Sin conflicto detectado (verificado)
- Cadena de supersedencia declarada (028→072, 062→064/065, 104→105, 089→105) coherente con REGISTRY.
- ADR-110 (proposed) vs ADR-178 (fuera de alcance): no hay contradicción, solo el estado de ADR-110 estaba desactualizado (ver cierres).
- ADR-108 (25k/s validado, 100k no aprobado) no contradicho por ningún ADR posterior; ADR-200 lo respeta.
- ADR-035 (Enterprise LATAM: requisito de producto sí, infraestructura F1-F4 no) es consistente con ADR-075 (4 locales) y ADR-087 (SUNAT solo Perú).
- ADR-131: fases 6/8/13 siguen pendientes de ventana de despliegue; ningún ADR posterior asume que ya se ejecutaron.

## Decisión — cierre de ADR

Se cierran con evidencia existente (actualización fechada agregada a cada ADR, sin editar su texto original, según la convención del log):

| ADR | Estado anterior | Estado tras esta pasada | Evidencia |
|---|---|---|---|
| 110 | proposed | **deferred** (fuera de alcance, ADR-178) | ADR-178 ya retira Operaciones de Campo del proyecto; el estado `proposed` era lectura obsoleta |
| 116 | accepted (texto de estado mixto) | **implemented** | su propia actualización 2026-08-20 ya lo declara implementado y verificado |
| 150 | en evaluación | **implemented (Fase A)**; Fases B/C `deferred` | Fase A (SadTalker) verificada E2E 2026-09-04/07 con contenedor `avatar_animation_engine` sano; B/C nunca se construyeron y no hay pedido |
| 085, 086, 088 | implemented, "pendiente E2E" | **implemented, verificado por uso real** | migraciones 50/51 registradas en el ledger; 52 empresas y permisos `empresas.view`/`empresas.manage` presentes en BD viva; ADR-190 auditó 35 de esas 52 empresas en vivo |
| 109 | implemented, "verificación integrada pendiente" | **implemented, verificado** | ADR-182: export real PDF/PPTX de los 20 tipos de gráfico contra el stack completo |

No se cierran (requieren decisión, dato externo o verificación con actor real) y se reubican en los ADR indicados:

| ADR | Motivo | Dónde queda gobernado |
|---|---|---|
| 033 | rename de BD y versionado `/api/v1` sin iniciar | ADR-212, decisión G-10 (recomendación: no hacer el rename; posponer versionado a Etapa 2) |
| 035 | F1-F4 LATAM sin aprobación de negocio | ADR-212, decisión G-9 |
| 111 | utilidad de portabilidad sin aceptación operativa | SPEC-023 T7-T11 (ADR-212, pista A) |
| 117 | falta la app MovilMinero | ADR-212, decisión G-12 |
| 131 | fases 6/8/13 sin ventana de despliegue | ADR-212, decisión G-5 |
| 156-159, 161, 163, 164, 202, 203, 207 | validación visual/E2E con registro o cámara real pendiente | ADR-212, lista de validación UAT-2 |
| 169 | pentest externo sin proveedor | ADR-212, G-1 |
| 170 | dimensionamiento VPS/GPU | ADR-212, G-6 |
| 176 | tres decisiones de deuda | ADR-212, G-11 |
| 188, 189, 196, 208 | verificación E2E/carga en vivo | ADR-212, lista de validación UAT-1 |
| 194 | Parte B bloqueada por decisión técnica ACC→VEL→DIS | ADR-212, G-8 |
| 112, 113, 122, 129, 137, 168 | cuentas comerciales Meta/Twilio | ADR-212, G-3 |

## Consecuencias

### Positivas
- El log queda sin estados obsoletos: solo permanecen abiertos los ADR que dependen de una persona, un proveedor o un dato de campo, cada uno con dueño y fecha en ADR-212.
- Tres riesgos operativos reales (H1, H2, H3) quedan visibles y con acción concreta antes de que rompan un despliegue.
- La lectura gerencial pasa a tres cifras honestas (oficial, auditada, backlog fino) en vez de una sola.

### Negativas / trade-offs
- Esta pasada documenta H1-H3 pero no los corrige: requiere una acción manual del developer o un permiso explícito para modificar la BD.
- Cerrar 085/086/088 por evidencia de uso es una lectura razonable, no una prueba E2E dedicada; si Gerencia exige acta de QA, reabrir como tarea de UAT.

## Alternativas descartadas
- **Reescribir las métricas a mano**: contradice ADR-090 y la regla "el porcentaje sale del script"; se prefiere corregir el script (ADR-212, D1).
- **Marcar `implemented` los ADR con verificación visual pendiente**: se rechaza porque ocultaría un riesgo de UAT real.

## Cambios aplicados en esta pasada (2026-09-23)

- Nuevos: ADR-210 (este), ADR-211 (ledger de migraciones), ADR-212 (plan maestro y decisiones) y `docs/PLAN_MAESTRO_2026-09-23.md`.
- Bloque de actualización fechado (sin tocar el texto original) en ADR-085, 086, 088, 109, 110, 116 y 150.
- `docs/decisions/README.md`: banner de corte, filas ADR-210 a 212 y fecha referencial de término corregida.
- `specs/REGISTRY.md` y `specs/BACKLOG.md`: bloque "corte vigente 2026-09-23" al inicio (el historial no se reescribió).
- `CHANGELOG.md`: entrada del día.
- **No modificados** (pendientes de acción del developer): la BD viva (115/116), el runner de migraciones, git (commit por bloques) y `scripts/project-status-metrics.ps1`.

## Acciones abiertas (para el developer)

Aplicar y registrar las migraciones pendientes en la BD local (aditivo/idempotente; revisar antes de ejecutar):

```bash
docker exec -i beemetry-db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1 < db_scripts/115_pdf_export_sin_marca_agua_permission.sql
```

```bash
docker exec -i beemetry-db psql -U sensors -d sensors_db -v ON_ERROR_STOP=1 < db_scripts/116_report_pdf_share_recipients_column.sql
```

Luego registrar ambas versiones según ADR-211 y commitear por bloques (ADR-212, A1).

## Referencias
- ADR-090, ADR-131, ADR-176, ADR-178, ADR-185, ADR-192, ADR-205, ADR-211, ADR-212.
- `scripts/project-status-metrics.ps1`, `scripts/apply_migrations.sh`, `specs/BACKLOG.md`, `specs/REGISTRY.md`.
