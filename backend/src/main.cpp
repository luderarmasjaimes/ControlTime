// --------------------------------------------------------------------------
// main.cpp  –  Modular entry point for mapas_backend
// --------------------------------------------------------------------------

#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/json.hpp>
#include <opencv2/opencv.hpp>

// SO_RCVTIMEO para el timeout de las conexiones keep-alive (ver
// setSocketReceiveTimeout más abajo: beast::tcp_stream::expires_after no
// aplica a las lecturas síncronas que usa este servidor).
#ifdef _WIN32
#include <winsock2.h>
#else
#include <sys/socket.h>
#include <sys/time.h>
#endif

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <future>
#include <iostream>
#include <regex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "config/app_config.hpp"
#include "http/http_utils.hpp"
#include "http/router.hpp"
#include "auth/auth_types.hpp"
#include "auth/auth_session.hpp"
#include "auth/auth_storage_file.hpp"
#include "auth/auth_storage_pg.hpp"
#include "auth/auth_routes.hpp"
#include "auth/jwt.hpp"
#include "biometric/biometric_types.hpp"
#include "biometric/face_analysis.hpp"
#include "biometric/ai_engine_client.hpp"
#include "biometric/biometric_routes.hpp"
#include "mining/mining_routes.hpp"
#include "mining/mining_gateway.hpp"
#include "mining/telemetry_ingest.hpp"
#include "mining/protocol_adapters.hpp"
#include "mining/thingsboard_sync.hpp"
#include "mining/device_alarm_routes.hpp"
#include "mining/notification_routes.hpp"
#include "mining/map_aggregator.hpp"
#include "ws_broadcast.hpp"
#include "reports/report_routes.hpp"
#include "formula/formula_service.hpp"
#include "formula/formula_routes.hpp"
#include "platform/platform_routes.hpp"
#include "tenant/tenant_assets_routes.hpp"
#include "map/map_routes.hpp"
#include "map/wms_proxy.hpp"
#include "gdal/gdal_routes.hpp"
#include "gdal/conversion_service.hpp"
#include "text/text_routes.hpp"
#include "support/support_routes.hpp"
#include "support/mining_chatbot_service.hpp"
#include "text_spell_service.hpp"
#include "onnx_cartoon.hpp"
#include "vision_pipeline.hpp"
#include "websocket_session.hpp"
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"

#include <sstream>

// ── namespace aliases ──────────────────────────────────────────────────────
namespace asio      = boost::asio;
namespace beast     = boost::beast;
namespace http      = beast::http;
namespace json      = boost::json;
namespace websocket = beast::websocket;
namespace fs        = std::filesystem;

// ── using declarations ─────────────────────────────────────────────────────
using config::AppConfig;
using config::AuthStorageMode;
using config::BiometricProvider;
using config::getenvOr;

using http_utils::makeJsonResponse;
using http_utils::makeCsvResponse;
using http_utils::makeJpegResponse;
using http_utils::makeId;
using http_utils::hashPassword;
using http_utils::nowIso8601;
using http_utils::isValidDni;
using http_utils::cosineSimilarity;
using http_utils::routePathOnly;
using http_utils::parseQueryString;

using auth::AuthUser;
using auth::AuthSession;
using auth::LegacyFacialUserRecord;
using auth::AuditFilter;
using auth::AuditPageResult;
using auth::resolveAuthSession;
using auth::extractAuthTokenFromRequest;
using auth::issueAuthSession;
using auth::revokeAuthSession;
using auth::resolveRoleForUsername;
using auth::gAuthMutex;
using auth::loadAuthUsers;
using auth::saveAuthUsers;
using auth::loadLegacyFacialUsers;
using auth::saveLegacyFacialUsers;
using auth::appendAuthAuditLog;
using auth::authIdentityKeyMatchesFsUser;
using auth::authUserSessionJson;
using auth::readAuthAuditTail;
using auth::auditRowsToCsv;
#if HAS_LIBPQ
using auth::migrateLegacyPasswordHashesPg;
using auth::readAuthAuditPg;
using auth::registerUserPg;
using auth::findOrCreateTenantForCompanyPg;
using auth::loginPasswordPg;
using auth::loginFaceTargetedPg;
using auth::updateUserAvatarCartoonPg;
#endif
using auth::updateUserAvatarCartoonFile;
using auth::AuthTokenPair;

using biometric::BiometricCaptureRuntimeState;
using biometric::gBiometricCaptureMutex;
using biometric::getOrCreateBiometricCaptureSession;
using biometric::captureSessionIdFromRequest;
using biometric::decodeBase64;
using biometric::stripDataUrlBase64;
using biometric::analyzeFaceImage;
using biometric::buildFaceLoginProbe;
using biometric::fetchFaceEmbeddingFromAiEngine;
using biometric::fetchCartoonAvatarBestEffort;
using biometric::getAccessoryDnnContext;

// ── compile-time constants ─────────────────────────────────────────────────
static constexpr const char *kAuthUserNotFoundMsg    = AppConfig::kAuthUserNotFoundMsg;
static constexpr const char *kAuthWrongPasswordMsg   = AppConfig::kAuthWrongPasswordMsg;
static constexpr const char *kAuthAmbiguousIdentityMsg = AppConfig::kAuthAmbiguousIdentityMsg;

// ── global router ──────────────────────────────────────────────────────────
static router::Router gRouter;

/** @brief Adjunta a `res` las cookies de refresh/CSRF de `pair` (ADR-029, "Actualización 2026-07-19") -- usar en TODA respuesta de login/registro/refresh/tenant-switch que emita un AuthTokenPair. El refresh token ya no viaja en el body JSON. */
static http::response<http::string_body>
withAuthCookies(http::response<http::string_body> res, const AuthTokenPair &pair) {
    auto &cfg = AppConfig::instance();
    const int maxAgeSeconds = cfg.gJwtRefreshTtlDays * 24 * 3600;
    http_utils::setAuthCookies(res, pair.refreshToken, pair.csrfToken, maxAgeSeconds);
    // ADR-082: el access token va en su propia cookie HttpOnly, con el TTL del
    // access token (no el del refresh) — así caduca a la vez que el JWT que
    // contiene y no queda una cookie muerta rondando siete días.
    http_utils::setAccessTokenCookie(res, pair.token, pair.expiresInSeconds);
    return res;
}

// =========================================================================
//  Route handlers NOT yet extracted into modules
// =========================================================================

// ── GET /api/reset_capture ──────────────────────────────────────────────
static http::response<http::string_body>
handleResetCapture(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> & /*query*/) {
    const std::string sessionId = captureSessionIdFromRequest(req);
    std::scoped_lock lk(gBiometricCaptureMutex);
    auto &slot = getOrCreateBiometricCaptureSession(sessionId);
    slot.state = BiometricCaptureRuntimeState{};
    slot.capturedImages.clear();
    return makeJsonResponse(http::status::ok, json::object{{"status", "reset"}});
}

// ── GET /api/captured_images ────────────────────────────────────────────
static http::response<http::string_body>
handleCapturedImages(const http::request<http::string_body> &req,
                     const std::unordered_map<std::string, std::string> & /*query*/) {
    const std::string sessionId = captureSessionIdFromRequest(req);
    json::array arr;
    {
        std::scoped_lock lk(gBiometricCaptureMutex);
        auto &slot = getOrCreateBiometricCaptureSession(sessionId);
        for (const auto &img : slot.capturedImages) {
            arr.push_back(json::value(img));
        }
    }
    return makeJsonResponse(http::status::ok, arr);
}

// ── GET /api/users ──────────────────────────────────────────────────────
static http::response<http::string_body>
handleLegacyUsers(const http::request<http::string_body> & /*req*/,
                  const std::unordered_map<std::string, std::string> & /*query*/) {
    const std::string dataRoot = getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
    const auto users = loadLegacyFacialUsers(dataRoot);
    json::array arr;
    for (const auto &u : users) {
        arr.push_back(json::object{{"id", u.id},
                                   {"name", u.name},
                                   {"timestamp", u.timestamp},
                                   {"confidence", u.confidence}});
    }
    return makeJsonResponse(http::status::ok, arr);
}

// ── POST /api/enroll ────────────────────────────────────────────────────
static http::response<http::string_body>
handleEnroll(const http::request<http::string_body> &req,
             const std::unordered_map<std::string, std::string> & /*query*/) {
    try {
        auto val = json::parse(req.body());
        if (!val.is_object()) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "invalid JSON body"}});
        }
        const auto &obj = val.as_object();
        const std::string empresa =
            obj.if_contains("empresa") && obj.at("empresa").is_string()
                ? json::value_to<std::string>(obj.at("empresa"))
                : "EMPRESA";
        const std::string paterno =
            obj.if_contains("paterno") && obj.at("paterno").is_string()
                ? json::value_to<std::string>(obj.at("paterno"))
                : "";
        const std::string materno =
            obj.if_contains("materno") && obj.at("materno").is_string()
                ? json::value_to<std::string>(obj.at("materno"))
                : "";
        const std::string nombre =
            obj.if_contains("nombre") && obj.at("nombre").is_string()
                ? json::value_to<std::string>(obj.at("nombre"))
                : "";

        if (paterno.empty() || nombre.empty()) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "paterno and nombre are required"}});
        }

        const std::string sessionId = captureSessionIdFromRequest(req);
        double confidence = 0.0;
        {
            std::scoped_lock lk(gBiometricCaptureMutex);
            auto &slot = getOrCreateBiometricCaptureSession(sessionId);
            if (slot.state.captureCount < 3 || slot.state.state != 7) {
                return makeJsonResponse(http::status::bad_request,
                                        json::object{{"error", "Capture process not complete"}});
            }
            confidence = slot.state.livenessScore;
            slot.state = BiometricCaptureRuntimeState{};
            slot.capturedImages.clear();
        }

        const std::string dataRoot = getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
        const std::string userId =
            empresa + "_" + paterno + "_" + materno + "_" + nombre;
        const std::string fullName =
            nombre + (paterno.empty() ? "" : " " + paterno) +
            (materno.empty() ? "" : " " + materno);
        auto users = loadLegacyFacialUsers(dataRoot);
        users.push_back(LegacyFacialUserRecord{
            userId,
            fullName,
            static_cast<std::int64_t>(std::chrono::system_clock::to_time_t(
                std::chrono::system_clock::now())),
            confidence});
        saveLegacyFacialUsers(dataRoot, users);

        return makeJsonResponse(http::status::ok,
                                json::object{{"status", "success"},
                                             {"userId", userId}});
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

// ── POST /api/auth/register ─────────────────────────────────────────────
static http::response<http::string_body>
handleRegister(const http::request<http::string_body> &req,
               const std::unordered_map<std::string, std::string> & /*query*/) {
    auto &cfg = AppConfig::instance();
    const std::string dataRoot = getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
    try {
        auto val = json::parse(req.body());
        if (!val.is_object()) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "invalid JSON body"}});
        }

        const auto &obj = val.as_object();
        const std::vector<std::string> required = {
            "company", "first_name", "last_name", "dni", "username", "password"};

        for (const auto &key : required) {
            if (!obj.if_contains(key.c_str())) {
                return makeJsonResponse(http::status::bad_request,
                                        json::object{{"error", key + " is required"}});
            }
        }

        if (!obj.at("company").is_string() || !obj.at("first_name").is_string() ||
            !obj.at("last_name").is_string() || !obj.at("dni").is_string() ||
            !obj.at("username").is_string() || !obj.at("password").is_string()) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "invalid auth payload"}});
        }

        const bool hasTemplate =
            obj.if_contains("face_template") && obj.at("face_template").is_array();
        const bool hasImage = obj.if_contains("face_image_base64") &&
                              obj.at("face_image_base64").is_string();
        if (!hasTemplate && !hasImage) {
            return makeJsonResponse(
                http::status::bad_request,
                json::object{{"error", "face_template or face_image_base64 is required"}});
        }

        const std::string company   = json::value_to<std::string>(obj.at("company"));
        const std::string firstName = json::value_to<std::string>(obj.at("first_name"));
        const std::string lastName  = json::value_to<std::string>(obj.at("last_name"));
        const std::string dni       = json::value_to<std::string>(obj.at("dni"));
        const std::string username  = json::value_to<std::string>(obj.at("username"));
        const std::string password  = json::value_to<std::string>(obj.at("password"));

        std::string role   = obj.if_contains("role")   && obj.at("role").is_string()   ? json::value_to<std::string>(obj.at("role"))   : resolveRoleForUsername(username);
        std::string ruc    = obj.if_contains("ruc")    && obj.at("ruc").is_string()    ? json::value_to<std::string>(obj.at("ruc"))    : "";
        std::string phone  = obj.if_contains("phone")  && obj.at("phone").is_string()  ? json::value_to<std::string>(obj.at("phone"))  : "";
        std::string mobile = obj.if_contains("mobile") && obj.at("mobile").is_string() ? json::value_to<std::string>(obj.at("mobile")) : "";
        std::string email  = obj.if_contains("email")  && obj.at("email").is_string()  ? json::value_to<std::string>(obj.at("email"))  : "";

        const auto regT0 = std::chrono::steady_clock::now();
        auto regLog = [&](const char *tag) {
            const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                                std::chrono::steady_clock::now() - regT0)
                                .count();
            std::cerr << "[AUTH_REGISTER] dni=" << dni << " user=" << username
                      << " +" << ms << "ms " << tag << std::endl;
        };
        regLog("parsed_payload");

        std::vector<unsigned char> rawRegImage;
        std::string regFaceBase64;
        if (!hasTemplate && hasImage) {
            regFaceBase64 = json::value_to<std::string>(obj.at("face_image_base64"));
            (void)decodeBase64(regFaceBase64, rawRegImage);
        }

        std::string portraitPayloadEarly;
        if (obj.if_contains("face_portrait_oval_base64") &&
            obj.at("face_portrait_oval_base64").is_string()) {
            portraitPayloadEarly = stripDataUrlBase64(
                json::value_to<std::string>(obj.at("face_portrait_oval_base64")));
        }
        std::vector<unsigned char> portraitBytes;
        if (!portraitPayloadEarly.empty()) {
            (void)decodeBase64(portraitPayloadEarly, portraitBytes);
        }
        std::string bustPayloadEarly;
        if (obj.if_contains("face_bust_rect_base64") &&
            obj.at("face_bust_rect_base64").is_string()) {
            bustPayloadEarly = stripDataUrlBase64(
                json::value_to<std::string>(obj.at("face_bust_rect_base64")));
        }
        std::vector<unsigned char> bustBytes;
        if (!bustPayloadEarly.empty()) {
            (void)decodeBase64(bustPayloadEarly, bustBytes);
        }

        std::optional<std::future<biometric::AiEngineCartoonResult>> cartoonFut;
        if (!bustBytes.empty()) {
            std::vector<unsigned char> bustCopy = bustBytes;
            cartoonFut.emplace(std::async(std::launch::async, [bustCopy]() {
                return fetchCartoonAvatarBestEffort(bustCopy);
            }));
            regLog("cartoon_async_started_parallel_with_embedding");
        }

        std::vector<double> faceTemplate;
        std::string biometricProvider = "legacy";
        double qualityScore = 0.0;
        if (hasTemplate) {
            for (const auto &v : obj.at("face_template").as_array()) {
                if (v.is_double()) {
                    faceTemplate.push_back(v.as_double());
                } else if (v.is_int64()) {
                    faceTemplate.push_back(static_cast<double>(v.as_int64()));
                } else {
                    return makeJsonResponse(
                        http::status::bad_request,
                        json::object{{"error", "face_template must be a numeric array"}});
                }
            }
            regLog("face_template_from_client_skip_ai_embedding");
        } else {
            if (!rawRegImage.empty() && !cfg.gAiEngineUrl.empty()) {
                regLog("embedding_ai_engine_begin");
                auto em = fetchFaceEmbeddingFromAiEngine(rawRegImage);
                regLog("embedding_ai_engine_end");
                if (em.ok()) {
                    faceTemplate = std::move(em.embedding);
                    biometricProvider = "insightface_onnx";
                    qualityScore = 0.92;
                }
            }
            if (faceTemplate.empty()) {
                regLog("analyze_face_legacy_begin");
                auto face = analyzeFaceImage(regFaceBase64, "register");
                regLog("analyze_face_legacy_end");
                if (face.faceTemplate.empty()) {
                    json::array issues;
                    for (const auto &issue : face.issues) {
                        issues.push_back(json::value(issue));
                    }
                    return makeJsonResponse(
                        http::status::bad_request,
                        json::object{{"error", "face not detected"},
                                     {"provider", face.provider},
                                     {"issues", issues}});
                }
                faceTemplate = std::move(face.faceTemplate);
                biometricProvider = face.provider;
                qualityScore = face.qualityScore;
            }
        }

        if (faceTemplate.size() < 100) {
            return makeJsonResponse(
                http::status::bad_request,
                json::object{{"error", "face_template is too short"}});
        }

        if (!isValidDni(dni)) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "dni must be numeric"}});
        }

        if (username.size() < 4 || password.size() < 6) {
            return makeJsonResponse(
                http::status::bad_request,
                json::object{{"error", "username or password length is invalid"}});
        }

        regLog("post_validate");

        AuthUser created;
        created.id           = makeId();
        created.company      = company;
        created.firstName    = firstName;
        created.lastName     = lastName;
        created.dni          = dni;
        created.username     = username;
        created.role         = role;
        created.passwordHash = hashPassword(password);
        created.faceTemplate = std::move(faceTemplate);
        created.createdAt    = nowIso8601();
        created.ruc          = ruc;
        created.phone        = phone;
        created.mobile       = mobile;
        created.email        = email;
        created.avatarCartoonBase64.clear();

        regLog("pre_db_insert");

        {
            std::scoped_lock lk(gAuthMutex);
            if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
                std::string dbError;
                if (!registerUserPg(cfg.gDatabaseUrl, created, dbError)) {
                    return makeJsonResponse(http::status::conflict,
                                            json::object{{"error", dbError}});
                }
                // Sin esto, el usuario autoregistrado nunca obtiene una fila
                // real en auth_user_tenant: su JWT queda atado para siempre
                // al tenant de fallback (kMiningTelemetryDemoTenantId), que
                // ADR-039 ya vetó explícitamente para crear/editar informes
                // -- quedaría bloqueado sin ninguna salida. Se crea (o
                // reutiliza, si ya existe) un tenant real dedicado para su
                // `company` y se vincula de una vez. No se aborta el
                // registro si esto falla (el usuario ya quedó creado) --
                // solo se deja constancia en el log del servidor.
                std::string tenantError;
                const std::string provisionedTenantId = findOrCreateTenantForCompanyPg(
                    cfg.gDatabaseUrl, company, created.id, role, tenantError);
                if (provisionedTenantId.empty()) {
                    std::cerr << "[AUTH_REGISTER] tenant provisioning failed for company='"
                              << company << "': " << tenantError << std::endl;
                } else {
                    // Bug real (QA 2026-07-27): provisionedTenantId se calculaba
                    // pero nunca se asignaba a `created.tenantId` -- el token
                    // emitido en ESTA misma respuesta de registro (issueAuthSession
                    // más abajo) quedaba con tenant_id vacío en el JWT, aunque la
                    // fila en auth_user_tenant ya existiera correctamente. Efecto
                    // observable: POST /api/reports con el token de la respuesta
                    // de registro fallaba con "tenant_required"; recién funcionaba
                    // tras un login nuevo (que sí resuelve el tenant real desde
                    // BD). Exactamente la regresión que este mismo bloque de
                    // código dice prevenir en su comentario de arriba.
                    created.tenantId = provisionedTenantId;
                }
#else
                return makeJsonResponse(
                    http::status::internal_server_error,
                    json::object{{"error", "postgres support is not compiled"}});
#endif
            } else {
                auto users = loadAuthUsers(dataRoot);

                const auto sameDni =
                    std::find_if(users.begin(), users.end(), [&](const auto &u) {
                        return u.dni == dni;
                    });
                if (sameDni != users.end()) {
                    appendAuthAuditLog(dataRoot, "register", company, username,
                                       false, "dni_exists");
                    return makeJsonResponse(
                        http::status::conflict,
                        json::object{{"error", "dni already exists"}});
                }

                const auto sameUsername =
                    std::find_if(users.begin(), users.end(), [&](const auto &u) {
                        return u.username == username && u.company == company;
                    });
                if (sameUsername != users.end()) {
                    appendAuthAuditLog(dataRoot, "register", company, username,
                                       false, "username_exists");
                    return makeJsonResponse(
                        http::status::conflict,
                        json::object{{"error", "username already exists in this company"}});
                }

                users.push_back(created);
                saveAuthUsers(dataRoot, users);
                appendAuthAuditLog(dataRoot, "register", company, username, true,
                                   "ok");
            }
        }

        regLog("db_insert_ok");

        const bool deferCartoonWork = cartoonFut.has_value() ||
                                      !rawRegImage.empty() ||
                                      !portraitBytes.empty();
        if (deferCartoonWork) {
            auto bgCartoonOpt = std::move(cartoonFut);
            std::vector<unsigned char> bgRawReg  = std::move(rawRegImage);
            std::vector<unsigned char> bgPortrait = std::move(portraitBytes);
            const auto storageModeCapture = cfg.gAuthStorageMode;
            const auto dbUrlCapture       = cfg.gDatabaseUrl;
            std::thread(
                [bgCartoonOpt = std::move(bgCartoonOpt),
                 bgRawReg = std::move(bgRawReg), bgPortrait = std::move(bgPortrait),
                 userId = created.id, regDni = dni, regUser = username,
                 regCompany = company, dataRoot,
                 storageModeCapture, dbUrlCapture]() mutable {
                    const auto t0 = std::chrono::steady_clock::now();
                    auto bgLog = [&](const char *tag) {
                        const auto ms =
                            std::chrono::duration_cast<std::chrono::milliseconds>(
                                std::chrono::steady_clock::now() - t0)
                                .count();
                        std::cerr << "[AUTH_REGISTER_CARTOON_BG] dni=" << regDni
                                  << " user=" << regUser << " id=" << userId
                                  << " +" << ms << "ms " << tag << std::endl;
                    };
                    bgLog("thread_start");
                    std::string b64;
                    std::string hdB64;
                    if (bgCartoonOpt.has_value()) {
                        try {
                            auto cartoonB = bgCartoonOpt->get();
                            bgLog("bust_future_done");
                            if (cartoonB.ok()) {
                                b64 = std::move(cartoonB.imageBase64);
                                hdB64 = std::move(cartoonB.imageHdBase64);
                            }
                        } catch (const std::exception &ex) {
                            std::cerr << "[AUTH_REGISTER_CARTOON_BG] future: "
                                      << ex.what() << std::endl;
                        } catch (...) {
                            std::cerr << "[AUTH_REGISTER_CARTOON_BG] future: unknown\n";
                        }
                    }
                    if (b64.empty() && !bgRawReg.empty()) {
                        bgLog("cartoon_sync_raw_bg");
                        auto cartoon = fetchCartoonAvatarBestEffort(bgRawReg);
                        if (cartoon.ok()) {
                            b64 = std::move(cartoon.imageBase64);
                            hdB64 = std::move(cartoon.imageHdBase64);
                        }
                    }
                    if (b64.empty() && !bgPortrait.empty()) {
                        bgLog("cartoon_sync_portrait_bg");
                        auto cartoon2 = fetchCartoonAvatarBestEffort(bgPortrait);
                        if (cartoon2.ok()) {
                            b64 = std::move(cartoon2.imageBase64);
                            hdB64 = std::move(cartoon2.imageHdBase64);
                        }
                    }
                    if (b64.empty()) {
                        bgLog("cartoon_all_failed_bg");
                        return;
                    }
                    bgLog("cartoon_ok_updating_store");
                    if (!hdB64.empty()) {
                        std::vector<unsigned char> hdBytes;
                        if (decodeBase64(hdB64, hdBytes) && !hdBytes.empty()) {
                            try {
                                const fs::path avatarDir =
                                    fs::path(dataRoot) / "auth" / "avatars_hd";
                                fs::create_directories(avatarDir);
                                const fs::path finalPath =
                                    avatarDir / (userId + ".png");
                                const fs::path tmpPath =
                                    avatarDir / (userId + ".png.tmp");
                                {
                                    std::ofstream out(tmpPath, std::ios::binary |
                                                                   std::ios::trunc);
                                    out.write(
                                        reinterpret_cast<const char *>(hdBytes.data()),
                                        static_cast<std::streamsize>(hdBytes.size()));
                                    if (!out.good()) {
                                        throw std::runtime_error(
                                            "avatar_hd_write_failed");
                                    }
                                }
                                if (fs::exists(finalPath)) {
                                    fs::remove(finalPath);
                                }
                                fs::rename(tmpPath, finalPath);
                                fs::permissions(
                                    finalPath,
                                    fs::perms::owner_read |
                                        fs::perms::owner_write,
                                    fs::perm_options::replace);
                                bgLog("avatar_hd_cached");
                            } catch (const std::exception &ex) {
                                std::cerr << "[AUTH_REGISTER_CARTOON_BG] hd: "
                                          << ex.what() << std::endl;
                            }
                        }
                    }
                    std::scoped_lock lk(gAuthMutex);
                    if (storageModeCapture == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
                        std::string err;
                        if (!updateUserAvatarCartoonPg(dbUrlCapture, userId, b64,
                                                       regUser, regCompany, "",
                                                       err)) {
                            std::cerr << "[AUTH_REGISTER_CARTOON_BG] pg: " << err
                                      << std::endl;
                        } else {
                            bgLog("pg_avatar_updated");
                        }
#else
                        (void)b64;
#endif
                    } else {
                        if (!updateUserAvatarCartoonFile(dataRoot, userId, b64)) {
                            std::cerr << "[AUTH_REGISTER_CARTOON_BG] file: user id "
                                         "not found\n";
                        } else {
                            bgLog("file_avatar_updated");
                        }
                    }
                })
                .detach();
            regLog("cartoon_bg_detached");
        }

        const auto sessionToken = issueAuthSession(created);
        regLog("response_ready");

        return withAuthCookies(
            makeJsonResponse(
                http::status::created,
                json::object{{"status", "registered"},
                             {"biometric_provider", biometricProvider},
                             {"quality_score", qualityScore},
                             {"user", authUserSessionJson(created,
                                                          sessionToken)}}),
            sessionToken);
    } catch (const std::exception &ex) {
        const std::string dataRoot = getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
        appendAuthAuditLog(dataRoot, "register", "unknown", "unknown", false,
                           ex.what());
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

// ── T22 — Rate limiter de login (spec 006) ────────────────────────────────
// Desliza ventana de 5 min; bloquea tras 5 fallos por clave company|username.
namespace {
struct LoginRateEntry { int fails = 0; std::chrono::steady_clock::time_point win{}; };
std::mutex gLoginRateMtx;
std::unordered_map<std::string, LoginRateEntry> gLoginRateMap;
constexpr int kRateMaxFails  = 5;
constexpr int kRateWindowSec = 300;  // ventana deslizante 5 min
// Techo duro de entradas vivas (auditoría de seguridad 2026-08-02). La clave
// del mapa es `company|username` — texto ARBITRARIO del atacante — y hasta
// ahora solo se borraba en el login CORRECTO: una ráfaga de intentos con
// usuarios inventados hacía crecer el mapa sin límite hasta agotar la memoria
// del proceso (DoS de la plataforma entera, no solo del login). nginx limita
// a 5 r/m por IP, pero eso no cubre una botnet ni el acceso directo al :8081
// desde dentro de la red Docker. Con la purga por ventana + este techo, el
// tamaño queda acotado por el propio TTL de 5 min.
constexpr std::size_t kRateMaxEntries = 20000;

/** @brief Elimina entradas cuya ventana ya expiró. Llamar con gLoginRateMtx tomado. */
void loginRatePruneLocked(std::chrono::steady_clock::time_point now) {
    for (auto it = gLoginRateMap.begin(); it != gLoginRateMap.end();) {
        const auto age = std::chrono::duration_cast<std::chrono::seconds>(
                             now - it->second.win).count();
        if (age > kRateWindowSec) it = gLoginRateMap.erase(it);
        else ++it;
    }
}
} // anonymous namespace

static bool loginRateCheck(const std::string &key) {
    std::lock_guard<std::mutex> lk(gLoginRateMtx);
    const auto now = std::chrono::steady_clock::now();
    if (gLoginRateMap.size() >= kRateMaxEntries) {
        loginRatePruneLocked(now);
        // Si tras purgar sigue lleno, el sistema está bajo un ataque activo de
        // relleno: se rechaza en vez de seguir creciendo (fail-closed).
        if (gLoginRateMap.size() >= kRateMaxEntries &&
            gLoginRateMap.find(key) == gLoginRateMap.end()) {
            return false;
        }
    }
    auto &e = gLoginRateMap[key];
    if (std::chrono::duration_cast<std::chrono::seconds>(now - e.win).count()
            > kRateWindowSec) {
        e.fails = 0;
        e.win   = now;
    }
    return e.fails < kRateMaxFails;
}

static void loginRateIncrement(const std::string &key) {
    std::lock_guard<std::mutex> lk(gLoginRateMtx);
    gLoginRateMap[key].fails++;
}

static void loginRateClear(const std::string &key) {
    std::lock_guard<std::mutex> lk(gLoginRateMtx);
    gLoginRateMap.erase(key);
}

namespace {
/**
 * @brief Cuenta el intento como FALLIDO salvo que se marque `success()`.
 *
 * El login facial tiene ~7 puntos de salida por error repartidos entre la rama
 * Postgres y la de archivo. Incrementar el contador a mano en cada uno es
 * frágil: basta con que un `return` nuevo se olvide para que ese camino quede
 * sin límite de intentos y reabra el bucle de fuerza bruta. Con este guard el
 * fallo es el comportamiento por DEFECTO — solo el camino de éxito lo
 * desactiva — así que cualquier salida futura queda cubierta sin tocar nada.
 */
class LoginAttemptGuard {
public:
    explicit LoginAttemptGuard(std::string key) : key_(std::move(key)) {}
    LoginAttemptGuard(const LoginAttemptGuard &) = delete;
    LoginAttemptGuard &operator=(const LoginAttemptGuard &) = delete;
    /** @brief Marca el intento como correcto: limpia el contador y no penaliza. */
    void success() {
        succeeded_ = true;
        loginRateClear(key_);
    }
    ~LoginAttemptGuard() {
        if (!succeeded_) loginRateIncrement(key_);
    }
private:
    std::string key_;
    bool succeeded_ = false;
};
} // anonymous namespace

// ADR-029, "Actualización 2026-07-19": el refresh token viaja SOLO por la
// cookie HttpOnly `refresh_token` (nunca más en el body JSON, ver
// http_utils::setAuthCookies) -- se lee del header `Cookie` de la request,
// no del body. Endpoints protegidos por esta cookie (refresh/logout) exigen
// además que el header `X-CSRF-Token` coincida con la cookie legible
// `csrf_token` (patrón double-submit): un sitio de terceros puede lograr que
// el navegador de la víctima MANDE la cookie de refresh_token sola, pero no
// puede LEERLA (same-origin policy) para repetirla en el header.
static bool csrfHeaderMatchesCookie(const http::request<http::string_body> &req) {
    // Nombre "v2": el cookie `csrf_token` (Path=/api/auth, bug corregido hoy
    // — ver setAuthCookies) puede seguir vivo en el navegador de sesiones ya
    // logueadas (Max-Age 7 días). Si se reutilizara el mismo nombre, el
    // navegador mandaría AMBAS cookies del mismo nombre en `Cookie` (la más
    // específica por path primero, RFC 6265), y `extractCookie` siempre
    // devuelve la primera coincidencia -- quedaría leyendo la vieja
    // (Path=/api/auth) mientras el JS del cliente lee la nueva (Path=/),
    // reproduciendo el mismo `csrf_token_mismatch` indefinidamente para
    // cualquier sesión activa desde antes del fix. Cambiar el nombre evita
    // la colisión por completo: la cookie vieja queda inerte y expira sola.
    const std::string cookieCsrf = http_utils::extractCookie(req, "csrf_token_v2");
    if (cookieCsrf.empty()) {
        return false;
    }
    const auto it = req.find("X-CSRF-Token");
    if (it == req.end()) {
        return false;
    }
    return std::string(it->value()) == cookieCsrf;
}

// ── T21 — POST /api/auth/logout ───────────────────────────────────────────
// ADR-029 (revisado): revoca el jti del access token de inmediato (denylist)
// y, si el cliente envía el refresh_token (ahora vía cookie, no body), lo
// marca revocado en el servidor — antes el logout solo actuaba client-side y
// la sesión seguía viva hasta expirar naturalmente (hasta 8 h).
static http::response<http::string_body>
handleLogout(const http::request<http::string_body> &req,
             const std::unordered_map<std::string, std::string> &query) {
    const auto session = resolveAuthSession(req, query);
    if (!session)
        return makeJsonResponse(http::status::unauthorized,
                                json::object{{"error", "unauthorized"}});
    const std::string refreshToken = http_utils::extractCookie(req, "refresh_token");
    // CSRF solo se exige cuando hay una cookie de refresh que revocar -- si el
    // cliente no la tenía (ya venció, o nunca hizo login con cookie), el
    // logout igual debe poder revocar el access token vigente.
    if (!refreshToken.empty() && !csrfHeaderMatchesCookie(req)) {
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "csrf_token_mismatch"}});
    }
    auth::revokeAuthSession(session->token, refreshToken);
    auto res = makeJsonResponse(http::status::ok, json::object{{"status", "logged_out"}});
    http_utils::clearAuthCookies(res);
    return res;
}

// ── POST /api/auth/refresh ─────────────────────────────────────────────────
// ADR-029 (revisado): endpoint stateless respecto al access token — recibe el
// refresh_token vía cookie HttpOnly (nunca un access token, que puede ya
// haber expirado; ese es justamente el propósito del refresh) y, si es
// válido, emite un par nuevo rotando el refresh token usado (uso único:
// reintentarlo tras esta llamada falla siempre, mitigando replay si fue
// robado).
static http::response<http::string_body>
handleTokenRefresh(const http::request<http::string_body> &req,
                   const std::unordered_map<std::string, std::string> & /*query*/) {
    const std::string refreshToken = http_utils::extractCookie(req, "refresh_token");
    if (refreshToken.empty()) {
        return makeJsonResponse(http::status::bad_request,
            json::object{{"error", "missing_refresh_token"}});
    }
    if (!csrfHeaderMatchesCookie(req)) {
        return makeJsonResponse(http::status::forbidden,
            json::object{{"error", "csrf_token_mismatch"}});
    }

    const auto pair = auth::refreshWithToken(refreshToken);
    if (!pair) {
        // Refresh token inválido/vencido/reusado: limpiar la cookie vieja
        // también, no solo responder 401 -- si no, el cliente seguiría
        // reenviándola en cada intento sin llegar nunca a un login limpio.
        auto res = makeJsonResponse(http::status::unauthorized,
            json::object{{"error", "invalid_or_expired_refresh_token"}});
        http_utils::clearAuthCookies(res);
        return res;
    }

    auto &cfg = AppConfig::instance();
    const auto claims = auth::jwt::verify(pair->token, cfg.gJwtSecret);
    json::object userObj;
    if (claims) {
        userObj = json::object{{"id", claims->sub},
                               {"username", claims->username},
                               {"company", claims->company},
                               {"role", claims->role},
                               {"tenant_id", claims->tenantId}};
    }

    return withAuthCookies(
        makeJsonResponse(http::status::ok,
            json::object{{"status",       "refreshed"},
                         {"access_token",  pair->token},
                         {"expires_in",    pair->expiresInSeconds},
                         {"token_type",    "Bearer"},
                         {"user",          userObj}}),
        *pair);
}

// ── POST /api/auth/login/password ───────────────────────────────────────
static http::response<http::string_body>
handleLoginPassword(const http::request<http::string_body> &req,
                    const std::unordered_map<std::string, std::string> & /*query*/) {
    auto &cfg = AppConfig::instance();
    const std::string dataRoot = getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
    try {
        auto val = json::parse(req.body());
        if (!val.is_object()) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "invalid JSON body"}});
        }
        const auto &obj = val.as_object();
        if (!obj.if_contains("company") || !obj.if_contains("username") ||
            !obj.if_contains("password") || !obj.at("company").is_string() ||
            !obj.at("username").is_string() || !obj.at("password").is_string()) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "invalid auth payload"}});
        }

        const std::string company  = json::value_to<std::string>(obj.at("company"));
        const std::string username = json::value_to<std::string>(obj.at("username"));
        const std::string password = json::value_to<std::string>(obj.at("password"));

        // T22 — Rate limiting: 5 fallos / 5 min por clave company|username
        const std::string rateKey = company + "|" + username;
        if (!loginRateCheck(rateKey)) {
            return makeJsonResponse(http::status::too_many_requests,
                json::object{{"error",  "too_many_failed_attempts"},
                             {"detail", "Cuenta bloqueada 5 min. Intente más tarde."}});
        }

        AuthUser found;
        bool ok = false;
        {
            std::scoped_lock lk(gAuthMutex);
            if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
                std::string dbError;
                std::string errCode;
                auto user = loginPasswordPg(cfg.gDatabaseUrl, company, username,
                                            password, dbError,
                                            &errCode);
                if (!user) {
                    loginRateIncrement(rateKey);
                    json::object jo{{"error", dbError}};
                    if (!errCode.empty()) {
                        jo["code"] = errCode;
                    }
                    return makeJsonResponse(http::status::unauthorized, jo);
                }
                found = *user;
                ok = true;
#else
                return makeJsonResponse(
                    http::status::internal_server_error,
                    json::object{{"error", "postgres support is not compiled"}});
#endif
            } else {
                AuthUser *match = nullptr;
                size_t matchCount = 0;
                auto users = loadAuthUsers(dataRoot);
                for (auto &u : users) {
                    if (u.company != company) continue;
                    if (authIdentityKeyMatchesFsUser(username, u)) {
                        match = &u;
                        matchCount++;
                    }
                }
                if (matchCount == 0) {
                    loginRateIncrement(rateKey);
                    appendAuthAuditLog(dataRoot, "login_password", company,
                                       username, false, "user_not_found");
                    return makeJsonResponse(
                        http::status::unauthorized,
                        json::object{{"error", std::string(kAuthUserNotFoundMsg)},
                                     {"code", "user_not_found"}});
                }
                if (matchCount > 1) {
                    loginRateIncrement(rateKey);
                    appendAuthAuditLog(dataRoot, "login_password", company,
                                       username, false, "ambiguous_identity");
                    return makeJsonResponse(
                        http::status::unauthorized,
                        json::object{{"error", std::string(kAuthAmbiguousIdentityMsg)},
                                     {"code", "ambiguous_identity"}});
                }
                if (!http_utils::verifyPassword(password, match->passwordHash)) {
                    loginRateIncrement(rateKey);
                    appendAuthAuditLog(dataRoot, "login_password", company,
                                       match->username, false, "invalid_password");
                    return makeJsonResponse(
                        http::status::unauthorized,
                        json::object{{"error", std::string(kAuthWrongPasswordMsg)},
                                     {"code", "wrong_password"}});
                }
                if (http_utils::passwordNeedsRehash(match->passwordHash)) {
                    match->passwordHash = hashPassword(password);
                    saveAuthUsers(dataRoot, users);
                }
                appendAuthAuditLog(dataRoot, "login_password", company,
                                   match->username, true, "ok");
                found = *match;
                ok = true;
            }
        }

        if (!ok) {
            loginRateIncrement(rateKey);
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", "invalid credentials"}});
        }

        loginRateClear(rateKey);  // login exitoso: reinicia contador
        const auto sessionToken = issueAuthSession(found);
        return withAuthCookies(
            makeJsonResponse(
                http::status::ok,
                json::object{{"status", "authenticated"},
                             {"method", "password"},
                             {"user", authUserSessionJson(found, sessionToken)}}),
            sessionToken);
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

// ── POST /api/auth/login/face ───────────────────────────────────────────
static http::response<http::string_body>
handleLoginFace(const http::request<http::string_body> &req,
                const std::unordered_map<std::string, std::string> & /*query*/) {
    auto &cfg = AppConfig::instance();
    const std::string dataRoot = getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
    try {
        auto val = json::parse(req.body());
        if (!val.is_object()) {
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "invalid JSON body"}});
        }

        const auto &obj = val.as_object();
        if (!obj.if_contains("company") || !obj.at("company").is_string()) {
            std::cout << "[AUTH_FACE] reject: missing/invalid company field"
                      << std::endl;
            return makeJsonResponse(http::status::bad_request,
                                    json::object{{"error", "invalid auth payload"}});
        }

        const bool hasTemplate =
            obj.if_contains("face_template") && obj.at("face_template").is_array();
        const bool hasImage = obj.if_contains("face_image_base64") &&
                              obj.at("face_image_base64").is_string();
        if (!hasTemplate && !hasImage) {
            std::cout << "[AUTH_FACE] reject: missing face_template/face_image_base64"
                      << std::endl;
            return makeJsonResponse(
                http::status::bad_request,
                json::object{{"error", "face_template or face_image_base64 is required"}});
        }

        std::string identityLogin;
        if (obj.if_contains("identity_login") && obj.at("identity_login").is_string()) {
            identityLogin = json::value_to<std::string>(obj.at("identity_login"));
        } else if (obj.if_contains("username") && obj.at("username").is_string()) {
            identityLogin = json::value_to<std::string>(obj.at("username"));
        }
        {
            const char *ws = " \t\n\r";
            const auto start = identityLogin.find_first_not_of(ws);
            if (start == std::string::npos) {
                identityLogin.clear();
            } else {
                const auto end = identityLogin.find_last_not_of(ws);
                identityLogin = identityLogin.substr(start, end - start + 1);
            }
        }
        if (identityLogin.empty()) {
            std::cout << "[AUTH_FACE] reject: empty identity_login; company="
                      << json::value_to<std::string>(obj.at("company"))
                      << " has_template=" << (hasTemplate ? "1" : "0")
                      << " has_image=" << (hasImage ? "1" : "0") << std::endl;
            return makeJsonResponse(
                http::status::bad_request,
                json::object{{"error",
                              "Indique usuario, DNI o RUC (campo identity_login) "
                              "junto con la empresa para el login facial."}});
        }

        const std::string company = json::value_to<std::string>(obj.at("company"));
        std::cout << "[AUTH_FACE] request: company=" << company
                  << " identity=" << identityLogin
                  << " has_template=" << (hasTemplate ? "1" : "0")
                  << " has_image=" << (hasImage ? "1" : "0") << std::endl;

        // Rate limiting a nivel de cuenta, igual que el login por contraseña
        // (auditoría de seguridad 2026-08-02). Este endpoint acepta un
        // `face_template` numérico ARBITRARIO enviado por el cliente y lo
        // compara por similitud coseno contra el embedding almacenado: sin
        // límite, un atacante puede iterar vectores hasta cruzar el umbral y
        // autenticarse como cualquier usuario del que conozca el DNI, sin
        // necesitar jamás su rostro. Es el camino de menor resistencia de todo
        // el sistema de auth y era el único login sin contador de fallos.
        // El prefijo separa el cupo del de contraseña: quemar los 5 intentos
        // faciales no debe bloquear el login normal del mismo usuario.
        const std::string faceRateKey = "face|" + company + "|" + identityLogin;
        if (!loginRateCheck(faceRateKey)) {
            return makeJsonResponse(http::status::too_many_requests,
                json::object{{"error",  "too_many_failed_attempts"},
                             {"detail", "Cuenta bloqueada 5 min. Intente más tarde."}});
        }
        LoginAttemptGuard faceAttempt(faceRateKey);

        const double legacyThreshold = cfg.gFaceLegacyCosineThreshold;

        std::vector<double> clientProbeTemplate;
        std::optional<std::vector<unsigned char>> rawImageBytes;
        std::optional<std::string> base64ForLegacy;
        if (hasTemplate) {
            for (const auto &v : obj.at("face_template").as_array()) {
                if (v.is_double()) {
                    clientProbeTemplate.push_back(v.as_double());
                } else if (v.is_int64()) {
                    clientProbeTemplate.push_back(static_cast<double>(v.as_int64()));
                } else {
                    return makeJsonResponse(
                        http::status::bad_request,
                        json::object{{"error", "face_template must be a numeric array"}});
                }
            }
        } else {
            const std::string base64Image =
                json::value_to<std::string>(obj.at("face_image_base64"));
            std::vector<unsigned char> raw;
            if (!decodeBase64(base64Image, raw) || raw.empty()) {
                return makeJsonResponse(http::status::bad_request,
                                        json::object{{"error", "invalid base64 image"}});
            }
            rawImageBytes = std::move(raw);
            base64ForLegacy = base64Image;
        }

        AuthUser bestUser;
        double bestScore = -1.0;
        bool ok = false;
        std::string biometricProvider = "legacy";
        {
            std::scoped_lock lk(gAuthMutex);
            if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
                std::string dbError;
                std::string probeProv;
                auto result = loginFaceTargetedPg(
                    cfg.gDatabaseUrl, company, identityLogin,
                    clientProbeTemplate, rawImageBytes, base64ForLegacy,
                    legacyThreshold, cfg.gFaceEmbeddingCosineThreshold,
                    dbError, &probeProv);
                if (!result) {
                    std::cout << "[AUTH_FACE] postgres login failed: company="
                              << company << " identity=" << identityLogin
                              << " reason=" << dbError << std::endl;
                    return makeJsonResponse(http::status::unauthorized,
                                            json::object{{"error", dbError}});
                }
                bestUser = result->first;
                bestScore = result->second;
                biometricProvider = probeProv.empty() ? "legacy" : probeProv;
                ok = true;
#else
                return makeJsonResponse(
                    http::status::internal_server_error,
                    json::object{{"error", "postgres support is not compiled"}});
#endif
            } else {
                const auto users = loadAuthUsers(dataRoot);

                const AuthUser *match = nullptr;
                size_t matchCount = 0;
                for (const auto &u : users) {
                    if (u.company != company) continue;
                    if (authIdentityKeyMatchesFsUser(identityLogin, u)) {
                        match = &u;
                        matchCount++;
                    }
                }

                if (matchCount == 0) {
                    std::cout << "[AUTH_FACE] no user for identity in company: "
                              << company << " / " << identityLogin << std::endl;
                    appendAuthAuditLog(dataRoot, "login_face", company, "unknown",
                                       false, "no_user_for_identity");
                    return makeJsonResponse(
                        http::status::unauthorized,
                        json::object{{"error", std::string(kAuthUserNotFoundMsg)}});
                }
                if (matchCount > 1) {
                    std::cout << "[AUTH_FACE] ambiguous identity in company: "
                              << company << " / " << identityLogin << std::endl;
                    appendAuthAuditLog(dataRoot, "login_face", company, "unknown",
                                       false, "ambiguous_identity");
                    return makeJsonResponse(
                        http::status::unauthorized,
                        json::object{
                            {"error",
                             "El identificador coincide con más de un registro en "
                             "esa empresa. Use un dato único e intente de nuevo."}});
                }

                if (match->faceTemplate.size() < 100) {
                    appendAuthAuditLog(dataRoot, "login_face", company,
                                       match->username, false,
                                       "template_too_short");
                    return makeJsonResponse(
                        http::status::unauthorized,
                        json::object{
                            {"error",
                             "El usuario indicado no tiene biometría facial "
                             "registrada de forma completa. Registre el rostro e "
                             "intente de nuevo."}});
                }
                std::vector<double> probe;
                std::string probeProv;
                double useThr = legacyThreshold;
                std::string probeErr;
                if (!buildFaceLoginProbe(clientProbeTemplate, rawImageBytes,
                                         base64ForLegacy, match->faceTemplate,
                                         probe, probeProv, useThr,
                                         legacyThreshold,
                                         cfg.gFaceEmbeddingCosineThreshold,
                                         probeErr)) {
                    std::cout << "[AUTH_FACE] probe build failed for user="
                              << match->username << " reason=" << probeErr
                              << std::endl;
                    appendAuthAuditLog(dataRoot, "login_face", company,
                                       match->username, false,
                                       "probe_build_failed");
                    return makeJsonResponse(http::status::unauthorized,
                                            json::object{{"error", probeErr}});
                }
                bestScore = cosineSimilarity(probe, match->faceTemplate);
                if (bestScore < useThr) {
                    std::cout << "[AUTH_FACE] score below threshold user="
                              << match->username << " score=" << bestScore
                              << " threshold=" << useThr
                              << " provider=" << probeProv << std::endl;
                    appendAuthAuditLog(dataRoot, "login_face", company,
                                       match->username, false, "no_match");
                    return makeJsonResponse(
                        http::status::unauthorized,
                        json::object{
                            {"error",
                             "La biometría facial no coincide con el usuario "
                             "indicado. Verifique su identidad y vuelva a "
                             "intentar."}});
                }
                appendAuthAuditLog(
                    dataRoot, "login_face", company, match->username, true,
                    "ok score=" + std::to_string(bestScore) +
                        " probe=" + probeProv);
                bestUser = *match;
                biometricProvider = probeProv.empty() ? "legacy" : probeProv;
                ok = true;
            }
        }

        if (!ok) {
            std::cout << "[AUTH_FACE] failed: unknown reason company=" << company
                      << " identity=" << identityLogin << std::endl;
            return makeJsonResponse(
                http::status::unauthorized,
                json::object{
                    {"error",
                     "No se pudo completar el inicio de sesión facial. Intente "
                     "de nuevo."}});
        }

        faceAttempt.success();
        const auto sessionToken = issueAuthSession(bestUser);
        std::cout << "[AUTH_FACE] success user=" << bestUser.username
                  << " company=" << bestUser.company
                  << " provider=" << biometricProvider
                  << " score=" << bestScore << std::endl;

        return withAuthCookies(
            makeJsonResponse(
                http::status::ok,
                json::object{{"status", "authenticated"},
                             {"method", "face"},
                             {"biometric_provider", biometricProvider},
                             {"score", bestScore},
                             {"user", authUserSessionJson(bestUser,
                                                          sessionToken)}}),
            sessionToken);
    } catch (const std::exception &ex) {
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

// ── GET /api/auth/audit ─────────────────────────────────────────────────
static http::response<http::string_body>
handleAudit(const http::request<http::string_body> &req,
            const std::unordered_map<std::string, std::string> &query) {
    auto &cfg = AppConfig::instance();
    const std::string dataRoot = getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");

    const auto session = resolveAuthSession(req, query);
    if (!session || session->role != "admin") {
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "admin access required"}});
    }

    AuditFilter filter;
    size_t page = 1;
    size_t pageSize = 50;

    if (auto it = query.find("page"); it != query.end()) {
        try { page = std::max<size_t>(1, static_cast<size_t>(std::stoul(it->second))); }
        catch (...) { page = 1; }
    }
    if (auto it = query.find("page_size"); it != query.end()) {
        try { pageSize = std::clamp<size_t>(static_cast<size_t>(std::stoul(it->second)), 1, 500); }
        catch (...) { pageSize = 50; }
    }
    if (auto it = query.find("limit"); it != query.end()) {
        try { pageSize = std::clamp<size_t>(static_cast<size_t>(std::stoul(it->second)), 1, 500); }
        catch (...) { pageSize = 50; }
    }
    filter.limit  = pageSize;
    filter.offset = (page - 1) * pageSize;

    if (auto it = query.find("company"); it != query.end() && !it->second.empty())
        filter.company = it->second;
    if (auto it = query.find("username"); it != query.end() && !it->second.empty())
        filter.username = it->second;
    if (auto it = query.find("action"); it != query.end() && !it->second.empty())
        filter.action = it->second;
    if (auto it = query.find("success"); it != query.end() && !it->second.empty()) {
        if (it->second == "true" || it->second == "1")
            filter.success = true;
        else if (it->second == "false" || it->second == "0")
            filter.success = false;
    }

    AuditPageResult pageResult;
    if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
        pageResult = readAuthAuditPg(cfg.gDatabaseUrl, filter);
#else
        pageResult = readAuthAuditTail(dataRoot, filter);
#endif
    } else {
        pageResult = readAuthAuditTail(dataRoot, filter);
    }

    const size_t pages = pageResult.limit == 0
                             ? 1
                             : std::max<size_t>(1, (pageResult.total + pageResult.limit - 1) /
                                                       pageResult.limit);

    return makeJsonResponse(
        http::status::ok,
        json::object{{"logs", pageResult.logs},
                     {"count", pageResult.logs.size()},
                     {"total", pageResult.total},
                     {"page", page},
                     {"page_size", pageResult.limit},
                     {"pages", pages}});
}

// ── GET /api/auth/audit/export.csv ──────────────────────────────────────
static http::response<http::string_body>
handleAuditExportCsv(const http::request<http::string_body> &req,
                     const std::unordered_map<std::string, std::string> &query) {
    auto &cfg = AppConfig::instance();
    const std::string dataRoot = getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");

    const auto session = resolveAuthSession(req, query);
    if (!session || session->role != "admin") {
        return makeJsonResponse(http::status::forbidden,
                                json::object{{"error", "admin access required"}});
    }

    AuditFilter filter;
    filter.limit  = 100000;
    filter.offset = 0;
    if (auto it = query.find("company"); it != query.end() && !it->second.empty())
        filter.company = it->second;
    if (auto it = query.find("username"); it != query.end() && !it->second.empty())
        filter.username = it->second;
    if (auto it = query.find("action"); it != query.end() && !it->second.empty())
        filter.action = it->second;
    if (auto it = query.find("success"); it != query.end() && !it->second.empty()) {
        if (it->second == "true" || it->second == "1")
            filter.success = true;
        else if (it->second == "false" || it->second == "0")
            filter.success = false;
    }

    AuditPageResult pageResult;
    if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
        pageResult = readAuthAuditPg(cfg.gDatabaseUrl, filter);
#else
        pageResult = readAuthAuditTail(dataRoot, filter);
#endif
    } else {
        pageResult = readAuthAuditTail(dataRoot, filter);
    }

    const std::string csv = auditRowsToCsv(pageResult.logs);
    return makeCsvResponse("auth_audit.csv", csv);
}

// =========================================================================
//  Route registration for remaining (non-module) routes
// =========================================================================
// /api/metrics — exposición Prometheus de pool PG, uptime y configuración.
static http::response<http::string_body> handleMetrics(
    const http::request<http::string_body>& req,
    const std::unordered_map<std::string, std::string>& /*query*/) {

    static const auto start_time = std::chrono::steady_clock::now();
    const auto uptime_s = std::chrono::duration_cast<std::chrono::seconds>(
        std::chrono::steady_clock::now() - start_time).count();

#if HAS_LIBPQ
    auto s = storage::PgPool::instance().stats();
#else
    struct { std::size_t idle=0, active=0, max_size=0;
             std::uint64_t acquires=0, bad_connections=0, waits=0; } s;
#endif

    const unsigned hw = std::thread::hardware_concurrency();
    const int cv_threads = cv::getNumThreads();

    std::ostringstream m;
    m << "# HELP mapas_backend_uptime_seconds Seconds since backend start\n"
      << "# TYPE mapas_backend_uptime_seconds counter\n"
      << "mapas_backend_uptime_seconds " << uptime_s << "\n"
      << "# HELP mapas_backend_pg_pool Connections in PG connection pool\n"
      << "# TYPE mapas_backend_pg_pool gauge\n"
      << "mapas_backend_pg_pool{state=\"idle\"} "   << s.idle   << "\n"
      << "mapas_backend_pg_pool{state=\"active\"} " << s.active << "\n"
      << "mapas_backend_pg_pool_max " << s.max_size << "\n"
      << "# HELP mapas_backend_pg_pool_acquires_total Lifetime acquires\n"
      << "# TYPE mapas_backend_pg_pool_acquires_total counter\n"
      << "mapas_backend_pg_pool_acquires_total "         << s.acquires        << "\n"
      << "mapas_backend_pg_pool_bad_connections_total "  << s.bad_connections << "\n"
      << "mapas_backend_pg_pool_waits_total "            << s.waits           << "\n"
      << "# HELP mapas_backend_hw_concurrency Host CPUs visible to process\n"
      << "# TYPE mapas_backend_hw_concurrency gauge\n"
      << "mapas_backend_hw_concurrency " << hw << "\n"
      << "# HELP mapas_backend_opencv_threads OpenCV thread cap\n"
      << "# TYPE mapas_backend_opencv_threads gauge\n"
      << "mapas_backend_opencv_threads " << cv_threads << "\n";

    const auto &wms = map_mod::wmsProxyStats();
    m << "# HELP beemetry_wms_proxy_requests_total WMS proxy requests by outcome\n"
      << "# TYPE beemetry_wms_proxy_requests_total counter\n"
      << "beemetry_wms_proxy_requests_total{outcome=\"all\"} " << wms.requests.load() << "\n"
      << "beemetry_wms_proxy_requests_total{outcome=\"success\"} " << wms.successes.load() << "\n"
      << "beemetry_wms_proxy_requests_total{outcome=\"error\"} " << wms.errors.load() << "\n"
      << "beemetry_wms_proxy_requests_total{outcome=\"blocked\"} " << wms.blocked.load() << "\n"
      << "# TYPE beemetry_wms_proxy_response_bytes_total counter\n"
      << "beemetry_wms_proxy_response_bytes_total " << wms.bytes.load() << "\n"
      << "# TYPE beemetry_wms_proxy_duration_milliseconds_total counter\n"
      << "beemetry_wms_proxy_duration_milliseconds_total " << wms.durationMs.load() << "\n";

#if HAS_LIBPQ
    {
        auto ti = mining::TelemetryIngestor::instance().stats();
        m << "# HELP mapas_backend_telemetry Telemetry ingestion counters\n"
          << "# TYPE mapas_backend_telemetry counter\n"
          << "mapas_backend_telemetry_received_total "        << ti.received        << "\n"
          << "mapas_backend_telemetry_inserted_total "        << ti.inserted        << "\n"
          << "mapas_backend_telemetry_dropped_full_total "    << ti.dropped_full    << "\n"
          << "mapas_backend_telemetry_dropped_unknown_total " << ti.dropped_unknown << "\n"
          << "mapas_backend_telemetry_flushes_total "         << ti.flushes         << "\n"
          << "mapas_backend_telemetry_flush_errors_total "    << ti.flush_errors    << "\n"
          << "# HELP mapas_backend_telemetry_queued Rows pending flush\n"
          << "# TYPE mapas_backend_telemetry_queued gauge\n"
          << "mapas_backend_telemetry_queued "        << ti.queued         << "\n"
          << "mapas_backend_telemetry_batch_max "     << ti.batch_max      << "\n"
          << "mapas_backend_telemetry_sensors_cached " << ti.sensors_cached << "\n"
          << "# HELP mapas_backend_telemetry_kafka Kafka/Redpanda ingest counters\n"
          << "# TYPE mapas_backend_telemetry_kafka counter\n"
          << "mapas_backend_telemetry_produced_total "       << ti.produced       << "\n"
          << "mapas_backend_telemetry_produce_errors_total " << ti.produce_errors << "\n"
          << "mapas_backend_telemetry_consumed_total "       << ti.consumed       << "\n"
          << "mapas_backend_telemetry_commits_total "        << ti.commits        << "\n"
          << "mapas_backend_telemetry_mode{mode=\"" << ti.mode << "\"} 1\n";

        auto tb = mining::tbsync::thingsBoardSyncStats();
        m << "# HELP mapas_backend_tbsync ThingsBoard (AWS legacy) sync counters\n"
          << "# TYPE mapas_backend_tbsync counter\n"
          << "mapas_backend_tbsync_enabled "                        << (tb.enabled ? 1 : 0)          << "\n"
          << "mapas_backend_tbsync_peers_configured "                << tb.peers_configured           << "\n"
          << "mapas_backend_tbsync_peers_authenticated_total "       << tb.peers_authenticated        << "\n"
          << "mapas_backend_tbsync_login_failures_total "            << tb.login_failures             << "\n"
          << "mapas_backend_tbsync_backfill_runs_total "             << tb.backfill_runs              << "\n"
          << "mapas_backend_tbsync_backfill_points_ingested_total "  << tb.backfill_points_ingested   << "\n"
          << "mapas_backend_tbsync_backfill_errors_total "           << tb.backfill_errors            << "\n"
          << "mapas_backend_tbsync_realtime_ws_connects_total "      << tb.realtime_ws_connects       << "\n"
          << "mapas_backend_tbsync_realtime_ws_reconnects_total "    << tb.realtime_ws_reconnects     << "\n"
          << "mapas_backend_tbsync_realtime_points_ingested_total "  << tb.realtime_points_ingested   << "\n"
          << "mapas_backend_tbsync_realtime_points_dropped_total "   << tb.realtime_points_dropped_unmapped << "\n"
          << "mapas_backend_tbsync_realtime_errors_total "           << tb.realtime_errors            << "\n";
    }
#endif

    http::response<http::string_body> res{http::status::ok, req.version()};
    res.set(http::field::content_type, "text/plain; version=0.0.4; charset=utf-8");
    res.body() = m.str();
    res.prepare_payload();
    return res;
}

static void registerRemainingRoutes(router::Router &r) {
    r.post("/api/auth/register",          handleRegister);
    r.post("/api/auth/login/password",    handleLoginPassword);
    r.post("/api/auth/login/face",        handleLoginFace);
    r.post("/api/auth/logout",            handleLogout);          // T21
    r.post("/api/auth/refresh",           handleTokenRefresh);    // T21
    r.get("/api/auth/audit",              handleAudit);
    r.get("/api/auth/audit/export.csv",   handleAuditExportCsv);
    r.get("/api/reset_capture",           handleResetCapture);
    r.get("/api/captured_images",         handleCapturedImages);
    r.get("/api/users",                   handleLegacyUsers);
    r.post("/api/enroll",                 handleEnroll);
    r.get("/api/metrics",                 handleMetrics);
}

// =========================================================================
//  SSE: push de KPIs en tiempo real desde la RÉPLICA (sin polling del cliente)
//  GET /api/live/kpi  → text/event-stream, evento cada N s.
//  Requiere sesión autenticada; tenant_id viene del token (no del query string).
//  Consulta mining_runtime_kpis (pre-calculados) sobre la réplica de lectura.
// =========================================================================
static void handleLiveKpiSse(beast::tcp_stream& stream,
                             const http::request<http::string_body>& req) {
    beast::error_code ec;

    // 1. Parsear query string para resolución de sesión (auth_token, etc.)
    std::string target(req.target());
    std::unordered_map<std::string, std::string> query;
    {
        auto qpos = target.find('?');
        if (qpos != std::string::npos)
            query = parseQueryString(target.substr(qpos + 1));
    }

    // 2. Requerir sesión válida — tenant desde el token, no del query string
    const auto session = resolveAuthSession(req, query);
    if (!session || session->tenantId.empty()) {
        static const std::string k401 =
            "HTTP/1.1 401 Unauthorized\r\n"
            "Content-Type: application/json\r\n"
            "Content-Length: 38\r\n"
            "Connection: close\r\n\r\n"
            "{\"error\":\"auth_required_or_no_tenant\"}";
        asio::write(stream, asio::buffer(k401), ec);
        return;
    }
    const std::string tenant = session->tenantId;

    // 3. Cabeceras SSE (escritura manual; conexión persistente)
    // Sin Access-Control-Allow-Origin: este endpoint se sirve same-origin vía
    // el proxy nginx /api/ (frontend/nginx.conf) — un wildcard aquí solo
    // permitía a cualquier origen leer el stream de KPIs si obtenía un token
    // válido por otra vía, sin ningún beneficio funcional.
    static const std::string kHead =
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: text/event-stream\r\n"
        "Cache-Control: no-cache\r\n"
        "Connection: keep-alive\r\n\r\n";
    asio::write(stream, asio::buffer(kHead), ec);
    if (ec) return;

#if HAS_LIBPQ
    const std::string replicaUrl = getenvOr(
        "BEEMETRY_REPLICA_DATABASE_URL",
        "host=db_replica port=5432 dbname=sensors_db user=dashboard_ro "
        "password=dash_pass");
    int intervalMs = 2000;
    try { intervalMs = std::stoi(getenvOr("BEEMETRY_LIVE_PUSH_INTERVAL_MS", "2000")); }
    catch (...) {}

    // Degradación graceful: si réplica no disponible, usar primario (Art.3 relajado).
    PGconn* conn = PQconnectdb(replicaUrl.c_str());
    bool usingFallback = false;
    if (PQstatus(conn) != CONNECTION_OK) {
        PQfinish(conn);
        auto &cfg = AppConfig::instance();
        if (cfg.gDatabaseUrl.empty()) return;
        conn = PQconnectdb(cfg.gDatabaseUrl.c_str());
        if (PQstatus(conn) != CONNECTION_OK) { PQfinish(conn); return; }
        usingFallback = true;
        std::cerr << "[SSE] replica unavailable, falling back to primary\n";
    }

    // 4. Query sobre mining_runtime_kpis (valores pre-calculados, sin full-scan
    //    de telemetry_raw) scoped por tenant_id del token → elimina IDOR.
    const std::string sql =
        "SELECT name, value, unit, category "
        "FROM mining_runtime_kpis "
        "WHERE tenant_id = $1::uuid "
        "ORDER BY category, name";
    const char* params[1] = { tenant.c_str() };

    while (true) {
        storage::PgResult r{PQexecParams(conn, sql.c_str(), 1, nullptr, params,
                                         nullptr, nullptr, 0)};
        json::array kpis;
        if (r.okTuples()) {
            for (int i = 0; i < PQntuples(r.get()); ++i) {
                kpis.push_back(json::object{
                    {"name",     PQgetvalue(r.get(), i, 0)},
                    {"value",    std::atof(PQgetvalue(r.get(), i, 1))},
                    {"unit",     PQgetvalue(r.get(), i, 2)},
                    {"category", PQgetvalue(r.get(), i, 3)}});
            }
        }
        json::object envelope{{"tenant", tenant},
                              {"ts", http_utils::nowIso8601()},
                              {"kpis", kpis}};
        if (usingFallback) envelope["degraded"] = true;
        std::string payload = "data: " + json::serialize(envelope) + "\n\n";
        asio::write(stream, asio::buffer(payload), ec);
        if (ec) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(intervalMs));
    }
    PQfinish(conn);
#endif
}

// =========================================================================
//  SSE: chatbot minero -- streaming token a token de Ollama al navegador.
//  POST /api/support/chat/stream → text/event-stream.
//  Requiere sesión autenticada. Mismo body que /api/support/chat/message
//  ({qualifying, messages}), pero en vez de esperar la respuesta completa de
//  Ollama (stream:false, ver support::handleChatMessage), abre una conexión
//  propia con stream:true y reenvía cada fragmento apenas llega -- el
//  usuario ve el texto aparecer progresivamente en vez de esperar ~5-10s en
//  silencio (pedido explícito 2026-07-29 tras optimizar la latencia total).
// =========================================================================
static void handleChatStreamSse(beast::tcp_stream& stream,
                                const http::request<http::string_body>& req) {
    beast::error_code ec;

    const auto session = resolveAuthSession(req, {});
    if (!session) {
        static const std::string k401 =
            "HTTP/1.1 401 Unauthorized\r\n"
            "Content-Type: application/json\r\n"
            "Content-Length: 21\r\n"
            "Connection: close\r\n\r\n"
            "{\"error\":\"unauthorized\"}";
        asio::write(stream, asio::buffer(k401), ec);
        return;
    }

    json::object qualifying;
    json::array messages;
    support::ChatIntent intent = support::ChatIntent::Chat;
    try {
        auto val = json::parse(req.body());
        if (!val.is_object()) throw std::runtime_error("invalid_json");
        const auto &obj = val.as_object();
        if (obj.contains("qualifying") && obj.at("qualifying").is_object()) {
            qualifying = obj.at("qualifying").as_object();
        }
        if (obj.contains("intent") && obj.at("intent").is_string()) {
            intent = support::parseChatIntent(json::value_to<std::string>(obj.at("intent")));
        }
        if (!obj.contains("messages") || !obj.at("messages").is_array()) {
            throw std::runtime_error("missing_messages");
        }
        messages = obj.at("messages").as_array();
        // Mismo tope de abuso que support::handleChatMessage (el recorte por
        // longitud real lo hace buildChatPromptForStreaming, no este guard).
        if (messages.empty() || messages.size() > 200) {
            throw std::runtime_error("invalid_messages");
        }
    } catch (const std::exception &ex) {
        const std::string errBody = json::serialize(json::object{{"error", ex.what()}});
        std::ostringstream resp;
        resp << "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n"
             << "Content-Length: " << errBody.size() << "\r\nConnection: close\r\n\r\n" << errBody;
        const std::string full = resp.str();
        asio::write(stream, asio::buffer(full), ec);
        return;
    }

    const std::string ollamaBase = getenvOr("BEEMETRY_OLLAMA_URL", "");
    if (ollamaBase.empty()) {
        static const std::string kUnavail =
            "HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n"
            "Content-Length: 30\r\nConnection: close\r\n\r\n"
            "{\"error\":\"ollama_not_configured\"}";
        asio::write(stream, asio::buffer(kUnavail), ec);
        return;
    }

    // Cabeceras SSE (misma convención que handleLiveKpiSse arriba).
    static const std::string kHead =
        "HTTP/1.1 200 OK\r\n"
        "Content-Type: text/event-stream\r\n"
        "Cache-Control: no-cache\r\n"
        "Connection: keep-alive\r\n\r\n";
    asio::write(stream, asio::buffer(kHead), ec);
    if (ec) return;

    auto sendSseEvent = [&](const json::value &payload) {
        const std::string data = "data: " + json::serialize(payload) + "\n\n";
        asio::write(stream, asio::buffer(data), ec);
    };

    // Parseo mínimo de BEEMETRY_OLLAMA_URL (http://host:port) -- copia local,
    // mismo criterio que el resto del backend ("cada módulo mantiene su
    // propia copia mínima del cliente HTTP").
    std::string ollamaHost, ollamaPort = "80", ollamaTarget = "/";
    {
        static const std::regex kHttpRegex(
            R"(^http://([A-Za-z0-9\.\-_]+)(?::([0-9]{1,5}))?(\/.*)?$)", std::regex::icase);
        std::smatch m;
        std::string base = ollamaBase;
        while (!base.empty() && base.back() == '/') base.pop_back();
        if (std::regex_match(base, m, kHttpRegex)) {
            ollamaHost = m[1].str();
            if (m.size() > 2 && m[2].matched) ollamaPort = m[2].str();
        }
    }
    if (ollamaHost.empty()) {
        sendSseEvent(json::object{{"error", "ollama_invalid_url"}});
        return;
    }

    try {
        asio::io_context ollamaIoc;
        asio::ip::tcp::resolver resolver{ollamaIoc};
        beast::tcp_stream ollamaStream{ollamaIoc};
        int timeoutMs = 180000;
        try { timeoutMs = std::clamp(std::stoi(getenvOr("BEEMETRY_OLLAMA_CHATBOT_TIMEOUT_MS", "60000")), 5000, 180000); }
        catch (...) { timeoutMs = 60000; }
        ollamaStream.expires_after(std::chrono::milliseconds(timeoutMs));

        const auto results = resolver.resolve(ollamaHost, ollamaPort, ec);
        if (ec) { sendSseEvent(json::object{{"error", "ollama_resolve_failed"}}); return; }
        ollamaStream.connect(results, ec);
        if (ec) { sendSseEvent(json::object{{"error", "ollama_connect_failed"}}); return; }

        const auto promptResult =
            support::buildChatPromptForStreaming(qualifying, messages, session->tenantId, intent);
        json::object reqBody;
        reqBody["model"] = config::AppConfig::instance().gOllamaChatbotModel;
        reqBody["stream"] = true;
        reqBody["prompt"] = promptResult.prompt;
        reqBody["keep_alive"] = "10m";
        // num_ctx / num_predict / stop compartidos con la ruta no-streaming
        // (support::buildOllamaOptions) -- que divergieran era como se colaba
        // la pérdida de contexto solo por el camino de streaming, que es el
        // que usa el widget en producción.
        reqBody["options"] = support::buildOllamaOptions(promptResult);
        const std::string payload = json::serialize(json::value(reqBody));

        http::request<http::string_body> ollamaReq{http::verb::post, "/api/generate", 11};
        ollamaReq.set(http::field::host, ollamaHost);
        ollamaReq.set(http::field::content_type, "application/json");
        ollamaReq.body() = payload;
        ollamaReq.prepare_payload();
        http::write(ollamaStream, ollamaReq, ec);
        if (ec) { sendSseEvent(json::object{{"error", "ollama_write_failed"}}); return; }

        // Lectura incremental: Ollama envía un objeto JSON por línea
        // (newline-delimited) mientras genera. http::response_parser con
        // string_body va acumulando el body en cada read_some() -- se
        // consume el delta nuevo cada vuelta y se separa por '\n'
        // (buffer local por si una línea llega partida entre dos reads).
        http::response_parser<http::string_body> parser;
        parser.body_limit(16 * 1024 * 1024);
        beast::flat_buffer readBuf;
        std::size_t consumed = 0;
        std::string lineBuf;
        bool anyForwarded = false;
        while (!parser.is_done()) {
            http::read_some(ollamaStream, readBuf, parser, ec);
            if (ec && ec != http::error::end_of_stream) {
                break;
            }
            const std::string &body = parser.get().body();
            if (body.size() > consumed) {
                lineBuf.append(body, consumed, body.size() - consumed);
                consumed = body.size();
                std::size_t nl;
                while ((nl = lineBuf.find('\n')) != std::string::npos) {
                    std::string line = lineBuf.substr(0, nl);
                    lineBuf.erase(0, nl + 1);
                    if (line.empty()) continue;
                    try {
                        auto chunkVal = json::parse(line);
                        if (!chunkVal.is_object()) continue;
                        const auto &co = chunkVal.as_object();
                        if (co.contains("response") && co.at("response").is_string()) {
                            const std::string frag = json::value_to<std::string>(co.at("response"));
                            // Filtro CJK por fragmento (ver mining_chatbot_service.hpp) --
                            // se omite silenciosamente el fragmento, sin cortar el stream.
                            if (!frag.empty() && !support::fragmentHasCjk(frag)) {
                                sendSseEvent(json::object{{"chunk", frag}});
                                anyForwarded = true;
                            }
                        }
                        if (co.contains("done") && co.at("done").is_bool() && co.at("done").as_bool()) {
                            sendSseEvent(json::object{{"done", true}});
                            return;
                        }
                    } catch (...) {
                        // Línea parcial/corrupta -- se descarta, el stream continúa.
                    }
                }
            }
            if (ec == http::error::end_of_stream) break;
        }
        if (!anyForwarded) {
            sendSseEvent(json::object{{"error", "ollama_empty_response"}});
        } else {
            sendSseEvent(json::object{{"done", true}});
        }
    } catch (const std::exception &ex) {
        std::cerr << "[chat_stream] excepcion: " << ex.what() << std::endl;
        sendSseEvent(json::object{{"error", "ollama_stream_exception"}});
    }
}

// =========================================================================
//  TCP session handler
// =========================================================================
// Segundos que una conexión keep-alive espera ociosa por la siguiente request
// antes de que el servidor la cierre y libere el hilo. Configurable con
// BEEMETRY_HTTP_KEEPALIVE_TIMEOUT (0 = desactiva keep-alive, comportamiento
// legacy de una request por conexión).
static int httpKeepAliveTimeoutSeconds() {
    static const int v = [] {
        if (const char *e = std::getenv("BEEMETRY_HTTP_KEEPALIVE_TIMEOUT")) {
            try { return std::max(0, std::stoi(e)); } catch (...) {}
        }
        return 15;
    }();
    return v;
}

// Tope de requests por conexión: evita que un cliente monopolice un hilo de
// forma indefinida y fuerza una reconexión periódica (que es también lo que
// permite rebalancear si algún día hay más de una réplica del backend).
static constexpr int kMaxRequestsPerConnection = 100;

// Aplica SO_RCVTIMEO al socket. `expires_after()` de beast::tcp_stream SOLO
// tiene efecto sobre operaciones ASÍNCRONAS — este servidor usa http::read()
// síncrono/bloqueante, así que sin un timeout a nivel socket una conexión
// keep-alive ociosa dejaría su hilo bloqueado en read() para siempre
// (con el modelo hilo-por-conexión de este servidor, eso es una fuga de
// hilos). SO_RCVTIMEO sí corta un read() bloqueante.
static void setSocketReceiveTimeout(beast::tcp_stream &stream, int seconds) {
#ifdef _WIN32
    // Windows espera un DWORD en milisegundos, no un `struct timeval`.
    DWORD ms = static_cast<DWORD>(seconds) * 1000u;
    ::setsockopt(stream.socket().native_handle(), SOL_SOCKET, SO_RCVTIMEO,
                 reinterpret_cast<const char *>(&ms), sizeof(ms));
#else
    struct timeval tv{};
    tv.tv_sec = seconds;
    tv.tv_usec = 0;
    ::setsockopt(stream.socket().native_handle(), SOL_SOCKET, SO_RCVTIMEO,
                 reinterpret_cast<const char *>(&tv), sizeof(tv));
#endif
}

static void session(beast::tcp_stream stream) {
    beast::flat_buffer buffer;
    beast::error_code ec;
    const int keepAliveTimeout = httpKeepAliveTimeoutSeconds();

    // Bucle keep-alive (2026-08-02). Antes este handler leía UNA request,
    // respondía y cerraba el socket: cada llamada a la API costaba un
    // handshake TCP completo + el spawn de un hilo del SO nuevo (ver el accept
    // loop en main(), que hace std::thread(session, ...).detach()). Una carga
    // típica del dashboard dispara decenas de requests, así que el coste era
    // decenas de handshakes + decenas de hilos por pantalla. Reutilizando la
    // conexión, esa misma pantalla usa 1 handshake y 1 hilo.
    for (int served = 0; served < kMaxRequestsPerConnection; ++served) {
        http::request<http::string_body> req;
        http::read(stream, buffer, req, ec);
        if (ec) return;

        // Las ramas WS y SSE de abajo se apropian del socket para toda la vida
        // de la conexión (o la liberan a otro io_context), así que siempre
        // hacen `return` — nunca vuelven al bucle keep-alive.
        if (websocket::is_upgrade(req)) {
            // Resuelve tenant desde la sesión (token en query string ?auth_token=
            // o header Authorization, ver auth::extractAuthTokenFromRequest --
            // el handshake WS del navegador no permite headers custom, así que
            // el cliente debe pasar el token como query param). Sin sesión
            // válida, la conexión igual se acepta (compat con el eco original y
            // con clientes que no necesitan push, p.ej. tests), pero
            // simplemente no se registra en WsRegistry => no recibe push de
            // ningún tenant (fail-closed: nunca queda suscrito "por defecto" a
            // datos de otro tenant).
            const auto query = http_utils::parseQueryString(std::string(req.target()));
            const auto authSession = auth::resolveAuthSession(req, query);
            const std::string tenantId = authSession ? authSession->tenantId : std::string();

            // IMPORTANTE: el socket liberado de `stream` pertenece al io_context
            // *global* del accept loop (ver `asio::io_context ioc{1}` en main()),
            // que jamás se pumpea con `.run()` -- el accept loop usa
            // `acceptor.accept()` SÍNCRONO en un bucle infinito, así que ningún
            // `async_*` colgado de ese io_context terminaría de ejecutarse jamás
            // (confirmado en pruebas: `ws_.async_accept()` nunca completaba, el
            // handshake WS se colgaba indefinidamente sin error ni log -- el eco
            // "original" de este archivo nunca funcionó realmente sobre la red).
            // Cada conexión WS ya corre en su propio hilo dedicado (detached, ver
            // el bucle de accept), así que la forma más simple y correcta de
            // arreglarlo sin rediseñar el modelo de concurrencia del resto del
            // servidor es: crear un io_context propio para ESTE hilo y
            // bloquearlo en `ioc.run()` hasta que la sesión WS termine. El socket
            // ya conectado se puede re-adjuntar (asio::ip::tcp::socket admite
            // moverse de un io_context a otro vía su release_socket()/protocolo
            // nativo) usando `native_handle()` + `assign()`.
            auto wsIoc = std::make_shared<net::io_context>(1);
            auto releasedSocket = stream.release_socket();
            const auto proto = releasedSocket.local_endpoint().protocol();
            const auto nativeHandle = releasedSocket.release();
            tcp::socket wsSocket(*wsIoc, proto, nativeHandle);
            // Se pasa `req` (ya leído arriba vía http::read) al accept: evita
            // que Beast intente releer el handshake HTTP del socket (ver
            // comentario en websocket_session.hpp::run(req) -- causaba
            // "gracefully closed" en pruebas reales contra el stack).
            std::make_shared<WebSocketSession>(std::move(wsSocket), tenantId)->run(req);
            wsIoc->run();
            return;
        }

        // SSE de KPIs en vivo (push, sin polling)
        if (req.target().starts_with("/api/live/kpi")) {
            handleLiveKpiSse(stream, req);
            stream.socket().shutdown(asio::ip::tcp::socket::shutdown_send, ec);
            return;
        }

        // SSE del chatbot minero (streaming token a token de Ollama)
        if (req.method() == http::verb::post && req.target().starts_with("/api/support/chat/stream")) {
            handleChatStreamSse(stream, req);
            stream.socket().shutdown(asio::ip::tcp::socket::shutdown_send, ec);
            return;
        }

        std::string dataRoot = getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
        auto res = gRouter.dispatch(req, dataRoot);

        // Red de seguridad de framing: con una conexión de una sola request,
        // una respuesta sin Content-Length se delimitaba sola al cerrar el
        // socket. Reutilizando la conexión eso ya no vale — sin Content-Length
        // el cliente no sabe dónde termina el cuerpo y la conexión queda
        // desincronizada (la siguiente respuesta se lee como basura). Hoy
        // todos los constructores de http_utils ya llaman prepare_payload();
        // repetirlo aquí es idempotente (recalcula el mismo Content-Length) y
        // evita que un handler futuro que lo olvide corrompa la conexión.
        res.prepare_payload();

        // El cliente decide: si mandó `Connection: close` (o HTTP/1.0 sin
        // keep-alive) se respeta y se cierra. Beast emite la cabecera
        // `Connection` correcta a partir de este flag.
        const bool reuse = req.keep_alive() && keepAliveTimeout > 0 &&
                           served + 1 < kMaxRequestsPerConnection;
        res.keep_alive(reuse);

        http::write(stream, res, ec);
        if (ec || !reuse) break;

        // Ventana de espera por la siguiente request en esta conexión. Se
        // aplica DESPUÉS de responder la primera: así el camino de una sola
        // request (y las ramas WS/SSE de arriba, que ya retornaron) se comporta
        // exactamente igual que antes, y el timeout solo gobierna el tiempo
        // ocioso entre requests. Si expira, http::read() falla y el hilo se
        // libera.
        setSocketReceiveTimeout(stream, keepAliveTimeout);
    }

    stream.socket().shutdown(asio::ip::tcp::socket::shutdown_send, ec);
}

// =========================================================================
//  main()
// =========================================================================
int main() {
    try {
        // OpenCV: cap de hilos para no robar CPU al I/O del backend bajo carga
        // (10K sensores → priorizar Asio). OPENCV_THREADS sobreescribe (default 4).
        {
            int cv_threads = 4;
            if (const char* e = std::getenv("BEEMETRY_OPENCV_THREADS")) {
                try { cv_threads = std::max(1, std::stoi(e)); } catch (...) {}
            }
            cv::setNumThreads(cv_threads);
            cv::setUseOptimized(true);
            std::cout << "[OPENCV] threads=" << cv::getNumThreads()
                      << " optimized=" << (cv::useOptimized() ? "yes" : "no")
                      << " build=" << CV_VERSION << std::endl;
        }

        auto &cfg = AppConfig::instance();
        cfg.loadFromEnv();

        // ── Migración de credenciales a Argon2id (auditoría 2026-08-02) ──
        // Idempotente: en arranques posteriores no encuentra nada que hacer y
        // sale en una consulta. Se ejecuta ANTES de aceptar tráfico para que no
        // quede ni una ventana sirviendo peticiones con hashes legados crudos
        // en la base. Un fallo aquí no impide arrancar: se registra y el
        // esquema legado sigue verificando, como antes.
#if HAS_LIBPQ
        if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
            const auto mig = migrateLegacyPasswordHashesPg(cfg.gDatabaseUrl);
            if (!mig.error.empty()) {
                std::cerr << "[AUTH_PASSWORD] migracion Argon2id no ejecutada: "
                          << mig.error << std::endl;
            } else if (mig.scanned > 0) {
                std::cout << "[AUTH_PASSWORD] migracion Argon2id: "
                          << mig.migrated << "/" << mig.scanned
                          << " hashes legados envueltos, " << mig.failed
                          << " fallidos." << std::endl;
            }
            if (mig.remainingRaw > 0) {
                std::cerr << "[AUTH_PASSWORD] ATENCION: quedan "
                          << mig.remainingRaw
                          << " hashes legados CRUDOS en auth_users." << std::endl;
            }
            if (mig.remainingWrapped > 0) {
                std::cout << "[AUTH_PASSWORD] " << mig.remainingWrapped
                          << " credenciales envueltas pendientes de rehash real "
                             "(se completa en el proximo login de cada usuario)."
                          << std::endl;
            }
        }
#endif
        if (cfg.gAuthStorageMode != AuthStorageMode::Postgres) {
            const int migratedFile = auth::migrateLegacyPasswordHashesFile(
                getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data"));
            if (migratedFile > 0) {
                std::cout << "[AUTH_PASSWORD] migracion Argon2id (modo File): "
                          << migratedFile << " credenciales envueltas."
                          << std::endl;
            }
        }

        const std::string address = getenvOr("BEEMETRY_MAPAS_BIND_ADDRESS", "0.0.0.0");
        const int port = std::stoi(getenvOr("BEEMETRY_MAPAS_PORT", "8081"));

        text_spell::configureFromEnv();

        // Register all module routes
        auth::registerRoutes(gRouter);
        biometric::registerRoutes(gRouter);
        mining::registerRoutes(gRouter);
        mining_iot::registerRoutes(gRouter);
        mining_iot::registerNotificationRoutes(gRouter);
        reports::registerRoutes(gRouter);
        formula::registerRoutes(gRouter);
        platform::registerRoutes(gRouter);
        tenant_assets::registerRoutes(gRouter);
        map_mod::registerRoutes(gRouter);
        gdal_mod::registerRoutes(gRouter);
        text_mod::registerRoutes(gRouter);
        support_mod::registerRoutes(gRouter);
        registerRemainingRoutes(gRouter);

        // ADR-034: motor de alarmas (evaluador de reglas en segundo plano,
        // near-real-time por polling — ver razonamiento en device_alarm_routes.cpp).
        mining_iot::startAlarmEvaluator();

        // Diagnostic output
        std::cout << "beemetry_backend listening on " << address << ":" << port
                  << std::endl;
        std::cout << "auth storage mode: "
                  << (cfg.gAuthStorageMode == AuthStorageMode::Postgres
                          ? "postgres"
                          : "file")
                  << std::endl;
        std::cout << "biometric provider: "
                  << (cfg.gBiometricProvider == BiometricProvider::DermalogCli
                          ? "dermalog_cli"
                          : "legacy")
                  << ", dermalog required: "
                  << (cfg.gDermalogRequired ? "true" : "false") << std::endl;
        auto &dnnCtx = getAccessoryDnnContext();
        std::cout << "biometric dnn: "
                  << (cfg.gBiometricDnnEnabled ? "enabled" : "disabled")
                  << ", model path: "
                  << (cfg.gBiometricDnnModelPath.empty()
                          ? "(none)"
                          : cfg.gBiometricDnnModelPath)
                  << ", threshold: " << cfg.gBiometricDnnThreshold
                  << ", loaded: " << (dnnCtx.loaded ? "true" : "false");
        if (!dnnCtx.initError.empty())
            std::cout << ", init_error: " << dnnCtx.initError;
        std::cout << std::endl;
        std::cout << "cartoon_onnx: linked="
                  << (informeCartoonOnnxRuntimeLinked() ? "true" : "false")
                  << ", model="
                  << (cfg.gCartoonOnnxModelPath.empty()
                          ? "(none)"
                          : cfg.gCartoonOnnxModelPath)
                  << ", exists="
                  << ((!cfg.gCartoonOnnxModelPath.empty() &&
                       fs::exists(cfg.gCartoonOnnxModelPath))
                          ? "true"
                          : "false")
                  << std::endl;
        std::cout << "ai_engine_url: "
                  << (cfg.gAiEngineUrl.empty() ? "(disabled)" : cfg.gAiEngineUrl)
                  << ", timeout_ms: " << cfg.gAiEngineTimeoutMs
                  << ", cartoon_timeout_ms: " << cfg.gAiEngineCartoonTimeoutMs
                  << ", max_image_bytes: " << cfg.gAiEngineMaxImageBytes
                  << ", face_embed_cos_thr: "
                  << cfg.gFaceEmbeddingCosineThreshold
                  << ", face_legacy_cos_thr: "
                  << cfg.gFaceLegacyCosineThreshold
                  << ", image_optimizer: "
                  << (cfg.gImageOptimizerEnabled ? "enabled" : "disabled")
                  << ", max_pixels: " << cfg.gBiometricMaxPixels << std::endl;

        // Ingestor de telemetría de alta tasa (10K+ sensores). Se arranca aquí
        // para que la caché de sensores y el hilo flusher estén listos antes de
        // aceptar conexiones en el gateway. Activable con TELEMETRY_INGEST_ENABLE.
        const bool telemetryIngestEnabled =
            getenvOr("BEEMETRY_TELEMETRY_INGEST_ENABLE", "true") != "false" &&
            cfg.gAuthStorageMode == AuthStorageMode::Postgres &&
            !cfg.gDatabaseUrl.empty();
#if HAS_LIBPQ
        if (telemetryIngestEnabled) {
            std::size_t batch = 1000;
            int flushMs = 200;
            try { batch = std::stoul(getenvOr("BEEMETRY_TELEMETRY_BATCH_SIZE", "1000")); }
            catch (...) {}
            try { flushMs = std::stoi(getenvOr("BEEMETRY_TELEMETRY_FLUSH_MS", "200")); }
            catch (...) {}
            // El ingestor usa UNA conexión persistente para COPY → va DIRECTO a
            // la BD (no por pgbouncer, que es para las conexiones cortas del
            // backend). TELEMETRY_DATABASE_URL permite sobreescribir.
            const std::string ingestUrl =
                getenvOr("BEEMETRY_TELEMETRY_DATABASE_URL", cfg.gDatabaseUrl);
            // Modo Kafka (ingesta durable vía Redpanda) si TELEMETRY_INGEST_MODE=kafka
            if (getenvOr("BEEMETRY_TELEMETRY_INGEST_MODE", "direct") == "kafka") {
                mining::TelemetryIngestor::instance().configureKafka(
                    getenvOr("BEEMETRY_KAFKA_BROKERS", "redpanda:9092"),
                    getenvOr("BEEMETRY_KAFKA_TOPIC", "telemetry"),
                    getenvOr("BEEMETRY_KAFKA_CONSUMER_GROUP", "telemetry-writers"));
            }
            mining::TelemetryIngestor::instance().start(ingestUrl, batch,
                                                        flushMs);

            // Agregador de mapa: push diferencial por WS (ver
            // ws_broadcast.hpp / map_aggregator.hpp). Reusa la misma
            // BEEMETRY_TELEMETRY_DATABASE_URL/gDatabaseUrl que el resto del
            // backend (no el canal directo de COPY del ingestor).
            int mapPollMs = 3000;
            try { mapPollMs = std::stoi(getenvOr("BEEMETRY_MAP_AGGREGATOR_POLL_MS", "3000")); }
            catch (...) {}
            mining::MapAggregator::instance().start(cfg.gDatabaseUrl, mapPollMs);

            // ADR-034: adaptadores de protocolo (MQTT/Modbus TCP/OPC UA).
            // Después del ingestor: normalizan todo al evento canónico y lo
            // entregan a TelemetryIngestor::ingestLine(), así que dependen de
            // que la caché de sensores y el pipeline ya estén arriba.
            mining::protocols::startAdapters(cfg.gDatabaseUrl);

            // Sync ThingsBoard (AWS legacy) → plataforma propia, ver
            // thingsboard_sync.hpp. Gated por BEEMETRY_THINGSBOARD_SYNC_ENABLED
            // (default false); no-op si está deshabilitado o sin peer configurado.
            mining::tbsync::startThingsBoardSync(cfg.gDatabaseUrl);
        }
#endif

        // Mining Gateway secondary listener: ingesta telemétrica TLS de sensores.
        // Pool de N hilos sobre el mismo io_context → paraleliza I/O para ~10K
        // conexiones concurrentes. Configurable con MINING_GATEWAY_THREADS
        // (default = min(hardware_concurrency, 8)).
        std::thread([telemetryIngestEnabled]() {
            try {
                std::cout << "[MINING-GATEWAY] Thread starting..." << std::endl;
                asio::io_context mining_ioc;
                mining::MiningConfig mcfg;
                mcfg.port = static_cast<unsigned short>(
                    std::stoi(getenvOr("BEEMETRY_MINING_GATEWAY_PORT", "8443")));
                mcfg.cert_path = getenvOr("BEEMETRY_TLS_CERT_PATH",
                    "/etc/mining-gateway/certs/server.crt");
                mcfg.key_path = getenvOr("BEEMETRY_TLS_KEY_PATH",
                    "/etc/mining-gateway/certs/server.key");
                mcfg.ingest_enabled = telemetryIngestEnabled;
                std::cout << "[MINING-GATEWAY] Initializing on "
                          << mcfg.bind_address << ":" << mcfg.port
                          << " ingest=" << (mcfg.ingest_enabled ? "on" : "off")
                          << std::endl;
                mining::MiningServer server(mining_ioc, mcfg);
                server.run();

                unsigned hw = std::thread::hardware_concurrency();
                if (hw == 0) hw = 4;
                unsigned n_workers = std::min(hw, 8u);
                if (const char* e = std::getenv("BEEMETRY_MINING_GATEWAY_THREADS")) {
                    try { n_workers = std::max(1u,
                        static_cast<unsigned>(std::stoi(e))); }
                    catch (...) {}
                }
                if (n_workers < 2) n_workers = 2;
                std::cout << "[MINING-GATEWAY] Running on " << n_workers
                          << " I/O worker threads" << std::endl;

                std::vector<std::thread> workers;
                workers.reserve(n_workers - 1);
                for (unsigned i = 0; i + 1 < n_workers; ++i) {
                    workers.emplace_back([&mining_ioc] { mining_ioc.run(); });
                }
                mining_ioc.run();  // este hilo también participa
                for (auto& t : workers) if (t.joinable()) t.join();
            } catch (const std::exception &e) {
                std::cerr << "[MINING-GATEWAY] Fatal: " << e.what() << std::endl;
            }
        }).detach();

        // Main accept loop
        asio::io_context ioc{1};
        asio::ip::tcp::acceptor acceptor{
            ioc,
            {asio::ip::make_address(address),
             static_cast<unsigned short>(port)}};

        for (;;) {
            asio::ip::tcp::socket socket{ioc};
            acceptor.accept(socket);
            std::thread(session, beast::tcp_stream(std::move(socket))).detach();
        }
    } catch (const std::exception &ex) {
        std::cerr << "Fatal error: " << ex.what() << std::endl;
        return 1;
    }
}
