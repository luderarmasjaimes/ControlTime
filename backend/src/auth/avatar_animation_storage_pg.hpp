#pragma once

#include <string>

namespace auth {

/** @brief Fila de `avatar_animation_job` (ADR-150, db_scripts/90). */
struct AvatarAnimationJob {
  std::string jobId;
  std::string userId;
  std::string tenantId;
  std::string kind;    // 'welcome' | 'onboarding' | 'report' | 'kpi' | 'alarm_loop'
  std::string status;  // 'queued' | 'running' | 'success' | 'failed' | 'cancelled'
  std::string storageUri;
  std::string errorMessage;
  std::string createdAt;
  std::string startedAt;
  std::string completedAt;
};

/** @brief Crea un job en estado `queued`, siempre asociado al usuario de la
 * SESIÓN (nunca a un userId provisto por el cliente -- mismo criterio
 * anti-IDOR que handleMyAvatarHd, auth_routes.cpp). */
bool createAvatarAnimationJobPg(const std::string &databaseUrl, const std::string &userId,
                                const std::string &tenantId, const std::string &kind,
                                std::string &outJobId, std::string &error);

/** @brief Obtiene un job por id, filtrado por `userId` (guard IDOR: un
 * usuario no puede consultar/descargar el video animado de otro). @return
 * true si se encontró; false con `error="avatar_animation_job_not_found"`
 * en otro caso (incluye "existe pero es de otro usuario" -- mismo mensaje
 * genérico, no revela si el job_id es válido). */
bool getAvatarAnimationJobPg(const std::string &databaseUrl, const std::string &jobId,
                             const std::string &userId, AvatarAnimationJob &out,
                             std::string &error);

/** @brief Actualiza el estado desde el worker (runAvatarAnimationJob, hilo
 * detached). `storageUri` vacío no sobreescribe el valor previo (COALESCE);
 * `started_at`/`completed_at` se resuelven server-side según `status`. */
bool updateAvatarAnimationJobStatusPg(const std::string &databaseUrl, const std::string &jobId,
                                      const std::string &status, const std::string &storageUri,
                                      const std::string &errorMessage, std::string &error);

/** @brief Cache de video animado (hallazgo real, sesión 2026-09-09): el guion
 * por defecto de cada `kind` es fijo (ver defaultScriptForKind en
 * avatar_animation_job.cpp), así que el resultado es el mismo mientras no
 * cambie el avatar HD fuente -- no hay razón para pagar los ~227s reales de
 * SadTalker+matting en CADA login. Devuelve el job `success` más reciente
 * para (userId, kind); el llamador (auth_routes.cpp) decide si sigue siendo
 * válido comparando la fecha del archivo de video contra la del avatar HD
 * en disco. Solo se usa cuando el caller NO pidió un guion custom (`text`
 * vacío) -- report/alarm_loop con contenido dinámico nunca deben cachearse
 * así. */
bool findLatestSuccessfulAvatarAnimationJobPg(const std::string &databaseUrl,
                                              const std::string &userId,
                                              const std::string &kind,
                                              AvatarAnimationJob &out);

/** @brief Hallazgo real, sesión 2026-09-09: `handleCreateAvatarAnimation` no
 * tenía ninguna protección server-side contra crear un job nuevo mientras
 * otro para el mismo (userId, kind) ya estaba 'queued'/'running' -- el
 * comentario en AvatarWidget.tsx que asumía "el backend ya rechaza un
 * segundo job" no correspondía a ningún código real. Con un disparador
 * duplicado del lado del cliente (confirmado en vivo: el widget se
 * remontaba y volvía a pedir la animación antes de que el mount anterior
 * pudiera cancelarse), esto hubiera lanzado un SadTalker real por cada
 * disparo -- ~227s de GPU cada uno, en serie por el mutex de GPU, sin
 * beneficio. Devuelve el job en curso más reciente si existe. */
bool findInProgressAvatarAnimationJobPg(const std::string &databaseUrl,
                                        const std::string &userId,
                                        const std::string &kind,
                                        AvatarAnimationJob &out);

}  // namespace auth
