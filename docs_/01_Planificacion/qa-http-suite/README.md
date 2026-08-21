# Suite HTTP de QA — Beemetry / AURIXA

Cliente HTTP dedicado (curl + Postman) para los casos del [Catálogo de
Casos de Prueba QA](../Catalogo_Casos_Prueba_QA_2026-07-21.md) que
requieren llamadas directas al backend — no ejecutables solo desde la UI
sin manipular cuentas reales de producción.

## Credenciales de prueba dedicadas

- **Alpayana / JUANP / 123456** — admin. Cuenta de prueba ya usada por
  `frontend/e2e/user-maintenance.spec.ts` (checked into el repo como
  fixture de E2E), no una cuenta real de producción.
- **Alpayana / qa_operator_test / QaTest#2026** — operator. Creada por
  este mismo script vía alta administrada (`POST /api/auth/users/create`
  con el token de JUANP) — sirve como cuenta de bajo privilegio para los
  casos negativos de RBAC (TC-RBAC-02, TC-GDAL-01, etc.).

Ninguna prueba de esta suite usa ni necesita la sesión real de un usuario
humano — todo corre con credenciales de prueba dedicadas y reproducibles.

## Uso

```bash
bash run-qa-http-suite.sh
```

Corre contra `http://127.0.0.1:8082` (puerto host de `beemetry-api`, ver
`docker-compose.yml` línea 351). Requiere que los contenedores estén
arriba (`docker compose up -d`).

Para Postman: importar `beemetry-qa.postman_collection.json`, correr con
el Collection Runner (el request de TC-AUTH-05 hay que repetirlo 6 veces
seguidas para disparar el rate limit).

## Resultado de la última ejecución real (2026-07-27)

**19/19 PASS** (`run-qa-http-suite.sh`) + **15/15 PASS** (fixtures
completados, `run-qa-fixtures.sh`) contra `beemetry-api` real (no mock).
Detalle completo en las secciones "Ejecución 2026-07-27 (3)" y "(4)" del
catálogo de QA. Además, la ronda de fixtures encontró y corrigió un
defecto real (ver más abajo).

## Fixtures completados en la segunda pasada (`run-qa-fixtures.sh`)

Los 4 pendientes que esta suite dejaba documentados como "no armados" ya
se resolvieron:

- **TC-USR-01, TC-BIO-01** (biometría): el backend acepta `face_template`
  como array JSON de ≥100 números — no exige una imagen facial real
  capturada por cámara (`main.cpp:377`, se salta el ai_engine si el
  cliente ya manda el array). Se usó un array sintético de 128 floats
  para registrar `qa_bio_test` y luego iniciar sesión facial con el mismo
  array — `score` casi perfecto (`0.9999...`), como se espera al reenviar
  el mismo vector.
- **TC-AUTH-03** (identidad ambigua): la condición real es
  `username=X OR dni=X OR ruc=X` (`auth_storage_pg.cpp:340-352`) — basta
  con que el `username` de un usuario coincida con el `dni` de otro
  (el backend ya bloquea DNIs duplicados, así que la ambigüedad no viene
  de ahí). Fixture: `qa_ambig_1` (dni=`70007000`) + `qa_ambig_3`
  (username=`70007000`).
- **TC-RBAC-03/04** (rol efectivo por tenant): se registró un admin para
  una empresa/tenant nueva (`QA Tenant B Corp`, vía autoregistro público
  con `role:"admin"`) y se le otorgó a `qa_operator_test` el rol
  `supervisor` en ese tenant nuevo (`POST /api/auth/users/{u}/tenants`).
  Confirmado que `POST /api/auth/tenants/switch` recalcula el rol
  efectivo correctamente al cambiar de tenant.
- **TC-GDAL-03/04/05** (conversión real): se usó el fixture YA EXISTENTE
  en el repo `data/incoming/test_geo.tif` (GeoTIFF real, 512×512 RGB) —
  no hizo falta generar nada nuevo. Conversión real completada, artefacto
  verificado en `data/tiles/qa_test_convert.mbtiles`.

Ver `run-qa-fixtures.sh` para el script reproducible completo.

### Defecto real encontrado, corregido y verificado en vivo: `tenant_id` vacío en el token de `POST /api/auth/register`

Al armar el fixture de biometría se detectó que el `access_token` de la
PROPIA respuesta de `POST /api/auth/register` traía `tenant_id` vacío,
aunque el tenant ya estaba correctamente creado y vinculado en
`auth_user_tenant`. Efecto real: `POST /api/reports` con ese token
fallaba con `400 tenant_required`; el mismo usuario con un login
posterior funcionaba (`201`). Causa: `backend/src/main.cpp` calculaba
`provisionedTenantId` pero nunca lo asignaba a `created.tenantId` antes
de emitir la sesión — corregido con una línea (`created.tenantId =
provisionedTenantId;`).

**Verificado en vivo** tras rebuild + redeploy real de `beemetry-api`:
el JWT de un registro nuevo ahora trae el `tenant_id` real (no vacío), y
`POST /api/reports` con ese mismo token de registro responde `201`
directamente. Ambos scripts de esta suite se re-corrieron completos tras
el redeploy — 19/19 y 10/10, sin regresión. Ver la sección "Ejecución
2026-07-27 (4)" del catálogo para el detalle completo, incluyendo una
nota de proceso: el primer intento de build falló silenciosamente
(BuildKit crash reportado como "éxito" por el wrapper de background) y
hubo que detectarlo y reintentar — mismo patrón ya documentado en
ADR-048 esta sesión.

## Qué sigue sin cubrir esta suite (limitaciones conocidas)

- **TC-TEN-01..03** (UI del selector de tenant): son casos de UI, no de
  API pura — verificar por separado en el navegador.
- **§16 (ADR-066), §17 (ADR-068), §20 (ADR-075)**: requieren fixtures de
  UI (selects, i18n) o servicios externos (Tavily con API key real) —
  fuera del alcance de un script curl genérico; ver el catálogo para el
  detalle de cómo probarlos manualmente.

## Limpieza

Las cuentas creadas por `run-qa-http-suite.sh` (`qa_weakpass_test`,
`qa_badrole_test`, `qa_nobio_test`, `qa_should_not_exist`) fallan
intencionalmente en su creación (son los casos NEGATIVOS) — no quedan
persistidas. Las cuentas creadas por `run-qa-fixtures.sh`
(`qa_operator_test`, `qa_bio_test`, `qa_ambig_1`, `qa_ambig_3`,
`qa_tenant_b_admin`) SÍ quedan persistidas como fixtures reutilizables —
no eliminar salvo que se decida limpiar el ambiente de pruebas por
completo. El archivo `data/tiles/qa_test_convert.mbtiles` (36 KB) también
queda como evidencia del test — inofensivo, se puede borrar sin impacto.
