#pragma once

#include <string>

namespace auth {

/** @brief Worker de un job `avatar_animation_job` (ADR-150, db_scripts/90):
 * marca el job `running`, lee el avatar HD YA generado y guardado del
 * usuario (`auth/avatars_hd/{userId}.png`, mismo archivo que sirve
 * `GET /api/auth/avatar/hd`) como imagen fuente -- NO se captura ni retiene
 * una foto nueva, decisión explícita para no reabrir la minimización de
 * datos de ADR-074 -- llama a avatar_animation_engine (guion `text` si vino
 * en el POST, si no un guion por defecto según `kind`), persiste el
 * video/WebM resultante a disco, y deja el job en `success` (con
 * `storage_uri`) o `failed` (con `error_message`). Pensado para correr en
 * un `std::thread(...).detach()` disparado desde
 * `POST /api/auth/avatar/animation` -- nunca de forma síncrona dentro del
 * request HTTP (mismo razonamiento ADR-023 ya aplicado a
 * report_export_jobs.cpp: 200-300s reales exceden cualquier presupuesto de
 * latencia síncrona). */
void runAvatarAnimationJob(const std::string &jobId, const std::string &userId,
                           const std::string &kind, const std::string &text,
                           bool transparentBg);

}  // namespace auth
