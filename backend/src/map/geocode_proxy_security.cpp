#include "geocode_proxy_security.hpp"

#include <algorithm>

namespace map_mod {
namespace {
std::string trim(std::string value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = value.find_last_not_of(" \t\r\n");
    return value.substr(first, last - first + 1);
}
} // namespace

bool sanitizeGeocodeQuery(const std::string &raw, std::string &out, std::string &error) {
    const std::string trimmed = trim(raw);
    if (trimmed.size() < 2 || trimmed.size() > 200) {
        error = "invalid_query_length";
        return false;
    }
    if (trimmed.find('\r') != std::string::npos || trimmed.find('\n') != std::string::npos) {
        error = "invalid_query_chars";
        return false;
    }
    out = trimmed;
    return true;
}

int clampGeocodeLimit(const std::string &rawLimit) {
    if (rawLimit.empty()) return kDefaultGeocodeResults;
    try {
        const int v = std::stoi(rawLimit);
        if (v <= 0) return kDefaultGeocodeResults;
        return std::min(v, kMaxGeocodeResults);
    } catch (...) {
        return kDefaultGeocodeResults;
    }
}

} // namespace map_mod
