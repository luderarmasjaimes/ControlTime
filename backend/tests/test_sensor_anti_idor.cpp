#include <catch2/catch_test_macros.hpp>
#include "mining/sensor_service.hpp"
#include "auth/auth_types.hpp"

// SPEC-021 T7 / ADR-109: prueba contractual del guard anti-IDOR compartido
// por handleGetSensorData/handleGetTelemetrySummary/sensor_telemetry_wizard.
// Cubre las dos ramas que no requieren Postgres (mismo tenant, sin query) —
// la rama de acceso cruzado real (userBelongsToTenant) consulta
// auth_user_tenant vía libpq y queda fuera de este test unitario; en su
// ausencia de conexión, userBelongsToTenant() es fail-closed (retorna
// false), así que el resultado ok=false de esa rama sigue siendo el
// comportamiento correcto de seguridad aunque no distinga aquí "sin
// permiso" de "sin conexión a BD" — ver mining::resolveAllowedSensorTenant.

TEST_CASE("resolveAllowedSensorTenant: sin tenant_id en la query, usa el de la sesion") {
  auth::AuthSession session;
  session.userId = "11111111-1111-1111-1111-111111111111";
  session.tenantId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  std::unordered_map<std::string, std::string> query;  // sin tenant_id
  bool ok = false;
  const std::string effective = mining::resolveAllowedSensorTenant(session, query, ok);

  CHECK(ok);
  CHECK(effective == session.tenantId);
}

TEST_CASE("resolveAllowedSensorTenant: tenant_id de la query igual al de la sesion") {
  auth::AuthSession session;
  session.userId = "11111111-1111-1111-1111-111111111111";
  session.tenantId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  std::unordered_map<std::string, std::string> query{{"tenant_id", session.tenantId}};
  bool ok = false;
  const std::string effective = mining::resolveAllowedSensorTenant(session, query, ok);

  CHECK(ok);
  CHECK(effective == session.tenantId);
}

TEST_CASE("resolveAllowedSensorTenant: tenant_id de OTRO tenant sin membresia real -> ok=false (fail-closed)") {
  auth::AuthSession session;
  session.userId = "11111111-1111-1111-1111-111111111111";
  session.tenantId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  std::unordered_map<std::string, std::string> query{
      {"tenant_id", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}};  // tenant B, distinto de la sesion (A)
  bool ok = false;
  const std::string effective = mining::resolveAllowedSensorTenant(session, query, ok);

  // El caso real de IDOR que este guard cierra (auditoria 2026-07-19,
  // sensor_service.cpp): un usuario del tenant A pedia ?tenant_id=<B> y
  // leia los sensores de B sin verificar pertenencia. Sin autorizacion real
  // (o sin BD disponible, que es fail-closed), esto DEBE resultar en
  // ok=false -- nunca se devuelve el tenant B como "efectivo" sin
  // verificacion.
  CHECK_FALSE(ok);
  CHECK(effective == session.tenantId);  // nunca devuelve el tenant ajeno como efectivo
}

TEST_CASE("resolveAllowedSensorTenant: tenant_id vacio en la query se trata igual que ausente") {
  auth::AuthSession session;
  session.userId = "11111111-1111-1111-1111-111111111111";
  session.tenantId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  std::unordered_map<std::string, std::string> query{{"tenant_id", ""}};
  bool ok = false;
  const std::string effective = mining::resolveAllowedSensorTenant(session, query, ok);

  CHECK(ok);
  CHECK(effective == session.tenantId);
}
