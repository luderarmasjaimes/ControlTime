# Runbook de despliegue — Beemetry / AURIXA v0.1 (borrador)

Insumo para que el equipo decida fecha/alcance de GO-LIVE — no es una
autorización de release. Ver `CHANGELOG.md` para el detalle de cambios y
`GAP_ANALYSIS_2026-07-04.md` para la evidencia de cada fix.

## 1. Estado de los hallazgos originales

| # | Hallazgo | Estado |
|---|---|---|
| 1 | Serializar cover/toc a JSON | ✅ Resuelto y verificado |
| 2 | Persistir layout Konva (x/y/width/height) | ✅ Ya existía, confirmado |
| 3 | Alinear workflow states | ✅ Resuelto y verificado (SQL+backend+frontend+E2E) |
| 4 | IDOR en endpoints de auditoría/mantenimiento de usuarios | ✅ Resuelto y verificado (ataque real) |
| 5 | Activar hypertables TimescaleDB | ✅ Resuelto y verificado (integridad byte a byte) |
| 6 | Auditoría 100% append-only | ✅ Resuelto y verificado (hash chain) |

## 2. Deuda técnica — estado actual

| Ítem | Estado |
|---|---|
| Memory safety RAII | ✅ 11/11 archivos |
| Doxygen (headers de negocio) | ✅ Completo |
| ADR-015 (versionado server-side) | ✅ Resuelto y verificado |
| ADR-016 (export PDF server-side) | ✅ Resuelto y verificado |
| React.memo en componentes de alto re-render | 🟡 Parcial (`PageCanvas`; el resto requiere refactor de `useCallback` en `App.jsx`, fuera de este alcance) |
| TypeScript | ⚪ 0% — diferido deliberadamente, esfuerzo propio de varios días |

## 3. Lo que este agente NO puede decidir por el equipo

- **Pentest de caja negra por un tercero.** Los checks automatizables
  (headers de seguridad, rate limiting, inyección SQL/comandos, IDOR) están
  cubiertos — ver sección 4. Un pentest formal externo requiere contratación
  y alcance definido por el equipo de seguridad.
- **Fecha y alcance de GO-LIVE.** Decisión de negocio.
- **QA manual de flujos de usuario final** (más allá de lo verificado vía
  API/navegador en esta sesión).
- **Comunicación a usuarios / changelog público.**

## 4. Checklist de seguridad automatizable — resultados

| Check | Resultado |
|---|---|
| SQL injection (parametrización) | ✅ 0 usos de `pqEscapeLiteral`/concatenación en todo el backend |
| Command injection | ✅ `shellQuote()` en los 4 puntos que invocan `std::system()` |
| IDOR en gestión de usuarios | ✅ Corregido, verificado con ataque cruzado real |
| IDOR en informes (lectura/revisiones/export PDF) | ✅ Verificado: cross-tenant devuelve 404/vacío antes de tocar datos |
| Rate limiting de login | ✅ Confirmado: 429 tras 6 intentos fallidos rápidos |
| Headers de seguridad HTTP | ✅ `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` en toda respuesta |
| CSP (Content-Security-Policy) | ⚪ No implementado — requiere auditar orígenes externos (Google Fonts, Tailwind CDN) antes de aplicar sin romper la app |
| Auditoría append-only + integridad forense | ✅ Hash chain verificado, 0 filas rotas |
| CORS | 🟡 `Access-Control-Allow-Origin: *` — aceptable dado que la app usa Bearer token (no cookies), pero es una política permisiva; endurecer a un allowlist de orígenes si se expone públicamente |

## 5. Pasos de despliegue (producción)

1. `docker compose build web frontend pdf_export`
2. Aplicar migraciones SQL nuevas en orden si no se aplicaron ya:
   `db_scripts/33_workflow_states_migration.sql`, `34_report_signature.sql`
   (33 y 34 son idempotentes, seguras de re-ejecutar).
3. `docker compose up -d web frontend pdf_export`
4. Verificar healthchecks: `docker ps` — `aurixa-api`, `aurixa-web`,
   `aurixa-pdf-export` deben quedar `healthy`.
5. Smoke test mínimo post-deploy:
   - `GET /api/auth/companies` → 200 con lista de empresas.
   - Login real (usuario de prueba) → token válido.
   - Crear informe → transición de workflow → verificar en
     `platform_audit_log` que la entrada aparece con hash correcto.
   - `GET /api/reports/{id}/export/pdf` → 200, `Content-Type: application/pdf`.
6. Confirmar `fn_audit_log_verify_chain()` → 0 filas rotas antes y después
   del despliegue (detecta si algo tocó el log de auditoría durante la
   ventana de deploy).

## 6. Rollback

- Backend/frontend: `docker compose up -d <servicio>` con el tag de imagen
  anterior (mantener las imágenes previas sin `docker image prune` hasta
  confirmar estabilidad del release).
- SQL: las migraciones 33/34 son aditivas (nuevas columnas/constraint) — un
  rollback de código no requiere revertir el esquema; los datos migrados
  (`published`→`archived`) no tienen camino de reversión automática (no se
  guardó el valor original) — si esto es un problema, coordinar antes del
  release, no después.

## 7. Riesgo de proceso pendiente (no técnico)

Todo el trabajo de esta sesión sigue sin commitear en git. Antes de
cualquier release real, commitear y revisar el diff completo.
