#include "api_auth.hpp"
#include <boost/beast/http.hpp>
#include <boost/json.hpp>
#include <iostream>
#include <string>
#include <cstdlib>
#include <algorithm>
#include <cctype>
#include <cstddef>
#include <sstream>

namespace security {

namespace {

/**
 * @brief Comparación de secretos en tiempo constante.
 *
 * El lookup en `unordered_set` corta en el primer byte distinto del hash/
 * memcmp, lo que filtra información de prefijo por temporización. Para un
 * secreto de autenticación se compara siempre el largo completo.
 */
bool constantTimeEquals(const std::string& a, const std::string& b) {
    if (a.size() != b.size()) return false;
    unsigned char diff = 0;
    for (std::size_t i = 0; i < a.size(); ++i) {
        diff |= static_cast<unsigned char>(a[i]) ^ static_cast<unsigned char>(b[i]);
    }
    return diff == 0;
}

/** @brief true solo si la variable está explícitamente en "true"/"1". */
bool envFlagEnabled(const char* key) {
    const char* v = std::getenv(key);
    if (!v) return false;
    std::string s(v);
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s == "true" || s == "1" || s == "yes";
}

}  // namespace

ApiKeyAuth::ApiKeyAuth() : enabled_(true) {
    loadFromEnvironment();

    // Fail-CLOSED (auditoría de seguridad 2026-08-02). Antes, la ausencia de
    // API keys deshabilitaba silenciosamente TODA la autenticación: un typo en
    // el nombre de la variable, un secreto no montado en el contenedor o un
    // despliegue sin `.env` dejaban la API completamente abierta sin más
    // señal que una línea de log. Ese es exactamente el modo de fallo que un
    // atacante busca provocar. Ahora deshabilitarla exige una decisión
    // explícita del operador vía BEEMETRY_API_AUTH_OPTIONAL=true; sin esa
    // opción y sin keys, el objeto queda habilitado y rechaza todo, que es el
    // fallo ruidoso y seguro.
    if (!valid_keys_.empty()) {
        std::cout << "[SECURITY] API authentication enabled with "
                  << valid_keys_.size() << " key(s)." << std::endl;
        return;
    }

    if (envFlagEnabled("BEEMETRY_API_AUTH_OPTIONAL")) {
        std::cout << "[SECURITY] WARN: sin API keys y BEEMETRY_API_AUTH_OPTIONAL=true "
                     "-> autenticacion por API key DESHABILITADA (solo desarrollo). "
                     "NUNCA usar este flag en produccion."
                  << std::endl;
        enabled_ = false;
        return;
    }

    std::cerr << "[SECURITY] ERROR: no se configuraron API keys "
                 "(BEEMETRY_API_KEYS / BEEMETRY_MINING_API_KEYS). La "
                 "autenticacion queda ACTIVA y rechazara todas las peticiones. "
                 "Defina las keys, o BEEMETRY_API_AUTH_OPTIONAL=true si esto es "
                 "un entorno de desarrollo."
              << std::endl;
    enabled_ = true;
}

void ApiKeyAuth::loadFromEnvironment() {
    const char* env_keys = std::getenv("BEEMETRY_API_KEYS");
    if (!env_keys) {
        env_keys = std::getenv("BEEMETRY_MINING_API_KEYS");
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
    // Recorrido completo con comparación en tiempo constante: no se corta al
    // primer acierto ni se usa el hash del set, para no filtrar por
    // temporización cuántos bytes del prefijo eran correctos.
    bool matched = false;
    for (const auto& candidate : valid_keys_) {
        matched |= constantTimeEquals(candidate, key);
    }
    return matched;
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

    // El parámetro de query ?api_key=<key> fue ELIMINADO (auditoría de
    // seguridad 2026-08-02): la query string se escribe en el access log de
    // nginx, en el historial del navegador y en el header `Referer` que se
    // envía a terceros, así que el secreto quedaba registrado en claro en al
    // menos tres sitios fuera del control de la aplicación. Ningún cliente del
    // repo lo usaba (verificado en frontend/ y backend/). Usar el header
    // Authorization: Bearer <key> o X-API-Key.
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