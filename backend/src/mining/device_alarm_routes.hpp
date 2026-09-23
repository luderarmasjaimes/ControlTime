#pragma once

#include "../http/router.hpp"
#include <atomic>
#include <cstdint>

namespace mining_iot {

/** @brief Registra las rutas de gestión de dispositivos (ADR-034: identidad/credenciales) y motor de alarmas (reglas + eventos). */
void registerRoutes(router::Router &r);

/** @brief Arranca el hilo de fondo que evalúa reglas de alarma periódicamente contra los valores cacheados de sensores. Idempotente (no-op si ya está corriendo). */
void startAlarmEvaluator();

/** @brief Detiene el hilo de evaluación de alarmas (usado en shutdown/tests). */
void stopAlarmEvaluator();

/** @brief Contadores del motor de alarmas (Art. 5 de la Constitución: toda
 * feature expone métricas de su salud/throughput). Cubre ambos caminos de
 * evaluación (polling de `evaluateRulesOnce` y el camino en tiempo real de
 * `handleRealtimeTelemetryBatch`, ADR-140). `rules_cached` es un gauge
 * (último tamaño del cache); el resto son contadores acumulativos. */
struct AlarmEngineStats {
    std::atomic<std::uint64_t> evaluations{0}, triggered{0}, debounced{0},
        resolved{0}, rules_cached{0};
};
AlarmEngineStats &alarmEngineStats();

} // namespace mining_iot
