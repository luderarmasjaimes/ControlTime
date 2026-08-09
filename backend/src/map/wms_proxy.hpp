#pragma once
#include "../http/router.hpp"
#include <atomic>

namespace map_mod {
struct WmsProxyStats {
    std::atomic<std::uint64_t> requests{0}, successes{0}, errors{0}, blocked{0}, bytes{0}, durationMs{0};
};
WmsProxyStats &wmsProxyStats();
http::response<http::string_body> handleWmsProxy(
    const http::request<http::string_body> &req,
    const std::unordered_map<std::string, std::string> &query);
}
