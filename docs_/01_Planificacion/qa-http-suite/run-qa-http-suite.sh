#!/usr/bin/env bash
# Suite de pruebas HTTP (curl) para el Catálogo de Casos de Prueba QA —
# cubre los casos de §1-7, 16, 19, 21, 24 que requieren llamadas directas
# al backend (no ejecutables solo desde la UI). Corre contra beemetry-api
# real en http://127.0.0.1:8082 — no un mock.
#
# Credenciales usadas (todas de prueba dedicada, ninguna cuenta real de
# producción):
#   - Alpayana / JUANP / 123456           (admin, ya usado por
#     frontend/e2e/user-maintenance.spec.ts — cuenta de prueba dedicada)
#   - Alpayana / qa_operator_test / QaTest#2026  (operator, creada por
#     este mismo script vía alta administrada — TC-USR-03)
#
# Uso: bash run-qa-http-suite.sh   (desde cualquier directorio; usa rutas
# absolutas del backend, no depende del cwd)

set -uo pipefail
BASE="http://127.0.0.1:8082"
PASS=0
FAIL=0
RESULTS=()

extract() { # extract <json-string> <field>
  echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | sed "s/\"$2\":\"//;s/\"$//"
}

extract_num() { # extract_num <json-string> <field>  (numeric/bool value, unquoted)
  echo "$1" | grep -o "\"$2\":[^,}]*" | head -1 | sed "s/\"$2\"://"
}

check() { # check <id> <description> <actual> <expected-substring-or-code>
  local id="$1" desc="$2" actual="$3" expected="$4"
  if echo "$actual" | grep -qF "$expected"; then
    echo "[PASS] $id — $desc"
    PASS=$((PASS+1))
    RESULTS+=("PASS|$id|$desc")
  else
    echo "[FAIL] $id — $desc (esperaba contener: $expected)"
    echo "        respuesta real: $actual"
    FAIL=$((FAIL+1))
    RESULTS+=("FAIL|$id|$desc|actual=$actual")
  fi
}

http_code() { # http_code <method> <path> <data-or-empty> <auth-header-or-empty>
  local method="$1" path="$2" data="${3:-}" auth="${4:-}"
  if [ -n "$data" ]; then
    if [ -n "$auth" ]; then
      curl -s -o /tmp/qa_http_body.json -w "%{http_code}" -X "$method" "$BASE$path" \
        -H "Content-Type: application/json" -H "Authorization: Bearer $auth" -d "$data"
    else
      curl -s -o /tmp/qa_http_body.json -w "%{http_code}" -X "$method" "$BASE$path" \
        -H "Content-Type: application/json" -d "$data"
    fi
  else
    if [ -n "$auth" ]; then
      curl -s -o /tmp/qa_http_body.json -w "%{http_code}" -X "$method" "$BASE$path" \
        -H "Authorization: Bearer $auth"
    else
      curl -s -o /tmp/qa_http_body.json -w "%{http_code}" -X "$method" "$BASE$path"
    fi
  fi
}

echo "=== Login admin de prueba (JUANP / Alpayana) ==="
ADMIN_RESP=$(curl -s -X POST "$BASE/api/auth/login/password" -H "Content-Type: application/json" \
  -d '{"company":"Alpayana","username":"JUANP","password":"123456"}')
ADMIN_TOKEN=$(extract "$ADMIN_RESP" "access_token")
check "TC-AUTH-01" "Login exitoso admin" "$ADMIN_RESP" '"status":"authenticated"'
check "TC-AUTH-01b" "method=password en respuesta" "$ADMIN_RESP" '"method":"password"'
[ -z "$ADMIN_TOKEN" ] && { echo "ABORTA: no se obtuvo token admin, el resto de pruebas autenticadas fallará."; }

echo ""
echo "=== §3 Password — casos negativos ==="
RESP=$(curl -s -X POST "$BASE/api/auth/login/password" -H "Content-Type: application/json" \
  -d '{"company":"Alpayana","username":"usuario_que_no_existe_qa","password":"x"}')
check "TC-AUTH-02" "Usuario inexistente -> user_not_found" "$RESP" "user_not_found"

RESP=$(curl -s -X POST "$BASE/api/auth/login/password" -H "Content-Type: application/json" \
  -d '{"company":"Alpayana","username":"JUANP","password":"password_incorrecta_qa"}')
check "TC-AUTH-04" "Password incorrecta -> wrong_password" "$RESP" "wrong_password"

echo ""
echo "=== TC-AUTH-05: Rate limit (6 intentos fallidos) ==="
for i in 1 2 3 4 5 6; do
  RESP=$(curl -s -X POST "$BASE/api/auth/login/password" -H "Content-Type: application/json" \
    -d '{"company":"Alpayana","username":"qa_ratelimit_probe","password":"wrong"}')
done
check "TC-AUTH-05" "6to intento bloqueado por rate limit" "$RESP" "too_many_failed_attempts"

echo ""
echo "=== §2 Empresas ==="
CODE=$(http_code GET "/api/auth/companies")
BODY=$(cat /tmp/qa_http_body.json)
check "TC-EMP-01" "GET companies -> 200" "$CODE" "200"
check "TC-EMP-01b" "companies incluye array real" "$BODY" '"companies"'

# Actualizado 2026-08-10: el hallazgo G2 (POST /api/auth/companies "no
# implementado", 404) ya no aplica -- db_scripts/50_companies_crud_rbac.sql
# implementó el endpoint con RBAC (empresas.manage). Sin token, ahora
# responde 401 (requiere sesión), no 404. Detectado corriendo esta suite
# completa durante la verificación de la integración RP (ADR-103) -- no
# relacionado a esa feature, es una expectativa de test desactualizada.
CODE=$(http_code POST "/api/auth/companies" '{"name":"Empresa QA Fantasma"}')
check "TC-EMP-02" "POST companies sin sesión -> 401 (empresas.manage ya implementado, ver db_scripts/50)" "$CODE" "401"

echo ""
echo "=== §1 Usuarios ==="
RESP=$(curl -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
  -d '{"company":"Alpayana","first_name":"QA","last_name":"NoBio","dni":"11223344","username":"qa_nobio_test","password":"QaTest#2026"}')
check "TC-USR-02" "Autoregistro SIN plantilla facial -> rechazo" "$RESP" "face_template"

RESP=$(curl -s -X POST "$BASE/api/auth/users/create" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"username":"qa_weakpass_test","password":"weak12","first_name":"QA","last_name":"WeakPass","dni":"22334455","role":"operator"}')
check "TC-USR-04" "Alta admin con password < 8 chars -> rechazo" "$RESP" "error"

RESP=$(curl -s -X POST "$BASE/api/auth/users/create" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"username":"qa_badrole_test","password":"QaTest#2026","first_name":"QA","last_name":"BadRole","dni":"33445566","role":"superadmin"}')
check "TC-USR-05" "Alta admin con rol inválido (superadmin) -> rechazo" "$RESP" "error"

echo ""
echo "=== Login operador de prueba (qa_operator_test) — creado antes de esta sesión de pruebas ==="
OP_RESP=$(curl -s -X POST "$BASE/api/auth/login/password" -H "Content-Type: application/json" \
  -d '{"company":"Alpayana","username":"qa_operator_test","password":"QaTest#2026"}')
OP_TOKEN=$(extract "$OP_RESP" "access_token")
check "TC-USR-03-verify" "Login del operador creado por alta administrada" "$OP_RESP" '"status":"authenticated"'

echo ""
echo "=== §6 RBAC ==="
RESP=$(curl -s -X POST "$BASE/api/auth/users/create" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OP_TOKEN" \
  -d '{"username":"qa_should_not_exist","password":"QaTest#2026","first_name":"X","last_name":"Y","dni":"99998888","role":"operator"}')
check "TC-USR-06 / TC-RBAC-02" "Operator sin permiso usuarios.manage -> rechazo" "$RESP" "error"

echo ""
echo "=== §19 Avatar biométrico HD (ADR-074) ==="
CODE=$(http_code GET "/api/auth/avatar/hd" "" "$ADMIN_TOKEN")
echo "  código real: $CODE (200 si el admin tiene biometría enrolada, 404 si no — ambos son comportamiento correcto)"
[ "$CODE" = "200" ] || [ "$CODE" = "404" ] && { echo "[PASS] TC-AVA-01/05 — código de estado válido ($CODE)"; PASS=$((PASS+1)); } || { echo "[FAIL] TC-AVA-01/05 — código inesperado ($CODE)"; FAIL=$((FAIL+1)); }

CODE=$(http_code GET "/api/auth/avatar/hd")
check "TC-AVA-03" "Sin sesión -> rechazo" "$CODE" "401"

echo ""
echo "=== §24 Conversión GDAL (ADR-072) ==="
CODE=$(http_code POST "/api/convert" '{"input":"demo.tif"}' "$OP_TOKEN")
check "TC-GDAL-01" "POST /api/convert con operator (no-admin) -> 403" "$CODE" "403"

CODE=$(http_code POST "/api/convert" '{"input":"../../etc/passwd"}' "$ADMIN_TOKEN")
BODY=$(cat /tmp/qa_http_body.json)
echo "  código real: $CODE, body: $BODY"
if [ "$CODE" != "200" ]; then echo "[PASS] TC-GDAL-02 — path traversal rechazado ($CODE)"; PASS=$((PASS+1)); else echo "[FAIL] TC-GDAL-02 — path traversal NO rechazado"; FAIL=$((FAIL+1)); fi

CODE=$(http_code GET "/api/jobs/00000000-0000-0000-0000-000000000000")
check "TC-GDAL-06" "GET /api/jobs sin sesión -> 401" "$CODE" "401"

echo ""
echo "=== §16 Tenant real vía autoregistro (ADR-067) ==="
UNIQ="qa_tenant_test_$(date +%s)"
RESP=$(curl -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
  -d "{\"company\":\"$UNIQ Minera QA\",\"first_name\":\"QA\",\"last_name\":\"TenantProbe\",\"dni\":\"55667788\",\"username\":\"$UNIQ\",\"password\":\"QaTest#2026\",\"face_image_base64\":\"\"}")
echo "  respuesta (esperado: rechazo por falta de biometría real, ya que face_image_base64 vacío no cuenta como válido): $RESP"

echo ""
echo "=== §21 Identificadores (ADR-076) ==="
# El campo "id" del login viene formateado como UUID estándar (con guiones,
# representación textual del tipo UUID de Postgres) -- makeId() genera 32
# hex chars SIN guiones; hay que quitarlos antes de contar, si no cualquier
# id de 32 chars reales cuenta como "36" y da un falso negativo.
UID_RAW=$(extract "$OP_RESP" "id")
UID_STRIPPED=$(echo "$UID_RAW" | tr -d '-')
echo "  id del operador de prueba: '$UID_RAW' -> sin guiones: '$UID_STRIPPED' (longitud: ${#UID_STRIPPED})"
if [ "${#UID_STRIPPED}" -eq 32 ]; then echo "[PASS] TC-SEC-01 — id de 32 hex chars"; PASS=$((PASS+1)); else echo "[FAIL] TC-SEC-01 — longitud de id inesperada (${#UID_STRIPPED})"; FAIL=$((FAIL+1)); fi

echo ""
echo "======================================"
echo "RESUMEN: $PASS PASS / $FAIL FAIL"
echo "======================================"
for r in "${RESULTS[@]}"; do echo "$r"; done
