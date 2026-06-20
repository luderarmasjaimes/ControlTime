#include "app_config.hpp"

#include <algorithm>
#include <cstdlib>
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
    gDatabaseUrl = getenvOr("DATABASE_URL", "");
    gKpiExternalDatabaseUrl = getenvOr("KPI_EXTERNAL_DATABASE_URL", "");
    gKpiExternalQuery = getenvOr("KPI_EXTERNAL_QUERY", "");
    gSessionTtlMinutes =
        std::max(15, std::stoi(getenvOr("AUTH_SESSION_TTL_MINUTES", "480")));

    const auto provider = toLowerCopy(getenvOr("BIOMETRIC_PROVIDER", "legacy"));
    gBiometricProvider =
        provider == "dermalog_cli" ? BiometricProvider::DermalogCli
                                   : BiometricProvider::Legacy;
    gDermalogCliPath = getenvOr("DERMALOG_CLI_PATH", "");
    gDermalogRequired =
        toLowerCopy(getenvOr("DERMALOG_REQUIRED", "false")) == "true";
    gBiometricDnnModelPath = getenvOr("BIOMETRIC_DNN_MODEL", "");
    gBiometricDnnLabelsCsv = getenvOr(
        "BIOMETRIC_DNN_LABELS",
        "glasses,hat,mask,makeup,eyes_closed,mouth_open,non_frontal");
    gBiometricDnnEnabled =
        toLowerCopy(getenvOr("BIOMETRIC_DNN_ENABLE", "false")) == "true";
    gAiEngineUrl = getenvOr("AI_ENGINE_URL", "");
    gCartoonOnnxModelPath = getenvOr("CARTOON_ONNX_MODEL", "");
    try {
        gAiEngineTimeoutMs = std::clamp(
            std::stoi(getenvOr("AI_ENGINE_TIMEOUT_MS", "500")), 50, 5000);
    } catch (...) {
        gAiEngineTimeoutMs = 500;
    }
    try {
        gAiEngineCartoonTimeoutMs = std::clamp(
            std::stoi(getenvOr("AI_ENGINE_CARTOON_TIMEOUT_MS", "8000")), 500,
            600000);
    } catch (...) {
        gAiEngineCartoonTimeoutMs = 8000;
    }
    try {
        gAiEngineMaxImageBytes = static_cast<std::size_t>(std::clamp(
            std::stoi(getenvOr("AI_ENGINE_MAX_IMAGE_BYTES", "450000")), 100000,
            6000000));
    } catch (...) {
        gAiEngineMaxImageBytes = 450000;
    }
    try {
        gFaceEmbeddingCosineThreshold = std::clamp(
            std::stod(getenvOr("FACE_EMBEDDING_COSINE_THRESHOLD", "0.45")), 0.20,
            0.99);
    } catch (...) {
        gFaceEmbeddingCosineThreshold = 0.45;
    }
    try {
        gFaceLegacyCosineThreshold = std::clamp(
            std::stod(getenvOr("FACE_LEGACY_COSINE_THRESHOLD", "0.82")), 0.55,
            0.99);
    } catch (...) {
        gFaceLegacyCosineThreshold = 0.82;
    }
    try {
        gBiometricIcaoEyeConfidenceMin = static_cast<float>(std::clamp(
            std::stod(getenvOr("BIOMETRIC_ICAO_EYE_CONFIDENCE_MIN", "70")), 50.0,
            100.0));
    } catch (...) {
        gBiometricIcaoEyeConfidenceMin = 70.0f;
    }
    try {
        gBiometricIcaoIlluminationMin = static_cast<float>(std::clamp(
            std::stod(getenvOr("BIOMETRIC_ICAO_ILLUMINATION_MIN", "40")), 5.0,
            80.0));
    } catch (...) {
        gBiometricIcaoIlluminationMin = 40.0f;
    }
    gImageOptimizerEnabled =
        toLowerCopy(getenvOr("BIOMETRIC_IMAGE_OPTIMIZER_ENABLE", "false")) ==
        "true";
    try {
        gBiometricMaxPixels = std::clamp(
            std::stoi(getenvOr("BIOMETRIC_MAX_PIXELS", "921600")), 120000,
            3000000);
    } catch (...) {
        gBiometricMaxPixels = 921600;
    }
    try {
        gBiometricDnnThreshold = std::clamp(
            std::stof(getenvOr("BIOMETRIC_DNN_THRESHOLD", "0.72")), 0.3f,
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
