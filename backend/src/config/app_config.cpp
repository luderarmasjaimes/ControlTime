#include "app_config.hpp"

#include <openssl/rand.h>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <iostream>
#include <iomanip>
#include <sstream>
#include <stdexcept>
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
    unsigned char bytes[32];
    if (RAND_bytes(bytes, sizeof(bytes)) != 1) {
        throw std::runtime_error("OpenSSL CSPRNG unavailable for JWT secret");
    }
    std::ostringstream oss;
    oss << std::hex << std::setfill('0');
    for (const auto value : bytes) {
        oss << std::setw(2) << static_cast<unsigned int>(value);
    }
    return oss.str();
}

static std::string toLowerCopy(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return value;
}

/** @brief Separa una lista por comas, recortando espacios y descartando
 * elementos vacios (p.ej. "soporte, ,comercial" -> ["soporte","comercial"]). */
static std::vector<std::string> splitCommaList(const std::string &value) {
    std::vector<std::string> out;
    std::string current;
    auto flush = [&]() {
        const auto a = current.find_first_not_of(" \t");
        const auto b = current.find_last_not_of(" \t");
        if (a != std::string::npos) out.push_back(current.substr(a, b - a + 1));
        current.clear();
    };
    for (const char c : value) {
        if (c == ',') { flush(); } else { current += c; }
    }
    flush();
    return out;
}

/** @brief Convierte un id de linea ("soporte") a la forma que usan las
 * variables de entorno ("SOPORTE") -- mayusculas, no-alfanumericos a '_'. */
static std::string toEnvKey(const std::string &lineId) {
    std::string out;
    out.reserve(lineId.size());
    for (const char c : lineId) {
        out += std::isalnum(static_cast<unsigned char>(c))
                   ? static_cast<char>(std::toupper(static_cast<unsigned char>(c)))
                   : '_';
    }
    return out;
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
    // ADR-077: las credenciales nuevas usan Argon2id con salt aleatorio por
    // contraseña. Esta variable solo conserva compatibilidad con el esquema
    // legado durante el rehash oportunista al siguiente login correcto.
    if (getenvOr("BEEMETRY_AUTH_LEGACY_PASSWORD_SALT", "").empty() &&
        getenvOr("BEEMETRY_AUTH_PASSWORD_SALT", "").empty()) {
        std::cerr << "[AUTH_PASSWORD] AVISO MIGRACION: no se definio "
                     "BEEMETRY_AUTH_LEGACY_PASSWORD_SALT; el verificador legado "
                     "usara el valor historico. Las credenciales nuevas ya usan "
                     "Argon2id y las antiguas se actualizan al iniciar sesion."
                  << std::endl;
    }
    try {
        // Vuelve de 60 a 15 min (migración a Bearer-en-memoria): el TTL se
        // había subido a 60 el 2026-08-19 porque el refresh silencioso ya era
        // transparente y 15 min "sentía" la sesión frágil -- razonamiento
        // válido mientras el access token vivía SOLO en una cookie HttpOnly
        // (invisible a JS). Con el cambio a Bearer en memoria (necesario para
        // que la plataforma conviva sin pisarse con otros frontends en el
        // mismo host), un XSS que capture el token de memoria lo tendría
        // usable por 60 min en vez de 15 -- la ventana de exposición importa
        // más que la frecuencia de renovación, que sigue siendo transparente
        // para el usuario (refresh proactivo + reintento en 401).
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
    try {
        // Techo de 480 min (8h): generoso para incluso un export de miles de
        // páginas, sin dejar el token "vivo para siempre" si algo se cuelga.
        gJwtExportTtlMinutes = std::clamp(
            std::stoi(getenvOr("BEEMETRY_JWT_EXPORT_TTL_MINUTES", "120")), 15, 480);
    } catch (...) {
        gJwtExportTtlMinutes = 120;
    }
    gAuthCookieSecure =
        toLowerCopy(getenvOr("BEEMETRY_AUTH_COOKIE_SECURE", "true")) == "true";

    const auto provider = toLowerCopy(getenvOr("BEEMETRY_BIOMETRIC_PROVIDER", "legacy"));
    if (provider == "dermalog_cli") {
        gBiometricProvider = BiometricProvider::DermalogCli;
    } else if (provider == "seetaface6" || provider == "seetaface6_local") {
        gBiometricProvider = BiometricProvider::SeetaFace6;
    } else if (provider == "deepface_silentface" || provider == "deepface") {
        gBiometricProvider = BiometricProvider::DeepFaceSilent;
    } else {
        gBiometricProvider = BiometricProvider::Legacy;
    }
    gDermalogCliPath = getenvOr("BEEMETRY_DERMALOG_CLI_PATH", "");
    gDermalogRequired =
        toLowerCopy(getenvOr("BEEMETRY_DERMALOG_REQUIRED", "false")) == "true";
    gSeetaFace6Required =
        toLowerCopy(getenvOr("BEEMETRY_SEETAFACE6_REQUIRED", "true")) == "true";
    try {
        gSeetaFace6TimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_SEETAFACE6_TIMEOUT_MS", "20000")), 1000,
            120000);
    } catch (...) {
        gSeetaFace6TimeoutMs = 20000;
    }
    gDeepFaceSilentRequired = toLowerCopy(getenvOr(
        "BEEMETRY_DEEPFACE_SILENTFACE_REQUIRED", "true")) == "true";
    gDeepFaceSilentDermalogFallback = toLowerCopy(getenvOr(
        "BEEMETRY_DEEPFACE_SILENTFACE_DERMALOG_FALLBACK", "false")) == "true";
    try {
        gDeepFaceSilentTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_DEEPFACE_SILENTFACE_TIMEOUT_MS", "25000")),
            1000, 120000);
    } catch (...) {
        gDeepFaceSilentTimeoutMs = 25000;
    }
    try {
        gFaceDeepfaceCosineThreshold = std::clamp(
            std::stod(getenvOr("BEEMETRY_FACE_DEEPFACE_COSINE_THRESHOLD", "0.70")),
            0.20, 0.99);
    } catch (...) {
        gFaceDeepfaceCosineThreshold = 0.70;
    }
    try {
        gSilentFaceLivenessThreshold = std::clamp(
            std::stod(getenvOr("BEEMETRY_SILENTFACE_LIVENESS_THRESHOLD", "0.60")),
            0.10, 0.99);
    } catch (...) {
        gSilentFaceLivenessThreshold = 0.60;
    }
    gBiometricDnnModelPath = getenvOr("BEEMETRY_BIOMETRIC_DNN_MODEL", "");
    gBiometricDnnLabelsCsv = getenvOr(
        "BEEMETRY_BIOMETRIC_DNN_LABELS",
        "glasses,hat,mask,makeup,eyes_closed,mouth_open,non_frontal");
    gBiometricDnnEnabled =
        toLowerCopy(getenvOr("BEEMETRY_BIOMETRIC_DNN_ENABLE", "false")) == "true";
    gPdfExportUrl = getenvOr("BEEMETRY_PDF_EXPORT_URL", "");
    gFrontendInternalOrigin = getenvOr("BEEMETRY_FRONTEND_INTERNAL_ORIGIN", "http://frontend");
    try {
        // Clamp máximo antes 120000 (2 min) -- el sidecar espera CADA
        // widget/gráfico individual (`data-export-ready`) antes de capturar,
        // así que un informe de cientos de páginas con más de mil gráficos de
        // sensor en vivo (prueba exhaustiva 56 sensores × 20 tipos de
        // gráfico) tarda varios minutos reales en terminar de renderizar --
        // con el clamp viejo, incluso subiendo la env var, el backend se
        // rendía esperando al sidecar mucho antes de que este terminara
        // (reproducido en vivo: 502 con un informe de 378 páginas). 900000
        // (15 min) iguala el techo ya usado para video export.
        gPdfExportTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_PDF_EXPORT_TIMEOUT_MS", "45000")), 1000, 900000);
    } catch (...) {
        gPdfExportTimeoutMs = 45000;
    }
    gExportDataRoot = getenvOr("BEEMETRY_EXPORT_DATA_ROOT", "");
    try {
        gPptxExportTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_PPTX_EXPORT_TIMEOUT_MS", "60000")), 1000, 900000);
    } catch (...) {
        gPptxExportTimeoutMs = 60000;
    }
    try {
        gVideoExportTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_VIDEO_EXPORT_TIMEOUT_MS", "180000")), 1000, 900000);
    } catch (...) {
        gVideoExportTimeoutMs = 180000;
    }
    try {
        // Mismo motivo que gPdfExportTimeoutMs arriba (clamp antes 300000).
        gDocxExportTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_DOCX_EXPORT_TIMEOUT_MS", "60000")), 1000, 900000);
    } catch (...) {
        gDocxExportTimeoutMs = 60000;
    }
    gTaxRegistryEnabled =
        toLowerCopy(getenvOr("BEEMETRY_TAX_REGISTRY_ENABLED", "false")) == "true";
    gTaxRegistryHost = getenvOr("BEEMETRY_TAX_REGISTRY_HOST", "");
    gTaxRegistryPathTemplate = getenvOr("BEEMETRY_TAX_REGISTRY_PATH_TEMPLATE", "");
    gTaxRegistryToken = getenvOr("BEEMETRY_TAX_REGISTRY_TOKEN", "");
    try {
        gTaxRegistryTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_TAX_REGISTRY_TIMEOUT_MS", "2500")), 500, 10000);
    } catch (...) {
        gTaxRegistryTimeoutMs = 2500;
    }

    gIgpApiBaseUrl = getenvOr("BEEMETRY_IGP_API_BASE_URL", "https://ultimosismo.igp.gob.pe");
    try {
        gIgpTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_IGP_TIMEOUT_MS", "4000")), 500, 15000);
    } catch (...) {
        gIgpTimeoutMs = 4000;
    }

    gWhatsappApiBaseUrl = getenvOr("BEEMETRY_WHATSAPP_API_BASE_URL", "graph.facebook.com");
    gWhatsappApiVersion = getenvOr("BEEMETRY_WHATSAPP_API_VERSION", "v22.0");
    gWhatsappPhoneNumberId = getenvOr("BEEMETRY_WHATSAPP_PHONE_NUMBER_ID", "");
    gWhatsappAccessToken = getenvOr("BEEMETRY_WHATSAPP_ACCESS_TOKEN", "");
    gWhatsappBusinessAccountId = getenvOr("BEEMETRY_WHATSAPP_BUSINESS_ACCOUNT_ID", "");
    gWhatsappSupportToE164 = getenvOr("BEEMETRY_WHATSAPP_SUPPORT_TO_E164", "");
    gWhatsappComercialToE164 = getenvOr("BEEMETRY_WHATSAPP_COMERCIAL_TO_E164", "");
    gWhatsappRrhhToE164 = getenvOr("BEEMETRY_WHATSAPP_RRHH_TO_E164", "");
    gWhatsappTemplateName = getenvOr("BEEMETRY_WHATSAPP_TEMPLATE_NAME", "hello_world");
    gWhatsappTemplateLang = getenvOr("BEEMETRY_WHATSAPP_TEMPLATE_LANG", "en_US");
    try {
        gWhatsappTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_WHATSAPP_TIMEOUT_MS", "8000")), 1000, 30000);
    } catch (...) {
        gWhatsappTimeoutMs = 8000;
    }
    gWhatsappWebhookVerifyToken = getenvOr("BEEMETRY_WHATSAPP_WEBHOOK_VERIFY_TOKEN", "");
    gWhatsappAppSecret = getenvOr("BEEMETRY_WHATSAPP_APP_SECRET", "");

    // Multi-linea (ADR-113): la linea "default" se arma con las variables de
    // arriba (compatibilidad con el despliegue de una sola linea de
    // ADR-112); lineas adicionales se declaran por id en BEEMETRY_WHATSAPP_EXTRA_LINES.
    gWhatsappLines.clear();
    if (!gWhatsappPhoneNumberId.empty() && !gWhatsappAccessToken.empty()) {
        gWhatsappLines.push_back(
            WhatsappLine{"default", gWhatsappPhoneNumberId, gWhatsappAccessToken, "General"});
    }
    for (const auto &lineId : splitCommaList(getenvOr("BEEMETRY_WHATSAPP_EXTRA_LINES", ""))) {
        const std::string envKey = toEnvKey(lineId);
        WhatsappLine line;
        line.id = lineId;
        line.phoneNumberId =
            getenvOr(("BEEMETRY_WHATSAPP_LINE_" + envKey + "_PHONE_NUMBER_ID").c_str(), "");
        line.accessToken =
            getenvOr(("BEEMETRY_WHATSAPP_LINE_" + envKey + "_ACCESS_TOKEN").c_str(), "");
        line.label = getenvOr(("BEEMETRY_WHATSAPP_LINE_" + envKey + "_LABEL").c_str(), lineId);
        if (line.phoneNumberId.empty() || line.accessToken.empty()) {
            std::cerr << "[WHATSAPP] linea '" << lineId
                      << "' listada en BEEMETRY_WHATSAPP_EXTRA_LINES pero le falta "
                         "PHONE_NUMBER_ID o ACCESS_TOKEN -- se omite."
                      << std::endl;
            continue;
        }
        gWhatsappLines.push_back(std::move(line));
    }
    gWhatsappAdminPhones = splitCommaList(getenvOr("BEEMETRY_WHATSAPP_ADMIN_TO_E164", ""));

    if (gWhatsappAccessToken.empty()) {
        std::cerr << "[WHATSAPP] BEEMETRY_WHATSAPP_ACCESS_TOKEN vacio -- el escalamiento a "
                     "soporte humano por WhatsApp respondera whatsapp_not_configured."
                  << std::endl;
    }
    if (gWhatsappWebhookVerifyToken.empty() || gWhatsappAppSecret.empty()) {
        std::cerr << "[WHATSAPP] webhook de entrada deshabilitado (falta "
                     "BEEMETRY_WHATSAPP_WEBHOOK_VERIFY_TOKEN y/o BEEMETRY_WHATSAPP_APP_SECRET)."
                  << std::endl;
    }
    gOllamaChatbotModel = getenvOr("BEEMETRY_OLLAMA_CHATBOT_MODEL", "gemma2:2b");
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
        gAiEngineCvExtractTimeoutMs = std::clamp(
            std::stoi(getenvOr("BEEMETRY_AI_ENGINE_CV_EXTRACT_TIMEOUT_MS", "30000")), 2000,
            120000);
    } catch (...) {
        gAiEngineCvExtractTimeoutMs = 30000;
    }
    try {
        gWhatsappCvMaxBytes = static_cast<std::size_t>(std::clamp(
            std::stoll(getenvOr("BEEMETRY_WHATSAPP_CV_MAX_BYTES", "10485760")), 100000LL,
            26214400LL));
    } catch (...) {
        gWhatsappCvMaxBytes = 10 * 1024 * 1024;
    }
    gHrCvEmailTo = getenvOr("BEEMETRY_HR_CV_EMAIL_TO", "");
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
        gFaceSeetaCosineThreshold = std::clamp(
            std::stod(getenvOr("BEEMETRY_FACE_SEETAFACE6_COSINE_THRESHOLD", "0.80")),
            0.40, 0.99);
    } catch (...) {
        gFaceSeetaCosineThreshold = 0.80;
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

const WhatsappLine *AppConfig::whatsappLineByPhoneNumberId(const std::string &phoneNumberId) const {
    for (const auto &line : gWhatsappLines) {
        if (line.phoneNumberId == phoneNumberId) return &line;
    }
    return nullptr;
}

const WhatsappLine *AppConfig::whatsappLineById(const std::string &lineId) const {
    for (const auto &line : gWhatsappLines) {
        if (line.id == lineId) return &line;
    }
    return nullptr;
}

const WhatsappLine *AppConfig::defaultWhatsappLine() const {
    return gWhatsappLines.empty() ? nullptr : &gWhatsappLines.front();
}

bool AppConfig::isWhatsappAdminPhone(const std::string &phoneE164) const {
    return std::find(gWhatsappAdminPhones.begin(), gWhatsappAdminPhones.end(), phoneE164) !=
           gWhatsappAdminPhones.end();
}

} // namespace config
