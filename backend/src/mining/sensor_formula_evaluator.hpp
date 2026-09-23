// --------------------------------------------------------------------------
// sensor_formula_evaluator.hpp — ADR-187 Entregable B: motor de cálculo por
// fórmula, un hilo de fondo separado (mismo patrón que el evaluador de
// alarmas de ADR-140/034 -- polling periódico, no enganchado al hot path de
// ingesta) que:
//   1. Lee las fórmulas habilitadas (sensor_formula_def).
//   2. Para cada una, resuelve `value` (última telemetría real del sensor,
//      ventana de 15 min igual que evaluateRulesOnce -- ADR-186) y los
//      parámetros numéricos configurados del propio sensor
//      (sensor_input_parameter_def/_value).
//   3. Evalúa la expresión con tinyexpr (third_party/tinyexpr) -- nunca
//      ejecuta código arbitrario, solo aritmética sobre variables nombradas.
//   4. Compara el resultado contra los límites warning_*/error_* de la
//      fórmula y escribe una fila en telemetry_multivariate con su status.
// --------------------------------------------------------------------------
#pragma once

#include <atomic>
#include <cstdint>

namespace mining_iot {

/** @brief Arranca el hilo del evaluador de fórmulas. Idempotente. Debe
 * llamarse igual que startAlarmEvaluator() -- antes de que main.cpp llame a
 * TelemetryIngestor::instance().start(), aunque este evaluador no depende
 * del hook en tiempo real (solo de que Postgres ya tenga los datos que lee
 * por polling). */
void startFormulaEvaluator();

/** @brief Detiene el hilo (usado en tests). */
void stopFormulaEvaluator();

/** @brief Contadores del motor de fórmulas (Art. 5 de la Constitución). */
struct FormulaEngineStats {
    std::atomic<std::uint64_t> evaluations{0};       // fórmulas evaluadas (intentos)
    std::atomic<std::uint64_t> computed{0};           // resultados escritos con éxito
    std::atomic<std::uint64_t> compile_errors{0};     // expresión no compiló (te_compile NULL)
    std::atomic<std::uint64_t> skipped_no_value{0};   // sin telemetría reciente del sensor
    std::atomic<std::uint64_t> write_errors{0};       // INSERT a telemetry_multivariate falló
};
FormulaEngineStats &formulaEngineStats();

} // namespace mining_iot
