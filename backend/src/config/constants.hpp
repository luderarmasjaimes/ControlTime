// --------------------------------------------------------------------------
// constants.hpp — Constantes de configuración centralizadas del backend
// --------------------------------------------------------------------------
// Objetivo: eliminar "magic numbers" dispersos por el código. Cada valor por
// defecto de tuning (telemetría, pool, servidor, auth, vigilancia, paginación)
// vive aquí como `constexpr`, con su unidad y racional documentados.
//
// Regla del proyecto: ningún archivo .cpp define un número mágico de tuning;
// usa `config::<CONSTANTE>` o su override por variable de entorno.
//
// Estos son *defaults*. Muchos admiten override en runtime vía env (ver la
// columna "Env" en cada bloque). Los defaults deben ser seguros para prod.
// --------------------------------------------------------------------------
#pragma once

#include <cstddef>

namespace config {

// ── Ingesta de telemetría (mining::TelemetryIngestor) ──────────────────────
namespace telemetry {
/// Lecturas acumuladas por lote antes de un flush a PostgreSQL.
/// Env: (parámetro de start()). Balancea latencia de escritura vs throughput.
inline constexpr std::size_t kDefaultBatchSize = 1000;

/// Intervalo máximo (ms) entre flushes aunque el lote no esté lleno.
/// Garantiza que lecturas de baja frecuencia no queden retenidas.
inline constexpr int kDefaultFlushMs = 200;

/// Tope de la cola en memoria; al superarlo se aplica back-pressure/descarte.
/// Protege la RAM del proceso ante picos de ingesta (10k sensores/seg).
inline constexpr std::size_t kDefaultMaxQueue = 200000;

/// Factor de reserva del vector de cola respecto al batch (reserve = batch*N).
/// Evita reallocs en el hot path de encolado.
inline constexpr std::size_t kQueueReserveFactor = 2;

/// Factor de reserva del hashmap de caché de sensores respecto a filas.
inline constexpr std::size_t kSensorCacheReserveFactor = 2;
}  // namespace telemetry

// ── Pool de conexiones libpq (storage::PgPool) ─────────────────────────────
namespace db {
/// Tamaño máximo del pool de conexiones por proceso.
/// Env: PG_POOL_SIZE. Dimensionar según núcleos y carga concurrente.
inline constexpr std::size_t kDefaultPoolSize = 64;

/// Tamaño mínimo admisible del pool (clamp inferior del override por env).
inline constexpr std::size_t kMinPoolSize = 2;
}  // namespace db

// ── Servidor HTTP/WS (main) ────────────────────────────────────────────────
namespace server {
/// Puerto HTTP/WS por defecto del gateway.
/// Env: MAPAS_PORT.
inline constexpr int kDefaultHttpPort = 8081;

/// Capacidad objetivo del pool de sesiones WebSocket (ADR-003).
/// Dimensionado para ~10k sensores + holgura.
inline constexpr int kWsPoolSize = 15000;
}  // namespace server

// ── Autenticación / sesión ─────────────────────────────────────────────────
namespace auth {
/// TTL de sesión (minutos). 480 = 8 horas (un turno operativo).
/// Env: SESSION_TTL_MINUTES.
inline constexpr int kSessionTtlMinutes = 480;

/// Longitud mínima de contraseña aceptada al registrar/cambiar credenciales.
inline constexpr std::size_t kPasswordMinLength = 8;

/// Longitud máxima de nombre de usuario (alineada con VARCHAR(80) en BD).
inline constexpr std::size_t kUsernameMaxLength = 80;

/// Longitud mínima de nombre de usuario.
inline constexpr std::size_t kUsernameMinLength = 3;

/// Longitud máxima de campos de nombre libre (first_name, last_name, company
/// tal como llega en el registro -- el catálogo de empresas tiene su propio
/// límite en auth_companies). Ver security::Validator::isValidDisplayName.
inline constexpr std::size_t kDisplayNameMaxLength = 120;
}  // namespace auth

// ── Vigilancia / captura de snapshot de cámara ─────────────────────────────
namespace surveillance {
/// Timeout (segundos) del subproceso de captura de snapshot.
/// Evita que un script colgado bloquee el hilo. Env: SURVEILLANCE_SNAPSHOT_TIMEOUT_S.
inline constexpr int kSnapshotTimeoutSeconds = 15;

/// Tamaño mínimo (bytes) de un JPEG para considerarlo válido (no placeholder).
inline constexpr std::size_t kMinValidJpegBytes = 64;
}  // namespace surveillance

// ── Paginación por defecto de listados (auth_routes, etc.) ─────────────────
namespace paging {
/// Número de página por defecto (1-indexed).
inline constexpr int kDefaultPage = 1;

/// Tamaño de página por defecto.
inline constexpr int kDefaultPageSize = 20;

/// Tamaño de página máximo admitido (protege contra dumps completos).
inline constexpr int kMaxPageSize = 200;
}  // namespace paging

// ── KPI / fórmulas ─────────────────────────────────────────────────────────
namespace kpi {
/// sort_order por defecto para KPIs sin orden explícito.
inline constexpr int kDefaultSortOrder = 100;
}  // namespace kpi

}  // namespace config
