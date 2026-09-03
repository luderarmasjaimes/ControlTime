#pragma once

#include <optional>
#include <string>

namespace reports {

/** @brief Fila de `report_pdf_share_links` (ADR-138) ya validada por
 * `resolveReportShareLinkPg` — existe, no está revocada y no expiró. */
struct ShareLink {
  std::string token;
  std::string reportId;
  std::string tenantId;
  std::string createdByUserId;
  std::string createdByUsername;
};

/** @brief Crea un enlace de acceso directo a PDF (ADR-138): genera un token
 * opaco (`http_utils::secureRandomHex`, no es un JWT ni sirve para nada más
 * que este endpoint puntual) y lo persiste con expiración `ttlHours` horas
 * desde ahora. El PDF servido a través del token resultante NO lleva
 * contraseña propia — la protección es el token en sí (largo, aleatorio,
 * expira), pensado para abrirse con cero pasos al escanear un QR.
 * @return El token generado, o cadena vacía si falló (ver `error`). */
std::string createReportShareLinkPg(const std::string &databaseUrl, const std::string &reportId,
                                    const std::string &tenantId, const std::string &createdByUserId,
                                    const std::string &createdByUsername, int ttlHours,
                                    std::string &error);

/** @brief Resuelve un token de enlace directo y registra el acceso
 * (`accessed_count`/`last_accessed_at`, best-effort — nunca bloquea la
 * resolución si ese UPDATE falla). @return El `ShareLink` si el token existe,
 * no está revocado y no expiró; `std::nullopt` en cualquier otro caso. */
std::optional<ShareLink> resolveReportShareLinkPg(const std::string &databaseUrl,
                                                  const std::string &token);

}  // namespace reports
