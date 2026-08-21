// --------------------------------------------------------------------------
// rp_odoo_sync.cpp — implementación (ver rp_odoo_sync.hpp)
// --------------------------------------------------------------------------
#include "rp_odoo_sync.hpp"
#include "../http/http_client.hpp"

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#    include <libpq-fe.h>
#  elif __has_include(<postgresql/libpq-fe.h>)
#    define HAS_LIBPQ 1
#    include <postgresql/libpq-fe.h>
#  else
#    define HAS_LIBPQ 0
#  endif
#else
#  if __has_include(<libpq-fe.h>)
#    include <libpq-fe.h>
#  else
#    include <postgresql/libpq-fe.h>
#  endif
#endif

#if HAS_LIBPQ

#include "storage/pg_result.hpp"
#include "../ws_broadcast.hpp"

#include <boost/beast/http.hpp>
#include <boost/json.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <memory>
#include <mutex>
#include <random>
#include <sstream>
#include <thread>
#include <unordered_map>
#include <vector>

namespace http = boost::beast::http;
namespace json = boost::json;

namespace mining {
namespace rpsync {

namespace {

// ── Config/env helpers (mismo patrón que thingsboard_sync.cpp) ───────────
std::string envOr(const char* k, const std::string& def) {
    const char* v = std::getenv(k);
    return (v && *v) ? std::string(v) : def;
}
bool envFlag(const char* k, bool def) {
    const std::string v = envOr(k, def ? "true" : "false");
    return v == "true" || v == "1" || v == "yes";
}
int envInt(const char* k, int def) {
    try { return std::stoi(envOr(k, std::to_string(def))); } catch (...) { return def; }
}

std::atomic<bool> g_running{false};
std::vector<std::thread> g_threads;

std::atomic<std::uint64_t> m_peers_configured{0};
std::atomic<std::uint64_t> m_peers_authenticated{0};
std::atomic<std::uint64_t> m_auth_failures{0};
std::atomic<std::uint64_t> m_backfill_runs{0};
std::atomic<std::uint64_t> m_backfill_upserted{0};
std::atomic<std::uint64_t> m_backfill_errors{0};
std::atomic<std::uint64_t> m_incremental_polls{0};
std::atomic<std::uint64_t> m_incremental_upserted{0};
std::atomic<std::uint64_t> m_incremental_errors{0};
std::atomic<std::uint64_t> m_webhook_nudges{0};
std::atomic<std::uint64_t> m_webhook_nudge_errors{0};
std::atomic<std::uint64_t> m_outbox_sent{0};
std::atomic<std::uint64_t> m_outbox_retried{0};
std::atomic<std::uint64_t> m_outbox_dead{0};
std::atomic<std::uint64_t> m_xmlrpc_errors{0};
std::atomic<std::uint64_t> m_circuit_open_events{0};

// ==========================================================================
// Codec XML-RPC mínimo — solo lo que Odoo necesita: authenticate/execute_kw
// con tipos string/int/boolean/array/struct/nil. Se hand-rolla en vez de
// tomar una dependencia nueva (boost::property_tree no está en uso en el
// resto del backend ni en vcpkg.json) — igual criterio que el resto del
// repo, que marshala JSON a mano con boost::json en vez de una librería de
// esquema genérico.
// ==========================================================================

std::string xmlEscape(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (char c : s) {
        switch (c) {
            case '&': out += "&amp;"; break;
            case '<': out += "&lt;"; break;
            case '>': out += "&gt;"; break;
            default: out += c;
        }
    }
    return out;
}

std::string xmlUnescape(const std::string& s) {
    std::string out;
    out.reserve(s.size());
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (s[i] == '&') {
            if (s.compare(i, 5, "&amp;") == 0) { out += '&'; i += 4; continue; }
            if (s.compare(i, 4, "&lt;") == 0) { out += '<'; i += 3; continue; }
            if (s.compare(i, 4, "&gt;") == 0) { out += '>'; i += 3; continue; }
            if (s.compare(i, 6, "&apos;") == 0) { out += '\''; i += 5; continue; }
            if (s.compare(i, 6, "&quot;") == 0) { out += '"'; i += 5; continue; }
        }
        out += s[i];
    }
    return out;
}

struct XrValue {
    enum class Kind { Nil, Bool, Int, Double, String, Array, Struct } kind{Kind::Nil};
    bool b{false};
    long long i{0};
    double d{0.0};
    std::string s;
    std::vector<XrValue> arr;
    std::vector<std::pair<std::string, XrValue>> obj;

    static XrValue Str(std::string v) { XrValue x; x.kind = Kind::String; x.s = std::move(v); return x; }
    static XrValue Int(long long v) { XrValue x; x.kind = Kind::Int; x.i = v; return x; }
    static XrValue Bool(bool v) { XrValue x; x.kind = Kind::Bool; x.b = v; return x; }
    static XrValue Dbl(double v) { XrValue x; x.kind = Kind::Double; x.d = v; return x; }
    static XrValue Arr(std::vector<XrValue> v) { XrValue x; x.kind = Kind::Array; x.arr = std::move(v); return x; }
    static XrValue Obj(std::vector<std::pair<std::string, XrValue>> v) { XrValue x; x.kind = Kind::Struct; x.obj = std::move(v); return x; }

    std::string encode() const {
        std::ostringstream o;
        o << "<value>";
        switch (kind) {
            case Kind::Nil: o << "<nil/>"; break;
            case Kind::Bool: o << "<boolean>" << (b ? 1 : 0) << "</boolean>"; break;
            case Kind::Int: o << "<int>" << i << "</int>"; break;
            case Kind::Double: o << "<double>" << d << "</double>"; break;
            case Kind::String: o << "<string>" << xmlEscape(s) << "</string>"; break;
            case Kind::Array: {
                o << "<array><data>";
                for (const auto& v : arr) o << v.encode();
                o << "</data></array>";
                break;
            }
            case Kind::Struct: {
                o << "<struct>";
                for (const auto& kv : obj) {
                    o << "<member><name>" << xmlEscape(kv.first) << "</name>" << kv.second.encode() << "</member>";
                }
                o << "</struct>";
                break;
            }
        }
        o << "</value>";
        return o.str();
    }
};

json::value xrToJson(const XrValue& v) {
    switch (v.kind) {
        case XrValue::Kind::Nil: return nullptr;
        case XrValue::Kind::Bool: return v.b;
        case XrValue::Kind::Int: return v.i;
        case XrValue::Kind::Double: return v.d;
        case XrValue::Kind::String: return json::string(v.s);
        case XrValue::Kind::Array: {
            json::array a;
            for (const auto& e : v.arr) a.push_back(xrToJson(e));
            return a;
        }
        case XrValue::Kind::Struct: {
            json::object o;
            for (const auto& kv : v.obj) o[kv.first] = xrToJson(kv.second);
            return o;
        }
    }
    return nullptr;
}

const XrValue* findMember(const XrValue& structVal, const std::string& name) {
    if (structVal.kind != XrValue::Kind::Struct) return nullptr;
    for (const auto& kv : structVal.obj) {
        if (kv.first == name) return &kv.second;
    }
    return nullptr;
}

std::string readStrField(const XrValue* v) {
    return (v && v->kind == XrValue::Kind::String) ? v->s : std::string();
}

// Campos many2one de Odoo llegan como `false` (sin valor) o `[id, "Display Name"]`.
bool readMany2One(const XrValue* v, long long& idOut, std::string& nameOut) {
    if (!v || v->kind != XrValue::Kind::Array || v->arr.size() != 2) return false;
    if (v->arr[0].kind != XrValue::Kind::Int) return false;
    idOut = v->arr[0].i;
    nameOut = v->arr[1].kind == XrValue::Kind::String ? v->arr[1].s : std::string();
    return true;
}

bool readDoubleField(const XrValue* v, double& out) {
    if (!v) return false;
    if (v->kind == XrValue::Kind::Double) { out = v->d; return true; }
    if (v->kind == XrValue::Kind::Int) { out = static_cast<double>(v->i); return true; }
    return false;
}

// ── Parser XML-RPC: extractor genérico de elemento con nesting mismo-nombre ─
struct ElementSpan {
    bool ok{false};
    std::size_t contentStart{0};
    std::size_t contentEnd{0};
    std::size_t afterCloseTag{0};
};

ElementSpan extractElement(const std::string& s, std::size_t fromPos, const std::string& tag) {
    ElementSpan sp;
    const std::string openFull = "<" + tag + ">";
    const std::string openSelf = "<" + tag + "/>";
    const std::string closeTag = "</" + tag + ">";
    std::size_t p = fromPos;
    while (p < s.size() && std::isspace(static_cast<unsigned char>(s[p]))) ++p;
    if (s.compare(p, openSelf.size(), openSelf) == 0) {
        sp.contentStart = sp.contentEnd = sp.afterCloseTag = p + openSelf.size();
        sp.ok = true;
        return sp;
    }
    if (s.compare(p, openFull.size(), openFull) != 0) return sp;
    std::size_t cursor = p + openFull.size();
    int depth = 1;
    while (cursor < s.size() && depth > 0) {
        const std::size_t nextOpen = s.find(openFull, cursor);
        const std::size_t nextClose = s.find(closeTag, cursor);
        if (nextClose == std::string::npos) return sp;  // malformado
        if (nextOpen != std::string::npos && nextOpen < nextClose) {
            ++depth;
            cursor = nextOpen + openFull.size();
        } else {
            --depth;
            if (depth == 0) {
                sp.contentStart = p + openFull.size();
                sp.contentEnd = nextClose;
                sp.afterCloseTag = nextClose + closeTag.size();
                sp.ok = true;
                return sp;
            }
            cursor = nextClose + closeTag.size();
        }
    }
    return sp;
}

std::string sliceTrim(const std::string& s, std::size_t a, std::size_t b) {
    return (a < b && b <= s.size()) ? s.substr(a, b - a) : std::string();
}

bool parseValue(const std::string& s, std::size_t pos, XrValue& out, std::size_t& endPos) {
    const auto valueSpan = extractElement(s, pos, "value");
    if (!valueSpan.ok) return false;
    endPos = valueSpan.afterCloseTag;

    std::size_t a = valueSpan.contentStart;
    while (a < valueSpan.contentEnd && std::isspace(static_cast<unsigned char>(s[a]))) ++a;
    if (a >= valueSpan.contentEnd) { out = XrValue::Str(""); return true; }  // <value></value> = string vacío

    auto startsWith = [&](const char* tag) {
        const std::size_t len = std::strlen(tag);
        return s.compare(a, len, tag) == 0;
    };

    if (startsWith("<string")) {
        const auto sp = extractElement(s, a, "string");
        out = XrValue::Str(xmlUnescape(sliceTrim(s, sp.contentStart, sp.contentEnd)));
    } else if (startsWith("<int") && !startsWith("<int64")) {
        const auto sp = extractElement(s, a, "int");
        try { out = XrValue::Int(std::stoll(sliceTrim(s, sp.contentStart, sp.contentEnd))); }
        catch (...) { out = XrValue::Int(0); }
    } else if (startsWith("<i4")) {
        const auto sp = extractElement(s, a, "i4");
        try { out = XrValue::Int(std::stoll(sliceTrim(s, sp.contentStart, sp.contentEnd))); }
        catch (...) { out = XrValue::Int(0); }
    } else if (startsWith("<boolean")) {
        const auto sp = extractElement(s, a, "boolean");
        const std::string t = sliceTrim(s, sp.contentStart, sp.contentEnd);
        out = XrValue::Bool(!t.empty() && t[0] == '1');
    } else if (startsWith("<double")) {
        const auto sp = extractElement(s, a, "double");
        try { out = XrValue::Dbl(std::stod(sliceTrim(s, sp.contentStart, sp.contentEnd))); }
        catch (...) { out = XrValue::Int(0); }
    } else if (startsWith("<dateTime.iso8601")) {
        const auto sp = extractElement(s, a, "dateTime.iso8601");
        out = XrValue::Str(sliceTrim(s, sp.contentStart, sp.contentEnd));
    } else if (startsWith("<nil")) {
        out = XrValue{};  // Kind::Nil por defecto
    } else if (startsWith("<array")) {
        const auto arrSp = extractElement(s, a, "array");
        const auto dataSp = extractElement(s, arrSp.contentStart, "data");
        std::vector<XrValue> items;
        std::size_t cur = dataSp.contentStart;
        while (true) {
            const std::size_t nextValuePos = s.find("<value", cur);
            if (nextValuePos == std::string::npos || nextValuePos >= dataSp.contentEnd) break;
            XrValue v;
            std::size_t after;
            if (!parseValue(s, nextValuePos, v, after)) break;
            items.push_back(std::move(v));
            cur = after;
        }
        out = XrValue::Arr(std::move(items));
    } else if (startsWith("<struct")) {
        const auto structSp = extractElement(s, a, "struct");
        std::vector<std::pair<std::string, XrValue>> members;
        std::size_t cur = structSp.contentStart;
        while (true) {
            const std::size_t nextMemberPos = s.find("<member>", cur);
            if (nextMemberPos == std::string::npos || nextMemberPos >= structSp.contentEnd) break;
            const auto memberSp = extractElement(s, nextMemberPos, "member");
            const auto nameSp = extractElement(s, memberSp.contentStart, "name");
            const std::string name = xmlUnescape(sliceTrim(s, nameSp.contentStart, nameSp.contentEnd));
            const std::size_t valPos = s.find("<value", nameSp.afterCloseTag);
            XrValue v;
            std::size_t after;
            if (valPos != std::string::npos && valPos < memberSp.contentEnd) parseValue(s, valPos, v, after);
            members.emplace_back(name, std::move(v));
            cur = memberSp.afterCloseTag;
        }
        out = XrValue::Obj(std::move(members));
    } else {
        // XML-RPC: <value> sin tag hijo = string por defecto (default type).
        out = XrValue::Str(xmlUnescape(sliceTrim(s, a, valueSpan.contentEnd)));
    }
    return true;
}

// ── Llamada XML-RPC de alto nivel ─────────────────────────────────────────
struct XmlRpcCallResult {
    bool ok{false};
    bool isFault{false};
    int faultCode{0};
    std::string faultString;
    XrValue value;
    std::string error;
};

std::string buildMethodCall(const std::string& method, const std::vector<XrValue>& params) {
    std::ostringstream o;
    o << "<?xml version=\"1.0\"?><methodCall><methodName>" << method
      << "</methodName><params>";
    for (const auto& p : params) o << "<param>" << p.encode() << "</param>";
    o << "</params></methodCall>";
    return o.str();
}

XmlRpcCallResult xmlRpcCall(const std::string& endpointUrl, const std::string& methodName,
                            const std::vector<XrValue>& params, int timeoutMs) {
    XmlRpcCallResult out;
    const std::string body = buildMethodCall(methodName, params);
    const auto res = http_client::request(endpointUrl, http::verb::post, body,
                                          {{"Content-Type", "text/xml"}}, timeoutMs);
    if (!res.ok) {
        out.error = res.error.empty() ? ("http_" + std::to_string(res.status)) : res.error;
        m_xmlrpc_errors.fetch_add(1, std::memory_order_relaxed);
        return out;
    }
    const std::size_t faultPos = res.body.find("<fault>");
    const std::size_t paramsPos = res.body.find("<params>");
    if (faultPos != std::string::npos && (paramsPos == std::string::npos || faultPos < paramsPos)) {
        out.isFault = true;
        const auto faultSp = extractElement(res.body, faultPos, "fault");
        const std::size_t vpos = res.body.find("<value", faultSp.contentStart);
        XrValue v;
        std::size_t after;
        if (vpos != std::string::npos && parseValue(res.body, vpos, v, after) && v.kind == XrValue::Kind::Struct) {
            if (const auto* fc = findMember(v, "faultCode"); fc && fc->kind == XrValue::Kind::Int) out.faultCode = static_cast<int>(fc->i);
            out.faultString = readStrField(findMember(v, "faultString"));
        }
        out.error = "xmlrpc_fault: " + out.faultString;
        m_xmlrpc_errors.fetch_add(1, std::memory_order_relaxed);
        return out;
    }
    if (paramsPos == std::string::npos) { out.error = "no_params_in_response"; m_xmlrpc_errors.fetch_add(1, std::memory_order_relaxed); return out; }
    const auto paramsSp = extractElement(res.body, paramsPos, "params");
    const std::size_t paramPos = res.body.find("<param>", paramsSp.contentStart);
    if (paramPos == std::string::npos || paramPos >= paramsSp.contentEnd) { out.error = "no_param"; m_xmlrpc_errors.fetch_add(1, std::memory_order_relaxed); return out; }
    const auto paramSp = extractElement(res.body, paramPos, "param");
    const std::size_t vpos = res.body.find("<value", paramSp.contentStart);
    XrValue v;
    std::size_t after;
    if (vpos == std::string::npos || !parseValue(res.body, vpos, v, after)) {
        out.error = "value_parse_failed";
        m_xmlrpc_errors.fetch_add(1, std::memory_order_relaxed);
        return out;
    }
    out.value = std::move(v);
    out.ok = true;
    return out;
}

bool odooAuthenticate(const std::string& baseUrl, const std::string& db, const std::string& username,
                      const std::string& password, long long& uidOut, std::string& errOut) {
    const std::vector<XrValue> params = {XrValue::Str(db), XrValue::Str(username), XrValue::Str(password), XrValue::Obj({})};
    const auto r = xmlRpcCall(baseUrl + "/xmlrpc/2/common", "authenticate", params, 8000);
    if (!r.ok) { errOut = r.error; return false; }
    if (r.value.kind == XrValue::Kind::Bool && !r.value.b) { errOut = "invalid_credentials"; return false; }
    if (r.value.kind != XrValue::Kind::Int) { errOut = "unexpected_uid_type"; return false; }
    uidOut = r.value.i;
    return true;
}

XmlRpcCallResult odooExecuteKw(const std::string& baseUrl, const std::string& db, long long uid,
                               const std::string& password, const std::string& model,
                               const std::string& method, XrValue args, XrValue kwargs, int timeoutMs) {
    const std::vector<XrValue> params = {XrValue::Str(db), XrValue::Int(uid), XrValue::Str(password),
                                         XrValue::Str(model), XrValue::Str(method),
                                         std::move(args), std::move(kwargs)};
    return xmlRpcCall(baseUrl + "/xmlrpc/2/object", "execute_kw", params, 20000);
}

// ==========================================================================
// Circuit breaker por peer — no había nada reusable: thingsboard_sync.cpp
// reintenta con delay fijo (sleep_for(5s|10s|30s)), sin backoff ni jitter.
// ==========================================================================
class CircuitBreaker {
public:
    bool allowRequest() {
        std::lock_guard<std::mutex> lk(mtx_);
        if (state_ != State::Open) return true;
        if (nowMs() >= openUntilMs_) { state_ = State::HalfOpen; return true; }
        return false;
    }
    void onSuccess() {
        std::lock_guard<std::mutex> lk(mtx_);
        state_ = State::Closed;
        consecutiveFailures_ = 0;
    }
    void onFailure(int failureThreshold, int cooldownMs) {
        std::lock_guard<std::mutex> lk(mtx_);
        ++consecutiveFailures_;
        if (state_ == State::HalfOpen || consecutiveFailures_ >= failureThreshold) {
            if (state_ != State::Open) m_circuit_open_events.fetch_add(1, std::memory_order_relaxed);
            state_ = State::Open;
            openUntilMs_ = nowMs() + cooldownMs;
        }
    }
private:
    enum class State { Closed, Open, HalfOpen } state_{State::Closed};
    int consecutiveFailures_{0};
    long long openUntilMs_{0};
    mutable std::mutex mtx_;

    static long long nowMs() {
        return std::chrono::duration_cast<std::chrono::milliseconds>(
                   std::chrono::steady_clock::now().time_since_epoch())
            .count();
    }
};

std::mutex g_breakersMtx;
std::unordered_map<std::string, std::shared_ptr<CircuitBreaker>> g_breakers;

std::shared_ptr<CircuitBreaker> breakerFor(const std::string& peerId) {
    std::lock_guard<std::mutex> lk(g_breakersMtx);
    auto it = g_breakers.find(peerId);
    if (it != g_breakers.end()) return it->second;
    auto cb = std::make_shared<CircuitBreaker>();
    g_breakers.emplace(peerId, cb);
    return cb;
}

int backoffWithJitter(int attempts, int baseMs, int capMs) {
    long long exp = static_cast<long long>(baseMs) << std::min(attempts, 16);
    long long capped = std::min<long long>(exp, capMs);
    static thread_local std::mt19937 rng(std::random_device{}());
    std::uniform_int_distribution<long long> jitter(0, capped / 2);
    return static_cast<int>(capped / 2 + jitter(rng));
}

// ==========================================================================
// Peer / config (etl_sync_peer, auth_config->>'kind'='timetelemetry')
// ==========================================================================
struct RpPeer {
    std::string peer_id;
    std::string tenant_id;
    std::string base_url;
    std::string db;
    std::string username;
    std::string password;
};

std::vector<RpPeer> loadPeers(const std::string& db_url) {
    std::vector<RpPeer> out;
    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) {
        std::cerr << "[RP_SYNC] no se pudo conectar para leer etl_sync_peer: " << conn.error() << std::endl;
        return out;
    }
    storage::PgResult res{PQexec(conn.get(),
        "SELECT peer_id, tenant_id, base_url, "
        "       auth_config->>'db', auth_config->>'username', auth_config->>'password' "
        "FROM etl_sync_peer "
        "WHERE is_active AND auth_config->>'kind' = 'timetelemetry' AND tenant_id IS NOT NULL")};
    if (!res.okTuples()) {
        std::cerr << "[RP_SYNC] error leyendo etl_sync_peer: " << res.error() << std::endl;
        return out;
    }
    const int n = PQntuples(res.get());
    for (int i = 0; i < n; ++i) {
        RpPeer p;
        p.peer_id = PQgetvalue(res.get(), i, 0);
        p.tenant_id = PQgetvalue(res.get(), i, 1);
        p.base_url = PQgetvalue(res.get(), i, 2);
        p.db = PQgetisnull(res.get(), i, 3) ? "" : PQgetvalue(res.get(), i, 3);
        p.username = PQgetisnull(res.get(), i, 4) ? "" : PQgetvalue(res.get(), i, 4);
        p.password = PQgetisnull(res.get(), i, 5) ? "" : PQgetvalue(res.get(), i, 5);
        if (!p.base_url.empty() && p.base_url.back() == '/') p.base_url.pop_back();
        if (!p.db.empty() && !p.username.empty()) out.push_back(std::move(p));
    }
    return out;
}

constexpr const char* kStreamCode = "maintenance.equipment";

std::string loadWatermarkTs(const std::string& db_url, const std::string& peer_id) {
    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) return "";
    const char* params[2] = {peer_id.c_str(), kStreamCode};
    // Formateado explícito SIN sufijo de zona horaria: Odoo espera sus
    // datetime en 'YYYY-MM-DD HH:MM:SS' (naive, UTC implícito) -- el
    // `::text` por defecto de Postgres agrega "+00", que rompe el parser
    // interno del dominio de Odoo (confirmado en vivo contra TimeTelemetry:
    // "IndexError: string index out of range" server-side en cada poll
    // incremental hasta este fix).
    storage::PgResult res{PQexecParams(conn.get(),
        "SELECT to_char(watermark_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') "
        "FROM etl_sync_state WHERE peer_id = $1::uuid AND stream_code = $2",
        2, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples() || PQntuples(res.get()) == 0 || PQgetisnull(res.get(), 0, 0)) return "";
    return PQgetvalue(res.get(), 0, 0);
}

void saveWatermarkTs(const std::string& db_url, const std::string& peer_id, const std::string& watermarkTs) {
    if (watermarkTs.empty()) return;
    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) return;
    const char* params[3] = {peer_id.c_str(), kStreamCode, watermarkTs.c_str()};
    storage::PgResult res{PQexecParams(conn.get(),
        "INSERT INTO etl_sync_state (peer_id, stream_code, watermark_ts, updated_at) "
        "VALUES ($1::uuid, $2, $3::timestamptz, NOW()) "
        "ON CONFLICT (peer_id, stream_code) DO UPDATE SET "
        "  watermark_ts = EXCLUDED.watermark_ts, updated_at = NOW()",
        3, nullptr, params, nullptr, nullptr, 0)};
    (void)res;
}

long long startSyncRun(const std::string& db_url, const std::string& peer_id, const std::string& mode) {
    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) return -1;
    const char* params[2] = {peer_id.c_str(), mode.c_str()};
    storage::PgResult res{PQexecParams(conn.get(),
        "INSERT INTO etl_sync_run (peer_id, mode, status) VALUES ($1::uuid, $2, 'running') RETURNING run_id",
        2, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples() || PQntuples(res.get()) == 0) return -1;
    try { return std::stoll(PQgetvalue(res.get(), 0, 0)); } catch (...) { return -1; }
}

void finishSyncRun(const std::string& db_url, long long run_id, bool ok, std::uint64_t rows, const std::string& errorMessage) {
    if (run_id < 0) return;
    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) return;
    json::object stats;
    stats["rows_upserted"] = static_cast<std::int64_t>(rows);
    const std::string statsJson = json::serialize(stats);
    const std::string runIdStr = std::to_string(run_id);
    const std::string status = ok ? "success" : "failed";
    const char* params[4] = {runIdStr.c_str(), status.c_str(), statsJson.c_str(),
                             errorMessage.empty() ? nullptr : errorMessage.c_str()};
    storage::PgResult res{PQexecParams(conn.get(),
        "UPDATE etl_sync_run SET finished_at = NOW(), status = $2, stats = $3::jsonb, error_message = $4 "
        "WHERE run_id = $1::bigint",
        4, nullptr, params, nullptr, nullptr, 0)};
    (void)res;
}

// ── Upsert de un registro maintenance.equipment en rp_equipment ──────────
// Devuelve el equipment_id local (para el broadcast WS) o "" en error.
std::string upsertEquipmentRow(PGconn* conn, const std::string& tenantId, const std::string& peerId,
                               long long externalId, const XrValue& record) {
    const std::string codigo = readStrField(findMember(record, "codigo"));
    const std::string name = readStrField(findMember(record, "name"));
    const std::string state = readStrField(findMember(record, "state"));
    const std::string serialNo = readStrField(findMember(record, "serial_no"));
    const std::string location = readStrField(findMember(record, "location"));
    const std::string writeDate = readStrField(findMember(record, "write_date"));

    long long categoryId = 0, projectId = 0;
    std::string categoryName, projectName;
    const bool hasCategory = readMany2One(findMember(record, "category_id"), categoryId, categoryName);
    const bool hasProject = readMany2One(findMember(record, "project_id"), projectId, projectName);

    double lat = 0.0, lon = 0.0;
    const bool hasLat = readDoubleField(findMember(record, "latitude"), lat);
    const bool hasLon = readDoubleField(findMember(record, "longitude"), lon);

    // "technician_user_id" es el nombre de campo estándar de
    // maintenance.equipment en Odoo 17 -- no verificado contra la instancia
    // real de TimeTelemetry (puede diferir si el cliente personalizó el
    // modelo). Si el campo no existe, readMany2One simplemente no matchea y
    // assigned_user queda vacío -- no rompe el sync; raw_json igual guarda
    // el registro completo para diagnosticar el nombre real del campo.
    std::string assignedUser;
    long long assignedId = 0;
    readMany2One(findMember(record, "technician_user_id"), assignedId, assignedUser);

    const std::string rawJson = json::serialize(xrToJson(record));
    const std::string externalIdStr = std::to_string(externalId);
    const std::string categoryIdStr = std::to_string(categoryId);
    const std::string projectIdStr = std::to_string(projectId);
    const std::string latStr = std::to_string(lat);
    const std::string lonStr = std::to_string(lon);

    const char* params[17] = {
        tenantId.c_str(), peerId.c_str(), externalIdStr.c_str(),
        codigo.empty() ? nullptr : codigo.c_str(),
        name.empty() ? nullptr : name.c_str(),
        hasCategory ? categoryIdStr.c_str() : nullptr,
        hasCategory ? categoryName.c_str() : nullptr,
        hasProject ? projectIdStr.c_str() : nullptr,
        hasProject ? projectName.c_str() : nullptr,
        state.empty() ? nullptr : state.c_str(),
        serialNo.empty() ? nullptr : serialNo.c_str(),
        location.empty() ? nullptr : location.c_str(),
        hasLat ? latStr.c_str() : nullptr,
        hasLon ? lonStr.c_str() : nullptr,
        assignedUser.empty() ? nullptr : assignedUser.c_str(),
        writeDate.empty() ? nullptr : writeDate.c_str(),
        rawJson.c_str(),
    };

    storage::PgResult res{PQexecParams(conn,
        "INSERT INTO rp_equipment ("
        "  tenant_id, peer_id, external_id, codigo, name, category_id, category_name,"
        "  project_id, project_name, state, serial_no, location, latitude, longitude,"
        "  assigned_user, odoo_write_date, raw_json, sync_status, updated_at"
        ") VALUES ($1::uuid,$2::uuid,$3::bigint,$4,$5,$6::bigint,$7,$8::bigint,$9,$10,$11,$12,"
        "          $13::double precision,$14::double precision,$15,$16::timestamptz,$17::jsonb,'synced',NOW()) "
        "ON CONFLICT (peer_id, external_id) DO UPDATE SET"
        "  tenant_id=EXCLUDED.tenant_id, codigo=EXCLUDED.codigo, name=EXCLUDED.name,"
        "  category_id=EXCLUDED.category_id, category_name=EXCLUDED.category_name,"
        "  project_id=EXCLUDED.project_id, project_name=EXCLUDED.project_name,"
        "  state=EXCLUDED.state, serial_no=EXCLUDED.serial_no, location=EXCLUDED.location,"
        "  latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, assigned_user=EXCLUDED.assigned_user,"
        "  odoo_write_date=EXCLUDED.odoo_write_date, raw_json=EXCLUDED.raw_json,"
        "  sync_status='synced', last_sync_error=NULL, updated_at=NOW() "
        "RETURNING equipment_id",
        17, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples() || PQntuples(res.get()) == 0) return "";
    return PQgetvalue(res.get(), 0, 0);
}

void broadcastEquipmentUpdated(const std::string& tenantId, const std::string& equipmentId) {
    json::object payload;
    payload["channel"] = "rp";
    payload["type"] = "rp_equipment_updated";
    payload["equipment_id"] = equipmentId;
    WsRegistry::instance().broadcastToTenant(tenantId, json::serialize(payload));
}

// ── Pull (backfill si no hay watermark, incremental si la hay) ───────────
// Consolidado en una sola función -- mismo criterio que backfillLoop() de
// thingsboard_sync.cpp, que ya resuelve "primera vez = lookback amplio,
// siguientes = incremental" dentro de un único loop en vez de dos separados.
void pullAndUpsert(const std::string& db_url, const RpPeer& peer, bool& anyRows) {
    anyRows = false;
    auto cb = breakerFor(peer.peer_id);
    if (!cb->allowRequest()) return;

    long long uid = 0;
    std::string authErr;
    if (!odooAuthenticate(peer.base_url, peer.db, peer.username, peer.password, uid, authErr)) {
        std::cerr << "[RP_SYNC] auth fallida peer=" << peer.peer_id << " err=" << authErr << std::endl;
        m_auth_failures.fetch_add(1, std::memory_order_relaxed);
        cb->onFailure(envInt("BEEMETRY_RP_CIRCUIT_FAILURE_THRESHOLD", 5),
                      envInt("BEEMETRY_RP_CIRCUIT_COOLDOWN_MS", 60000));
        return;
    }
    m_peers_authenticated.fetch_add(1, std::memory_order_relaxed);

    const std::string watermark = loadWatermarkTs(db_url, peer.peer_id);
    const std::string mode = watermark.empty() ? "bulk" : "incremental";
    const long long runId = startSyncRun(db_url, peer.peer_id, mode);

    XrValue domain;
    if (watermark.empty()) {
        domain = XrValue::Arr({});
    } else {
        domain = XrValue::Arr({XrValue::Arr({XrValue::Str("write_date"), XrValue::Str(">"), XrValue::Str(watermark)})});
    }

    storage::PgConn writeConn{PQconnectdb(db_url.c_str())};
    if (!writeConn.ok()) {
        finishSyncRun(db_url, runId, false, 0, "no se pudo conectar a Postgres para el upsert");
        return;
    }

    const int batchSize = envInt("BEEMETRY_RP_BATCH_SIZE", 200);
    int offset = 0;
    std::uint64_t upserted = 0;
    std::string maxWriteDate = watermark;
    bool anyError = false;

    while (g_running.load()) {
        XrValue kwargs = XrValue::Obj({
            {"limit", XrValue::Int(batchSize)},
            {"offset", XrValue::Int(offset)},
            {"order", XrValue::Str("id")},
        });
        // execute_kw's `args` es la lista de argumentos POSICIONALES de
        // search_read -- el dominio (que ya es en sí mismo una lista de
        // leaves) tiene que ir ENVUELTO como su primer elemento:
        // args=[domain], no args=domain directo. Confirmado en vivo contra
        // TimeTelemetry: con domain=[] el bug era invisible (unpacking de
        // *args a cero argumentos = "sin filtro", funciona por accidente),
        // pero con un domain real Odoo recibía la leaf suelta como si fuera
        // el dominio completo y su parser interno (expression.is_false)
        // reventaba con "IndexError: string index out of range" al indexar
        // caracteres de un string donde esperaba una tupla.
        const auto r = odooExecuteKw(peer.base_url, peer.db, uid, peer.password,
                                     kStreamCode, "search_read", XrValue::Arr({domain}), kwargs, 20000);
        if (!r.ok) {
            std::cerr << "[RP_SYNC] search_read fallo peer=" << peer.peer_id << " err=" << r.error << std::endl;
            anyError = true;
            cb->onFailure(envInt("BEEMETRY_RP_CIRCUIT_FAILURE_THRESHOLD", 5),
                          envInt("BEEMETRY_RP_CIRCUIT_COOLDOWN_MS", 60000));
            break;
        }
        cb->onSuccess();
        if (r.value.kind != XrValue::Kind::Array) break;
        const auto& rows = r.value.arr;
        if (rows.empty()) break;

        for (const auto& rec : rows) {
            long long externalId = 0;
            if (const auto* idField = findMember(rec, "id"); idField && idField->kind == XrValue::Kind::Int) {
                externalId = idField->i;
            } else {
                continue;
            }
            const std::string equipmentId = upsertEquipmentRow(writeConn.get(), peer.tenant_id, peer.peer_id, externalId, rec);
            if (!equipmentId.empty()) {
                ++upserted;
                anyRows = true;
                broadcastEquipmentUpdated(peer.tenant_id, equipmentId);
                const std::string wd = readStrField(findMember(rec, "write_date"));
                if (!wd.empty() && wd > maxWriteDate) maxWriteDate = wd;
            }
        }
        if (static_cast<int>(rows.size()) < batchSize) break;
        offset += batchSize;
    }

    if (!maxWriteDate.empty()) saveWatermarkTs(db_url, peer.peer_id, maxWriteDate);
    finishSyncRun(db_url, runId, !anyError, upserted, anyError ? "search_read falló durante la paginación; ver logs" : "");

    if (mode == "bulk") {
        m_backfill_runs.fetch_add(1, std::memory_order_relaxed);
        m_backfill_upserted.fetch_add(upserted, std::memory_order_relaxed);
        if (anyError) m_backfill_errors.fetch_add(1, std::memory_order_relaxed);
    } else {
        m_incremental_polls.fetch_add(1, std::memory_order_relaxed);
        m_incremental_upserted.fetch_add(upserted, std::memory_order_relaxed);
        if (anyError) m_incremental_errors.fetch_add(1, std::memory_order_relaxed);
    }
}

void syncLoop(const std::string& db_url) {
    const int intervalMs = envInt("BEEMETRY_RP_POLL_INTERVAL_MS", 30000);
    while (g_running.load()) {
        auto peers = loadPeers(db_url);
        m_peers_configured.store(peers.size(), std::memory_order_relaxed);
        for (const auto& peer : peers) {
            if (!g_running.load()) break;
            bool anyRows = false;
            pullAndUpsert(db_url, peer, anyRows);
        }
        for (int waited = 0; waited < intervalMs && g_running.load(); waited += 500) {
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }
    }
}

// ── Drenado de rp_write_outbox: create/write por XML-RPC con backoff ─────
struct OutboxRow {
    std::string outbox_id;
    std::string tenant_id;
    std::string peer_id;
    std::string equipment_id;
    std::string operation;
    std::string payload_json;
    int attempts{0};
    int max_attempts{8};
};

std::vector<OutboxRow> loadDueOutboxRows(PGconn* conn, int limit) {
    std::vector<OutboxRow> out;
    const std::string limitStr = std::to_string(limit);
    const char* params[1] = {limitStr.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "SELECT outbox_id, tenant_id, peer_id, equipment_id, operation, payload_json::text, attempts, max_attempts "
        "FROM rp_write_outbox "
        "WHERE status IN ('pending','failed') AND next_attempt_at <= NOW() "
        "ORDER BY created_at ASC LIMIT $1::int FOR UPDATE SKIP LOCKED",
        1, nullptr, params, nullptr, nullptr, 0)};
    if (!res.okTuples()) return out;
    const int n = PQntuples(res.get());
    for (int i = 0; i < n; ++i) {
        OutboxRow row;
        row.outbox_id = PQgetvalue(res.get(), i, 0);
        row.tenant_id = PQgetvalue(res.get(), i, 1);
        row.peer_id = PQgetvalue(res.get(), i, 2);
        row.equipment_id = PQgetvalue(res.get(), i, 3);
        row.operation = PQgetvalue(res.get(), i, 4);
        row.payload_json = PQgetvalue(res.get(), i, 5);
        row.attempts = std::atoi(PQgetvalue(res.get(), i, 6));
        row.max_attempts = std::atoi(PQgetvalue(res.get(), i, 7));
        out.push_back(std::move(row));
    }
    return out;
}

// Construye el struct XML-RPC de campos escribibles a partir del JSON
// encolado por rp_gateway_routes.cpp (ya validado contra la lista blanca
// ahí -- este módulo confía en lo que el gateway encoló, no vuelve a
// validar reglas de negocio de Odoo). Las claves con prefijo "__" son
// metadata interna del outbox (p.ej. "__external_id" para 'update'), nunca
// campos de negocio -- se excluyen del struct que viaja a Odoo.
XrValue jsonToXrStruct(const json::value& v) {
    std::vector<std::pair<std::string, XrValue>> members;
    if (!v.is_object()) return XrValue::Obj({});
    for (const auto& kv : v.as_object()) {
        if (kv.key().size() >= 2 && kv.key()[0] == '_' && kv.key()[1] == '_') continue;
        const auto& val = kv.value();
        if (val.is_string()) members.emplace_back(kv.key(), XrValue::Str(json::value_to<std::string>(val)));
        else if (val.is_int64()) members.emplace_back(kv.key(), XrValue::Int(val.as_int64()));
        else if (val.is_double()) members.emplace_back(kv.key(), XrValue::Dbl(val.as_double()));
        else if (val.is_bool()) members.emplace_back(kv.key(), XrValue::Bool(val.as_bool()));
        // otros tipos (arrays anidados, null) no se esperan en el payload de
        // escritura de este gateway -- se omiten en vez de fallar el lote.
    }
    return XrValue::Obj(std::move(members));
}

void markOutboxSent(PGconn* conn, const OutboxRow& row) {
    const char* params[1] = {row.outbox_id.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "UPDATE rp_write_outbox SET status='sent', processed_at=NOW() WHERE outbox_id=$1::bigint",
        1, nullptr, params, nullptr, nullptr, 0)};
    (void)res;
}

void markOutboxRetryOrDead(PGconn* conn, const OutboxRow& row, const std::string& errMsg) {
    const int newAttempts = row.attempts + 1;
    const bool dead = newAttempts >= row.max_attempts;
    const int delayMs = backoffWithJitter(newAttempts, envInt("BEEMETRY_RP_OUTBOX_BACKOFF_BASE_MS", 2000),
                                          envInt("BEEMETRY_RP_OUTBOX_BACKOFF_CAP_MS", 900000));
    const std::string attemptsStr = std::to_string(newAttempts);
    const std::string status = dead ? "dead" : "failed";
    const std::string delaySecondsStr = std::to_string(delayMs / 1000.0);
    const char* params[5] = {row.outbox_id.c_str(), attemptsStr.c_str(), status.c_str(), errMsg.c_str(),
                             delaySecondsStr.c_str()};
    storage::PgResult res{PQexecParams(conn,
        "UPDATE rp_write_outbox SET attempts=$2::smallint, status=$3, last_error=$4, "
        "  next_attempt_at = NOW() + make_interval(secs => $5::double precision) "
        "WHERE outbox_id=$1::bigint",
        5, nullptr, params, nullptr, nullptr, 0)};
    (void)res;
    if (dead) m_outbox_dead.fetch_add(1, std::memory_order_relaxed);
    else m_outbox_retried.fetch_add(1, std::memory_order_relaxed);
}

void updateEquipmentAfterWrite(PGconn* conn, const std::string& equipmentId, bool ok,
                               long long newExternalId, const std::string& errMsg) {
    if (ok) {
        if (newExternalId > 0) {
            const std::string idStr = std::to_string(newExternalId);
            const char* params[2] = {idStr.c_str(), equipmentId.c_str()};
            storage::PgResult res{PQexecParams(conn,
                "UPDATE rp_equipment SET external_id=$1::bigint, sync_status='synced', last_sync_error=NULL, updated_at=NOW() "
                "WHERE equipment_id=$2::uuid",
                2, nullptr, params, nullptr, nullptr, 0)};
            (void)res;
        } else {
            const char* params[1] = {equipmentId.c_str()};
            storage::PgResult res{PQexecParams(conn,
                "UPDATE rp_equipment SET sync_status='synced', last_sync_error=NULL, updated_at=NOW() WHERE equipment_id=$1::uuid",
                1, nullptr, params, nullptr, nullptr, 0)};
            (void)res;
        }
    } else {
        const char* params[2] = {errMsg.c_str(), equipmentId.c_str()};
        storage::PgResult res{PQexecParams(conn,
            "UPDATE rp_equipment SET sync_status='push_failed', last_sync_error=$1, updated_at=NOW() WHERE equipment_id=$2::uuid",
            2, nullptr, params, nullptr, nullptr, 0)};
        (void)res;
    }
}

void writeOutboxDrainLoop(const std::string& db_url) {
    const int intervalMs = envInt("BEEMETRY_RP_OUTBOX_POLL_MS", 5000);
    while (g_running.load()) {
        auto peers = loadPeers(db_url);
        std::unordered_map<std::string, RpPeer> peerById;
        for (const auto& p : peers) peerById[p.peer_id] = p;

        storage::PgConn conn{PQconnectdb(db_url.c_str())};
        if (conn.ok()) {
            storage::PgResult begin{PQexec(conn.get(), "BEGIN")};
            auto rows = loadDueOutboxRows(conn.get(), envInt("BEEMETRY_RP_OUTBOX_BATCH_SIZE", 20));
            for (const auto& row : rows) {
                const auto it = peerById.find(row.peer_id);
                if (it == peerById.end()) {
                    markOutboxRetryOrDead(conn.get(), row, "peer_no_longer_active");
                    continue;
                }
                const RpPeer& peer = it->second;
                auto cb = breakerFor(peer.peer_id);
                if (!cb->allowRequest()) {
                    markOutboxRetryOrDead(conn.get(), row, "circuit_open");
                    continue;
                }

                long long uid = 0;
                std::string authErr;
                if (!odooAuthenticate(peer.base_url, peer.db, peer.username, peer.password, uid, authErr)) {
                    cb->onFailure(envInt("BEEMETRY_RP_CIRCUIT_FAILURE_THRESHOLD", 5),
                                  envInt("BEEMETRY_RP_CIRCUIT_COOLDOWN_MS", 60000));
                    markOutboxRetryOrDead(conn.get(), row, "auth_failed: " + authErr);
                    updateEquipmentAfterWrite(conn.get(), row.equipment_id, false, 0, authErr);
                    continue;
                }

                json::value payloadVal;
                try { payloadVal = json::parse(row.payload_json); } catch (...) { payloadVal = json::object{}; }
                const XrValue fields = jsonToXrStruct(payloadVal);

                if (row.operation == "create") {
                    const auto r = odooExecuteKw(peer.base_url, peer.db, uid, peer.password, kStreamCode,
                                                 "create", XrValue::Arr({fields}), XrValue::Obj({}), 20000);
                    if (r.ok && r.value.kind == XrValue::Kind::Int) {
                        cb->onSuccess();
                        markOutboxSent(conn.get(), row);
                        updateEquipmentAfterWrite(conn.get(), row.equipment_id, true, r.value.i, "");
                        m_outbox_sent.fetch_add(1, std::memory_order_relaxed);
                        broadcastEquipmentUpdated(row.tenant_id, row.equipment_id);
                    } else {
                        cb->onFailure(envInt("BEEMETRY_RP_CIRCUIT_FAILURE_THRESHOLD", 5),
                                      envInt("BEEMETRY_RP_CIRCUIT_COOLDOWN_MS", 60000));
                        markOutboxRetryOrDead(conn.get(), row, r.error);
                        updateEquipmentAfterWrite(conn.get(), row.equipment_id, false, 0, r.error);
                    }
                } else {  // "update"
                    // "__external_id" es metadata que rp_gateway_routes.cpp agrega al
                    // encolar un PUT -- el id real de maintenance.equipment en Odoo,
                    // necesario para el 'write'. Se excluye de `fields` (ver
                    // jsonToXrStruct) para no mandarlo como campo de negocio.
                    long long externalId = 0;
                    if (payloadVal.is_object()) {
                        if (const auto* eid = payloadVal.as_object().if_contains("__external_id"); eid && eid->is_int64()) {
                            externalId = eid->as_int64();
                        }
                    }
                    if (externalId <= 0) {
                        markOutboxRetryOrDead(conn.get(), row, "missing_external_id_in_payload");
                        continue;
                    }
                    const auto r = odooExecuteKw(peer.base_url, peer.db, uid, peer.password, kStreamCode,
                                                 "write", XrValue::Arr({XrValue::Arr({XrValue::Int(externalId)}), fields}),
                                                 XrValue::Obj({}), 20000);
                    if (r.ok) {
                        cb->onSuccess();
                        markOutboxSent(conn.get(), row);
                        updateEquipmentAfterWrite(conn.get(), row.equipment_id, true, 0, "");
                        m_outbox_sent.fetch_add(1, std::memory_order_relaxed);
                        broadcastEquipmentUpdated(row.tenant_id, row.equipment_id);
                    } else {
                        cb->onFailure(envInt("BEEMETRY_RP_CIRCUIT_FAILURE_THRESHOLD", 5),
                                      envInt("BEEMETRY_RP_CIRCUIT_COOLDOWN_MS", 60000));
                        markOutboxRetryOrDead(conn.get(), row, r.error);
                        updateEquipmentAfterWrite(conn.get(), row.equipment_id, false, 0, r.error);
                    }
                }
            }
            storage::PgResult commit{PQexec(conn.get(), "COMMIT")};
        }

        for (int waited = 0; waited < intervalMs && g_running.load(); waited += 500) {
            std::this_thread::sleep_for(std::chrono::milliseconds(500));
        }
    }
}

} // namespace

// ==========================================================================
// API pública
// ==========================================================================
bool handleWebhookNudge(const std::string& db_url, const std::string& peer_id, long long odoo_equipment_id) {
    auto peers = loadPeers(db_url);
    const RpPeer* peer = nullptr;
    for (const auto& p : peers) if (p.peer_id == peer_id) { peer = &p; break; }
    if (!peer) { m_webhook_nudge_errors.fetch_add(1, std::memory_order_relaxed); return false; }

    auto cb = breakerFor(peer->peer_id);
    if (!cb->allowRequest()) { m_webhook_nudge_errors.fetch_add(1, std::memory_order_relaxed); return false; }

    long long uid = 0;
    std::string authErr;
    if (!odooAuthenticate(peer->base_url, peer->db, peer->username, peer->password, uid, authErr)) {
        cb->onFailure(envInt("BEEMETRY_RP_CIRCUIT_FAILURE_THRESHOLD", 5),
                      envInt("BEEMETRY_RP_CIRCUIT_COOLDOWN_MS", 60000));
        m_webhook_nudge_errors.fetch_add(1, std::memory_order_relaxed);
        return false;
    }

    // Relectura AUTORITATIVA por XML-RPC -- el payload del webhook nunca se
    // usó para nada más que decidir "a qué id relee" (ver justificación de
    // seguridad en rp_odoo_sync.hpp / ADR-103).
    const auto r = odooExecuteKw(peer->base_url, peer->db, uid, peer->password, kStreamCode, "read",
                                 XrValue::Arr({XrValue::Arr({XrValue::Int(odoo_equipment_id)})}),
                                 XrValue::Obj({}), 15000);
    if (!r.ok) {
        cb->onFailure(envInt("BEEMETRY_RP_CIRCUIT_FAILURE_THRESHOLD", 5),
                      envInt("BEEMETRY_RP_CIRCUIT_COOLDOWN_MS", 60000));
        m_webhook_nudge_errors.fetch_add(1, std::memory_order_relaxed);
        return false;
    }
    cb->onSuccess();
    m_webhook_nudges.fetch_add(1, std::memory_order_relaxed);

    if (r.value.kind != XrValue::Kind::Array || r.value.arr.empty()) {
        // id inexistente/borrado en Odoo -- no es un error de transporte, no
        // hay nada que aplicar (CA-8 de SPEC-019).
        return true;
    }

    storage::PgConn conn{PQconnectdb(db_url.c_str())};
    if (!conn.ok()) return false;
    const std::string equipmentId = upsertEquipmentRow(conn.get(), peer->tenant_id, peer->peer_id,
                                                        odoo_equipment_id, r.value.arr.front());
    if (!equipmentId.empty()) broadcastEquipmentUpdated(peer->tenant_id, equipmentId);
    const long long runId = startSyncRun(db_url, peer->peer_id, "webhook_nudge");
    finishSyncRun(db_url, runId, true, equipmentId.empty() ? 0 : 1, "");
    return true;
}

void startRpOdooSync(const std::string& db_url) {
    bool expected = false;
    if (!g_running.compare_exchange_strong(expected, true)) return;
    if (!envFlag("BEEMETRY_RP_SYNC_ENABLED", false)) {
        g_running.store(false);
        std::cout << "[RP_SYNC] deshabilitado (BEEMETRY_RP_SYNC_ENABLED=false) -- "
                     "integración con sistema externo del cliente (TimeTelemetry/Odoo), opt-in explícito."
                  << std::endl;
        return;
    }
    std::cout << "[RP_SYNC] iniciando sincronización con TimeTelemetry/Odoo (backfill+incremental+outbox)" << std::endl;
    g_threads.emplace_back(syncLoop, db_url);
    g_threads.emplace_back(writeOutboxDrainLoop, db_url);
}

void stopRpOdooSync() {
    g_running.store(false);
    for (auto& t : g_threads) if (t.joinable()) t.join();
    g_threads.clear();
}

RpSyncStats rpSyncStats() {
    RpSyncStats s;
    s.enabled = g_running.load();
    s.peers_configured = m_peers_configured.load();
    s.peers_authenticated = m_peers_authenticated.load();
    s.auth_failures = m_auth_failures.load();
    s.backfill_runs = m_backfill_runs.load();
    s.backfill_upserted = m_backfill_upserted.load();
    s.backfill_errors = m_backfill_errors.load();
    s.incremental_polls = m_incremental_polls.load();
    s.incremental_upserted = m_incremental_upserted.load();
    s.incremental_errors = m_incremental_errors.load();
    s.webhook_nudges = m_webhook_nudges.load();
    s.webhook_nudge_errors = m_webhook_nudge_errors.load();
    s.outbox_sent = m_outbox_sent.load();
    s.outbox_retried = m_outbox_retried.load();
    s.outbox_dead = m_outbox_dead.load();
    s.xmlrpc_errors = m_xmlrpc_errors.load();
    s.circuit_open_events = m_circuit_open_events.load();
    return s;
}

} // namespace rpsync
} // namespace mining

#else  // !HAS_LIBPQ

namespace mining {
namespace rpsync {
void startRpOdooSync(const std::string&) {}
void stopRpOdooSync() {}
RpSyncStats rpSyncStats() { return {}; }
bool handleWebhookNudge(const std::string&, const std::string&, long long) { return false; }
} // namespace rpsync
} // namespace mining

#endif // HAS_LIBPQ
