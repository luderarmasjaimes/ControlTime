#include "whatsapp_bot_engine.hpp"
#include "whatsapp_client.hpp"
#include "whatsapp_menu.hpp"
#include "whatsapp_media_client.hpp"
#include "support_storage_pg.hpp"
#include "cv_storage_pg.hpp"
#include "cv_extraction_client.hpp"
#include "mining_chatbot_service.hpp"
#include "../config/app_config.hpp"
#include "../mining/alarm_notifier.hpp"

#include <algorithm>
#include <cctype>
#include <deque>
#include <iostream>
#include <mutex>
#include <optional>
#include <sstream>
#include <unordered_set>
#include <vector>

using config::AppConfig;

namespace support {

namespace {

// ── Cache de deduplicación en memoria contra reintentos rápidos de webhook ──
class RecentMessageIdsCache {
public:
  bool checkAndInsert(const std::string &wamid) {
    if (wamid.empty()) return false;
    std::lock_guard<std::mutex> lock(mutex_);
    if (seen_.find(wamid) != seen_.end()) {
      return true; // Ya fue procesado
    }
    seen_.insert(wamid);
    order_.push_back(wamid);
    if (order_.size() > 2000) {
      seen_.erase(order_.front());
      order_.pop_front();
    }
    return false;
  }

private:
  std::mutex mutex_;
  std::unordered_set<std::string> seen_;
  std::deque<std::string> order_;
};

RecentMessageIdsCache g_recentMessages;

std::string trim(const std::string &s) {
  const auto a = s.find_first_not_of(" \t\r\n");
  if (a == std::string::npos) return "";
  const auto b = s.find_last_not_of(" \t\r\n");
  return s.substr(a, b - a + 1);
}

std::string toLower(const std::string &s) {
  std::string out = s;
  std::transform(out.begin(), out.end(), out.begin(),
                 [](unsigned char c) { return std::tolower(c); });
  return out;
}

// ── Preguntas por sub-flujo de calificación (estado genérico COLLECTING) ──
struct FlowQuestion {
  std::string field;
  std::string prompt;
};

const std::vector<FlowQuestion> &questionsForFlow(const std::string &flow) {
  static const std::vector<FlowQuestion> soporte = {
      {"nombre", "🛠️ *Soporte técnico* — ¿Cuál es tu nombre completo?"},
      {"empresa", "¿Cuál es tu empresa o unidad minera?"},
      {"descripcion", "Cuéntanos brevemente el problema técnico o equipo/sensor afectado."},
  };
  static const std::vector<FlowQuestion> comercial = {
      {"nombre", "💼 *Área comercial* — ¿Cuál es tu nombre completo?"},
      {"empresa", "¿Cuál es tu empresa y cargo?"},
      {"descripcion", "¿Qué producto, sensor o servicio te interesa cotizar?"},
  };
  static const std::vector<FlowQuestion> reclamo = {
      {"nombre", "📋 *Nuevo reclamo* — ¿Cuál es tu nombre completo?"},
      {"empresa", "¿Cuál es tu empresa o unidad minera?"},
      {"descripcion", "Describe el reclamo o incidencia con el mayor detalle posible."},
  };
  static const std::vector<FlowQuestion> docSolicitud = {
      {"nombre", "📄 *Solicitud de Documento* — ¿Cuál es tu nombre y correo corporativo?"},
      {"empresa", "¿Cuál es tu empresa o unidad minera?"},
      {"descripcion", "¿Qué plantilla o informe técnico necesitas (ej. Monitoreo Geotécnico, Ficha Piezómetros, Presentación Gerencial)?"},
  };
  static const std::vector<FlowQuestion> agenda = {
      {"nombre", "🗓️ *Agendar visita técnica* — ¿Cuál es tu nombre completo?"},
      {"empresa", "¿Cuál es tu empresa y ubicación de la unidad minera?"},
      {"fecha", "¿Qué fecha y horario propones para la visita en campo?"},
  };
  static const std::vector<FlowQuestion> emergencia = {
      {"descripcion",
       "🚨 *Emergencia Minera / Crítica* — Describe brevemente la contingencia ocurrida. "
       "Nuestro equipo de guardia será notificado de inmediato."},
  };
  static const std::vector<FlowQuestion> rrhh = {
      {"nombre", "🧑‍💼 *Recursos Humanos* — ¿Cuál es tu nombre completo?"},
      {"empresa", "¿Cuál es tu empresa o cargo al que postulas?"},
      {"descripcion", "Cuéntanos brevemente tu consulta (postulaciones, planillas, certificados, personal)."},
  };

  if (flow == "soporte") return soporte;
  if (flow == "comercial") return comercial;
  if (flow == "reclamo_nuevo") return reclamo;
  if (flow == "doc_solicitud") return docSolicitud;
  if (flow == "agenda") return agenda;
  if (flow == "rrhh") return rrhh;
  return emergencia;
}

/** @brief category/priority de support_ticket para cada flujo, y a qué
 * número humano (si alguno) se notifica al finalizar. */
struct FlowOutcome {
  std::string category;
  std::string priority;
  std::string notifyToE164; // vacío = no se notifica a un humano de inmediato
};

/** @brief Número efectivo de contacto `key` ('soporte'|'comercial'|'rrhh'): la fila de
 * `whatsapp_contact_number` si alguna vez se editó desde la plataforma web o la
 * opción "Administración" del bot (ADR-114), si no el valor "de fábrica" de la
 * variable de entorno (`envFallback`). */
std::string effectiveContactNumber(const std::string &key, const std::string &envFallback) {
  const auto row = getContactNumberPg(AppConfig::instance().gDatabaseUrl, key);
  if (row && !row->phoneE164.empty()) return row->phoneE164;
  return envFallback;
}

FlowOutcome outcomeForFlow(const std::string &flow) {
  auto &cfg = AppConfig::instance();
  const std::string soporte = effectiveContactNumber("soporte", cfg.gWhatsappSupportToE164);
  const std::string comercial = effectiveContactNumber("comercial", cfg.gWhatsappComercialToE164);
  const std::string rrhh = effectiveContactNumber("rrhh", cfg.gWhatsappRrhhToE164);

  if (flow == "soporte") return {"soporte", "media", soporte};
  if (flow == "comercial") return {"comercial", "media", comercial};
  if (flow == "doc_solicitud") return {"soporte", "media", soporte};
  if (flow == "agenda") return {"agenda", "media", soporte};
  if (flow == "emergencia") return {"soporte", "alta", soporte};
  if (flow == "rrhh") return {"rrhh", "media", rrhh};
  return {"reclamo", "media", ""}; // reclamo_nuevo: solo cola de tickets
}

std::string humanFlowLabel(const std::string &flow) {
  if (flow == "soporte") return "Soporte técnico";
  if (flow == "comercial") return "Área comercial";
  if (flow == "doc_solicitud") return "Solicitud de documento";
  if (flow == "agenda") return "Agenda de visita técnica";
  if (flow == "emergencia") return "🚨 EMERGENCIA";
  if (flow == "rrhh") return "Recursos Humanos";
  return "Reclamo";
}

std::string answersToDescription(const json::object &answers) {
  std::string out;
  for (auto &kv : answers) {
    if (!out.empty()) out += "\n";
    out += std::string(kv.key()) + ": " + std::string(json::value_to<std::string>(kv.value()));
  }
  return out;
}

void logOut(const config::WhatsappLine &line, const std::string &phone,
           const std::string &messageType, const json::value &payload,
           const WhatsappSendResult &sendResult) {
  json::object logged{{"payload", payload}, {"send_ok", sendResult.ok}};
  if (!sendResult.error.empty()) logged["send_error"] = sendResult.error;
  appendMessageLogPg(AppConfig::instance().gDatabaseUrl, phone, line.id, "out", messageType,
                     logged, "");
}

void sendText(const config::WhatsappLine &line, const std::string &phone,
             const std::string &body) {
  const auto res = sendWhatsappTextMessage(line, phone, body);
  logOut(line, phone, "text", json::object{{"body", body}}, res);
}

void sendRootMenu(const config::WhatsappLine &line, const std::string &phone) {
  std::vector<WhatsappListSection> sections = {
      {"Menú principal",
       {
           {kMenuSoporte, "🛠️ Soporte técnico", "Reporta un problema técnico"},
           {kMenuComercial, "💼 Área comercial", "Ventas y cotizaciones"},
           {kMenuReclamos, "📋 Gestión de reclamos", "Nuevo reclamo o consultar código"},
           {kMenuDocumentos, "📄 Documentos", "Plantillas Word y PowerPoint"},
           {kMenuIa, "🤖 Consultas a la IA", "Pregunta lo que necesites"},
           {kMenuEmergencia, "🚨 Emergencia", "Atención prioritaria inmediata"},
           {kMenuAgenda, "🗓️ Agendar visita", "Coordina una visita en campo"},
           {kMenuRrhh, "🧑‍💼 Recursos Humanos", "Consultas de personal, planillas, postulaciones"},
           {kMenuVolver, "👤 Hablar con agente", "Canales directos de atención"},
       }}};
  const auto res = sendWhatsappInteractiveListMessage(
      line, phone, "👋 Bienvenido a Beemetry", menuRootBodyText(), "Beemetry · Plataforma minera",
      "Ver opciones", sections);
  logOut(line, phone, "interactive_list", json::object{{"body", menuRootBodyText()}}, res);
}

void sendDocumentosSubmenu(const config::WhatsappLine &line, const std::string &phone) {
  std::vector<WhatsappListSection> sections = {
      {"Documentos y Plantillas",
       {
           {kDocPlantillasWord, "📑 Plantillas Word (DOCX)", "Informes geotécnicos y fichas"},
           {kDocPlantillasPptx, "📊 Plantillas PPTX", "Presentaciones ejecutivas para gerencia"},
           {kDocSolicitarFicha, "📝 Solicitar Documento", "Pide un informe o plantilla a tu correo"},
           {kMenuVolver, "👤 Volver al menú principal", ""},
       }}};
  const std::string body =
      "📄 *Generación de Documentos y Reportes*\n"
      "Selecciona una opción:\n"
      "1. 📑 Plantillas Word / DOCX (Informes técnicos y fichas de campo)\n"
      "2. 📊 Plantillas PowerPoint / PPTX (Presentaciones ejecutivas de relaves)\n"
      "3. 📝 Solicitar generación o envío de plantilla/informe\n"
      "0. 👤 Volver al menú principal";
  const auto res =
      sendWhatsappInteractiveListMessage(line, phone, "", body, "Beemetry · Documentos", "Ver opciones", sections);
  logOut(line, phone, "interactive_list", json::object{{"body", body}}, res);
}

void sendAgentContactOptions(const config::WhatsappLine &line, const std::string &phone) {
  auto &cfg = AppConfig::instance();
  const std::string soporte = effectiveContactNumber("soporte", cfg.gWhatsappSupportToE164);
  const std::string comercial = effectiveContactNumber("comercial", cfg.gWhatsappComercialToE164);
  const std::string rrhh = effectiveContactNumber("rrhh", cfg.gWhatsappRrhhToE164);

  std::string body =
      "👤 *Atención con Asesor Humano*\n"
      "Puedes comunicarte directamente con nuestros especialistas según tu requerimiento:\n\n";
  if (!soporte.empty()) {
    body += "🛠️ *Soporte Técnico Minero (24/7):*\n👉 https://wa.me/" + soporte + "\n\n";
  }
  if (!comercial.empty()) {
    body += "💼 *Área Comercial y Cotizaciones:*\n👉 https://wa.me/" + comercial + "\n\n";
  }
  if (!rrhh.empty()) {
    body += "🧑‍💼 *Recursos Humanos y Selección:*\n👉 https://wa.me/" + rrhh + "\n\n";
  }
  body += "También puedes responder:\n"
          "• *1* para registrar un ticket de soporte técnico\n"
          "• *2* para solicitar cotización comercial\n"
          "• *menu* para ver todas las opciones del menú.";
  sendText(line, phone, body);
}

/** @brief Submenú de la opción oculta "Administración" (ADR-114) */
void sendAdminSubmenu(const config::WhatsappLine &line, const std::string &phone) {
  std::vector<WhatsappListSection> sections = {
      {"Administración",
       {
           {kAdminContactSoporte, "🛠️ Soporte técnico", "Editar número de contacto"},
           {kAdminContactComercial, "💼 Área comercial", "Editar número de contacto"},
           {kAdminContactRrhh, "🧑‍💼 Recursos Humanos", "Editar número de contacto"},
           {kMenuVolver, "👤 Volver al menú", ""},
       }}};
  const std::string body =
      "⚙️ *Administración* — ¿Qué número de contacto quieres editar?\n"
      "1. Soporte técnico\n2. Área comercial\n3. Recursos Humanos\n0. Volver al menú";
  const auto res =
      sendWhatsappInteractiveListMessage(line, phone, "", body, "", "Ver opciones", sections);
  logOut(line, phone, "interactive_list", json::object{{"body", body}}, res);
}

struct AdminContactChoice {
  std::string key;
  std::string label;
};

AdminContactChoice adminContactChoiceFor(const std::string &choice) {
  if (choice == kAdminContactSoporte) return {"soporte", "Soporte técnico"};
  if (choice == kAdminContactComercial) return {"comercial", "Área comercial"};
  return {"rrhh", "Recursos Humanos"};
}

void sendReclamosSubmenu(const config::WhatsappLine &line, const std::string &phone) {
  std::vector<WhatsappListSection> sections = {
      {"Reclamos",
       {
           {kReclamoNuevo, "🆕 Nuevo reclamo", "Registra una incidencia y recibe un código"},
           {kReclamoConsultar, "🔎 Consultar reclamo", "Escribe tu código de seguimiento"},
           {kMenuVolver, "👤 Volver al menú", ""},
       }}};
  const std::string body =
      "📋 *Gestión de reclamos*\n1. Nuevo reclamo\n2. Consultar reclamo (con tu código)\n0. "
      "Volver al menú";
  const auto res =
      sendWhatsappInteractiveListMessage(line, phone, "", body, "", "Ver opciones", sections);
  logOut(line, phone, "interactive_list", json::object{{"body", body}}, res);
}

/** @brief Submenú de RRHH (ADR-122): antes "Recursos Humanos" caía directo
 * al COLLECTING genérico -- ahora primero pregunta si el postulante quiere
 * enviar su CV (flujo de subida de documento) u otra consulta. */
void sendRrhhSubmenu(const config::WhatsappLine &line, const std::string &phone) {
  std::vector<WhatsappListSection> sections = {
      {"Recursos Humanos",
       {
           {kRrhhEnviarCv, "📄 Enviar mi CV", "Postula adjuntando tu currículum (Word o PDF)"},
           {kRrhhOtraConsulta, "💬 Otra consulta", "Planillas, certificados, personal"},
           {kMenuVolver, "👤 Volver al menú", ""},
       }}};
  const std::string body =
      "🧑‍💼 *Recursos Humanos*\n1. 📄 Enviar mi CV (postulación)\n2. 💬 Otra consulta\n0. "
      "Volver al menú";
  const auto res =
      sendWhatsappInteractiveListMessage(line, phone, "", body, "", "Ver opciones", sections);
  logOut(line, phone, "interactive_list", json::object{{"body", body}}, res);
}

/** @brief Tipos MIME aceptados para el CV (ADR-122) -- Word (.docx, y el
 * legado .doc) y PDF. Se valida DOS veces: acá (tras descargar, contra lo
 * que reportó la Graph API) y en ai_engine (defensa en profundidad). */
bool isAllowedCvMimeType(const std::string &mime) {
  return mime == "application/pdf" ||
         mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
         mime == "application/msword";
}

std::string cvExtensionForMime(const std::string &mime) {
  if (mime == "application/pdf") return ".pdf";
  if (mime == "application/msword") return ".doc";
  return ".docx";
}

/** @brief Arma el resumen legible que se envía por WhatsApp/correo a RRHH --
 * mismo dato tanto si la extracción tuvo éxito como si no (en ese caso,
 * indica explícitamente que hay que revisar el archivo a mano, ver ADR-122
 * "nunca se pierde una postulación en silencio"). */
std::string cvSummaryText(const CvSubmissionRecord &submission,
                          const std::optional<CvCandidateProfile> &profile) {
  std::ostringstream out;
  out << "📥 *Nueva postulación de CV* (RRHH)\n";
  out << "De: " << submission.phoneE164 << "\n";
  out << "Archivo: " << (submission.originalFilename.empty() ? std::string("cv")
                                                              : submission.originalFilename)
      << "\n\n";
  if (!profile.has_value()) {
    out << "⚠️ No se pudo procesar automáticamente este CV con IA -- revisar el archivo "
           "adjunto manualmente.\n";
    return out.str();
  }
  const auto &p = *profile;
  auto line = [&](const char *label, const std::string &v) {
    if (!v.empty()) out << label << ": " << v << "\n";
  };
  line("Nombres", p.nombres);
  line("Apellidos", p.apellidos);
  line("Celular", p.celular);
  line("WhatsApp", p.whatsapp);
  line("Cargo al que postula", p.cargoPostulado);
  line("Lugar de residencia", p.lugarResidencia);
  if (p.score) out << "Puntuación IA (triaje 0-100): " << *p.score << "/100\n";
  if (!p.scoreRationale.empty()) out << "Motivo: " << p.scoreRationale << "\n";
  out << "\n_Puntaje generado por IA como apoyo de priorización -- revisa siempre el CV "
         "original antes de decidir._";
  return out.str();
}

/** @brief Pipeline completo tras recibir un documento válido en el estado
 * RRHH_CV_UPLOAD: persiste, extrae texto (ai_engine), extrae campos+score
 * (Ollama), y notifica a RRHH por correo (adjunto) y WhatsApp -- en ese
 * orden, sin abortar el fan-out de notificación aunque la extracción falle
 * (ver ADR-122: ninguna postulación se pierde en silencio). */
void processCvSubmission(const config::WhatsappLine &line, const std::string &phone,
                         ConversationRecord &conv, const std::vector<unsigned char> &fileBytes,
                         const std::string &filename, const std::string &mimeType) {
  auto &cfg = AppConfig::instance();

  CvSubmissionRecord submission;
  std::string err;
  if (!insertCvSubmissionPg(cfg.gDatabaseUrl, phone, line.id, conv.tenantId, "", filename,
                            mimeType, static_cast<int>(fileBytes.size()), fileBytes, submission,
                            err)) {
    std::cerr << "[WHATSAPP_BOT] fallo al guardar cv_submission: " << err << std::endl;
    sendText(line, phone,
            "Hubo un problema guardando tu CV. Por favor intenta de nuevo en unos minutos, o "
            "escribe *menu*.");
    conv.state = "MENU_ROOT";
    conv.context = json::object{};
    return;
  }

  sendText(line, phone,
          "✅ Recibimos tu CV, gracias. Nuestro equipo de RRHH lo revisará y se pondrá en "
          "contacto contigo si tu perfil encaja con una posición disponible.\n\nEscribe *menu* "
          "para volver al menú principal.");
  conv.state = "MENU_ROOT";
  conv.context = json::object{};

  // Extracción de texto (ai_engine) -- solo texto plano, sin interpretar
  // contenido todavía.
  const auto textResult = extractCvTextFromAiEngine(fileBytes, filename, mimeType);
  updateCvSubmissionTextPg(cfg.gDatabaseUrl, submission.id, textResult.ok ? textResult.text : "",
                          textResult.ok ? "extracted" : "extraction_failed");
  if (!textResult.ok) {
    std::cerr << "[WHATSAPP_BOT] extracción de texto de CV falló (" << submission.id
              << "): " << textResult.error << std::endl;
  }

  // Extracción de campos + score (Ollama) -- solo si hubo texto utilizable.
  std::optional<CvCandidateProfile> profile;
  if (textResult.ok) {
    const auto fieldsResult = extractCvFieldsWithOllama(textResult.text);
    if (fieldsResult.ok) {
      std::string profErr;
      if (insertCvCandidateProfilePg(cfg.gDatabaseUrl, submission.id, fieldsResult.profile,
                                     profErr)) {
        profile = fieldsResult.profile;
        updateCvSubmissionStatusPg(cfg.gDatabaseUrl, submission.id, "scored");
      } else {
        std::cerr << "[WHATSAPP_BOT] fallo al guardar cv_candidate_profile (" << submission.id
                  << "): " << profErr << std::endl;
      }
    } else {
      std::cerr << "[WHATSAPP_BOT] extracción de campos de CV falló (" << submission.id
                << "): " << fieldsResult.error << std::endl;
    }
  }

  // Fan-out de notificación a RRHH -- SIEMPRE, tenga o no perfil extraído
  // (ver ADR-122: ninguna postulación se pierde en silencio). Reusa el
  // mismo número de contacto ya resuelto para el resto del flujo rrhh.
  const std::string summary = cvSummaryText(submission, profile);
  const std::string rrhhNumber = effectiveContactNumber("rrhh", cfg.gWhatsappRrhhToE164);
  bool anyNotifyOk = false;

  if (!cfg.gHrCvEmailTo.empty()) {
    std::string emailDetail;
    const bool emailOk = mining_iot::sendEmailWithAttachment(
        cfg.gHrCvEmailTo, "Nueva postulación de CV -- " + submission.originalFilename, summary,
        submission.originalFilename, submission.mimeType, fileBytes, emailDetail);
    anyNotifyOk = anyNotifyOk || emailOk;
    if (!emailOk) {
      std::cerr << "[WHATSAPP_BOT] correo de postulación de CV falló (" << submission.id
                << "): " << emailDetail << std::endl;
    }
  }
  if (!rrhhNumber.empty()) {
    sendText(line, rrhhNumber, summary);
    anyNotifyOk = true;
  }

  updateCvSubmissionStatusPg(cfg.gDatabaseUrl, submission.id,
                            anyNotifyOk ? "notified" : "notify_failed");
}

void startCollectingFlow(const config::WhatsappLine &line, const std::string &phone,
                         ConversationRecord &conv, const std::string &flow) {
  conv.state = "COLLECTING";
  conv.context = json::object{{"flow", flow}, {"step", 0}, {"answers", json::object{}}};
  sendText(line, phone, questionsForFlow(flow).front().prompt);
}

/** @brief Crea el support_ticket con las respuestas ya calificadas, notifica
 * al equipo humano si corresponde y responde al usuario con el código. */
void finalizeCollectingFlow(const config::WhatsappLine &line, const std::string &phone,
                            ConversationRecord &conv, const std::string &flow,
                            const json::object &answers) {
  const auto outcome = outcomeForFlow(flow);
  const std::string nombre =
      answers.contains("nombre") ? json::value_to<std::string>(answers.at("nombre")) : "";
  const std::string descripcion = answersToDescription(answers);

  TicketRecord ticket;
  std::string error;
  const bool created = createTicketPg(
      AppConfig::instance().gDatabaseUrl, "whatsapp", outcome.category, phone, nombre,
      conv.tenantId, humanFlowLabel(flow), descripcion, outcome.priority, ticket, error);

  if (!created) {
    std::cerr << "[WHATSAPP_BOT] fallo al crear ticket (" << flow << "): " << error << std::endl;
    sendText(line, phone,
            "Hubo un problema registrando tu solicitud. Por favor intenta de nuevo en unos "
            "minutos, o vuelve a escribir *menu*.");
    conv.state = "MENU_ROOT";
    conv.context = json::object{};
    return;
  }

  std::string confirmation = "✅ Listo, " + (nombre.empty() ? std::string("gracias") : nombre) +
                             ". Tu código de seguimiento es *" + ticket.code + "*.\n";
  if (!outcome.notifyToE164.empty()) {
    confirmation += "Un especialista de nuestro equipo ya fue notificado y te contactará pronto. "
                    "También puedes escribirle directo: https://wa.me/" +
                    outcome.notifyToE164 + "\n";
    // Evita duplicar el mensaje si el emisor es el propio teléfono del agente (ej. en pruebas)
    if (outcome.notifyToE164 != phone) {
      sendText(line, outcome.notifyToE164,
              "📥 Nueva solicitud (" + humanFlowLabel(flow) + ") — código " + ticket.code +
                  "\nDe: " + phone + "\n" + descripcion);
    }
  } else {
    confirmation += "Guarda este código: podrás consultar el estado del reclamo escribiendo "
                    "*3* (Gestión de reclamos → Consultar) en cualquier momento.\n";
  }
  confirmation += "\nEscribe *menu* para volver al menú principal.";
  sendText(line, phone, confirmation);

  conv.state = "MENU_ROOT";
  conv.context = json::object{};
}

void handleCollectingStep(const config::WhatsappLine &line, const std::string &phone,
                          ConversationRecord &conv, const std::string &input) {
  const std::string flow =
      conv.context.contains("flow") ? json::value_to<std::string>(conv.context.at("flow")) : "";
  const auto &questions = questionsForFlow(flow);
  const int step = conv.context.contains("step")
                       ? static_cast<int>(json::value_to<std::int64_t>(conv.context.at("step")))
                       : 0;
  if (flow.empty() || step < 0 || step >= static_cast<int>(questions.size())) {
    conv.state = "MENU_ROOT";
    conv.context = json::object{};
    sendText(line, phone, "Volvamos a empezar.");
    sendRootMenu(line, phone);
    return;
  }
  if (trim(input).empty()) {
    sendText(line, phone, "Por favor responde con un texto -- " + questions[step].prompt);
    return;
  }

  json::object answers = conv.context.contains("answers") ? conv.context.at("answers").as_object()
                                                           : json::object{};
  answers[questions[step].field] = trim(input);

  if (step + 1 < static_cast<int>(questions.size())) {
    conv.context = json::object{{"flow", flow}, {"step", step + 1}, {"answers", answers}};
    sendText(line, phone, questions[step + 1].prompt);
    return;
  }
  finalizeCollectingFlow(line, phone, conv, flow, answers);
}

void handleReclamoConsulta(const config::WhatsappLine &line, const std::string &phone,
                           ConversationRecord &conv, const std::string &input) {
  const std::string code = trim(input);
  TicketRecord ticket;
  if (code.empty() || !findTicketByCodePg(AppConfig::instance().gDatabaseUrl, code, ticket)) {
    sendText(line, phone,
            "No encontré ningún registro con el código *" + code +
                "*. Verifica que esté bien escrito, o escribe *menu* para volver.");
    return;
  }
  std::string response =
      "📋 *Detalle del Ticket / Reclamo*\n"
      "• *Código:* " + ticket.code + "\n"
      "• *Estado:* " + ticket.status + "\n"
      "• *Categoría:* " + ticket.category + "\n"
      "• *Prioridad:* " + ticket.priority + "\n"
      "• *Fecha registro:* " + ticket.createdAt + "\n"
      "• *Última actualización:* " + ticket.updatedAt + "\n";
  if (!ticket.resolvedAt.empty()) {
    response += "• *Fecha resolución:* " + ticket.resolvedAt + "\n";
  }
  response += "\nEscribe *menu* para volver al menú principal.";
  sendText(line, phone, response);
  conv.state = "MENU_ROOT";
  conv.context = json::object{};
}

void handleAdminEditNumberStep(const config::WhatsappLine &line, const std::string &phone,
                              ConversationRecord &conv, const std::string &input) {
  const std::string key = conv.context.contains("admin_key")
                              ? json::value_to<std::string>(conv.context.at("admin_key"))
                              : "";
  const std::string label = conv.context.contains("admin_label")
                                ? json::value_to<std::string>(conv.context.at("admin_label"))
                                : key;
  const std::string candidate = trim(input);
  const bool looksLikeE164 = candidate.size() >= 8 && candidate.size() <= 15 &&
                             candidate.find_first_not_of("0123456789") == std::string::npos;
  if (key.empty() || !looksLikeE164) {
    sendText(line, phone,
            "Ese número no parece válido. Escribe solo dígitos, sin '+' ni espacios (ej. "
            "51999888777), o *menu* para cancelar.");
    return;
  }
  std::string error;
  const bool ok = setContactNumberPg(AppConfig::instance().gDatabaseUrl, key, label, candidate,
                                     "wa:" + phone, error);
  sendText(line, phone,
          ok ? ("✅ Número de " + label + " actualizado a " + candidate + ".")
             : ("Hubo un problema guardando el número. Intenta de nuevo o escribe *menu*."));
  conv.state = "MENU_ROOT";
  conv.context = json::object{};
}

void handleIaTurn(const config::WhatsappLine &line, const std::string &phone,
                  ConversationRecord &conv, const std::string &input) {
  if (resolveRootMenuChoice(input) == kMenuVolver || toLower(trim(input)) == "menu" ||
      toLower(trim(input)) == "menú" || trim(input) == "0") {
    conv.state = "MENU_ROOT";
    conv.context = json::object{};
    sendText(line, phone, "Volviendo al menú principal.");
    sendRootMenu(line, phone);
    return;
  }
  if (trim(input).empty()) {
    sendText(line, phone, "🤖 Escríbeme tu consulta sobre sensores o telemetría, o *menu* para volver.");
    return;
  }

  json::array messages =
      conv.context.contains("ia_messages") ? conv.context.at("ia_messages").as_array()
                                            : json::array{};
  messages.push_back(json::object{{"role", "user"}, {"content", input}});

  json::object body{{"qualifying", json::object{}}, {"messages", messages}};
  const auto out = handleChatMessage(json::value(body), "");
  std::string reply;
  if (out.contains("error")) {
    reply = "🤖 El asistente de IA no está disponible en este momento. Intenta más tarde o "
            "escribe *menu*.";
  } else {
    reply = json::value_to<std::string>(out.at("reply"));
    messages.push_back(json::object{{"role", "assistant"}, {"content", reply}});
  }
  while (messages.size() > 6) messages.erase(messages.begin());
  conv.context = json::object{{"ia_messages", messages}};
  sendText(line, phone, reply + "\n\n_(Escribe \"menu\" para volver al menú principal)_");
}

} // namespace

void handleInboundMessage(const InboundWhatsappMessage &msg) {
  const std::string &phone = msg.fromE164;
  if (phone.empty()) return;

  // Deduplicación estricta en memoria y en Postgres para evitar procesar reintentos de Meta
  if (!msg.waMessageId.empty()) {
    if (g_recentMessages.checkAndInsert(msg.waMessageId) ||
        isWaMessageAlreadyLoggedPg(AppConfig::instance().gDatabaseUrl, msg.waMessageId)) {
      std::cerr << "[WHATSAPP_BOT] mensaje duplicado ignorado (wamid=" << msg.waMessageId << ")" << std::endl;
      return;
    }
  }

  const auto *resolvedLine = AppConfig::instance().whatsappLineById(msg.lineId);
  const config::WhatsappLine line =
      resolvedLine ? *resolvedLine : config::WhatsappLine{msg.lineId, "", "", "Sin configurar"};

  appendMessageLogPg(AppConfig::instance().gDatabaseUrl, phone, line.id, "in", msg.type,
                     msg.rawPayload, msg.waMessageId);

  const std::string input = msg.type == "interactive" ? msg.interactiveReplyId : msg.textBody;

  ConversationRecord conv;
  if (!getOrCreateConversationPg(AppConfig::instance().gDatabaseUrl, phone, line.id, conv)) {
    std::cerr << "[WHATSAPP_BOT] no se pudo resolver la conversación de " << phone
              << " (linea " << line.id << ")" << std::endl;
    return;
  }
  if (conv.isStale && conv.state != "MENU_ROOT") {
    conv.state = "MENU_ROOT";
    conv.context = json::object{};
  }

  if (conv.state == "MENU_ROOT") {
    const std::string choice = resolveRootMenuChoice(input);
    const std::string cleanInput = toLower(trim(input));

    if (choice == kMenuSoporte) {
      startCollectingFlow(line, phone, conv, "soporte");
    } else if (choice == kMenuComercial) {
      startCollectingFlow(line, phone, conv, "comercial");
    } else if (choice == kMenuReclamos) {
      conv.state = "RECLAMOS_MENU";
      sendReclamosSubmenu(line, phone);
    } else if (choice == kMenuDocumentos) {
      conv.state = "DOCUMENTOS_MENU";
      sendDocumentosSubmenu(line, phone);
    } else if (choice == kMenuIa) {
      conv.state = "IA_CHAT";
      conv.context = json::object{};
      sendText(line, phone, "🤖 *Asistente de IA Minera*\nPregúntame sobre piezómetros, inclinómetros, "
                            "presión de poro, normas ICMM/GISTM o estado de sensores.\n"
                            "Escribe *menu* en cualquier momento para volver.");
    } else if (choice == kMenuEmergencia) {
      startCollectingFlow(line, phone, conv, "emergencia");
    } else if (choice == kMenuAgenda) {
      startCollectingFlow(line, phone, conv, "agenda");
    } else if (choice == kMenuRrhh) {
      conv.state = "RRHH_MENU";
      sendRrhhSubmenu(line, phone);
    } else if (cleanInput == "0" || cleanInput == "agente" || cleanInput == "hablar con agente" ||
               cleanInput == "humano" || cleanInput == "asesor") {
      sendAgentContactOptions(line, phone);
    } else if (choice == kMenuAdmin) {
      if (AppConfig::instance().isWhatsappAdminPhone(phone)) {
        conv.state = "ADMIN_MENU";
        sendAdminSubmenu(line, phone);
      } else {
        sendRootMenu(line, phone);
      }
    } else {
      sendRootMenu(line, phone);
    }
  } else if (conv.state == "DOCUMENTOS_MENU") {
    const std::string choice = resolveDocumentosSubmenuChoice(input);
    if (choice == kDocPlantillasWord) {
      sendText(line, phone,
               "📑 *Plantillas Oficiales en Word (DOCX)*\n\n"
               "Disponibles en la plataforma Beemetry:\n"
               "• *Informe de Monitoreo Geotécnico:* Análisis de presiones de poro, deformaciones y nivel freático.\n"
               "• *Ficha Técnica de Instrumentación:* Piezómetros, inclinómetros y celdas de asentamiento.\n"
               "• *Acta de Instalación y Calibración:* Protocolo de puesta en marcha de sensores en campo.\n"
               "• *Propuesta Técnica de Instrumentación:* Plan de instrumentación de presas de relaves y tajos.\n\n"
               "💡 *¿Cómo usarlas?* En la plataforma web (sección Informes), pulsa *Plantillas* e *Insertar* en el editor.\n"
               "Para solicitar el envío de formatos a tu correo responde *3*, o escribe *menu* para volver.");
    } else if (choice == kDocPlantillasPptx) {
      sendText(line, phone,
               "📊 *Plantillas Ejecutivas en PowerPoint (PPTX)*\n\n"
               "Formatos para comités de seguridad y gerencia:\n"
               "• *Comité de Seguridad de Relaves (GISTM/ICMM):* KPIs, semáforo de alertas y tendencias.\n"
               "• *Dashboard Ejecutivo Mensual:* Telemetría consolidada, sectores críticos y planes de acción.\n"
               "• *Reporte de Contingencias:* Evaluación rápida ante eventos sísmicos o sobrepresiones.\n\n"
               "💡 Para solicitar formatos a tu correo responde *3*, o escribe *menu* para volver.");
    } else if (choice == kDocSolicitarFicha) {
      startCollectingFlow(line, phone, conv, "doc_solicitud");
    } else if (choice == kMenuVolver || toLower(trim(input)) == "menu" || toLower(trim(input)) == "menú") {
      conv.state = "MENU_ROOT";
      sendRootMenu(line, phone);
    } else {
      sendDocumentosSubmenu(line, phone);
    }
  } else if (conv.state == "ADMIN_MENU") {
    if (!AppConfig::instance().isWhatsappAdminPhone(phone)) {
      conv.state = "MENU_ROOT";
      conv.context = json::object{};
      sendRootMenu(line, phone);
    } else {
      const std::string choice = resolveAdminMenuChoice(input);
      if (choice == kMenuVolver) {
        conv.state = "MENU_ROOT";
        sendRootMenu(line, phone);
      } else if (choice == kAdminContactSoporte || choice == kAdminContactComercial ||
                choice == kAdminContactRrhh) {
        const auto target = adminContactChoiceFor(choice);
        conv.state = "ADMIN_EDIT_NUMBER";
        conv.context = json::object{{"admin_key", target.key}, {"admin_label", target.label}};
        sendText(line, phone,
                "✏️ Escribe el nuevo número (E.164, solo dígitos, sin '+') para *" +
                    target.label + "*, o *menu* para cancelar.");
      } else {
        sendAdminSubmenu(line, phone);
      }
    }
  } else if (conv.state == "ADMIN_EDIT_NUMBER") {
    if (!AppConfig::instance().isWhatsappAdminPhone(phone)) {
      conv.state = "MENU_ROOT";
      conv.context = json::object{};
      sendRootMenu(line, phone);
    } else if (resolveRootMenuChoice(input) == kMenuVolver || toLower(trim(input)) == "menu" ||
              toLower(trim(input)) == "menú") {
      conv.state = "MENU_ROOT";
      conv.context = json::object{};
      sendText(line, phone, "Cancelado. Volviendo al menú principal.");
      sendRootMenu(line, phone);
    } else {
      handleAdminEditNumberStep(line, phone, conv, input);
    }
  } else if (conv.state == "RECLAMOS_MENU") {
    const std::string choice = resolveReclamosSubmenuChoice(input);
    if (choice == kReclamoNuevo) startCollectingFlow(line, phone, conv, "reclamo_nuevo");
    else if (choice == kReclamoConsultar) {
      conv.state = "RECLAMO_CONSULTA";
      sendText(line, phone, "🔎 Escribe tu código de reclamo o ticket (ej. RCL-20260819-0001 o SOP-20260819-0001).");
    } else if (choice == kMenuVolver || toLower(trim(input)) == "menu" || toLower(trim(input)) == "menú") {
      conv.state = "MENU_ROOT";
      sendRootMenu(line, phone);
    } else sendReclamosSubmenu(line, phone);
  } else if (conv.state == "RECLAMO_CONSULTA") {
    handleReclamoConsulta(line, phone, conv, input);
  } else if (conv.state == "RRHH_MENU") {
    const std::string choice = resolveRrhhSubmenuChoice(input);
    if (choice == kRrhhEnviarCv) {
      conv.state = "RRHH_CV_UPLOAD";
      conv.context = json::object{};
      sendText(line, phone,
              "📄 Envía tu CV como *documento adjunto* (Word o PDF, máx. "
              "" + std::to_string(AppConfig::instance().gWhatsappCvMaxBytes / (1024 * 1024)) +
              "MB). Usa el clip 📎 de WhatsApp y elige \"Documento\" -- no lo envíes como foto.\n\n"
              "Escribe *menu* para cancelar.");
    } else if (choice == kRrhhOtraConsulta) {
      startCollectingFlow(line, phone, conv, "rrhh");
    } else if (choice == kMenuVolver || toLower(trim(input)) == "menu" || toLower(trim(input)) == "menú") {
      conv.state = "MENU_ROOT";
      sendRootMenu(line, phone);
    } else {
      sendRrhhSubmenu(line, phone);
    }
  } else if (conv.state == "RRHH_CV_UPLOAD") {
    const std::string cleanInput = toLower(trim(input));
    if (msg.type != "document" || msg.mediaId.empty()) {
      if (cleanInput == "menu" || cleanInput == "menú" || resolveRootMenuChoice(input) == kMenuVolver) {
        conv.state = "MENU_ROOT";
        conv.context = json::object{};
        sendText(line, phone, "Cancelado. Volviendo al menú principal.");
        sendRootMenu(line, phone);
      } else {
        sendText(line, phone,
                "Todavía no recibí un documento. Envía tu CV como *documento adjunto* (Word o "
                "PDF) usando el clip 📎, o escribe *menu* para cancelar.");
      }
    } else {
      // Chequeo rápido sobre lo que reportó el webhook (defensa temprana,
      // antes de gastar ancho de banda) -- la validación real, contra lo
      // que devuelve la Graph API, ocurre después de descargar (ver
      // whatsapp_media_client.cpp e isAllowedCvMimeType más abajo).
      if (!msg.mediaMimeType.empty() && !isAllowedCvMimeType(msg.mediaMimeType)) {
        sendText(line, phone,
                "Ese tipo de archivo no es válido. Solo aceptamos *Word (.docx)* o *PDF*. "
                "Intenta de nuevo, o escribe *menu* para cancelar.");
      } else {
        const auto dl = downloadWhatsappMedia(line, msg.mediaId,
                                              AppConfig::instance().gWhatsappCvMaxBytes);
        if (!dl.ok) {
          std::cerr << "[WHATSAPP_BOT] descarga de CV falló (" << msg.mediaId
                    << "): " << dl.error << std::endl;
          const std::string reason = dl.error == "file_too_large"
                                         ? "El archivo supera el tamaño máximo permitido."
                                         : "No pudimos descargar tu documento.";
          sendText(line, phone, reason + " Intenta de nuevo, o escribe *menu* para cancelar.");
        } else if (!isAllowedCvMimeType(dl.mimeType)) {
          sendText(line, phone,
                  "Ese tipo de archivo no es válido. Solo aceptamos *Word (.docx)* o *PDF*. "
                  "Intenta de nuevo, o escribe *menu* para cancelar.");
        } else {
          const std::string filename =
              msg.mediaFilename.empty() ? ("cv" + cvExtensionForMime(dl.mimeType)) : msg.mediaFilename;
          processCvSubmission(line, phone, conv, dl.bytes, filename, dl.mimeType);
        }
      }
    }
  } else if (conv.state == "COLLECTING") {
    handleCollectingStep(line, phone, conv, input);
  } else if (conv.state == "IA_CHAT") {
    handleIaTurn(line, phone, conv, input);
  } else {
    conv.state = "MENU_ROOT";
    conv.context = json::object{};
    sendRootMenu(line, phone);
  }

  saveConversationStatePg(AppConfig::instance().gDatabaseUrl, phone, line.id, conv.state,
                          conv.context, conv.tenantId);
}

} // namespace support
