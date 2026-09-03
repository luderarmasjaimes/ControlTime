#include <catch2/catch_test_macros.hpp>
#include "mining/alarm_rule_evaluator.hpp"

// SPEC-016 T4/T5/T15/T20: pruebas contractuales de la lógica pura del motor
// de alarmas (ADR-034, ADR-016-1..5) -- sin Postgres, sin hilo de fondo real.
// Cubre lo que sí es determinista y aislable; la evaluación contra datos
// reales de `platform_alarm_rules`/`telemetry_fact` sigue verificándose por
// build+CTest (742/742 aserciones, ver README) más una corrida manual
// contra `beemetry-db` real (ver ADR-016-1..5), no por este archivo.

using namespace mining_iot;

TEST_CASE("evaluateThresholdCondition: operadores basicos") {
  CHECK(evaluateThresholdCondition("gt", 12.4, 10.0));
  CHECK_FALSE(evaluateThresholdCondition("gt", 10.0, 10.0));
  CHECK(evaluateThresholdCondition("gte", 10.0, 10.0));
  CHECK(evaluateThresholdCondition("lt", 5.0, 10.0));
  CHECK_FALSE(evaluateThresholdCondition("lt", 10.0, 10.0));
  CHECK(evaluateThresholdCondition("lte", 10.0, 10.0));
  CHECK(evaluateThresholdCondition("eq", 10.0, 10.0));
  CHECK_FALSE(evaluateThresholdCondition("eq", 10.1, 10.0));
}

TEST_CASE("evaluateThresholdCondition: operador desconocido es fail-closed") {
  // Nunca debe disparar una alarma por un operador que no reconoce -- mismo
  // criterio fail-closed que el resto de guards de este backend.
  CHECK_FALSE(evaluateThresholdCondition("rate_of_change", 999.0, 0.0));
  CHECK_FALSE(evaluateThresholdCondition("", 999.0, 0.0));
  CHECK_FALSE(evaluateThresholdCondition("GT", 999.0, 0.0));
}

TEST_CASE("computeRatePerMinute: sube 6 unidades en 30s = 12/min") {
  CHECK(computeRatePerMinute(10.0, 16.0, 30.0) == 12.0);
}

TEST_CASE("computeRatePerMinute: baja 3 unidades en 60s = -3/min") {
  CHECK(computeRatePerMinute(10.0, 7.0, 60.0) == -3.0);
}

TEST_CASE("computeRatePerMinute: ventana invalida (<=0s) no divide por cero") {
  CHECK(computeRatePerMinute(10.0, 16.0, 0.0) == 0.0);
  CHECK(computeRatePerMinute(10.0, 16.0, -5.0) == 0.0);
}

TEST_CASE("isWithinDebounceWindow: sin disparo previo nunca debounce") {
  const auto now = std::chrono::steady_clock::now();
  CHECK_FALSE(isWithinDebounceWindow(std::nullopt, 60, now));
}

TEST_CASE("isWithinDebounceWindow: debounce_secs <= 0 desactiva la ventana") {
  const auto now = std::chrono::steady_clock::now();
  CHECK_FALSE(isWithinDebounceWindow(now, 0, now));
  CHECK_FALSE(isWithinDebounceWindow(now, -1, now));
}

TEST_CASE("isWithinDebounceWindow: dentro de la ventana bloquea el disparo") {
  const auto lastTrigger = std::chrono::steady_clock::now();
  const auto now = lastTrigger + std::chrono::seconds(10);
  CHECK(isWithinDebounceWindow(lastTrigger, 60, now));
}

TEST_CASE("isWithinDebounceWindow: fuera de la ventana permite el disparo") {
  const auto lastTrigger = std::chrono::steady_clock::now();
  const auto now = lastTrigger + std::chrono::seconds(61);
  CHECK_FALSE(isWithinDebounceWindow(lastTrigger, 60, now));
}
