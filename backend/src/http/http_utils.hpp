#pragma once

#include <boost/beast/http.hpp>
#include <boost/json.hpp>

#include <string>
#include <unordered_map>
#include <vector>

namespace beast = boost::beast;
namespace http = beast::http;
namespace json = boost::json;

namespace http_utils {

int hexToInt(char c);

std::string urlDecode(const std::string &src);

std::unordered_map<std::string, std::string>
parseQueryString(const std::string &target);

std::string routePathOnly(const std::string &target);

std::string nowIso8601();

std::string toLowerCopy(std::string value);

std::vector<std::string> splitCsvLower(const std::string &csv);

std::string makeId();

void pushIssueUnique(std::vector<std::string> &issues,
                     const std::string &issue);

std::string hashPassword(const std::string &password);

bool isValidDni(const std::string &dni);

double cosineSimilarity(const std::vector<double> &a,
                        const std::vector<double> &b);

std::string csvEscape(const std::string &v);

http::response<http::string_body> makeJsonResponse(http::status status,
                                                   const json::value &value);

http::response<http::string_body> makeCsvResponse(const std::string &filename,
                                                  const std::string &csv);

http::response<http::string_body> makeJpegResponse(std::string jpegBytes);

/** @brief Respuesta 200 con Content-Type application/pdf y Content-Disposition attachment (descarga directa). */
http::response<http::string_body> makePdfResponse(const std::string &filename,
                                                  std::string pdfBytes);

} // namespace http_utils
