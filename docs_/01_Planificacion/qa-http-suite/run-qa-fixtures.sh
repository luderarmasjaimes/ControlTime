#!/usr/bin/env bash
# Fixtures completos para los 4 pendientes que run-qa-http-suite.sh dejaba
# documentados como "no armados": biometría real (TC-USR-01/TC-BIO-01),
# identidad ambigua (TC-AUTH-03), override de permiso multitenant
# (TC-RBAC-03/04), conversión GDAL con archivo real (TC-GDAL-03/04/05).
#
# Requiere Node.js (para generar arrays de floats y decodificar JWT) y
# que qa_operator_test ya exista (creado por run-qa-http-suite.sh).
#
# Uso: bash run-qa-fixtures.sh

set -uo pipefail
BASE="http://127.0.0.1:8082"
PASS=0
FAIL=0

extract() { echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | sed "s/\"$2\":\"//;s/\"$//"; }

check() {
  local id="$1" desc="$2" actual="$3" expected="$4"
  if echo "$actual" | grep -qF "$expected"; then
    echo "[PASS] $id — $desc"; PASS=$((PASS+1))
  else
    echo "[FAIL] $id — $desc (esperaba: $expected)"; echo "        real: $actual"; FAIL=$((FAIL+1))
  fi
}

echo "=== Login admin (JUANP) ==="
ADMIN_TOKEN=$(curl -s -X POST "$BASE/api/auth/login/password" -H "Content-Type: application/json" \
  -d '{"company":"Alpayana","username":"JUANP","password":"123456"}' | grep -o '"access_token":"[^"]*"' | sed 's/"access_token":"//;s/"$//')

echo ""
echo "=== TC-USR-01 / TC-BIO-01: biometría (face_template sintético, 128 floats) ==="
TEMPLATE=$(node -e "console.log(JSON.stringify(Array(128).fill(0).map((_,i)=>Math.sin(i)*0.5)))")
DNI=$(date +%s | tail -c 9)
REG_RESP=$(curl -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
  -d "{\"company\":\"Alpayana\",\"first_name\":\"QA\",\"last_name\":\"BioTest\",\"dni\":\"$DNI\",\"username\":\"qa_bio_test_$DNI\",\"password\":\"QaTest#2026\",\"face_template\":$TEMPLATE}")
check "TC-USR-01" "Registro con face_template válido (>=100 floats)" "$REG_RESP" '"status":"registered"'

BIO_RESP=$(curl -s -X POST "$BASE/api/auth/login/face" -H "Content-Type: application/json" \
  -d "{\"company\":\"Alpayana\",\"identity_login\":\"qa_bio_test_$DNI\",\"face_template\":$TEMPLATE}")
check "TC-BIO-01" "Login facial exitoso con el mismo template" "$BIO_RESP" '"method":"face"'

echo ""
echo "=== TC-AUTH-03: identidad ambigua (username de uno == dni de otro) ==="
DNI_AMBIG=$(date +%s | tail -c 9)
curl -s -X POST "$BASE/api/auth/users/create" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d "{\"username\":\"qa_ambig_a_$DNI_AMBIG\",\"password\":\"QaTest#2026\",\"first_name\":\"QA\",\"last_name\":\"AmbigA\",\"dni\":\"$DNI_AMBIG\",\"role\":\"operator\"}" > /dev/null
DNI_B=$(( DNI_AMBIG + 1 ))
curl -s -X POST "$BASE/api/auth/users/create" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d "{\"username\":\"$DNI_AMBIG\",\"password\":\"QaTest#2026\",\"first_name\":\"QA\",\"last_name\":\"AmbigB\",\"dni\":\"$DNI_B\",\"role\":\"operator\"}" > /dev/null
AMBIG_RESP=$(curl -s -X POST "$BASE/api/auth/login/password" -H "Content-Type: application/json" \
  -d "{\"company\":\"Alpayana\",\"username\":\"$DNI_AMBIG\",\"password\":\"whatever\"}")
check "TC-AUTH-03" "Identidad ambigua (username == dni de otro usuario)" "$AMBIG_RESP" "ambiguous_identity"

echo ""
echo "=== TC-RBAC-03/04: rol distinto por tenant ==="
TSTAMP=$(date +%s)
TEMPLATE_B=$(node -e "console.log(JSON.stringify(Array(128).fill(0).map((_,i)=>Math.cos(i)*0.3)))")
DNI_TB=$(( $(date +%s) + 1000 ))
curl -s -X POST "$BASE/api/auth/register" -H "Content-Type: application/json" \
  -d "{\"company\":\"QA Tenant B Corp $TSTAMP\",\"first_name\":\"QA\",\"last_name\":\"TenantBAdmin\",\"dni\":\"$DNI_TB\",\"username\":\"qa_tb_admin_$TSTAMP\",\"password\":\"QaTest#2026\",\"role\":\"admin\",\"face_template\":$TEMPLATE_B}" > /dev/null
TOKEN_B=$(curl -s -X POST "$BASE/api/auth/login/password" -H "Content-Type: application/json" \
  -d "{\"company\":\"QA Tenant B Corp $TSTAMP\",\"username\":\"qa_tb_admin_$TSTAMP\",\"password\":\"QaTest#2026\"}" | grep -o '"access_token":"[^"]*"' | sed 's/"access_token":"//;s/"$//')
GRANT_RESP=$(curl -s -X POST "$BASE/api/auth/users/qa_operator_test/tenants" -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN_B" -d '{"role":"supervisor"}')
check "TC-RBAC-03-setup" "Otorgar rol supervisor en tenant nuevo" "$GRANT_RESP" '"ok":true'

OP_TOKEN=$(curl -s -X POST "$BASE/api/auth/login/password" -H "Content-Type: application/json" \
  -d '{"company":"Alpayana","username":"qa_operator_test","password":"QaTest#2026"}' | grep -o '"access_token":"[^"]*"' | sed 's/"access_token":"//;s/"$//')
TENANTS_RESP=$(curl -s -X GET "$BASE/api/auth/tenants" -H "Authorization: Bearer $OP_TOKEN")
check "TC-RBAC-03" "Roles distintos por tenant visibles" "$TENANTS_RESP" '"role":"supervisor"'

TENANT_B_ID=$(node -e "
const d = JSON.parse(process.argv[1]);
const t = d.tenants.find(x => x.role === 'supervisor');
console.log(t ? t.tenant_id : '');
" "$TENANTS_RESP")
SWITCH_RESP=$(curl -s -X POST "$BASE/api/auth/tenants/switch" -H "Content-Type: application/json" -H "Authorization: Bearer $OP_TOKEN" -d "{\"tenant_id\":\"$TENANT_B_ID\"}")
check "TC-RBAC-04" "Switch de tenant recalcula rol efectivo" "$SWITCH_RESP" '"role":"supervisor"'

echo ""
echo "=== TC-GDAL-03/04/05: conversión real con data/incoming/test_geo.tif ==="
CONV_RESP=$(curl -s -X POST "$BASE/api/convert" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d "{\"input_path\":\"incoming/test_geo.tif\",\"output_name\":\"qa_fixture_$TSTAMP\"}")
JOB_ID=$(extract "$CONV_RESP" "job_id")
check "TC-GDAL-03-queue" "Job de conversión aceptado" "$CONV_RESP" '"status":"queued"'
sleep 5
JOB_STATUS=$(curl -s -X GET "$BASE/api/jobs/$JOB_ID" -H "Authorization: Bearer $ADMIN_TOKEN")
check "TC-GDAL-03" "Job completado con output real" "$JOB_STATUS" '"status":"completed"'

BAD_COMPRESS=$(curl -s -X POST "$BASE/api/convert" -H "Content-Type: application/json" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"input_path":"incoming/test_geo.tif","output_name":"qa_bad_compress","compression":"HACKED_CODEC"}')
check "TC-GDAL-04" "Compresión fuera de allowlist rechazada" "$BAD_COMPRESS" "compression must be"

JOB_AS_OP=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE/api/jobs/$JOB_ID" -H "Authorization: Bearer $OP_TOKEN")
if [ "$JOB_AS_OP" = "403" ] || [ "$JOB_AS_OP" = "404" ]; then
  echo "[PASS] TC-GDAL-05 — job no visible para no-dueño/no-admin ($JOB_AS_OP)"; PASS=$((PASS+1))
else
  echo "[FAIL] TC-GDAL-05 — código inesperado ($JOB_AS_OP)"; FAIL=$((FAIL+1))
fi

echo ""
echo "======================================"
echo "RESUMEN FIXTURES: $PASS PASS / $FAIL FAIL"
echo "======================================"
