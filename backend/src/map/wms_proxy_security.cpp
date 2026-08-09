#include "wms_proxy_security.hpp"

#include <algorithm>
#include <cctype>
#include <iomanip>
#include <regex>
#include <set>
#include <sstream>

namespace map_mod {
namespace {
std::string lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return value;
}

std::string trim(std::string value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) return {};
    const auto last = value.find_last_not_of(" \t\r\n");
    return value.substr(first, last - first + 1);
}

std::string encode(const std::string &value) {
    std::ostringstream out;
    out << std::uppercase << std::hex;
    for (unsigned char c : value) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~' || c == ',') out << c;
        else out << '%' << std::setw(2) << std::setfill('0') << static_cast<int>(c);
    }
    return out.str();
}
} // namespace

bool parseHttpsWmsEndpoint(const std::string &url, WmsEndpoint &out) {
    static const std::regex pattern(
        R"(^https://([A-Za-z0-9.-]+)(?::([0-9]{1,5}))?(/[^?#]*)?$)", std::regex::icase);
    std::smatch match;
    if (!std::regex_match(url, match, pattern)) return false;
    out.host = lower(match[1].str());
    out.port = match[2].matched ? match[2].str() : "443";
    out.target = match[3].matched && !match[3].str().empty() ? match[3].str() : "/";
    try {
        const int port = std::stoi(out.port);
        if (port < 1 || port > 65535) return false;
    } catch (...) { return false; }
    return out.target.find("//") != 0 && out.target.find('@') == std::string::npos;
}

bool isAllowedWmsHost(const std::string &host, const std::string &csvAllowlist) {
    const std::string candidate = lower(host);
    std::stringstream input(csvAllowlist);
    std::string item;
    while (std::getline(input, item, ',')) {
        item = lower(trim(item));
        if (!item.empty() && item == candidate) return true;
    }
    return false;
}

bool isPrivateOrReserved(const boost::asio::ip::address &address) {
    if (address.is_v4()) {
        const auto bytes = address.to_v4().to_bytes();
        return bytes[0] == 0 || bytes[0] == 10 || bytes[0] == 127
            || (bytes[0] == 100 && bytes[1] >= 64 && bytes[1] <= 127)
            || (bytes[0] == 169 && bytes[1] == 254)
            || (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
            || (bytes[0] == 192 && bytes[1] == 0)
            || (bytes[0] == 192 && bytes[1] == 168)
            || (bytes[0] == 198 && bytes[1] == 51 && bytes[2] == 100)
            || (bytes[0] == 198 && (bytes[1] == 18 || bytes[1] == 19))
            || (bytes[0] == 203 && bytes[1] == 0 && bytes[2] == 113)
            || bytes[0] >= 224;
    }
    const auto v6 = address.to_v6();
    const auto bytes = v6.to_bytes();
    const bool mappedV4 = std::all_of(bytes.begin(), bytes.begin() + 10,
                                     [](unsigned char value) { return value == 0; })
        && bytes[10] == 0xff && bytes[11] == 0xff;
    if (mappedV4) {
        boost::asio::ip::address_v4::bytes_type v4Bytes{{bytes[12], bytes[13], bytes[14], bytes[15]}};
        return isPrivateOrReserved(boost::asio::ip::address_v4(v4Bytes));
    }
    return v6.is_unspecified() || v6.is_loopback() || v6.is_link_local()
        || v6.is_multicast() || (bytes[0] & 0xfe) == 0xfc;
}

bool buildWmsTarget(const WmsEndpoint &endpoint,
                    const std::unordered_map<std::string, std::string> &query,
                    std::string &target, std::string &error) {
    static const std::set<std::string> allowed = {
        "service", "request", "layers", "styles", "format", "transparent",
        "version", "width", "height", "crs", "srs", "bbox", "tiled",
        "exceptions", "bgcolor", "dpi", "map_resolution", "format_options"
    };
    std::unordered_map<std::string, std::string> normalized;
    for (const auto &[key, value] : query) {
        const auto k = lower(key);
        if (k == "source") continue;
        if (!allowed.count(k)) { error = "unsupported_parameter"; return false; }
        normalized[k] = value;
    }
    if (lower(normalized["service"]) != "wms" || lower(normalized["request"]) != "getmap") {
        error = "only_wms_getmap_allowed"; return false;
    }
    for (const char *dimension : {"width", "height"}) {
        try {
            const int value = std::stoi(normalized[dimension]);
            if (value < 1 || value > 1024) { error = "invalid_dimensions"; return false; }
        } catch (...) { error = "invalid_dimensions"; return false; }
    }
    if (normalized["layers"].empty() || normalized["bbox"].empty()
        || normalized["format"].rfind("image/", 0) != 0) {
        error = "missing_wms_parameters"; return false;
    }
    target = endpoint.target;
    target += target.find('?') == std::string::npos ? '?' : '&';
    bool first = true;
    for (const auto &[key, value] : normalized) {
        if (!first) target += '&';
        first = false;
        target += encode(key) + "=" + encode(value);
    }
    if (target.size() > 8192) { error = "target_too_long"; return false; }
    return true;
}
} // namespace map_mod
