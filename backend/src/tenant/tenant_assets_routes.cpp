#include "tenant_assets_routes.hpp"
#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"
#include "../biometric/face_analysis.hpp"

// HAS_LIBPQ no se propaga entre translation units — cada .cpp que compila
// bloques PQ* debe redefinirla localmente ANTES de incluir pg_pool.hpp /
// pg_result.hpp (ambos se auto-protegen con #if HAS_LIBPQ y quedan vacíos
// si la macro no está definida en el punto de inclusión) — mismo patrón que
// report_routes.cpp y device_alarm_routes.cpp.
#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <opencv2/opencv.hpp>
#include <openssl/sha.h>

#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <unordered_map>

using http_utils::makeJsonResponse;
using http_utils::routePathOnly;
using config::AppConfig;
using auth::resolveAuthSession;
using biometric::encodeBase64;
using biometric::decodeBase64;

// ADR-046 (logo) + ADR-047 (galería): un único módulo para todos los activos
// de imagen bajo /api/v1/tenants/{tenant_id}/... — estandarizado en un solo
// lugar porque comparten el mismo prefijo de ruta, la misma validación de
// tenant/rol, y la misma carpeta de origen para importación masiva
// (C:\InformeCliente\IMAGENES\<empresa>\), en vez de tener dos módulos que
// dupliquen el parseo de {tenant_id} y las reglas anti-IDOR.
namespace tenant_assets {

namespace {

constexpr const char *kPrefix = "/api/v1/tenants/";
constexpr const char *kLogoGetSuffix = "/logo.svg";
constexpr const char *kLogoPostSuffix = "/logo";
constexpr const char *kGallerySuffix = "/gallery";
constexpr const char *kGalleryItemInfix = "/gallery/";

// SVG textual: 4 MB es generoso incluso para logos vectoriales muy
// detallados y evita que un upload accidental (o malicioso) infle la fila.
constexpr std::size_t kMaxSvgBytes = 4 * 1024 * 1024;
// Fotos JPEG de unidad minera: 12 MB cubre cámaras réflex sin permitir
// archivos desproporcionados en una fila de BD.
constexpr std::size_t kMaxJpegBytes = 12 * 1024 * 1024;
// Miniatura de galería — pequeña a propósito (zonas de mala conectividad):
// la lista completa de la galería se transfiere en una sola respuesta JSON,
// por eso cada miniatura debe pesar poco (varios KB, no cientos).
constexpr int kThumbnailMaxDim = 220;
constexpr int kThumbnailJpegQuality = 55;

std::string sha256Hex(const std::string &data) {
  unsigned char digest[SHA256_DIGEST_LENGTH];
  SHA256(reinterpret_cast<const unsigned char *>(data.data()), data.size(), digest);
  std::ostringstream oss;
  oss << std::hex << std::setfill('0');
  for (unsigned char b : digest) oss << std::setw(2) << static_cast<int>(b);
  return oss.str();
}

/** @brief Validación superficial: exige que el cuerpo parezca XML/SVG real
 * (evita guardar binarios/HTML arbitrarios bajo un Content-Type de imagen). */
bool looksLikeSvg(const std::string &body) {
  if (body.empty() || body.size() > kMaxSvgBytes) return false;
  std::size_t firstNonSpace = body.find_first_not_of(" \t\r\n");
  if (firstNonSpace == std::string::npos) return false;
  const std::string head = body.substr(firstNonSpace, 200);
  return head.find("<svg") != std::string::npos ||
         head.find("<?xml") != std::string::npos;
}

/** @brief Magic bytes JPEG (FF D8) — evita decodificar/guardar cualquier
 * binario arbitrario como si fuera una foto. */
bool looksLikeJpeg(const std::string &body) {
  return body.size() >= 3 && body.size() <= kMaxJpegBytes &&
         static_cast<unsigned char>(body[0]) == 0xFF &&
         static_cast<unsigned char>(body[1]) == 0xD8;
}

/** @brief Nombre de archivo seguro: solo alfanumérico, punto, guion y guion
 * bajo — evita path traversal o inyección vía el nombre visible al listar. */
std::string sanitizeFilename(const std::string &raw) {
  std::string out;
  out.reserve(raw.size());
  for (char c : raw) {
    if (std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '-' || c == '_') {
      out += c;
    }
  }
  if (out.empty()) out = "imagen.jpg";
  return out.size() > 200 ? out.substr(0, 200) : out;
}

/** @brief Separa "{tenant_id}" del resto del path tras el prefijo común.
 * @return {tenantId, afterTenant} — afterTenant empieza en '/' (p.ej.
 * "/logo.svg", "/gallery", "/gallery/{image_id}") o está vacío si el path no
 * calza con el prefijo. */
std::pair<std::string, std::string> splitTenantPath(const std::string &pathOnly) {
  const std::string prefix = kPrefix;
  if (pathOnly.size() <= prefix.size() || pathOnly.compare(0, prefix.size(), prefix) != 0) {
    return {"", ""};
  }
  const std::string rest = pathOnly.substr(prefix.size());
  const auto slash = rest.find('/');
  if (slash == std::string::npos) return {rest, ""};
  return {rest.substr(0, slash), rest.substr(slash)};
}

bool checkTenantAccess(const auth::AuthSession &session, const std::string &tenantId, bool requireAdmin) {
  if (requireAdmin && session.role != "admin") return false;
  // Mismo criterio anti-IDOR que reports: un usuario solo accede a los
  // activos de SU tenant activo, salvo rol admin (soporte multi-tenant, ver
  // resolveAllowedReportTenant en report_routes.cpp).
  return session.tenantId == tenantId || session.role == "admin";
}

// ── Logo (ADR-046) ──────────────────────────────────────────────────────

http::response<http::string_body> serveLogo(const std::string &tenantId) {
  auto &cfg = AppConfig::instance();
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  const char *params[1] = {tenantId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT svg_content, content_sha256, mime_type FROM tenant_logo WHERE tenant_id = $1::uuid",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "logo_not_configured"}});
  }
  const std::string svg = PQgetvalue(res.get(), 0, 0);
  const std::string hash = PQgetvalue(res.get(), 0, 1);
  const std::string mime = PQgetvalue(res.get(), 0, 2);

  http::response<http::string_body> resp{http::status::ok, 11};
  resp.set(http::field::content_type, mime.empty() ? "image/svg+xml" : mime);
  resp.set(http::field::access_control_allow_origin, http_utils::corsAllowedOrigin());
  // Zonas de mala conectividad: el contenido es inmutable mientras no cambie
  // el hash (subir un nuevo logo cambia la URL efectiva vía ETag, no hace
  // falta invalidar por tiempo) — el navegador no debería volver a pedirlo
  // por red una vez cacheado.
  resp.set(http::field::cache_control, "public, max-age=31536000, immutable");
  resp.set(http::field::etag, "\"" + hash + "\"");
  resp.body() = svg;
  resp.prepare_payload();
  return resp;
#else
  (void)cfg;
  return makeJsonResponse(http::status::not_implemented, json::object{{"error", "postgres_not_compiled"}});
#endif
}

http::response<http::string_body> uploadLogo(const std::string &updatedBy, const std::string &tenantId,
                                             const std::string &body) {
  if (!looksLikeSvg(body)) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "el cuerpo debe ser un SVG bien formado (<svg ...>) de máximo 4MB"}});
  }
  const std::string hash = sha256Hex(body);
  auto &cfg = AppConfig::instance();
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  const char *params[4] = {tenantId.c_str(), body.c_str(), hash.c_str(), updatedBy.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO tenant_logo (tenant_id, svg_content, content_sha256, updated_by, updated_at) "
      "VALUES ($1::uuid, $2, $3, $4, now()) "
      "ON CONFLICT (tenant_id) DO UPDATE SET "
      "  svg_content = EXCLUDED.svg_content, "
      "  content_sha256 = EXCLUDED.content_sha256, "
      "  updated_by = EXCLUDED.updated_by, "
      "  updated_at = now()",
      4, nullptr, params, nullptr, nullptr, 0)};
  if (!res.ok()) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_write_failed"}});
  }
  return makeJsonResponse(http::status::ok,
                          json::object{{"tenant_id", tenantId}, {"content_sha256", hash}, {"bytes", static_cast<int64_t>(body.size())}});
#else
  (void)cfg; (void)hash;
  return makeJsonResponse(http::status::not_implemented, json::object{{"error", "postgres_not_compiled"}});
#endif
}

// ── Galería (ADR-047) ───────────────────────────────────────────────────

http::response<http::string_body> listGallery(const std::string &tenantId) {
  auto &cfg = AppConfig::instance();
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  const char *params[1] = {tenantId.c_str()};
  // encode(...,'base64') delega la codificación a Postgres — evita traer
  // bytea crudo en formato hex y tener que reimplementar un decoder hex en
  // C++ (ver comentario de diseño en tenant_gallery_image.sql).
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT image_id::text, filename, width_px, height_px, "
      "       encode(thumbnail, 'base64') AS thumb_b64, mime_type "
      "FROM tenant_gallery_image WHERE tenant_id = $1::uuid ORDER BY created_at DESC",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples()) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_read_failed"}});
  }
  json::array images;
  const int n = PQntuples(res.get());
  for (int i = 0; i < n; ++i) {
    const char *widthRaw = PQgetvalue(res.get(), i, 2);
    const char *heightRaw = PQgetvalue(res.get(), i, 3);
    const std::string mime = PQgetvalue(res.get(), i, 5);
    json::object o;
    o["image_id"] = std::string(PQgetvalue(res.get(), i, 0));
    o["filename"] = std::string(PQgetvalue(res.get(), i, 1));
    o["width_px"] = (widthRaw && *widthRaw) ? std::atoi(widthRaw) : 0;
    o["height_px"] = (heightRaw && *heightRaw) ? std::atoi(heightRaw) : 0;
    o["thumbnail_data_url"] = "data:" + (mime.empty() ? "image/jpeg" : mime) + ";base64," + std::string(PQgetvalue(res.get(), i, 4));
    images.push_back(std::move(o));
  }
  return makeJsonResponse(http::status::ok, json::object{{"images", images}});
#else
  (void)cfg;
  return makeJsonResponse(http::status::not_implemented, json::object{{"error", "postgres_not_compiled"}});
#endif
}

http::response<http::string_body> serveGalleryImage(const std::string &tenantId, const std::string &imageId) {
  auto &cfg = AppConfig::instance();
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  const char *params[2] = {tenantId.c_str(), imageId.c_str()};
  // Igual que arriba: pedirle a Postgres la codificación base64 evita un
  // decoder hex propio — el JPEG completo solo se transfiere "bajo demanda"
  // (cuando el usuario efectivamente inserta la imagen en el lienzo), nunca
  // al listar la galería.
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT encode(content, 'base64') AS content_b64, content_sha256, mime_type "
      "FROM tenant_gallery_image WHERE tenant_id = $1::uuid AND image_id = $2::uuid",
      2, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "image_not_found"}});
  }
  const std::string contentB64 = PQgetvalue(res.get(), 0, 0);
  const std::string hash = PQgetvalue(res.get(), 0, 1);
  const std::string mime = PQgetvalue(res.get(), 0, 2);
  std::vector<unsigned char> raw;
  if (!decodeBase64(contentB64, raw)) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "decode_failed"}});
  }

  http::response<http::string_body> resp{http::status::ok, 11};
  resp.set(http::field::content_type, mime.empty() ? "image/jpeg" : mime);
  resp.set(http::field::access_control_allow_origin, http_utils::corsAllowedOrigin());
  resp.set(http::field::cache_control, "public, max-age=31536000, immutable");
  resp.set(http::field::etag, "\"" + hash + "\"");
  resp.body().assign(reinterpret_cast<const char *>(raw.data()), raw.size());
  resp.prepare_payload();
  return resp;
#else
  (void)cfg;
  return makeJsonResponse(http::status::not_implemented, json::object{{"error", "postgres_not_compiled"}});
#endif
}

http::response<http::string_body> uploadGalleryImage(const std::string &updatedBy, const std::string &tenantId,
                                                     const std::string &body, const std::string &filenameRaw) {
  if (!looksLikeJpeg(body)) {
    return makeJsonResponse(http::status::bad_request,
                            json::object{{"error", "el cuerpo debe ser un JPEG válido (encabezado FF D8) de máximo 12MB"}});
  }
  const std::string filename = sanitizeFilename(filenameRaw.empty() ? "imagen.jpg" : filenameRaw);

  std::vector<unsigned char> raw(body.begin(), body.end());
  cv::Mat img = cv::imdecode(raw, cv::IMREAD_COLOR);
  if (img.empty()) {
    return makeJsonResponse(http::status::bad_request, json::object{{"error", "no se pudo decodificar el JPEG"}});
  }
  const int width = img.cols;
  const int height = img.rows;

  // Miniatura ~220px en el lado mayor, calidad baja — pensada para listar la
  // galería completa en una sola respuesta sin penalizar zonas con mala
  // conectividad (ver comentario de diseño en tenant_gallery_image.sql).
  cv::Mat thumb;
  const double scale = static_cast<double>(kThumbnailMaxDim) / std::max(width, height);
  if (scale < 1.0) {
    cv::resize(img, thumb, cv::Size(), scale, scale, cv::INTER_AREA);
  } else {
    thumb = img;
  }
  std::vector<unsigned char> thumbJpeg;
  if (!cv::imencode(".jpg", thumb, thumbJpeg, {cv::IMWRITE_JPEG_QUALITY, kThumbnailJpegQuality})) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "thumbnail_encode_failed"}});
  }

  const std::string hash = sha256Hex(body);
  const std::string contentB64 = encodeBase64(raw);
  const std::string thumbB64 = encodeBase64(thumbJpeg);

  auto &cfg = AppConfig::instance();
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  const std::string widthStr = std::to_string(width);
  const std::string heightStr = std::to_string(height);
  const char *params[8] = {
      tenantId.c_str(), filename.c_str(), contentB64.c_str(), thumbB64.c_str(),
      hash.c_str(), widthStr.c_str(), heightStr.c_str(), updatedBy.c_str(),
  };
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO tenant_gallery_image "
      "  (tenant_id, filename, content, thumbnail, content_sha256, width_px, height_px, updated_by) "
      "VALUES ($1::uuid, $2, decode($3,'base64'), decode($4,'base64'), $5, $6::int, $7::int, $8) "
      "ON CONFLICT (tenant_id, filename) DO UPDATE SET "
      "  content = EXCLUDED.content, thumbnail = EXCLUDED.thumbnail, "
      "  content_sha256 = EXCLUDED.content_sha256, width_px = EXCLUDED.width_px, "
      "  height_px = EXCLUDED.height_px, updated_by = EXCLUDED.updated_by, created_at = now() "
      "RETURNING image_id::text",
      8, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_write_failed"}});
  }
  return makeJsonResponse(http::status::ok, json::object{
      {"image_id", std::string(PQgetvalue(res.get(), 0, 0))},
      {"filename", filename}, {"width_px", width}, {"height_px", height},
      {"content_sha256", hash}, {"bytes", static_cast<int64_t>(body.size())},
  });
#else
  (void)cfg; (void)hash; (void)contentB64; (void)thumbB64;
  return makeJsonResponse(http::status::not_implemented, json::object{{"error", "postgres_not_compiled"}});
#endif
}

// ── Importación masiva desde disco (ADR-046/047 estandarizados) ────────
//
// Fuente única: C:\InformeCliente\IMAGENES\<empresa>\ (montada de solo
// lectura en el contenedor backend como /imagenes, ver docker-compose.yml).
// Una subcarpeta por empresa — su nombre debe corresponder al `tenant_name`
// de esa empresa (el mismo texto que ya se ve arriba de la plataforma,
// normalizado): dentro, cualquier *.svg se sube como logotipo y cualquier
// *.jpg/*.jpeg se sube a la galería de esa empresa. Reutiliza EXACTAMENTE
// las mismas funciones uploadLogo()/uploadGalleryImage() (y por lo tanto la
// misma validación, generación de miniatura OpenCV, y hash) que usa el
// endpoint HTTP normal — la única diferencia es que el "body" viene de un
// archivo local en vez de una request.

/** @brief minúsculas + sin acentos (vocales/ñ latinas comunes) + solo
 * alfanumérico — para comparar de forma tolerante el nombre de una carpeta
 * del disco contra `tenants.tenant_name` en BD. */
std::string normalizeSlug(const std::string &input) {
  static const std::unordered_map<std::string, char> kFold = {
      {"\xC3\xA1", 'a'}, {"\xC3\xA9", 'e'}, {"\xC3\xAD", 'i'}, {"\xC3\xB3", 'o'}, {"\xC3\xBA", 'u'},
      {"\xC3\xB1", 'n'}, {"\xC3\xBC", 'u'},
      {"\xC3\x81", 'a'}, {"\xC3\x89", 'e'}, {"\xC3\x8D", 'i'}, {"\xC3\x93", 'o'}, {"\xC3\x9A", 'u'},
      {"\xC3\x91", 'n'}, {"\xC3\x9C", 'u'},
  };
  std::string out;
  out.reserve(input.size());
  std::size_t i = 0;
  while (i < input.size()) {
    unsigned char c = static_cast<unsigned char>(input[i]);
    if (c < 0x80) {
      if (std::isalnum(c)) out += static_cast<char>(std::tolower(c));
      i += 1;
    } else if ((c & 0xE0) == 0xC0 && i + 1 < input.size()) {
      const auto it = kFold.find(input.substr(i, 2));
      if (it != kFold.end()) out += it->second;
      i += 2;
    } else {
      i += 1;
    }
  }
  return out;
}

std::string toLowerAscii(std::string s) {
  for (char &c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

bool hasExtension(const std::string &filename, const std::string &ext) {
  const std::string lower = toLowerAscii(filename);
  return lower.size() >= ext.size() && lower.compare(lower.size() - ext.size(), ext.size(), ext) == 0;
}

http::response<http::string_body> importAssetsFromDisk(const std::string &updatedBy) {
  namespace fs = std::filesystem;
  const std::string root = config::getenvOr("BEEMETRY_ASSETS_IMPORT_ROOT", "/imagenes");
  std::error_code fsErr;
  if (!fs::exists(root, fsErr) || !fs::is_directory(root, fsErr)) {
    return makeJsonResponse(http::status::not_found,
                            json::object{{"error", "carpeta_no_montada"}, {"root", root}});
  }

  auto &cfg = AppConfig::instance();
#if HAS_LIBPQ
  auto lease = storage::PgPool::instance().acquire(cfg.gDatabaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "db_unavailable"}});
  }
  storage::PgResult tenantsRes{PQexec(conn, "SELECT tenant_id::text, tenant_name FROM tenants")};
  if (!tenantsRes.okTuples()) {
    return makeJsonResponse(http::status::internal_server_error, json::object{{"error", "no_se_pudo_leer_tenants"}});
  }
  std::unordered_map<std::string, std::string> tenantBySlug; // slug -> tenant_id
  for (int i = 0; i < PQntuples(tenantsRes.get()); ++i) {
    tenantBySlug[normalizeSlug(PQgetvalue(tenantsRes.get(), i, 1))] = PQgetvalue(tenantsRes.get(), i, 0);
  }
#else
  (void)cfg;
  return makeJsonResponse(http::status::not_implemented, json::object{{"error", "postgres_not_compiled"}});
#endif

  json::array imported;
  json::array skipped;
  for (const auto &entry : fs::directory_iterator(root, fsErr)) {
    if (!entry.is_directory()) continue;
    const std::string folderName = entry.path().filename().string();
    const auto match = tenantBySlug.find(normalizeSlug(folderName));
    if (match == tenantBySlug.end()) {
      skipped.push_back(json::object{{"folder", folderName}, {"reason", "sin_tenant_coincidente"}});
      continue;
    }
    const std::string &tenantId = match->second;
    for (const auto &file : fs::directory_iterator(entry.path(), fsErr)) {
      if (!file.is_regular_file()) continue;
      const std::string filename = file.path().filename().string();
      std::ifstream in(file.path(), std::ios::binary);
      if (!in) {
        skipped.push_back(json::object{{"folder", folderName}, {"file", filename}, {"reason", "no_se_pudo_abrir"}});
        continue;
      }
      std::string bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());

      http::response<http::string_body> result;
      bool handled = true;
      if (hasExtension(filename, ".svg")) {
        result = uploadLogo(updatedBy, tenantId, bytes);
      } else if (hasExtension(filename, ".jpg") || hasExtension(filename, ".jpeg")) {
        result = uploadGalleryImage(updatedBy, tenantId, bytes, filename);
      } else {
        handled = false;
      }
      if (!handled) {
        skipped.push_back(json::object{{"folder", folderName}, {"file", filename}, {"reason", "extension_no_soportada"}});
        continue;
      }
      if (result.result() == http::status::ok) {
        imported.push_back(json::object{{"folder", folderName}, {"file", filename}, {"tenant_id", tenantId}});
      } else {
        skipped.push_back(json::object{{"folder", folderName}, {"file", filename}, {"reason", "upload_fallido"}});
      }
    }
  }

  return makeJsonResponse(http::status::ok, json::object{{"imported", imported}, {"skipped", skipped}});
}

// ── Dispatch por método ─────────────────────────────────────────────────

http::response<http::string_body>
handleGet(const http::request<http::string_body> &req,
         const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

  const std::string pathOnly = routePathOnly(std::string(req.target()));
  const auto [tenantId, after] = splitTenantPath(pathOnly);
  if (tenantId.empty() || after.empty()) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
  }
  if (!checkTenantAccess(*session, tenantId, /*requireAdmin=*/false)) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "no_pertenece_a_esa_unidad"}});
  }

  if (after == kLogoGetSuffix) return serveLogo(tenantId);
  if (after == kGallerySuffix) return listGallery(tenantId);
  if (after.size() > std::string(kGalleryItemInfix).size() &&
      after.compare(0, std::string(kGalleryItemInfix).size(), kGalleryItemInfix) == 0) {
    const std::string imageId = after.substr(std::string(kGalleryItemInfix).size());
    return serveGalleryImage(tenantId, imageId);
  }
  return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
}

http::response<http::string_body>
handlePost(const http::request<http::string_body> &req,
          const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});

  const std::string pathOnly = routePathOnly(std::string(req.target()));
  const auto [tenantId, after] = splitTenantPath(pathOnly);
  if (tenantId.empty() || after.empty()) {
    return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
  }
  // Toda escritura de activos de imagen (logo o galería) es admin-only.
  if (!checkTenantAccess(*session, tenantId, /*requireAdmin=*/true)) {
    return makeJsonResponse(http::status::forbidden, json::object{{"error", "admin_only_o_no_pertenece_a_esa_unidad"}});
  }

  if (after == kLogoPostSuffix) return uploadLogo(session->username, tenantId, req.body());
  if (after == kGallerySuffix) {
    const auto it = query.find("filename");
    return uploadGalleryImage(session->username, tenantId, req.body(), it != query.end() ? it->second : "");
  }
  return makeJsonResponse(http::status::not_found, json::object{{"error", "not_found"}});
}

http::response<http::string_body>
handleImportAssets(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query) {
  const auto session = resolveAuthSession(req, query);
  if (!session) return makeJsonResponse(http::status::unauthorized, json::object{{"error", "unauthorized"}});
  if (session->role != "admin") return makeJsonResponse(http::status::forbidden, json::object{{"error", "admin_only"}});
  return importAssetsFromDisk(session->username);
}

} // namespace

void registerRoutes(router::Router &r) {
  r.get(kPrefix, handleGet);
  r.post(kPrefix, handlePost);
  // Importación masiva admin-only desde C:\InformeCliente\IMAGENES (montada
  // como /imagenes, solo lectura) — un subdirectorio por empresa, ver
  // importAssetsFromDisk() para la convención de nombres.
  r.post("/api/platform/assets/import", handleImportAssets);
}

} // namespace tenant_assets
