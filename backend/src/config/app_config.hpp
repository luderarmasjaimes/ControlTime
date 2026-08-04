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
    // Réplica read-only (streaming standby) para lecturas de dashboards/KPIs.
    // Si REPLICA_DATABASE_URL no se define, cae al primario (gDatabaseUrl).
    std::string gReplicaDatabaseUrl;
    /// URL para lecturas de solo-lectura (dashboards/KPIs): réplica si existe.
    const std::string &readUrl() const {
        return gReplicaDatabaseUrl.empty() ? gDatabaseUrl : gReplicaDatabaseUrl;
    }
    std::string gKpiExternalDatabaseUrl;
    std::string gKpiExternalQuery;
    BiometricProvider gBiometricProvider = BiometricProvider::Legacy;
    std::string gDermalogCliPath;
    bool gDermalogRequired = false;
    bool gBiometricDnnEnabled = false;
    std::string gBiometricDnnModelPath;
    std::string gBiometricDnnLabelsCsv;
    float gBiometricDnnThreshold = 0.72f;
    // ADR-016: sidecar de export PDF (Chromium headless). Vacío = deshabilitado.
    std::string gPdfExportUrl;
    int gPdfExportTimeoutMs = 45000;
    std::string gFrontendInternalOrigin;
    // Export PPTX/MP4 (modo presentación, sobre el mismo sidecar Chromium que
    // PDF): directorio compartido backend<->sidecar donde caen los archivos
    // generados (report_export_job.storage_uri apunta dentro de esta raíz).
    // Vacío = deshabilitado (las rutas /export/pptx devuelven 503).
    std::string gExportDataRoot;
    int gPptxExportTimeoutMs = 60000;
    int gVideoExportTimeoutMs = 180000;
    // IGP/CENSIS (Instituto Geofisico del Peru) -- fuente oficial de
    // sismicidad, API HTTPS publica sin autenticacion (ver igp_seismic_client.hpp).
    std::string gIgpApiBaseUrl = "https://ultimosismo.igp.gob.pe";
    int gIgpTimeoutMs = 4000;
    // WhatsApp Business Cloud API (Meta) -- chatbot minero / escalamiento a
    // soporte humano (ver support/whatsapp_client.hpp). Las credenciales
    // reales viven SOLO en .env (nunca hardcodeadas aqui ni en el repo).
    std::string gWhatsappApiBaseUrl = "graph.facebook.com";
    std::string gWhatsappApiVersion = "v22.0";
    std::string gWhatsappPhoneNumberId;
    std::string gWhatsappAccessToken;
    std::string gWhatsappBusinessAccountId;
    // Numero (E.164, sin '+') del equipo de soporte humano que recibe la
    // notificacion de escalamiento.
    std::string gWhatsappSupportToE164;
    // hello_world/en_US es la unica plantilla preaprobada por defecto en
    // cualquier WABA de prueba nueva -- no requiere aprobacion de Meta.
    std::string gWhatsappTemplateName = "hello_world";
    std::string gWhatsappTemplateLang = "en_US";
    int gWhatsappTimeoutMs = 8000;
    // Chatbot minero: reutiliza el mismo Ollama que ya usa text_spell_service
    // (BEEMETRY_OLLAMA_URL), con un modelo propio. Corrección 2026-07-29:
    // estaba en qwen2.5:7b -- el mismo benchmark de esfuerzo continuo de
    // text_spell_service.cpp (2026-07-22) ya había medido qwen2.5:7b ~2.4x
    // más lento que gemma2:2b (p50 18s vs 7s) y por eso reserva qwen2.5:7b
    // solo para APA7 (tarea puntual, no interactiva) y usa gemma2:2b para
    // reescritura (interactiva). El chat es el caso interactivo por
    // excelencia -- el usuario reportó demoras reales, causa raíz era
    // literalmente usar el modelo lento donde ya se sabía que no debía ir.
    std::string gOllamaChatbotModel = "gemma2:2b";
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
    // ADR-029 (revisado): JWT de acceso de vida corta + refresh token
    // server-side rotado. gJwtSecret vacío en loadFromEnv() dispara una clave
    // efímera aleatoria (con warning) — válida solo dentro de este proceso;
    // en despliegue real JWT_SECRET debe fijarse (ver docker-compose.yml).
    std::string gJwtSecret;
    int gJwtAccessTtlMinutes = 15;
    int gJwtRefreshTtlDays = 7;
    // ADR-029, "Actualización 2026-07-19": el refresh token migró de
    // localStorage (JSON body) a una cookie HttpOnly — Secure debe quedar en
    // true en cualquier despliegue con TLS real delante (terminado por el
    // balanceador, ver ADR-054); solo se desactiva para probar por HTTP
    // plano en local (docker-compose.yml lo hace explícito).
    bool gAuthCookieSecure = true;
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
