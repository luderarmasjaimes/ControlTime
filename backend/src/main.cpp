// --------------------------------------------------------------------------
// main.cpp  –  Modular entry point for mapas_backend
// --------------------------------------------------------------------------

#include <boost/asio.hpp>
#include <boost/beast.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/json.hpp>
#include <opencv2/opencv.hpp>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <future>
#include <iostream>
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
#include "biometric/biometric_types.hpp"
#include "biometric/face_analysis.hpp"
#include "biometric/ai_engine_client.hpp"
#include "biometric/biometric_routes.hpp"
#include "mining/mining_routes.hpp"
#include "mining/mining_gateway.hpp"
#include "reports/report_routes.hpp"
#include "formula/formula_service.hpp"
#include "formula/formula_routes.hpp"
#include "platform/platform_routes.hpp"
#include "map/map_routes.hpp"
#include "gdal/gdal_routes.hpp"
#include "gdal/conversion_service.hpp"
#include "text/text_routes.hpp"
#include "text_spell_service.hpp"
#include "onnx_cartoon.hpp"
#include "vision_pipeline.hpp"
#include "websocket_session.hpp"

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
using auth::readAuthAuditPg;
using auth::registerUserPg;
using auth::loginPasswordPg;
using auth::loginFaceTargetedPg;
using auth::updateUserAvatarCartoonPg;
#endif
using auth::updateUserAvatarCartoonFile;

using biometric::BiometricCaptureRuntimeState;
using biometric::gBiometricCaptureMutex;
using biometric::gBiometricCaptureState;
using biometric::gBiometricCapturedImages;
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

// =========================================================================
//  Route handlers NOT yet extracted into modules
// =========================================================================

// ── GET /api/reset_capture ──────────────────────────────────────────────
static http::response<http::string_body>
handleResetCapture(const http::request<http::string_body> & /*req*/,
                   const std::unordered_map<std::string, std::string> & /*query*/) {
    std::scoped_lock lk(gBiometricCaptureMutex);
    gBiometricCaptureState = BiometricCaptureRuntimeState{};
    gBiometricCapturedImages.clear();
    return makeJsonResponse(http::status::ok, json::object{{"status", "reset"}});
}

// ── GET /api/captured_images ────────────────────────────────────────────
static http::response<http::string_body>
handleCapturedImages(const http::request<http::string_body> & /*req*/,
                     const std::unordered_map<std::string, std::string> & /*query*/) {
    json::array arr;
    {
        std::scoped_lock lk(gBiometricCaptureMutex);
        for (const auto &img : gBiometricCapturedImages) {
            arr.push_back(json::value(img));
        }
    }
    return makeJsonResponse(http::status::ok, arr);
}

// ── GET /api/users ──────────────────────────────────────────────────────
static http::response<http::string_body>
handleLegacyUsers(const http::request<http::string_body> & /*req*/,
                  const std::unordered_map<std::string, std::string> & /*query*/) {
    const std::string dataRoot = getenvOr("MAPAS_DATA_ROOT", "/data");
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

        double confidence = 0.0;
        {
            std::scoped_lock lk(gBiometricCaptureMutex);
            if (gBiometricCaptureState.captureCount < 3 ||
                gBiometricCaptureState.state != 7) {
                return makeJsonResponse(http::status::bad_request,
                                        json::object{{"error", "Capture process not complete"}});
            }
            confidence = gBiometricCaptureState.livenessScore;
            gBiometricCaptureState = BiometricCaptureRuntimeState{};
            gBiometricCapturedImages.clear();
        }

        const std::string dataRoot = getenvOr("MAPAS_DATA_ROOT", "/data");
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
    const std::string dataRoot = getenvOr("MAPAS_DATA_ROOT", "/data");
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
                    if (bgCartoonOpt.has_value()) {
                        try {
                            auto cartoonB = bgCartoonOpt->get();
                            bgLog("bust_future_done");
                            if (cartoonB.ok()) {
                                b64 = std::move(cartoonB.imageBase64);
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
                        }
                    }
                    if (b64.empty() && !bgPortrait.empty()) {
                        bgLog("cartoon_sync_portrait_bg");
                        auto cartoon2 = fetchCartoonAvatarBestEffort(bgPortrait);
                        if (cartoon2.ok()) {
                            b64 = std::move(cartoon2.imageBase64);
                        }
                    }
                    if (b64.empty()) {
                        bgLog("cartoon_all_failed_bg");
                        return;
                    }
                    bgLog("cartoon_ok_updating_store");
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

        return makeJsonResponse(
            http::status::created,
            json::object{{"status", "registered"},
                         {"biometric_provider", biometricProvider},
                         {"quality_score", qualityScore},
                         {"user", authUserSessionJson(created,
                                                      sessionToken.token)}});
    } catch (const std::exception &ex) {
        const std::string dataRoot = getenvOr("MAPAS_DATA_ROOT", "/data");
        appendAuthAuditLog(dataRoot, "register", "unknown", "unknown", false,
                           ex.what());
        return makeJsonResponse(http::status::bad_request,
                                json::object{{"error", ex.what()}});
    }
}

// ── POST /api/auth/login/password ───────────────────────────────────────
static http::response<http::string_body>
handleLoginPassword(const http::request<http::string_body> &req,
                    const std::unordered_map<std::string, std::string> & /*query*/) {
    auto &cfg = AppConfig::instance();
    const std::string dataRoot = getenvOr("MAPAS_DATA_ROOT", "/data");
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

        AuthUser found;
        bool ok = false;
        {
            std::scoped_lock lk(gAuthMutex);
            if (cfg.gAuthStorageMode == AuthStorageMode::Postgres) {
#if HAS_LIBPQ
                std::string dbError;
                std::string errCode;
                auto user = loginPasswordPg(cfg.gDatabaseUrl, company, username,
                                            hashPassword(password), dbError,
                                            &errCode);
                if (!user) {
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
                const AuthUser *match = nullptr;
                size_t matchCount = 0;
                const auto users = loadAuthUsers(dataRoot);
                for (const auto &u : users) {
                    if (u.company != company) continue;
                    if (authIdentityKeyMatchesFsUser(username, u)) {
                        match = &u;
                        matchCount++;
                    }
                }
                if (matchCount == 0) {
                    appendAuthAuditLog(dataRoot, "login_password", company,
                                       username, false, "user_not_found");
                    return makeJsonResponse(
                        http::status::unauthorized,
                        json::object{{"error", std::string(kAuthUserNotFoundMsg)},
                                     {"code", "user_not_found"}});
                }
                if (matchCount > 1) {
                    appendAuthAuditLog(dataRoot, "login_password", company,
                                       username, false, "ambiguous_identity");
                    return makeJsonResponse(
                        http::status::unauthorized,
                        json::object{{"error", std::string(kAuthAmbiguousIdentityMsg)},
                                     {"code", "ambiguous_identity"}});
                }
                if (match->passwordHash != hashPassword(password)) {
                    appendAuthAuditLog(dataRoot, "login_password", company,
                                       match->username, false, "invalid_password");
                    return makeJsonResponse(
                        http::status::unauthorized,
                        json::object{{"error", std::string(kAuthWrongPasswordMsg)},
                                     {"code", "wrong_password"}});
                }
                appendAuthAuditLog(dataRoot, "login_password", company,
                                   match->username, true, "ok");
                found = *match;
                ok = true;
            }
        }

        if (!ok) {
            return makeJsonResponse(http::status::unauthorized,
                                    json::object{{"error", "invalid credentials"}});
        }

        const auto sessionToken = issueAuthSession(found);
        return makeJsonResponse(
            http::status::ok,
            json::object{{"status", "authenticated"},
                         {"method", "password"},
                         {"user", authUserSessionJson(found, sessionToken.token)}});
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
    const std::string dataRoot = getenvOr("MAPAS_DATA_ROOT", "/data");
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

        const auto sessionToken = issueAuthSession(bestUser);
        std::cout << "[AUTH_FACE] success user=" << bestUser.username
                  << " company=" << bestUser.company
                  << " provider=" << biometricProvider
                  << " score=" << bestScore << std::endl;

        return makeJsonResponse(
            http::status::ok,
            json::object{{"status", "authenticated"},
                         {"method", "face"},
                         {"biometric_provider", biometricProvider},
                         {"score", bestScore},
                         {"user", authUserSessionJson(bestUser,
                                                      sessionToken.token)}});
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
    const std::string dataRoot = getenvOr("MAPAS_DATA_ROOT", "/data");

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
    const std::string dataRoot = getenvOr("MAPAS_DATA_ROOT", "/data");

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
static void registerRemainingRoutes(router::Router &r) {
    r.post("/api/auth/register",          handleRegister);
    r.post("/api/auth/login/password",    handleLoginPassword);
    r.post("/api/auth/login/face",        handleLoginFace);
    r.get("/api/auth/audit",              handleAudit);
    r.get("/api/auth/audit/export.csv",   handleAuditExportCsv);
    r.get("/api/reset_capture",           handleResetCapture);
    r.get("/api/captured_images",         handleCapturedImages);
    r.get("/api/users",                   handleLegacyUsers);
    r.post("/api/enroll",                 handleEnroll);
}

// =========================================================================
//  TCP session handler
// =========================================================================
static void session(beast::tcp_stream stream) {
    beast::flat_buffer buffer;
    beast::error_code ec;
    http::request<http::string_body> req;
    http::read(stream, buffer, req, ec);
    if (ec) return;

    if (websocket::is_upgrade(req)) {
        std::make_shared<WebSocketSession>(stream.release_socket())->run();
        return;
    }

    std::string dataRoot = getenvOr("MAPAS_DATA_ROOT", "/data");
    auto res = gRouter.dispatch(req, dataRoot);
    http::write(stream, res, ec);
    stream.socket().shutdown(asio::ip::tcp::socket::shutdown_send, ec);
}

// =========================================================================
//  main()
// =========================================================================
int main() {
    try {
        auto &cfg = AppConfig::instance();
        cfg.loadFromEnv();

        const std::string address = getenvOr("MAPAS_BIND_ADDRESS", "0.0.0.0");
        const int port = std::stoi(getenvOr("MAPAS_PORT", "8081"));

        text_spell::configureFromEnv();

        // Register all module routes
        auth::registerRoutes(gRouter);
        biometric::registerRoutes(gRouter);
        mining::registerRoutes(gRouter);
        reports::registerRoutes(gRouter);
        formula::registerRoutes(gRouter);
        platform::registerRoutes(gRouter);
        map_mod::registerRoutes(gRouter);
        gdal_mod::registerRoutes(gRouter);
        text_mod::registerRoutes(gRouter);
        registerRemainingRoutes(gRouter);

        // Diagnostic output
        std::cout << "mapas_backend listening on " << address << ":" << port
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

        // Mining Gateway secondary listener
        std::thread([]() {
            try {
                std::cout << "[MINING-GATEWAY] Thread starting..." << std::endl;
                asio::io_context mining_ioc;
                mining::MiningConfig mcfg;
                mcfg.port = static_cast<unsigned short>(
                    std::stoi(getenvOr("MINING_GATEWAY_PORT", "8443")));
                mcfg.cert_path = getenvOr("TLS_CERT_PATH",
                    "/etc/mining-gateway/certs/server.crt");
                mcfg.key_path = getenvOr("TLS_KEY_PATH",
                    "/etc/mining-gateway/certs/server.key");
                std::cout << "[MINING-GATEWAY] Initializing on "
                          << mcfg.bind_address << ":" << mcfg.port << std::endl;
                mining::MiningServer server(mining_ioc, mcfg);
                server.run();
                mining_ioc.run();
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
