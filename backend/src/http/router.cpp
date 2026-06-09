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

http::response<http::string_body> Router::dispatch(
    const http::request<http::string_body> &req,
    const std::string & /*dataRoot*/) {
    const std::string target = std::string(req.target());
    const std::string pathOnly = http_utils::routePathOnly(target);
    const auto query = http_utils::parseQueryString(target);

    if (req.method() == http::verb::options) {
        return http_utils::makeJsonResponse(http::status::ok,
                                            json::object{{"ok", true}});
    }

    for (const auto &route : exactRoutes_) {
        if (req.method() == route.method && pathOnly == route.path) {
            return route.handler(req, query);
        }
    }

    for (const auto &route : prefixRoutes_) {
        if (req.method() == route.method &&
            pathOnly.substr(0, route.prefix.size()) == route.prefix) {
            return route.handler(req, query);
        }
    }

    return http_utils::makeJsonResponse(
        http::status::not_found,
        json::object{{"error", "not_found"},
                     {"path", pathOnly}});
}

} // namespace router
