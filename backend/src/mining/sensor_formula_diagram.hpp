// --------------------------------------------------------------------------
// sensor_formula_diagram.hpp — ADR-195: reconstruye el diagrama del lienzo
// "Cálculo" (blocks/connections del sidecar formula_engine, tablas que viven
// en la misma BD que sensor_formula_def) a partir de una fila real del motor
// de fórmulas (ADR-187/189). Cierra el gap que ADR-188 dejó documentado
// explícitamente: el lienzo seguía "puramente visual", sin ningún vínculo con
// sensor_formula_def. El lienzo generado sigue sin ejecutar nada por sí
// mismo -- es una visualización fiel del pipeline real (entradas -> cálculo
// -> decisiones de umbral -> OK/WARNING/ERROR), no una segunda
// implementación; la ejecución real sigue siendo solo
// sensor_formula_evaluator.cpp.
// --------------------------------------------------------------------------
#pragma once

#include <string>

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

#if HAS_LIBPQ
#include <libpq-fe.h>
#endif

namespace mining_iot {

#if HAS_LIBPQ

/** @brief Reemplaza TODO el diagrama guardado bajo diagram_id =
 * 'formula_<formulaId>' por uno reconstruido desde la fórmula real: bloque
 * INICIO -> un bloque de entrada por cada variable referenciada en
 * `expression` (canales/parámetros del sensor) -> bloque de cálculo (la
 * expresión completa) -> bloque(s) de decisión por umbral de error/warning
 * (si están definidos) -> bloques terminales OK/WARNING/ERROR. Autogeneración
 * total y sin merge (decisión de producto ADR-195): cualquier edición manual
 * de layout hecha en el lienzo para esta fórmula se pierde en cada
 * regeneración. No toca la tabla `rules` del sidecar (código muerto,
 * confirmado que nunca se evaluaba). `conn` debe apuntar a la misma base que
 * usa el sidecar (sensors_db); si el caller abrió una transacción, esto
 * corre dentro de ella. */
void regenerateFormulaDiagram(PGconn *conn,
                              const std::string &formulaId,
                              const std::string &sensorId,
                              const std::string &formulaName,
                              const std::string &expression,
                              const std::string &outputChannelCode,
                              const std::string &outputUnit,
                              bool hasWarningLow, double warningLow,
                              bool hasWarningHigh, double warningHigh,
                              bool hasErrorLow, double errorLow,
                              bool hasErrorHigh, double errorHigh);

/** @brief Borra blocks/connections del diagrama de una fórmula (invocada al
 * borrar la fórmula misma). No falla si no había diagrama generado. */
void deleteFormulaDiagram(PGconn *conn, const std::string &formulaId);

#endif // HAS_LIBPQ

} // namespace mining_iot
