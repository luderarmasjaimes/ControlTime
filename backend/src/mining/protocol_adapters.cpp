// --------------------------------------------------------------------------
// protocol_adapters.cpp — ADR-034: adaptadores MQTT / Modbus TCP / OPC UA
// --------------------------------------------------------------------------
#include "protocol_adapters.hpp"
#include "telemetry_ingest.hpp"

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

#if __has_include(<mosquitto.h>)
#  define HAS_MQTT 1
#  include <mosquitto.h>
#else
#  define HAS_MQTT 0
#endif

#if __has_include(<modbus/modbus.h>)
#  define HAS_MODBUS 1
#  include <modbus/modbus.h>
#else
#  define HAS_MODBUS 0
#endif

#if __has_include(<open62541/client_config_default.h>)
#  define HAS_OPCUA 1
#  include <open62541/client.h>
#  include <open62541/client_config_default.h>
#  include <open62541/client_highlevel.h>
#else
#  define HAS_OPCUA 0
#endif

#include <boost/json.hpp>

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <mutex>
#include <sstream>
#include <thread>
#include <vector>

namespace json = boost::json;

namespace mining {
namespace protocols {

namespace {

std::string envOr(const char* k, const std::string& def) {
    const char* v = std::getenv(k);
    return (v && *v) ? std::string(v) : def;
}

bool envFlag(const char* k, bool def) {
    const std::string v = envOr(k, def ? "true" : "false");
    return v == "true" || v == "1" || v == "yes";
}

std::atomic<bool> g_running{false};

// Métricas (expuestas vía adapterStats() → /api/metrics)
std::atomic<bool>          g_mqtt_enabled{false}, g_mqtt_connected{false};
std::atomic<std::uint64_t> g_mqtt_received{0}, g_mqtt_ingested{0}, g_mqtt_rejected{0};
std::atomic<bool>          g_modbus_enabled{false};
std::atomic<std::uint64_t> g_modbus_polls{0}, g_modbus_ingested{0}, g_modbus_errors{0};
std::atomic<bool>          g_opcua_enabled{false};
std::atomic<std::uint64_t> g_opcua_polls{0}, g_opcua_ingested{0}, g_opcua_errors{0};

std::thread g_mqtt_thread;
std::thread g_poll_thread;
std::string g_db_url;

// Entrega al pipeline canónico. Devuelve true si el ingestor la aceptó
// (sensor_code registrado y cola con espacio).
bool ingestCanonical(const std::string& code, double value, int quality = 0) {
    std::ostringstream line;
    line << code << ',' << value;
    if (quality != 0) line << ',' << quality;
    return TelemetryIngestor::instance().ingestLine(line.str());
}

// ─────────────────────────── MQTT (libmosquitto) ───────────────────────────
#if HAS_MQTT

// Formatos de payload aceptados (en este orden):
//   1) canónico:  "SENSOR-01,12.34"  o  "SENSOR-01,12.34,0"
//   2) JSON:      {"sensor_code":"SENSOR-01","value":12.34,"quality":0}
//   3) doméstico: tópico ".../SENSOR-01" con payload numérico plano "12.34"
//      (patrón Tasmota/ESPHome/Shelly: un tópico por métrica).
void mqttOnMessage(struct mosquitto*, void*, const struct mosquitto_message* msg) {
    if (!msg || !msg->payload || msg->payloadlen <= 0) return;
    g_mqtt_received.fetch_add(1, std::memory_order_relaxed);

    const std::string payload(static_cast<const char*>(msg->payload),
                              static_cast<size_t>(msg->payloadlen));
    const std::string topic = msg->topic ? msg->topic : "";

    // 1) JSON — se evalúa ANTES que el canónico: un objeto JSON también
    // contiene comas, y el chequeo por coma lo capturaría como línea
    // canónica inválida (bug encontrado en la verificación E2E real).
    if (!payload.empty() && payload.front() == '{') {
        try {
            const auto v = json::parse(payload);
            const auto& o = v.as_object();
            std::string code;
            if (const auto* c = o.if_contains("sensor_code")) {
                if (c->is_string()) code = std::string(c->as_string());
            }
            double value = 0.0;
            bool haveValue = false;
            if (const auto* val = o.if_contains("value")) {
                if (val->is_double())      { value = val->as_double(); haveValue = true; }
                else if (val->is_int64())  { value = static_cast<double>(val->as_int64()); haveValue = true; }
                else if (val->is_uint64()) { value = static_cast<double>(val->as_uint64()); haveValue = true; }
            }
            int quality = 0;
            if (const auto* q = o.if_contains("quality")) {
                if (q->is_int64()) quality = static_cast<int>(q->as_int64());
            }
            if (!code.empty() && haveValue && ingestCanonical(code, value, quality)) {
                g_mqtt_ingested.fetch_add(1, std::memory_order_relaxed);
            } else {
                g_mqtt_rejected.fetch_add(1, std::memory_order_relaxed);
            }
        } catch (...) {
            g_mqtt_rejected.fetch_add(1, std::memory_order_relaxed);
        }
        return;
    }

    // 2) canónico: "SENSOR-01,12.34[,calidad]"
    if (payload.find(',') != std::string::npos) {
        if (TelemetryIngestor::instance().ingestLine(payload)) {
            g_mqtt_ingested.fetch_add(1, std::memory_order_relaxed);
        } else {
            g_mqtt_rejected.fetch_add(1, std::memory_order_relaxed);
        }
        return;
    }

    // 3) doméstico: código = último segmento del tópico, payload = número
    try {
        const double value = std::stod(payload);
        const auto slash = topic.rfind('/');
        const std::string code =
            (slash == std::string::npos) ? topic : topic.substr(slash + 1);
        if (!code.empty() && ingestCanonical(code, value)) {
            g_mqtt_ingested.fetch_add(1, std::memory_order_relaxed);
            return;
        }
    } catch (...) {}
    g_mqtt_rejected.fetch_add(1, std::memory_order_relaxed);
}

void mqttOnConnect(struct mosquitto* m, void*, int rc) {
    if (rc == 0) {
        g_mqtt_connected.store(true);
        const std::string topic = envOr("BEEMETRY_MQTT_TOPIC", "beemetry/telemetry/#");
        mosquitto_subscribe(m, nullptr, topic.c_str(), 1);
        std::cout << "[MQTT] conectado, suscrito a '" << topic << "'" << std::endl;
    } else {
        std::cerr << "[MQTT] conexión rechazada rc=" << rc << std::endl;
    }
}

void mqttOnDisconnect(struct mosquitto*, void*, int rc) {
    g_mqtt_connected.store(false);
    if (rc != 0) std::cerr << "[MQTT] desconectado (rc=" << rc << "), reintentando…" << std::endl;
}

void mqttThread() {
    mosquitto_lib_init();
    struct mosquitto* m = mosquitto_new("beemetry-backend", true, nullptr);
    if (!m) {
        std::cerr << "[MQTT] mosquitto_new falló" << std::endl;
        return;
    }
    const std::string user = envOr("BEEMETRY_MQTT_USERNAME", "");
    const std::string pass = envOr("BEEMETRY_MQTT_PASSWORD", "");
    if (!user.empty()) mosquitto_username_pw_set(m, user.c_str(), pass.c_str());
    mosquitto_connect_callback_set(m, mqttOnConnect);
    mosquitto_disconnect_callback_set(m, mqttOnDisconnect);
    mosquitto_message_callback_set(m, mqttOnMessage);
    mosquitto_reconnect_delay_set(m, 2, 30, true);

    const std::string host = envOr("BEEMETRY_MQTT_HOST", "mqtt");
    int port = 1883;
    try { port = std::stoi(envOr("BEEMETRY_MQTT_PORT", "1883")); } catch (...) {}

    // connect_async + loop_forever: reintenta indefinidamente si el broker
    // aún no está arriba al arrancar (orden de contenedores no garantizado).
    mosquitto_connect_async(m, host.c_str(), port, 30);
    std::cout << "[MQTT] adaptador iniciado → " << host << ":" << port << std::endl;
    mosquitto_loop_forever(m, -1, 1);  // retorna tras mosquitto_disconnect en stop
    mosquitto_destroy(m);
    mosquitto_lib_cleanup();
}
#endif // HAS_MQTT

// ─────────────── Fuentes de sondeo (protocol_adapter_sources) ──────────────
struct PollSource {
    std::string protocol;   // "modbus_tcp" | "opcua"
    std::string label;
    json::value connection;
    json::value mappings;
    int         poll_interval_ms{5000};
    std::chrono::steady_clock::time_point next_due{};
};

std::mutex              g_sources_mtx;
std::vector<PollSource> g_sources;

void refreshSources() {
#if HAS_LIBPQ
    PGconn* conn = PQconnectdb(g_db_url.c_str());
    if (PQstatus(conn) != CONNECTION_OK) {
        std::cerr << "[ADAPTERS] no se pudo leer protocol_adapter_sources: "
                  << PQerrorMessage(conn) << std::endl;
        PQfinish(conn);
        return;
    }
    PGresult* res = PQexec(conn,
        "SELECT protocol, label, connection::text, mappings::text, poll_interval_ms "
        "FROM protocol_adapter_sources WHERE enabled ORDER BY created_at");
    std::vector<PollSource> fresh;
    if (PQresultStatus(res) == PGRES_TUPLES_OK) {
        const int n = PQntuples(res);
        for (int i = 0; i < n; ++i) {
            try {
                PollSource s;
                s.protocol         = PQgetvalue(res, i, 0);
                s.label            = PQgetvalue(res, i, 1);
                s.connection       = json::parse(PQgetvalue(res, i, 2));
                s.mappings         = json::parse(PQgetvalue(res, i, 3));
                s.poll_interval_ms = std::atoi(PQgetvalue(res, i, 4));
                s.next_due         = std::chrono::steady_clock::now();
                fresh.push_back(std::move(s));
            } catch (const std::exception& e) {
                std::cerr << "[ADAPTERS] fuente inválida ignorada: " << e.what() << std::endl;
            }
        }
    }
    PQclear(res);
    PQfinish(conn);
    {
        std::lock_guard<std::mutex> lk(g_sources_mtx);
        g_sources = std::move(fresh);
    }
#endif
}

std::string jsonStr(const json::value& v, const char* key, const std::string& def = "") {
    if (const auto* o = v.if_object())
        if (const auto* f = o->if_contains(key))
            if (f->is_string()) return std::string(f->as_string());
    return def;
}

std::int64_t jsonInt(const json::value& v, const char* key, std::int64_t def) {
    if (const auto* o = v.if_object())
        if (const auto* f = o->if_contains(key)) {
            if (f->is_int64())  return f->as_int64();
            if (f->is_uint64()) return static_cast<std::int64_t>(f->as_uint64());
            if (f->is_double()) return static_cast<std::int64_t>(f->as_double());
        }
    return def;
}

double jsonNum(const json::value& v, const char* key, double def) {
    if (const auto* o = v.if_object())
        if (const auto* f = o->if_contains(key)) {
            if (f->is_double()) return f->as_double();
            if (f->is_int64())  return static_cast<double>(f->as_int64());
            if (f->is_uint64()) return static_cast<double>(f->as_uint64());
        }
    return def;
}

// ───────────────────────── Modbus TCP (libmodbus) ──────────────────────────
#if HAS_MODBUS
void pollModbusSource(const PollSource& s) {
    const std::string host = jsonStr(s.connection, "host");
    const int port    = static_cast<int>(jsonInt(s.connection, "port", 502));
    const int unit_id = static_cast<int>(jsonInt(s.connection, "unit_id", 1));
    if (host.empty()) return;

    // modbus_new_tcp() solo acepta IPs literales; la variante _pi (protocol
    // independent) resuelve hostnames — imprescindible en Docker, donde los
    // PLCs/simuladores se direccionan por nombre de servicio. (Confirmado en
    // vivo: con hostname, modbus_new_tcp fallaba con EINPROGRESS perpetuo.)
    modbus_t* ctx = modbus_new_tcp_pi(host.c_str(), std::to_string(port).c_str());
    if (!ctx) { g_modbus_errors.fetch_add(1); return; }
    modbus_set_response_timeout(ctx, 3, 0);
    modbus_set_slave(ctx, unit_id);
    if (modbus_connect(ctx) == -1) {
        std::cerr << "[MODBUS] " << s.label << " (" << host << ":" << port
                  << "): " << modbus_strerror(errno) << std::endl;
        g_modbus_errors.fetch_add(1);
        modbus_free(ctx);
        return;
    }

    g_modbus_polls.fetch_add(1, std::memory_order_relaxed);
    const auto* arr = s.mappings.if_array();
    if (arr) {
        for (const auto& m : *arr) {
            const std::string code = jsonStr(m, "sensor_code");
            if (code.empty()) continue;
            const int addr = static_cast<int>(jsonInt(m, "address", 0));
            const std::string regType  = jsonStr(m, "reg_type", "holding");
            const std::string dataType = jsonStr(m, "data_type", "u16");
            const double scale = jsonNum(m, "scale", 1.0);
            const int nregs = (dataType == "u32" || dataType == "s32" || dataType == "f32") ? 2 : 1;

            std::uint16_t regs[2] = {0, 0};
            const int rc = (regType == "input")
                ? modbus_read_input_registers(ctx, addr, nregs, regs)
                : modbus_read_registers(ctx, addr, nregs, regs);
            if (rc != nregs) { g_modbus_errors.fetch_add(1); continue; }

            double value = 0.0;
            if (dataType == "s16")      value = static_cast<std::int16_t>(regs[0]);
            else if (dataType == "u32") value = (static_cast<std::uint32_t>(regs[0]) << 16) | regs[1];
            else if (dataType == "s32") value = static_cast<std::int32_t>((static_cast<std::uint32_t>(regs[0]) << 16) | regs[1]);
            else if (dataType == "f32") {
                // Orden de palabra big-endian (ABCD), el más común en PLCs.
                const std::uint32_t raw = (static_cast<std::uint32_t>(regs[0]) << 16) | regs[1];
                float f; std::memcpy(&f, &raw, sizeof(f));
                value = static_cast<double>(f);
            } else                      value = regs[0];  // u16

            if (ingestCanonical(code, value * scale))
                g_modbus_ingested.fetch_add(1, std::memory_order_relaxed);
        }
    }
    modbus_close(ctx);
    modbus_free(ctx);
}
#endif // HAS_MODBUS

// ─────────────────────────── OPC UA (open62541) ────────────────────────────
#if HAS_OPCUA
double uaVariantToDouble(const UA_Variant& v, bool& ok) {
    ok = true;
    if (UA_Variant_hasScalarType(&v, &UA_TYPES[UA_TYPES_DOUBLE]))  return *static_cast<UA_Double*>(v.data);
    if (UA_Variant_hasScalarType(&v, &UA_TYPES[UA_TYPES_FLOAT]))   return *static_cast<UA_Float*>(v.data);
    if (UA_Variant_hasScalarType(&v, &UA_TYPES[UA_TYPES_INT64]))   return static_cast<double>(*static_cast<UA_Int64*>(v.data));
    if (UA_Variant_hasScalarType(&v, &UA_TYPES[UA_TYPES_UINT64]))  return static_cast<double>(*static_cast<UA_UInt64*>(v.data));
    if (UA_Variant_hasScalarType(&v, &UA_TYPES[UA_TYPES_INT32]))   return *static_cast<UA_Int32*>(v.data);
    if (UA_Variant_hasScalarType(&v, &UA_TYPES[UA_TYPES_UINT32]))  return *static_cast<UA_UInt32*>(v.data);
    if (UA_Variant_hasScalarType(&v, &UA_TYPES[UA_TYPES_INT16]))   return *static_cast<UA_Int16*>(v.data);
    if (UA_Variant_hasScalarType(&v, &UA_TYPES[UA_TYPES_UINT16]))  return *static_cast<UA_UInt16*>(v.data);
    if (UA_Variant_hasScalarType(&v, &UA_TYPES[UA_TYPES_BOOLEAN])) return *static_cast<UA_Boolean*>(v.data) ? 1.0 : 0.0;
    ok = false;
    return 0.0;
}

void pollOpcuaSource(const PollSource& s) {
    const std::string endpoint = jsonStr(s.connection, "endpoint");
    if (endpoint.empty()) return;

    UA_Client* client = UA_Client_new();
    UA_ClientConfig_setDefault(UA_Client_getConfig(client));
    UA_StatusCode st = UA_Client_connect(client, endpoint.c_str());
    if (st != UA_STATUSCODE_GOOD) {
        std::cerr << "[OPCUA] " << s.label << " (" << endpoint << "): "
                  << UA_StatusCode_name(st) << std::endl;
        g_opcua_errors.fetch_add(1);
        UA_Client_delete(client);
        return;
    }

    g_opcua_polls.fetch_add(1, std::memory_order_relaxed);
    const auto* arr = s.mappings.if_array();
    if (arr) {
        for (const auto& m : *arr) {
            const std::string code   = jsonStr(m, "sensor_code");
            const std::string nodeId = jsonStr(m, "node_id");
            if (code.empty() || nodeId.empty()) continue;

            UA_NodeId id;
            UA_String uaStr = UA_STRING(const_cast<char*>(nodeId.c_str()));
            if (UA_NodeId_parse(&id, uaStr) != UA_STATUSCODE_GOOD) {
                g_opcua_errors.fetch_add(1);
                continue;
            }
            UA_Variant value;
            UA_Variant_init(&value);
            st = UA_Client_readValueAttribute(client, id, &value);
            if (st == UA_STATUSCODE_GOOD) {
                bool ok = false;
                const double d = uaVariantToDouble(value, ok);
                if (ok && ingestCanonical(code, d))
                    g_opcua_ingested.fetch_add(1, std::memory_order_relaxed);
                else if (!ok)
                    g_opcua_errors.fetch_add(1);
            } else {
                g_opcua_errors.fetch_add(1);
            }
            UA_Variant_clear(&value);
            UA_NodeId_clear(&id);
        }
    }
    UA_Client_disconnect(client);
    UA_Client_delete(client);
}
#endif // HAS_OPCUA

// ─────────────────── Hilo de sondeo (Modbus + OPC UA) ──────────────────────
void pollThread() {
    int refreshMs = 60000;
    try { refreshMs = std::stoi(envOr("BEEMETRY_ADAPTER_SOURCES_REFRESH_MS", "60000")); }
    catch (...) {}

    refreshSources();
    auto lastRefresh = std::chrono::steady_clock::now();

    while (g_running.load()) {
        const auto now = std::chrono::steady_clock::now();
        if (now - lastRefresh >= std::chrono::milliseconds(refreshMs)) {
            refreshSources();
            lastRefresh = now;
        }

        // Copia local de fuentes vencidas (no sondear con el mutex tomado).
        std::vector<PollSource*> due;
        {
            std::lock_guard<std::mutex> lk(g_sources_mtx);
            for (auto& s : g_sources)
                if (now >= s.next_due) {
                    s.next_due = now + std::chrono::milliseconds(s.poll_interval_ms);
                    due.push_back(&s);
                }
        }
        for (auto* s : due) {
            if (!g_running.load()) break;
            if (s->protocol == "modbus_tcp") {
#if HAS_MODBUS
                if (g_modbus_enabled.load()) pollModbusSource(*s);
#endif
            } else if (s->protocol == "opcua") {
#if HAS_OPCUA
                if (g_opcua_enabled.load()) pollOpcuaSource(*s);
#endif
            }
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(250));
    }
}

} // namespace

void startAdapters(const std::string& db_url) {
    if (g_running.exchange(true)) return;
    g_db_url = db_url;

#if HAS_MQTT
    if (envFlag("BEEMETRY_MQTT_ENABLED", false)) {
        g_mqtt_enabled.store(true);
        g_mqtt_thread = std::thread(mqttThread);
    }
#endif
#if HAS_MODBUS
    g_modbus_enabled.store(envFlag("BEEMETRY_MODBUS_ENABLED", true));
#endif
#if HAS_OPCUA
    g_opcua_enabled.store(envFlag("BEEMETRY_OPCUA_ENABLED", true));
#endif

    const bool anyPull = g_modbus_enabled.load() || g_opcua_enabled.load();
    if (anyPull) g_poll_thread = std::thread(pollThread);

    std::cout << "[ADAPTERS] mqtt=" << (g_mqtt_enabled.load() ? "on" : "off")
              << " modbus=" << (g_modbus_enabled.load() ? "on" : "off")
              << " opcua=" << (g_opcua_enabled.load() ? "on" : "off") << std::endl;
}

void stopAdapters() {
    if (!g_running.exchange(false)) return;
    if (g_poll_thread.joinable()) g_poll_thread.join();
    // El hilo MQTT vive en mosquitto_loop_forever; el proceso termina con el
    // contenedor (mismo patrón que los demás hilos de fondo del backend).
    if (g_mqtt_thread.joinable()) g_mqtt_thread.detach();
}

AdapterStats adapterStats() {
    AdapterStats s;
    s.mqtt_enabled    = g_mqtt_enabled.load();
    s.mqtt_connected  = g_mqtt_connected.load();
    s.mqtt_received   = g_mqtt_received.load();
    s.mqtt_ingested   = g_mqtt_ingested.load();
    s.mqtt_rejected   = g_mqtt_rejected.load();
    s.modbus_enabled  = g_modbus_enabled.load();
    s.modbus_polls    = g_modbus_polls.load();
    s.modbus_ingested = g_modbus_ingested.load();
    s.modbus_errors   = g_modbus_errors.load();
    s.opcua_enabled   = g_opcua_enabled.load();
    s.opcua_polls     = g_opcua_polls.load();
    s.opcua_ingested  = g_opcua_ingested.load();
    s.opcua_errors    = g_opcua_errors.load();
    return s;
}

} // namespace protocols
} // namespace mining
