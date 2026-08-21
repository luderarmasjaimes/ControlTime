#include "whatsapp_menu.hpp"

#include <algorithm>
#include <cctype>

namespace support {

const char *const kMenuSoporte = "menu_soporte";
const char *const kMenuComercial = "menu_comercial";
const char *const kMenuReclamos = "menu_reclamos";
const char *const kMenuDocumentos = "menu_documentos";
const char *const kMenuIa = "menu_ia";
const char *const kMenuEmergencia = "menu_emergencia";
const char *const kMenuAgenda = "menu_agenda";
const char *const kMenuRrhh = "menu_rrhh";
const char *const kMenuVolver = "menu_volver";
const char *const kMenuAgente = "menu_agente";
const char *const kReclamoNuevo = "reclamo_nuevo";
const char *const kReclamoConsultar = "reclamo_consultar";
const char *const kDocPlantillasWord = "doc_plantillas_word";
const char *const kDocPlantillasPptx = "doc_plantillas_pptx";
const char *const kDocSolicitarFicha = "doc_solicitar_ficha";
const char *const kMenuAdmin = "menu_admin";
const char *const kAdminContactSoporte = "admin_contact_soporte";
const char *const kAdminContactComercial = "admin_contact_comercial";
const char *const kAdminContactRrhh = "admin_contact_rrhh";
const char *const kRrhhEnviarCv = "rrhh_enviar_cv";
const char *const kRrhhOtraConsulta = "rrhh_otra_consulta";

namespace {

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

} // namespace

std::string resolveRootMenuChoice(const std::string &input) {
  const std::string n = toLower(trim(input));
  if (n == kMenuSoporte || n == "1" || n == "soporte") return kMenuSoporte;
  if (n == kMenuComercial || n == "2" || n == "comercial") return kMenuComercial;
  if (n == kMenuReclamos || n == "3" || n == "reclamo" || n == "reclamos") return kMenuReclamos;
  if (n == kMenuDocumentos || n == "4" || n == "documentos" || n == "documento") return kMenuDocumentos;
  if (n == kMenuIa || n == "5" || n == "ia") return kMenuIa;
  if (n == kMenuEmergencia || n == "6" || n == "emergencia" || n == "urgente") return kMenuEmergencia;
  if (n == kMenuAgenda || n == "7" || n == "agenda" || n == "visita") return kMenuAgenda;
  if (n == kMenuRrhh || n == "8" || n == "rrhh" || n == "recursos humanos") return kMenuRrhh;
  if (n == kMenuVolver || n == "0" || n == "menu" || n == "menú" || n == "agente") return kMenuVolver;
  // Sin dígito asignado a propósito (ADR-114): no se anuncia en el menú
  // numerado ni en menuRootBodyText() -- solo quien ya conoce la palabra
  // clave puede llegar hasta acá (la autorización real la hace
  // whatsapp_bot_engine.cpp contra AppConfig::gWhatsappAdminPhones).
  if (n == kMenuAdmin || n == "administracion" || n == "administración" || n == "admin") {
    return kMenuAdmin;
  }
  return "";
}

std::string resolveReclamosSubmenuChoice(const std::string &input) {
  const std::string n = toLower(trim(input));
  if (n == kReclamoNuevo || n == "1" || n == "nuevo") return kReclamoNuevo;
  if (n == kReclamoConsultar || n == "2" || n == "consultar") return kReclamoConsultar;
  if (n == kMenuVolver || n == "0" || n == "menu" || n == "menú") return kMenuVolver;
  return "";
}

std::string resolveDocumentosSubmenuChoice(const std::string &input) {
  const std::string n = toLower(trim(input));
  if (n == kDocPlantillasWord || n == "1" || n == "word" || n == "docx" || n == "informes") {
    return kDocPlantillasWord;
  }
  if (n == kDocPlantillasPptx || n == "2" || n == "powerpoint" || n == "pptx" || n == "presentaciones") {
    return kDocPlantillasPptx;
  }
  if (n == kDocSolicitarFicha || n == "3" || n == "ficha" || n == "solicitar" || n == "resumen") {
    return kDocSolicitarFicha;
  }
  if (n == kMenuVolver || n == "0" || n == "menu" || n == "menú" || n == "volver") {
    return kMenuVolver;
  }
  return "";
}

std::string resolveAdminMenuChoice(const std::string &input) {
  const std::string n = toLower(trim(input));
  if (n == kAdminContactSoporte || n == "1" || n == "soporte") return kAdminContactSoporte;
  if (n == kAdminContactComercial || n == "2" || n == "comercial") return kAdminContactComercial;
  if (n == kAdminContactRrhh || n == "3" || n == "rrhh") return kAdminContactRrhh;
  if (n == kMenuVolver || n == "0" || n == "menu" || n == "menú" || n == "volver") return kMenuVolver;
  return "";
}

std::string resolveRrhhSubmenuChoice(const std::string &input) {
  const std::string n = toLower(trim(input));
  if (n == kRrhhEnviarCv || n == "1" || n == "cv" || n == "curriculum" || n == "currículum" ||
      n == "postular" || n == "postulacion" || n == "postulación") {
    return kRrhhEnviarCv;
  }
  if (n == kRrhhOtraConsulta || n == "2" || n == "consulta" || n == "otra") {
    return kRrhhOtraConsulta;
  }
  if (n == kMenuVolver || n == "0" || n == "menu" || n == "menú" || n == "volver") {
    return kMenuVolver;
  }
  return "";
}

std::string menuRootBodyText() {
  return "¿En qué te ayudamos hoy? Elige una opción de la lista o responde con el número:\n"
         "1. 🛠️ Soporte técnico\n2. 💼 Área comercial\n3. 📋 Gestión de reclamos\n"
         "4. 📄 Generación de documentos\n5. 🤖 Consultas a la IA\n6. 🚨 Emergencia\n"
         "7. 🗓️ Agendar visita técnica\n8. 🧑‍💼 Recursos Humanos\n0. 👤 Hablar con un agente";
}

} // namespace support
