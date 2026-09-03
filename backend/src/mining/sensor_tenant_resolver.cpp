// --------------------------------------------------------------------------
// sensor_tenant_resolver.cpp — guard anti-IDOR de sensores/telemetría
// --------------------------------------------------------------------------
// Extraído de sensor_service.cpp (2026-09-02) a su propia unidad de
// compilación para que backend/tests/test_sensor_anti_idor.cpp (SPEC-021 T7)
// pueda linkearse sin arrastrar el resto de sensor_service.cpp -- ese archivo
// también define handlers que llaman auth::resolveAuthSession
// (auth_session.cpp -> auth_storage_pg.cpp -> biometric/*), cadena de
// dependencia incompatible con el target liviano de pruebas
// (beemetry_backend_tests). resolveAllowedSensorTenant en sí solo necesita
// auth::AuthSession (auth_types.hpp, sin dependencias pesadas) y
// auth::userBelongsToTenant (permissions.cpp, que ya es liviano: sin
// HAS_LIBPQ cae fail-closed a `return false`, ver permissions.cpp).
// Sin cambios de comportamiento -- ver el comentario original completo en el
// historial de sensor_service.cpp antes de este commit.
#include "sensor_service.hpp"
#include "../auth/permissions.hpp"

namespace mining {

/**
 * Resuelve el tenant efectivo de una lectura de sensores/telemetría a prueba
 * de IDOR — mismo criterio que resolveAllowedReportTenant (report_routes.cpp)
 * y que surveillance_service.cpp. Auditoría de seguridad 2026-07-19:
 * `handleGetSensorData` y `handleGetTelemetrySummary` (a) devolvían datos
 * GLOBALES sin scope cuando la petición no traía `tenant_id` (fuga del
 * inventario de sensores de TODOS los tenants a cualquiera con sesión, o
 * incluso sin ella en el caso de sensors/data), y (b) confiaban ciegamente
 * en el `tenant_id` del cliente sin verificar que perteneciera a la sesión
 * (IDOR horizontal: un usuario del tenant A podía pedir `?tenant_id=<B>` y
 * leer los sensores del tenant B). El tenant efectivo SIEMPRE se deriva de
 * la sesión; solo se acepta un tenant distinto si `userBelongsToTenant` lo
 * autoriza (rol admin multi-tenant). `ok=false` → 403.
 *
 * Declarada en sensor_service.hpp (no en un namespace anónimo) para que
 * sensor_telemetry_wizard.cpp reutilice el mismo guard en vez de duplicar
 * lógica de seguridad.
 */
std::string resolveAllowedSensorTenant(
    const auth::AuthSession &session,
    const std::unordered_map<std::string, std::string> &query, bool &ok) {
  ok = true;
  auto it = query.find("tenant_id");
  if (it == query.end() || it->second.empty() || it->second == session.tenantId) {
    return session.tenantId;
  }
  if (auth::userBelongsToTenant(session.userId, session.tenantId, it->second)) {
    return it->second;
  }
  ok = false;
  return session.tenantId;
}

} // namespace mining
