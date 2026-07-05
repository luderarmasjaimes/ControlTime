#pragma once

#include <boost/beast/http.hpp>
#include <boost/json.hpp>
#include <string>
#include <unordered_map>

namespace beast = boost::beast;
namespace http  = beast::http;
namespace json  = boost::json;

namespace mining {

/** @brief GET /api/surveillance/cameras — lista cámaras, filtradas por `tenant_id` si se provee en query. */
http::response<http::string_body>
handleGetCameras(const http::request<http::string_body>& req,
                 const std::unordered_map<std::string, std::string>& query);

/** @brief GET /api/surveillance/camera-snapshot — invoca el script Python de captura de snapshot contra el `rtmp_url` de la cámara (resuelta por id+tenant_id), devuelve la imagen resultante. */
http::response<http::string_body>
handleCameraSnapshot(const http::request<http::string_body>& req,
                     const std::unordered_map<std::string, std::string>& query);

/** @brief POST /api/surveillance/cameras — crea una cámara para el tenant dado. */
http::response<http::string_body>
handleCreateCamera(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query);

/** @brief PUT /api/surveillance/cameras/{id} — actualiza campos parciales (name/location/rtmp_url/status/lat/lng) de una cámara del tenant. */
http::response<http::string_body>
handleUpdateCamera(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query);

/** @brief DELETE /api/surveillance/cameras/{id} — elimina una cámara del tenant (hard delete). */
http::response<http::string_body>
handleDeleteCamera(const http::request<http::string_body>& req,
                   const std::unordered_map<std::string, std::string>& query);

} // namespace mining
