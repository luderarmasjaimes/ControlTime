#include "app_config.hpp"

#include <algorithm>
#include <cstdlib>
#include <iostream>
#include <random>
#include <sstream>
#include <string>

// Detección de libpq para decidir el modo de almacenamiento.
// Debe coincidir con auth_storage_pg.hpp; sin esto, app_config no "ve" libpq
// y el backend cae a modo File aunque DATABASE_URL esté definida.
#if !defined(HAS_LIBPQ)
#  if __has_include(<libpq-fe.h>) || __has_include(<postgresql/libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

namespace config {

std::string getenvOr(const char *key, const std::string &fallback) {
    const char *value = std::getenv(key);
    if (!value)
        return fallback;
    return value;
}

/** @brief Clave aleatoria de 256 bits (hex) — solo como último recurso si JWT_SECRET no está fijado. */
static std::string makeEphemeralSecret() {
    std::random_device rd;
    std::mt19937_64 rng(rd());
    std::uniform_int_distribution<unsigned long long> dist;
    std::ostringstream oss;
    oss << std::hex << dist(rng) << dist(rng) << dist(rng) << dist(rng);
    return oss.str();
}

static std::string toLowerCopy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return value;
}

AppConfig& AppConfig::instance() {
    static AppConfig cfg;
    return cfg;
}

void AppConfig::loadFromEnv() {
    gDatabaseUrl = getenvOr("BEEMETRY_DATABASE_URL", "");
    // Réplica read-only: si no se define, readUrl() usará el primario.
    gReplicaDatabaseUrl = getenvOr("BEEMETRY_REPLICA_DATABASE_URL", "");
    gKpiExternalDatabaseUrl = getenvOr("BEEMETRY_KPI_EXTERNAL_DATABASE_URL", "");
    gKpiExternalQuery = getenvOr("BEEMETRY_KPI_EXTERNAL_QUERY", "");
    gSessionTtlMinutes =
        std::max(15, std::stoi(getenvOr("BEEMETRY_AUTH_SESSION_TTL_MINUTES", "480")));

    gJwtSecret = getenvOr("BEEMETRY_JWT_SECRET", "");
    if (gJwtSecret.empty()) {
        gJwtSecret = makeEphemeralSecret();
        std::cerr << "[AUTH_JWT] ADVERTENCIA: JWT_SECRET no definido; usando "
                     "clave efimera de proceso (las sesiones no sobreviven un "
                     "reinicio/reescalado). Fije JWT_SECRET en produccion."
                  << std::endl;
    }
    // Auditoría de seguridad 2026-07-13: BEEMETRY_AUTH_PASSWORD_SALT no está
    // definido en este entorno — hashPassword() (http_utils.cpp) cae a un
    // literal hardcodeado. A diferencia de JWT_SECRET, NO se puede generar
    // una clave efímera aquí como mitigación: los hashes de contraseña ya
    // persistidos en la base de datos real fueron calculados con ese mismo
    // literal — cambiar el valor (efímero o no) invalidaría de golpe el
    // login de TODOS los usuarios existentes. Se deja como advertencia
    // visible en logs de arranque; corregirlo de raíz requiere fijar la
    // variable Y coordinar un reset/rehash de contraseñas existentes en una
    // ventana de mantenimiento — no algo para resolver solo, silenciosamente.
    if (getenvOr("BEEMETRY_AUTH_PASSWORD_SALT", "").empty()) {
        std::cerr << "[AUTH_PASSWORD] ADVERTENCIA: BEEMETRY_AUTH_PASSWORD_SALT "
                     "no definido; usando salt hardcodeado de desarrollo. Fijar "
                     "esta variable en produccion requiere ademas re-hashear o "
                     "forzar reset de las contrasenas existentes (cambiar solo "
                     "la variable invalida todos los logins actuales)."
                  << std::endl;
    }
    try {
        gJwtAccessTtlMinutes = std::clamp(
            std::stoi(getenvOr("BEEMETRY_JWT_ACCESS_TTL_MINUTES", "15")), 1, 120);
    } catch (...) {
        gJwtAccessTtlMinutes = 15;
    }
    try {
        gJwtRefreshTtlDays = std::clamp(
            std::stoi(getenvOr("BEEMETRY_JWT_REFRESH_TTL_DAYS", "7")), 1, 90);
    } catch (...) {
        gJwtRefreshTtlDays = 7;
    }
    gAuthCookieSecure =
        toLowerCopy(getenvOr("BEEMETRY_AUTH_COOKIE_SECURE", "true")) == "true";

    const auto provider = toLowerCopy(getenvOr("BEEMETRY_BIOMETRIC_PROVIDER", "legacy"));
    gBiometricProvider =
        provider == "dermalog_cli" ? BiometricProvider::DermalogCli
                                   : BiometricProvider::Legacy;
    gDermalogCliPath = getenvOr("BEEMETRY_DERMALOG_CLI_PATH", "");
    gDermalogRequired =
        toLowerCopy(getenvOr("BEEMETRY_DERMALOG_REQUIRED", "false")) == "true";
    gBiometricDnnModelPath = getenvOr("BEEMETRY_BIOMETRIC_DNN_MODEL", "");
    gBiometricDnnLabelsCsv = getenvOr(
        "BEEMETRY_BIOMETRIC_DNN_LABELS",
        "glasses,hat,mask,makeup,eyes_closed,mouth_open,non_frontal");
    gBiometricDnnEnabled =
        toLowerCopy(getenvOr("BEEMETRY_BIOMETRIC_DNN_ENABLE", "false")) == "true";
    gPdfExportUrl = getenvOr("BEEMETRY_PDF_EXPORT_URL", "");
    gFrontendInternalOrigin = getenvOr("BEEMETRY_FRONTEND_INTERNAL_ORIGIN", "http://frontend");
    try {
        gPdfExportTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_PDF_EXPORT_TIMEOUT_MS", "45000")), 1000, 120000);
    } catch (...) {
        gPdfExportTimeoutMs = 45000;
    }
    gAiEngineUrl = getenvOr("BEEMETRY_AI_ENGINE_URL", "");
    gCartoonOnnxModelPath = getenvOr("BEEMETRY_CARTOON_ONNX_MODEL", "");
    try {
        gAiEngineTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_AI_ENGINE_TIMEOUT_MS", "500")), 50, 5000);
    } catch (...) {
        gAiEngineTimeoutMs = 500;
    }
    try {
        gAiEngineCartoonTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_AI_ENGINE_CARTOON_TIMEOUT_MS", "8000")), 500,
            600000);
    } catch (...) {
        gAiEngineCartoonTimeoutMs = 8000;
    }
    try {
        gAiEngineMaxImageBytes = static_cast<std::size_t>(std::clamp(
            std::stoi(getenvOr("BEEMETRY_AI_ENGINE_MAX_IMAGE_BYTES", "450000")), 100000,
            6000000));
    } catch (...) {
        gAiEngineMaxImageBytes = 450000;
    }
    try {
        gFaceEmbeddingCosineThreshold = std::clamp(
            std::stod(getenvOr("BEEMETRY_FACE_EMBEDDING_COSINE_THRESHOLD", "0.45")), 0.20,
            0.99);
    } catch (...) {
        gFaceEmbeddingCosineThreshold = 0.45;
    }
    try {
        gFaceLegacyCosineThreshold = std::clamp(
            std::stod(getenvOr("BEEMETRY_FACE_LEGACY_COSINE_THRESHOLD", "0.82")), 0.55,
            0.99);
    } catch (...) {
        gFaceLegacyCosineThreshold = 0.82;
    }
    try {
        gBiometricIcaoEyeConfidenceMin = static_cast<float>(std::clamp(
            std::stod(getenvOr("BEEMETRY_BIOMETRIC_ICAO_EYE_CONFIDENCE_MIN", "70")), 50.0,
            100.0));
    } catch (...) {
        gBiometricIcaoEyeConfidenceMin = 70.0f;
    }
    try {
        gBiometricIcaoIlluminationMin = static_cast<float>(std::clamp(
            std::stod(getenvOr("BEEMETRY_BIOMETRIC_ICAO_ILLUMINATION_MIN", "40")), 5.0,
            80.0));
    } catch (...) {
        gBiometricIcaoIlluminationMin = 40.0f;
    }
    gImageOptimizerEnabled =
        toLowerCopy(getenvOr("BEEMETRY_BIOMETRIC_IMAGE_OPTIMIZER_ENABLE", "false")) ==
        "true";
    try {
        gBiometricMaxPixels = std::clamp(
            std::stoi(getenvOr("BEEMETRY_BIOMETRIC_MAX_PIXELS", "921600")), 120000,
            3000000);
    } catch (...) {
        gBiometricMaxPixels = 921600;
    }
    try {
        gBiometricDnnThreshold = std::clamp(
            std::stof(getenvOr("BEEMETRY_BIOMETRIC_DNN_THRESHOLD", "0.72")), 0.3f,
            0.95f);
    } catch (...) {
        gBiometricDnnThreshold = 0.72f;
    }

    if (!gDatabaseUrl.empty()) {
#if HAS_LIBPQ
        gAuthStorageMode = AuthStorageMode::Postgres;
#else
        gAuthStorageMode = AuthStorageMode::File;
#endif
    } else {
        gAuthStorageMode = AuthStorageMode::File;
    }
}

} // namespace config
