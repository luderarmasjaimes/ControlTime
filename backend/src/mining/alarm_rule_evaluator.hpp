#pragma once

// --------------------------------------------------------------------------
// alarm_rule_evaluator.hpp — lógica PURA (sin libpq/red/estado global) del
// motor de alarmas de ADR-034 / SPEC-016. Extraída de
// device_alarm_routes.cpp (2026-09-02) con el mismo criterio ya usado en
// wms_proxy_security.cpp/sensor_tenant_resolver.cpp: separar el guard/regla
// de negocio (testeable con Catch2 puro) de los handlers HTTP/DB que lo
// envuelven. Nada acá toca Postgres ni el reloj real directamente -- recibe
// `now`/valores como parámetros, así los tests son deterministas.
// --------------------------------------------------------------------------

#include <chrono>
#include <optional>
#include <string>

namespace mining_iot {

/** @brief Evalúa una condición de umbral simple (`gt`/`gte`/`lt`/`lte`/`eq`).
 * Operador desconocido -> false (fail-closed: nunca dispara una alarma por
 * un operador que no reconoce). Misma semántica que el switch inline que
 * reemplaza en `evaluateRulesOnce`. */
bool evaluateThresholdCondition(const std::string &op, double observedValue,
                                double threshold);

/** @brief Tasa de cambio en unidades/minuto entre dos lecturas. `deltaSeconds
 * <= 0` -> 0.0 (sin ventana de tiempo real, no hay tasa que reportar; evita
 * división por cero o por un intervalo negativo si el reloj del sistema
 * retrocediera). */
double computeRatePerMinute(double previousValue, double currentValue,
                            double deltaSeconds);

/** @brief `true` si `now` cae dentro de la ventana de debounce desde el
 * último disparo real de esta regla -- en ese caso el evaluador debe
 * SALTAR el disparo (no insertar alarma ni notificar), aunque la condición
 * siga cumpliéndose. Complementa (no reemplaza) el índice único parcial
 * `idx_alarms_one_open_per_rule`: ese índice evita alarmas ABIERTAS
 * duplicadas; esto evita RE-notificar en ráfaga si una alarma se
 * dispara→resuelve→dispara varias veces dentro de la ventana
 * (`debounce_secs`, ver `platform_alarm_rules`, SPEC-016 T5/CA-6).
 * `debounce_secs <= 0` -> siempre `false` (debounce desactivado para esa
 * regla, comportamiento anterior a este cambio). */
bool isWithinDebounceWindow(
    const std::optional<std::chrono::steady_clock::time_point> &lastTriggeredAt,
    int debounceSecs, std::chrono::steady_clock::time_point now);

} // namespace mining_iot
