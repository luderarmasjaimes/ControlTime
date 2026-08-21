#pragma once

#include <atomic>
#include <mutex>
#include <string>
#include <vector>

namespace config {

enum class AuthStorageMode { Postgres, File };
// DeepFaceSilent (DeepFace/Facenet512 + Silent-Face-Anti-Spoofing) es el
// proveedor local por defecto; SeetaFace6 queda en el enum por compatibilidad
// / rollback pero ya no es el default (ver ADR de supersesión en docs/decisions/).
enum class BiometricProvider { Legacy, DermalogCli, SeetaFace6, DeepFaceSilent };

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

// Una linea de WhatsApp conectada (ADR-113): un phone_number_id + access
// token de la WhatsApp Business Platform, identificada internamente por un
// id corto (p.ej. "soporte"). Vive en config/ (no en support/) porque es
// dato de configuracion puro, sin dependencias de red/DB -- support/whatsapp_client.hpp
// la consume para saber por cual numero enviar.
struct WhatsappLine {
    std::string id;            // "default", "soporte", "comercial", ...
    std::string phoneNumberId;
    std::string accessToken;
    std::string label;         // nombre humano, solo para logs/auditoria
};

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
    bool gSeetaFace6Required = true;
    int gSeetaFace6TimeoutMs = 20000;
    // DeepFace (Facenet512) + Silent-Face-Anti-Spoofing (MiniFASNet) --
    // proveedor local por defecto. Fail-closed por defecto (mismo principio
    // que SeetaFace6/ADR-104): indisponibilidad rechaza, no degrada.
    bool gDeepFaceSilentRequired = true;
    // Cold-start de TensorFlow/PyTorch es más lento que el CLI de SeetaFace6.
    int gDeepFaceSilentTimeoutMs = 25000;
    // Cascada a Dermalog solo cuando gDeepFaceSilentRequired=false Y el fallo
    // fue de infraestructura (ai_engine caído/timeout), nunca ante un rechazo
    // de seguridad (spoof/no-match) -- ver analyzeFaceImage en face_analysis.cpp.
    bool gDeepFaceSilentDermalogFallback = false;
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
    // Numero (E.164, sin '+') del equipo comercial/ventas -- destino del
    // escalamiento del menu del bot cuando el usuario elige "Area comercial".
    std::string gWhatsappComercialToE164;
    // Numero (E.164, sin '+') de Recursos Humanos -- destino del
    // escalamiento del menu del bot cuando el usuario elige "Recursos
    // Humanos" (ADR-115).
    std::string gWhatsappRrhhToE164;
    // hello_world/en_US es la unica plantilla preaprobada por defecto en
    // cualquier WABA de prueba nueva -- no requiere aprobacion de Meta.
    std::string gWhatsappTemplateName = "hello_world";
    std::string gWhatsappTemplateLang = "en_US";
    int gWhatsappTimeoutMs = 8000;
    // Multi-linea (ADR-113): varios numeros de WhatsApp (areas distintas --
    // soporte, comercial, etc.) bajo la misma WABA/App de Meta, cada uno con
    // su propio phone_number_id/access token pero compartiendo API base/app
    // secret/webhook (una sola App de Meta puede tener varios numeros). La
    // linea "default" se arma sola a partir de PHONE_NUMBER_ID/ACCESS_TOKEN
    // de arriba (compatibilidad con el despliegue de una sola linea de
    // ADR-112); lineas adicionales se declaran en BEEMETRY_WHATSAPP_EXTRA_LINES.
    std::vector<WhatsappLine> gWhatsappLines;
    /** @brief Resuelve la linea por el `phone_number_id` que llega en
     * `value.metadata.phone_number_id` del webhook de Meta -- asi el motor
     * del bot sabe por cual numero responder. nullptr si ninguna coincide. */
    const WhatsappLine *whatsappLineByPhoneNumberId(const std::string &phoneNumberId) const;
    /** @brief Resuelve la linea por su id corto interno (el que se persiste
     * en `whatsapp_conversation.line_id`). nullptr si no existe. */
    const WhatsappLine *whatsappLineById(const std::string &lineId) const;
    /** @brief Primera linea configurada, o nullptr si no hay ninguna
     * (compatibilidad: comportamiento de una sola linea de ADR-112). */
    const WhatsappLine *defaultWhatsappLine() const;
    // Numeros (E.164 sin '+') autorizados para usar la opcion oculta
    // "Administracion" del bot de WhatsApp (ADR-114): cambiar los numeros de
    // escalamiento (soporte/comercial) sin pasar por un redeploy. No hay
    // login en WhatsApp -- esta lista ES el mecanismo de autorizacion.
    std::vector<std::string> gWhatsappAdminPhones;
    bool isWhatsappAdminPhone(const std::string &phoneE164) const;
    // Webhook de entrada (bot conversacional, ver whatsapp_webhook_routes):
    // token que Meta debe repetir en el handshake GET de verificacion, y el
    // "app secret" con el que Meta firma cada POST (X-Hub-Signature-256,
    // HMAC-SHA256 sobre el body crudo) -- rechazado sin procesar si no
    // coincide. Ambos vacios = webhook deshabilitado (responde 404).
    std::string gWhatsappWebhookVerifyToken;
    std::string gWhatsappAppSecret;
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
    // ADR-122: extracción de texto de CVs (Word/PDF) en /extract_cv_text --
    // mucho más lenta que analyze_eyes (500ms) o incluso cartoon_avatar
    // (8s): un PDF de varias páginas con pdfplumber puede tardar varios
    // segundos, así que necesita su propio timeout generoso, no el de
    // gAiEngineTimeoutMs (pensado para frames de cámara en vivo).
    int gAiEngineCvExtractTimeoutMs = 30000;
    // Tope de tamaño del CV descargado de WhatsApp (ver whatsapp_media_client.cpp
    // y whatsapp_bot_engine.cpp) -- aplicado en tres capas: antes de
    // descargar (file_size reportado por la Graph API), sobre los bytes ya
    // descargados, y de nuevo en ai_engine (defensa en profundidad, ver
    // ADR-122). 10MB es generoso para un CV escaneado de varias páginas sin
    // permitir archivos desproporcionados en un adjunto de correo.
    std::size_t gWhatsappCvMaxBytes = 10 * 1024 * 1024;
    // Destino de la notificación por correo de cada postulación de CV
    // (ADR-122) -- CV adjunto + resumen extraído + score. Vacío = no se
    // envía correo (solo queda la notificación WhatsApp a RRHH, si el
    // número está configurado).
    std::string gHrCvEmailTo;
    std::size_t gAiEngineMaxImageBytes = 450000;
    std::string gCartoonOnnxModelPath;
    static constexpr std::size_t kFaceEmbeddingVectorDim = 512;
    double gFaceEmbeddingCosineThreshold = 0.45;
    // SeetaFace6 general ResNet-50 entrega 1024 componentes. El umbral es
    // operativo y debe calibrarse con la población/cámara del despliegue.
    double gFaceSeetaCosineThreshold = 0.80;
    // Facenet512: el doc técnico de referencia especifica "distancia coseno
    // < 0.30" para considerar la misma identidad. cosineSimilarity() en este
    // código devuelve similitud (dot/|a||b|), no distancia, así que el umbral
    // equivalente es 1 - 0.30 = 0.70 (similitud alta = misma persona).
    double gFaceDeepfaceCosineThreshold = 0.70;
    // Silent-Face: clase 1 (piel viva real) con confianza > 60%, igual que el
    // script de referencia. La decisión de liveness ocurre 100% en Python
    // (ai_engine); este valor solo se expone en /api/auth/biometric/status
    // para observabilidad -- ajustarlo de verdad requiere cambiar
    // SILENTFACE_LIVENESS_THRESHOLD en el propio ai_engine.
    double gSilentFaceLivenessThreshold = 0.60;
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
    // ADR-087: consulta opcional a un verificador de RUC de terceros (SUNAT
    // no publica una API REST oficial gratuita — solo el portal HTML
    // e-consultaruc.sunat.gob.pe). Excepción explícita y acotada a ADR-001
    // ("todo on-prem, sin dependencias externas"): apagada por defecto,
    // nunca bloquea el alta de una empresa (ver tax_registry_client.hpp).
    bool gTaxRegistryEnabled = false;
    std::string gTaxRegistryHost;
    // "{ruc}" se reemplaza por el RUC normalizado (solo dígitos).
    std::string gTaxRegistryPathTemplate;
    std::string gTaxRegistryToken;
    int gTaxRegistryTimeoutMs = 2500;
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
