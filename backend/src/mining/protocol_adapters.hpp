// --------------------------------------------------------------------------
// protocol_adapters.hpp — ADR-034: ingesta multi-protocolo por adaptadores
// --------------------------------------------------------------------------
// Cada protocolo es un adaptador que normaliza su entrada al evento canónico
// de telemetría ("<sensor_code>,<valor>[,<calidad>]") y lo entrega a
// TelemetryIngestor::ingestLine() — colas, reglas, alarmas y persistencia no
// conocen el protocolo de origen (regla dura del ADR).
//
//   MQTT      (push) — libmosquitto; broker Mosquitto propio (compose `mqtt`).
//                      Industrial/minero (SCADA moderno, gateways LoRaWAN
//                      tipo ChirpStack, puentes zigbee2mqtt) y doméstico/
//                      comercial (Tasmota, ESPHome, Shelly).
//   Modbus TCP (pull) — libmodbus; la plataforma es el maestro y sondea PLCs,
//                      RTUs, medidores de energía, variadores. El protocolo
//                      legado más ubicuo de la industria.
//   OPC UA    (pull) — open62541 (estático); cliente que lee NodeIds de
//                      servidores OPC UA (DCS/SCADA de planta concentradora,
//                      historiadores). El estándar de interoperabilidad de
//                      automatización industrial (IEC 62541).
//   HTTP      (push) — no vive aquí: POST /api/mining/telemetry con API key
//                      de dispositivo (device_alarm_routes.cpp), para
//                      webhooks y dispositivos domésticos/comerciales.
//
// Los adaptadores pull leen sus orígenes de `protocol_adapter_sources`
// (db_scripts/41) y la releen cada BEEMETRY_ADAPTER_SOURCES_REFRESH_MS —
// agregar un PLC no requiere reiniciar el backend.
// --------------------------------------------------------------------------
#pragma once

#include <cstdint>
#include <string>

namespace mining {
namespace protocols {

struct AdapterStats {
    // MQTT
    bool          mqtt_enabled{false};
    bool          mqtt_connected{false};
    std::uint64_t mqtt_received{0};
    std::uint64_t mqtt_ingested{0};
    std::uint64_t mqtt_rejected{0};
    // Modbus
    bool          modbus_enabled{false};
    std::uint64_t modbus_polls{0};
    std::uint64_t modbus_ingested{0};
    std::uint64_t modbus_errors{0};
    // OPC UA
    bool          opcua_enabled{false};
    std::uint64_t opcua_polls{0};
    std::uint64_t opcua_ingested{0};
    std::uint64_t opcua_errors{0};
};

// Arranca los adaptadores habilitados por entorno (BEEMETRY_MQTT_ENABLED,
// BEEMETRY_MODBUS_ENABLED, BEEMETRY_OPCUA_ENABLED). Requiere que
// TelemetryIngestor esté corriendo (se llama después de su start()).
// db_url: para que los adaptadores pull lean protocol_adapter_sources.
void startAdapters(const std::string& db_url);
void stopAdapters();

AdapterStats adapterStats();

} // namespace protocols
} // namespace mining
