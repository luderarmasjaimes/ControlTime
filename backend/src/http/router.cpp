#include "router.hpp"
#include "http_utils.hpp"

namespace router {

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
// ruta/handler: único punto de paso de toda la API. nosniff/frame-ancestors
// son seguros de aplicar globalmente (no rompen ningún flujo existente); CSP
// completo queda pendiente (requiere auditar orígenes externos ya en uso).
void applySecurityHeaders(http::response<http::string_body> &res) {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("X-Frame-Options", "SAMEORIGIN");
    res.set("Referrer-Policy", "strict-origin-when-cross-origin");
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
        applySecurityHeaders(res);
        return res;
    }

    for (const auto &route : exactRoutes_) {
        if (req.method() == route.method && pathOnly == route.path) {
            auto res = route.handler(req, query);
            applySecurityHeaders(res);
            return res;
        }
    }

    for (const auto &route : prefixRoutes_) {
        if (req.method() == route.method &&
            pathOnly.substr(0, route.prefix.size()) == route.prefix) {
            auto res = route.handler(req, query);
            applySecurityHeaders(res);
            return res;
        }
    }

    auto res = http_utils::makeJsonResponse(
        http::status::not_found,
        json::object{{"error", "not_found"},
                     {"path", pathOnly}});
    applySecurityHeaders(res);
    return res;
}

} // namespace router
