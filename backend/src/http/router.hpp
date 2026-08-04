#pragma once

#include <boost/beast/http.hpp>
#include <boost/json.hpp>
#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

namespace beast = boost::beast;
namespace http = beast::http;
namespace json = boost::json;

namespace router {

using RouteHandler = std::function<http::response<http::string_body>(
    const http::request<http::string_body> &,
    const std::unordered_map<std::string, std::string> &query)>;

class Router {
public:
    void addRoute(http::verb method, const std::string &path,
                  RouteHandler handler);
    void addPrefixRoute(http::verb method, const std::string &prefix,
                        RouteHandler handler);

    void get(const std::string &path, RouteHandler handler);
    void post(const std::string &path, RouteHandler handler);
    void put(const std::string &path, RouteHandler handler);
    void del(const std::string &path, RouteHandler handler);

    http::response<http::string_body> dispatch(
        const http::request<http::string_body> &req,
        const std::string &dataRoot);

private:
    struct ExactRoute {
        http::verb method;
        std::string path;
        RouteHandler handler;
    };
    struct PrefixRoute {
        http::verb method;
        std::string prefix;
        RouteHandler handler;
    };
    std::vector<ExactRoute> exactRoutes_;
    std::vector<PrefixRoute> prefixRoutes_;
};

} // namespace router
