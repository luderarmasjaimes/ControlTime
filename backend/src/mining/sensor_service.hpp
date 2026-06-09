#pragma once

#include <boost/beast/http.hpp>
#include <boost/json.hpp>
#include <string>
#include <unordered_map>

namespace beast = boost::beast;
namespace http  = beast::http;
namespace json  = boost::json;

namespace mining {

http::response<http::string_body>
handleGetSensorData(const http::request<http::string_body>& req,
                    const std::unordered_map<std::string, std::string>& query);

} // namespace mining
