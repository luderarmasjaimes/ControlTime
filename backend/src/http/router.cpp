#include "router.hpp"
#include "http_utils.hpp"
#include "../auth/auth_session.hpp"

#include <exception>
#include <iostream>

namespace router {

namespace {
// Red de seguridad global: un handler que lanza una excepción no capturada
// (p.ej. json::value_to<std::string>() sobre un campo que en realidad es un
// número — encontrado en vivo mientras se probaba ADR-034, tumbaba TODO el
// proceso `beemetry-api`, no solo esa request, afectando a cualquier otro
// usuario conectado en ese momento) ahora se convierte en un 500 acotado a
// esa única respuesta. Corregir el tipo de dato en el handler específico
// sigue siendo lo correcto (ya hecho para el caso encontrado), pero ningún
// handler individual debería poder derribar el servidor entero por una
// entrada mal tipada.
http::response<http::string_body> invokeHandlerSafely(
    const RouteHandler &handler,
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query) {
    try {
        return handler(req, query);
    } catch (const std::exception &e) {
        std::cerr << "[ROUTER] Handler lanzó excepción no capturada: " << e.what() << "\n";
        return http_utils::makeJsonResponse(
            http::status::internal_server_error,
            json::object{{"error", "internal_server_error"}});
    } catch (...) {
        std::cerr << "[ROUTER] Handler lanzó excepción desconocida\n";
        return http_utils::makeJsonResponse(
            http::status::internal_server_error,
            json::object{{"error", "internal_server_error"}});
    }
}
}  // namespace

void Router::addRoute(http::verb method, const std::string &path,
                      RouteHandler handler) {
    exactRoutes_.push_back({method, path, std::move(handler)});
}

void Router::addPrefixRoute(http::verb method, const std::string &prefix,
                            RouteHandler handler) {
    prefixRoutes_.push_back({method, prefix, std::move(handler)});
}

void Router::get(const std::string &path, RouteHandler handler) {
    if (!path.empty() && path.back() == '/')
        addPrefixRoute(http::verb::get, path, std::move(handler));
    else
        addRoute(http::verb::get, path, std::move(handler));
}

void Router::post(const std::string &path, RouteHandler handler) {
    if (!path.empty() && path.back() == '/')
        addPrefixRoute(http::verb::post, path, std::move(handler));
    else
        addRoute(http::verb::post, path, std::move(handler));
}

void Router::put(const std::string &path, RouteHandler handler) {
    if (!path.empty() && path.back() == '/')
        addPrefixRoute(http::verb::put, path, std::move(handler));
    else
        addRoute(http::verb::put, path, std::move(handler));
}

void Router::del(const std::string &path, RouteHandler handler) {
    if (!path.empty() && path.back() == '/')
        addPrefixRoute(http::verb::delete_, path, std::move(handler));
    else
        addRoute(http::verb::delete_, path, std::move(handler));
}

namespace {
// Headers de seguridad básicos aplicados a TODA respuesta, sin importar la
// ruta/handler: único punto de paso de toda la API.
//
// CSP (antes pendiente, cerrado 2026-07-07 tras auditar todos los orígenes
// externos en uso por el frontend — ver el mismo valor replicado en
// frontend/nginx.conf, que es el que realmente aplica el navegador sobre el
// HTML servido; aquí se agrega también por defensa en profundidad sobre las
// respuestas JSON de la API, que no sirven HTML/scripts propios):
//   - script-src: 'self' + cdn.tailwindcss.com (único script externo real,
//     confirmado en index.html/dist build — sin scripts inline). Se agregó
//     'wasm-unsafe-eval' (2026-07-13, edición offline del Informe Técnico):
//     sql.js (SQLite compilado a WASM, ver offlineSqlite.ts) necesita
//     compilar/instanciar WebAssembly, y sin este token el navegador lo
//     bloquea con "violates ... script-src" — confirmado en consola real
//     durante la prueba offline antes de este fix. No habilita eval() de
//     JS arbitrario: 'wasm-unsafe-eval' solo cubre WebAssembly, es un token
//     separado de 'unsafe-eval'.
//   - style-src: necesita 'unsafe-inline' — Tailwind Play CDN inyecta su CSS
//     generado en runtime sin soporte de nonce/hash, y hay un <style> propio
//     inline en index.html. Mismo trade-off ya aceptado por usar Tailwind
//     CDN en producción (advertencia conocida, fuera de alcance de este fix).
//   - img-src: incluye "https:" sin restringir host — MapViewer.tsx tiene un
//     campo real de "WMS personalizado (URL manual)" donde el usuario puede
//     apuntar a cualquier GeoServer propio; un allowlist fijo de hosts
//     (MINAM/INGEMMET/MINEM/USGS/NationalMap, los WMS del catálogo
//     corporativo) rompería esa función para cualquier WMS privado no
//     listado. Se restringe a HTTPS (bloquea downgrade a http) en vez de
//     restringir por host.
//   - connect-src: 'self' + ws/wss (mismo origen; el WS de la app siempre
//     pasa por el proxy de nginx, nunca a un host externo).
static const char *kCspValue =
    "default-src 'self'; "
    "script-src 'self' 'wasm-unsafe-eval' https://cdn.tailwindcss.com; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data: blob: https:; "
    "connect-src 'self' ws: wss:; "
    "object-src 'none'; "
    "base-uri 'self'; "
    "frame-ancestors 'self'; "
    "form-action 'self'";

void applySecurityHeaders(http::response<http::string_body> &res) {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "SAMEORIGIN");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.set("Content-Security-Policy", kCspValue);
}

// ADR-081: único punto que conoce tanto la request (header `Origin`) como la
// respuesta ya construida por el handler. Cada handler/make*Response() dejó
// el origen default (`http_utils::corsAllowedOrigin()`, primer valor de la
// allowlist) en `Access-Control-Allow-Origin`; acá se sobrescribe con el
// origen exacto de la request SOLO si está en la allowlist configurada
// (`BEEMETRY_CORS_ALLOWED_ORIGIN`). Si no matchea (o no hay header `Origin`,
// caso same-origin normal), no se toca nada — el navegador rechaza por su
// cuenta cualquier origen no reflejado.
void applyCorsOriginOverride(http::response<http::string_body> &res,
                             const http::request<http::string_body> &req) {
    const std::string requestOrigin = std::string(req[http::field::origin]);
    const std::string reflected = http_utils::resolveCorsOrigin(requestOrigin);
    if (reflected.empty()) return;
    res.set(http::field::access_control_allow_origin, reflected);
    res.set(http::field::access_control_allow_credentials, "true");
    res.set(http::field::vary, "Origin");
}
}  // namespace

http::response<http::string_body> Router::dispatch(
    const http::request<http::string_body> &req,
    const std::string & /*dataRoot*/) {
    const std::string target = std::string(req.target());
    const std::string pathOnly = http_utils::routePathOnly(target);
    const auto query = http_utils::parseQueryString(target);

    if (req.method() == http::verb::options) {
        auto res = http_utils::makeJsonResponse(http::status::ok,
                                                 json::object{{"ok", true}});
        applyCorsOriginOverride(res, req);
        applySecurityHeaders(res);
        return res;
    }

    // ── CSRF (ADR-082) ───────────────────────────────────────────────────
    // Desde que el access token viaja en una cookie HttpOnly, el navegador lo
    // adjunta SOLO a toda petición al backend — incluidas las que dispara un
    // sitio de terceros. Eso reintroduce CSRF en cualquier endpoint que mute
    // estado, un riesgo que no existía cuando el token había que poner a mano
    // en un header. `SameSite=Strict` ya bloquea el grueso, pero es una
    // defensa de un solo punto (y con excepciones históricas por navegador),
    // así que se exige además el double-submit token.
    //
    // Se comprueba AQUÍ, en el único punto por el que pasan las 97 rutas, y no
    // handler por handler: una ruta nueva queda protegida por omisión, que es
    // la propiedad que importa. Las peticiones autenticadas por
    // `Authorization: Bearer` (clientes de API, integraciones) no se ven
    // afectadas: ese header no lo pone el navegador solo.
    {
        auth::AuthTokenSource tokenSource = auth::AuthTokenSource::None;
        (void)auth::extractAuthTokenFromRequest(req, query, &tokenSource);
        if (auth::requiresCsrfRejection(req, tokenSource)) {
            auto res = http_utils::makeJsonResponse(
                http::status::forbidden,
                json::object{{"error", "csrf_token_mismatch"},
                             {"detail", "Falta o no coincide el header X-CSRF-Token."}});
            applyCorsOriginOverride(res, req);
            applySecurityHeaders(res);
            return res;
        }
    }

    for (const auto &route : exactRoutes_) {
        if (req.method() == route.method && pathOnly == route.path) {
            auto res = invokeHandlerSafely(route.handler, req, query);
            applyCorsOriginOverride(res, req);
            applySecurityHeaders(res);
            return res;
        }
    }

    for (const auto &route : prefixRoutes_) {
        // `starts_with` en vez del `substr(...) == prefix` anterior: substr
        // construía un std::string temporal (potencial reserva en heap) por
        // cada ruta de prefijo evaluada y por cada request — trabajo y presión
        // sobre el allocator puramente desechables, ya que el resultado solo
        // se usaba para una comparación. starts_with compara in situ.
        if (req.method() == route.method &&
            pathOnly.starts_with(route.prefix)) {
            auto res = invokeHandlerSafely(route.handler, req, query);
            applyCorsOriginOverride(res, req);
            applySecurityHeaders(res);
            return res;
        }
    }

    auto res = http_utils::makeJsonResponse(
        http::status::not_found,
        json::object{{"error", "not_found"},
                     {"path", pathOnly}});
    applyCorsOriginOverride(res, req);
    applySecurityHeaders(res);
    return res;
}

} // namespace router
