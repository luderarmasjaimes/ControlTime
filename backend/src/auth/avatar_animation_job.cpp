#include "avatar_animation_job.hpp"
#include "avatar_animation_storage_pg.hpp"
#include "../biometric/avatar_animation_client.hpp"
#include "../config/app_config.hpp"

#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>

namespace auth {

namespace {

// Guiones por defecto (ADR-164): welcome/onboarding/report/alarm_loop ya
// están cableados a un disparador real en el frontend (ver AvatarWidget.tsx
// / useSupportAvatar). "kpi" se queda con el placeholder a propósito -- no
// tiene todavía ningún punto de acción explícita en la UI (ver ADR-164,
// diferido sin punto de disparo real), así que nunca debería llegar a
// pedirse en producción por ahora; el placeholder documenta esa brecha en
// vez de inventar un guion para un trigger que no existe.
std::string defaultScriptForKind(const std::string &kind) {
  if (kind == "welcome") {
    return "Bienvenido a la plataforma. Tu sesión se inició correctamente.";
  }
  if (kind == "onboarding") {
    return "Hola, soy tu asistente de soporte de campo Beemetry. Estoy "
           "aquí para ayudarte a sacarle el máximo provecho a la "
           "plataforma de monitoreo minero.";
  }
  if (kind == "report") {
    return "Tu informe ya está listo. Puedes revisarlo, exportarlo o "
           "seguir editándolo cuando quieras.";
  }
  if (kind == "alarm_loop") {
    return "Se registró una alarma crítica nueva. Revisa el panel de "
           "alarmas para más detalle.";
  }
  return "Vista previa del avatar animado.";
}

}  // namespace

void runAvatarAnimationJob(const std::string &jobId, const std::string &userId,
                           const std::string &kind, const std::string &text,
                           bool transparentBg) {
  auto &cfg = config::AppConfig::instance();
  std::string statusError;
  updateAvatarAnimationJobStatusPg(cfg.gDatabaseUrl, jobId, "running", "", "", statusError);

  const std::string dataRoot = config::getenvOr("BEEMETRY_MAPAS_DATA_ROOT", "/data");
  const std::filesystem::path hdPath =
      std::filesystem::path(dataRoot) / "auth" / "avatars_hd" / (userId + ".png");

  std::ifstream ifs(hdPath, std::ios::binary);
  if (!ifs) {
    // No se genera un HD nuevo acá a propósito (evita duplicar la lógica de
    // handleMyAvatarHd/findCurrentAvatarUser) -- si el usuario nunca abrió
    // su avatar HD, el job falla con un error explícito en vez de intentar
    // reconstruir esa ruta. Follow-up real, no un olvido silencioso.
    updateAvatarAnimationJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "",
                                     "avatar_hd_not_available", statusError);
    return;
  }
  std::vector<unsigned char> sourceBytes(
      (std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
  ifs.close();
  if (sourceBytes.empty()) {
    updateAvatarAnimationJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "",
                                     "avatar_hd_empty", statusError);
    return;
  }

  const std::string script = text.empty() ? defaultScriptForKind(kind) : text;
  const auto result = biometric::fetchAnimatedAvatar(sourceBytes, script, transparentBg);
  if (!result.ok()) {
    updateAvatarAnimationJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "", result.error,
                                     statusError);
    return;
  }

  const std::string ext =
      result.contentType.find("webm") != std::string::npos ? ".webm" : ".mp4";
  const std::filesystem::path outDir =
      std::filesystem::path(dataRoot) / "auth" / "avatar_animations";
  try {
    std::filesystem::create_directories(outDir);
  } catch (const std::exception &ex) {
    updateAvatarAnimationJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "",
                                     std::string("mkdir_failed: ") + ex.what(), statusError);
    return;
  }
  const std::filesystem::path outPath = outDir / (jobId + ext);
  {
    std::ofstream out(outPath, std::ios::binary | std::ios::trunc);
    out.write(reinterpret_cast<const char *>(result.videoBytes.data()),
              static_cast<std::streamsize>(result.videoBytes.size()));
    if (!out) {
      updateAvatarAnimationJobStatusPg(cfg.gDatabaseUrl, jobId, "failed", "",
                                       "write_failed", statusError);
      return;
    }
  }
  // Mismo criterio que el avatar HD (ADR-074): archivo restringido al
  // dueño del proceso, no legible por otros usuarios del filesystem.
  std::filesystem::permissions(
      outPath,
      std::filesystem::perms::owner_read | std::filesystem::perms::owner_write,
      std::filesystem::perm_options::replace);

  updateAvatarAnimationJobStatusPg(cfg.gDatabaseUrl, jobId, "success", outPath.string(), "",
                                   statusError);
}

}  // namespace auth
