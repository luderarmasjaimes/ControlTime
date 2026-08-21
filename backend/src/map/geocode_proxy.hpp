#pragma once
#include "../http/router.hpp"
#include <atomic>

namespace map_mod {
struct GeocodeProxyStats {
    std::atomic<std::uint64_t> requests{0}, successes{0}, errors{0}, blocked{0}, rateLimited{0};
};
GeocodeProxyStats &geocodeProxyStats();
http::response<http::string_body> handleGeocodeProxy(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query);
}
