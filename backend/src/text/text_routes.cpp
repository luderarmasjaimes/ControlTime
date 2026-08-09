#include "text_routes.hpp"
#include "../text_spell_service.hpp"
#include "../http/http_utils.hpp"
#include "../auth/auth_session.hpp"

using http_utils::makeJsonResponse;

namespace text_mod {

static http::response<http::string_body>
handleCorrectQuick(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    try {
        auto val = json::parse(req.body());
        auto out = text_spell::handleCorrectQuick(val);
        if (out.contains("error"))
            return makeJsonResponse(http::status::bad_request, out);
        return makeJsonResponse(http::status::ok, out);
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

static http::response<http::string_body>
handleCorrectAdvanced(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    try {
        auto val = json::parse(req.body());
        auto out = text_spell::handleCorrectAdvanced(val);
        if (out.contains("error")) {
            const std::string e = json::value_to<std::string>(out.at("error"));
            if (e == "languagetool_unavailable")
                return makeJsonResponse(http::status::service_unavailable, out);
            return makeJsonResponse(http::status::bad_request, out);
        }
        return makeJsonResponse(http::status::ok, out);
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

static http::response<http::string_body>
handleRewrite(const http::request<http::string_body> &req,
              const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    try {
        auto val = json::parse(req.body());
        auto out = text_spell::handleRewrite(val);
        if (out.contains("error"))
            return makeJsonResponse(http::status::bad_request, out);
        return makeJsonResponse(http::status::ok, out);
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

static http::response<http::string_body>
handleLanguageToolCheck(const http::request<http::string_body> &req,
                        const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    try {
        auto val = json::parse(req.body());
        auto out = text_spell::handleLanguageToolCheck(val);
        if (out.contains("error")) {
            const std::string e = json::value_to<std::string>(out.at("error"));
            if (e == "languagetool_unavailable")
                return makeJsonResponse(http::status::service_unavailable, out);
            return makeJsonResponse(http::status::bad_request, out);
        }
        return makeJsonResponse(http::status::ok, out);
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

static http::response<http::string_body>
handleFormatApa7(const http::request<http::string_body> &req,
                 const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    try {
        auto val = json::parse(req.body());
        auto out = text_spell::handleFormatApa7(val);
        if (out.contains("error"))
            return makeJsonResponse(http::status::bad_request, out);
        return makeJsonResponse(http::status::ok, out);
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

static http::response<http::string_body>
handleSearchReferences(const http::request<http::string_body> &req,
                       const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    try {
        auto val = json::parse(req.body());
        auto out = text_spell::handleSearchReferences(val);
        if (out.contains("error")) {
            const std::string e = json::value_to<std::string>(out.at("error"));
            if (e == "search_not_configured" || e == "serper_not_configured")
                return makeJsonResponse(http::status::service_unavailable, out);
            return makeJsonResponse(http::status::bad_request, out);
        }
        return makeJsonResponse(http::status::ok, out);
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

static http::response<http::string_body>
handleVerifyReference(const http::request<http::string_body> &req,
                      const std::unordered_map<std::string, std::string> &query) {
    const auto session = auth::resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    try {
        auto val = json::parse(req.body());
        auto out = text_spell::handleVerifyReference(val);
        if (out.contains("error")) {
            const std::string e = json::value_to<std::string>(out.at("error"));
            if (e == "tavily_not_configured")
                return makeJsonResponse(http::status::service_unavailable, out);
            return makeJsonResponse(http::status::bad_request, out);
        }
        return makeJsonResponse(http::status::ok, out);
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

void registerRoutes(router::Router &r) {
    r.post("/api/text/correct/quick", handleCorrectQuick);
    r.post("/api/text/correct/advanced", handleCorrectAdvanced);
    r.post("/api/text/rewrite", handleRewrite);
    r.post("/api/text/languagetool-check", handleLanguageToolCheck);
    r.post("/api/text/format-apa7", handleFormatApa7);
    r.post("/api/text/search-references", handleSearchReferences);
    r.post("/api/text/verify-reference", handleVerifyReference);
}

} // namespace text_mod
