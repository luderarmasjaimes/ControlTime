#include "api_auth.hpp"
#include <boost/beast/http.hpp>
#include <boost/json.hpp>
#include <iostream>
#include <string>
#include <cstdlib>
#include <algorithm>
#include <sstream>

namespace security {

ApiKeyAuth::ApiKeyAuth() : enabled_(true) {
    loadFromEnvironment();
    
    // Si no se encontraron API keys, deshabilitar autenticación en modo desarrollo
    if (valid_keys_.empty()) {
        std::cout << "[SECURITY] WARN: No API keys found. Authentication disabled (development mode)." << std::endl;
        enabled_ = false;
    } else {
        std::cout << "[SECURITY] API authentication enabled with " << valid_keys_.size() << " key(s)." << std::endl;
    }
}

void ApiKeyAuth::loadFromEnvironment() {
    const char* env_keys = std::getenv("API_KEYS");
    if (!env_keys) {
        env_keys = std::getenv("MINING_API_KEYS");
    }
    
    if (!env_keys || std::string(env_keys).empty()) {
        return;
    }
    
    std::string keys_str(env_keys);
    std::istringstream iss(keys_str);
    std::string key;
    
    while (std::getline(iss, key, ',')) {
        // Eliminar espacios en blanco
        key.erase(std::remove_if(key.begin(), key.end(), ::isspace), key.end());
        if (!key.empty()) {
            addApiKey(key);
        }
    }
}

void ApiKeyAuth::addApiKey(const std::string& key) {
    std::unique_lock<std::shared_mutex> lock(keys_mutex_);
    valid_keys_.insert(key);
}

bool ApiKeyAuth::validateApiKey(const std::string& key) const {
    std::shared_lock<std::shared_mutex> lock(keys_mutex_);
    return valid_keys_.find(key) != valid_keys_.end();
}

std::string ApiKeyAuth::extractApiKey(const boost::beast::http::request<boost::beast::http::string_body>& req) const {
    // Intentar obtener de header Authorization: Bearer <api_key>
    auto auth_it = req.find(boost::beast::http::field::authorization);
    if (auth_it != req.end()) {
        std::string auth_header(auth_it->value());
        if (auth_header.substr(0, 7) == "Bearer ") {
            return auth_header.substr(7);
        }
    }
    
    // Intentar obtener de header X-API-Key
    auto api_key_it = req.find("X-API-Key");
    if (api_key_it != req.end()) {
        return std::string(api_key_it->value());
    }
    
    // Intentar obtener de query parameter ?api_key=<key>
    std::string target = req.target();
    size_t pos = target.find("api_key=");
    if (pos != std::string::npos) {
        pos += 8; // longitud de "api_key="
        size_t end = target.find('&', pos);
        if (end == std::string::npos) {
            end = target.find('?', pos);
        }
        if (end == std::string::npos) {
            end = target.length();
        }
        return target.substr(pos, end - pos);
    }
    
    return "";
}

bool ApiKeyAuth::validateRequest(const boost::beast::http::request<boost::beast::http::string_body>& req, 
                                std::string& error_message) const {
    if (!enabled_) {
        return true; // Autenticación deshabilitada
    }
    
    std::string api_key = extractApiKey(req);
    if (api_key.empty()) {
        error_message = "Missing API key. Provide via Authorization: Bearer <key>, X-API-Key header, or api_key query parameter.";
        return false;
    }
    
    if (!validateApiKey(api_key)) {
        error_message = "Invalid API key.";
        return false;
    }
    
    return true;
}

bool authenticateRequest(const boost::beast::http::request<boost::beast::http::string_body>& req,
                        boost::beast::http::response<boost::beast::http::string_body>& res) {
    static ApiKeyAuth auth;
    
    if (!auth.isEnabled()) {
        return true; // Autenticación deshabilitada
    }
    
    std::string error_message;
    if (!auth.validateRequest(req, error_message)) {
        // Crear respuesta de error
        res.result(boost::beast::http::status::unauthorized);
        res.set(boost::beast::http::field::content_type, "application/json");
        
        boost::json::object error_obj;
        error_obj["error"] = error_message;
        error_obj["code"] = "UNAUTHORIZED";
        
        res.body() = boost::json::serialize(error_obj);
        res.prepare_payload();
        return false;
    }
    
    return true;
}

} // namespace security