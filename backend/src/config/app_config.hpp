#pragma once

#include <atomic>
#include <mutex>
#include <string>
#include <vector>

namespace config {

enum class AuthStorageMode { Postgres, File };
enum class BiometricProvider { Legacy, DermalogCli };

const std::vector<std::string> kMiningCompanies = {
    "Activos Mineros",
    "Alpayana",
    "Anglo American Quellaveco",
    "Ares",
    "Bear Creek Mining",
    "Buenaventura",
    "Catalina Huanca",
    "Chinalco Peru",
    "Compania Minera Antamina",
    "Compania Minera Ares",
    "Compania Minera Poderosa",
    "Compania Minera Raura",
    "Compania Minera San Ignacio de Morococha",
    "Compania Minera Volcan",
    "Consorcio Minero Horizonte",
    "DOE Run Peru",
    "Dynacor",
    "El Brocal",
    "Gold Fields La Cima",
    "Hochschild Mining Peru",
    "Hudbay Peru",
    "Jinzhao Mining Peru",
    "Las Bambas",
    "Marcobre",
    "Minsur",
    "Minera Antamina",
    "Minera Antapaccay",
    "Minera Bateas",
    "Minera Boroo Misquichilca",
    "Minera Caraveli",
    "Minera Cerro Verde",
    "Minera Condestable",
    "Minera Corona",
    "Minera IRL",
    "Minera Los Quenuales",
    "Minera Poderosa",
    "Minera Raura",
    "Nexa Resources Peru",
    "Pan American Silver Peru",
    "Sierra Metals Yauricocha",
    "Shougang Hierro Peru",
    "Sociedad Minera El Brocal",
    "Southern Peru Copper Corporation",
    "Summa Gold",
    "Yanacocha"};

struct AppConfig {
    static constexpr char kMiningTelemetryDemoTenantId[] =
        "a0000001-0000-4000-8000-000000000001";
    static constexpr char kAuthUserNotFoundMsg[] = "USUARIO NO EXISTE";
    static constexpr char kAuthWrongPasswordMsg[] =
        "La contraseña no es correcta.";
    static constexpr char kAuthAmbiguousIdentityMsg[] =
        "El identificador coincide con más de un registro en esa empresa. Use un "
        "dato único (por ejemplo el DNI) e intente de nuevo.";

    AuthStorageMode gAuthStorageMode = AuthStorageMode::File;
    std::string gDatabaseUrl;
    std::string gKpiExternalDatabaseUrl;
    std::string gKpiExternalQuery;
    BiometricProvider gBiometricProvider = BiometricProvider::Legacy;
    std::string gDermalogCliPath;
    bool gDermalogRequired = false;
    bool gBiometricDnnEnabled = false;
    std::string gBiometricDnnModelPath;
    std::string gBiometricDnnLabelsCsv;
    float gBiometricDnnThreshold = 0.72f;
    std::string gAiEngineUrl;
    int gAiEngineTimeoutMs = 500;
    int gAiEngineCartoonTimeoutMs = 8000;
    std::size_t gAiEngineMaxImageBytes = 450000;
    std::string gCartoonOnnxModelPath;
    static constexpr std::size_t kFaceEmbeddingVectorDim = 512;
    double gFaceEmbeddingCosineThreshold = 0.45;
    double gFaceLegacyCosineThreshold = 0.82;
    float gBiometricIcaoEyeConfidenceMin = 70.0f;
    float gBiometricIcaoIlluminationMin = 40.0f;
    bool gImageOptimizerEnabled = false;
    int gBiometricMaxPixels = 1280 * 720;
    int gSessionTtlMinutes = 480;
    std::atomic<bool> gAuthSchemaReady{false};
    std::mutex gAuthSchemaInitMutex;
    std::atomic<bool> gFormulaSchemaReady{false};
    std::mutex gFormulaSchemaInitMutex;

    static AppConfig& instance();

    void loadFromEnv();
};

std::string getenvOr(const char *key, const std::string &fallback);

inline AppConfig &cfg() { return AppConfig::instance(); }

} // namespace config
