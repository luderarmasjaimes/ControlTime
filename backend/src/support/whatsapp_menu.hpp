#pragma once

// --------------------------------------------------------------------------
// whatsapp_menu.hpp — Ids y resolución del menú del bot (lógica pura)
// --------------------------------------------------------------------------
// Separado de whatsapp_bot_engine.cpp (que sí depende de DB/red vía
// support_storage_pg/whatsapp_client) para poder cubrir con un test unitario
// real, sin I/O, la parte más sensible a errores silenciosos: que un id de
// fila interactiva, un dígito de texto plano y una palabra clave alternativa
// resuelvan SIEMPRE a la misma opción de menú (ver el mismo criterio de
// separación en whatsapp_signature.hpp). Mismo target `beemetry_backend_tests`
// (ADR-060) que deliberadamente no linkea libpq/red.
// --------------------------------------------------------------------------

#include <string>

namespace support {

// Ids de fila/botón (van y vuelven en interactive.list_reply.id / button_reply.id).
extern const char *const kMenuSoporte;
extern const char *const kMenuComercial;
extern const char *const kMenuReclamos;
extern const char *const kMenuDocumentos;
extern const char *const kMenuIa;
extern const char *const kMenuEmergencia;
extern const char *const kMenuAgenda;
extern const char *const kMenuRrhh;
extern const char *const kMenuVolver;
extern const char *const kMenuAgente;
extern const char *const kReclamoNuevo;
extern const char *const kReclamoConsultar;
extern const char *const kDocPlantillasWord;
extern const char *const kDocPlantillasPptx;
extern const char *const kDocSolicitarFicha;
// Opción de administración (ADR-114) -- deliberadamente sin dígito asignado
// ni mención en menuRootBodyText(): solo se llega por palabra clave, y solo
// se atiende si el número que escribe está en AppConfig::gWhatsappAdminPhones
// (chequeo impuro, vive en whatsapp_bot_engine.cpp -- este módulo es lógica
// pura sin acceso a config/DB, ver comentario de archivo).
extern const char *const kMenuAdmin;
extern const char *const kAdminContactSoporte;
extern const char *const kAdminContactComercial;
extern const char *const kAdminContactRrhh;
// Submenú de RRHH (ADR-122): antes "Recursos Humanos" caía directo al
// flujo COLLECTING genérico (nombre/empresa/consulta) -- ahora primero
// pregunta si el postulante quiere enviar su CV (flujo de subida de
// documento, ver whatsapp_bot_engine.cpp) u otra consulta (el COLLECTING
// de siempre).
extern const char *const kRrhhEnviarCv;
extern const char *const kRrhhOtraConsulta;

/**
 * @brief Resuelve la intención del usuario en el menú raíz a partir de un id de
 * fila/botón interactivo, un dígito suelto, o unas pocas palabras clave --
 * nunca deja al usuario sin salida solo porque su cliente de WhatsApp no
 * soporta listas interactivas.
 * @return uno de los `kMenu*` de arriba, o cadena vacía si no se reconoce.
 */
std::string resolveRootMenuChoice(const std::string &input);

/** @brief Igual que `resolveRootMenuChoice` pero para el sub-menú de reclamos
 * (nuevo/consultar/volver). */
std::string resolveReclamosSubmenuChoice(const std::string &input);

/** @brief Igual que `resolveRootMenuChoice` pero para el sub-menú de
 * Documentos (plantillas Word, PowerPoint, solicitud de informe o volver). */
std::string resolveDocumentosSubmenuChoice(const std::string &input);

/** @brief Igual que `resolveRootMenuChoice` pero para el sub-menú de
 * Administración (qué número de contacto editar, o volver). */
std::string resolveAdminMenuChoice(const std::string &input);

/** @brief Igual que `resolveRootMenuChoice` pero para el sub-menú de RRHH
 * (enviar CV / otra consulta / volver, ADR-122). */
std::string resolveRrhhSubmenuChoice(const std::string &input);

/** @brief Texto completo del menú principal (fallback de texto plano para
 * clientes sin soporte de listas interactivas). */
std::string menuRootBodyText();

} // namespace support
