#ifndef API_AUTH_HPP
#define API_AUTH_HPP

#include <boost/beast/http.hpp>
#include <string>
#include <vector>
#include <unordered_set>
#include <mutex>
#include <shared_mutex>

namespace security {

class ApiKeyAuth {
private:
    mutable std::shared_mutex keys_mutex_;
    std::unordered_set<std::string> valid_keys_;
    bool enabled_;
    
    // Helper para extraer API Key de headers o query parameters
    std::string extractApiKey(const boost::beast::http::request<boost::beast::http::string_body>& req) const;
    
public:
    ApiKeyAuth();
    ~ApiKeyAuth() = default;
    
    // Cargar API Keys desde variables de entorno
    void loadFromEnvironment();
    
    // Agregar API Key válida
    void addApiKey(const std::string& key);
    
    // Validar API Key
    bool validateApiKey(const std::string& key) const;
    
    // Validar solicitud HTTP completa
    bool validateRequest(const boost::beast::http::request<boost::beast::http::string_body>& req, 
                        std::string& error_message) const;
    
    // Verificar si la autenticación está habilitada
    bool isEnabled() const { return enabled_; }
    
    // Deshabilitar autenticación (modo desarrollo)
    void disable() { enabled_ = false; }
};

// Función helper global para autenticación rápida
bool authenticateRequest(const boost::beast::http::request<boost::beast::http::string_body>& req,
                        boost::beast::http::response<boost::beast::http::string_body>& res);

} // namespace security

#endif