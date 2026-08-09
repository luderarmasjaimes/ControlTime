#pragma once

#include <boost/asio/ip/address.hpp>
#include <string>
#include <unordered_map>

namespace map_mod {

struct WmsEndpoint {
    std::string host;
    std::string port = "443";
    std::string target = "/";
};

bool parseHttpsWmsEndpoint(const std::string &url, WmsEndpoint &out);
bool isAllowedWmsHost(const std::string &host, const std::string &csvAllowlist);
bool isPrivateOrReserved(const boost::asio::ip::address &address);
bool buildWmsTarget(const WmsEndpoint &endpoint,
                    const std::unordered_map<std::string, std::string> &query,
                    std::string &target, std::string &error);

} // namespace map_mod
