#pragma once

#include "../http/router.hpp"

namespace mining_iot {

/** @brief Registra las rutas de gestión de dispositivos (ADR-034: identidad/credenciales) y motor de alarmas (reglas + eventos). */
void registerRoutes(router::Router &r);

/** @brief Arranca el hilo de fondo que evalúa reglas de alarma periódicamente contra los valores cacheados de sensores. Idempotente (no-op si ya está corriendo). */
void startAlarmEvaluator();

/** @brief Detiene el hilo de evaluación de alarmas (usado en shutdown/tests). */
void stopAlarmEvaluator();

} // namespace mining_iot
