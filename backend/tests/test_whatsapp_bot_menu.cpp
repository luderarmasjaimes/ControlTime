// ADR-112 — resolveRootMenuChoice/resolveReclamosSubmenuChoice son lógica
// pura (sin I/O), igual criterio que test_tax_id.cpp: cubre que un id de fila
// interactiva, un dígito de texto plano y una palabra clave alternativa
// resuelvan SIEMPRE a la misma opción -- este es el mecanismo que garantiza
// que el bot nunca deje a un usuario sin salida solo porque su cliente de
// WhatsApp no soporta listas interactivas (fallback de texto plano).

#include <catch2/catch_test_macros.hpp>

#include "support/whatsapp_menu.hpp"

using namespace support;

TEST_CASE("resolveRootMenuChoice acepta id de fila, digito y palabra clave", "[whatsapp][menu]") {
  REQUIRE(resolveRootMenuChoice("menu_soporte") == std::string(kMenuSoporte));
  REQUIRE(resolveRootMenuChoice("1") == std::string(kMenuSoporte));
  REQUIRE(resolveRootMenuChoice("soporte") == std::string(kMenuSoporte));

  REQUIRE(resolveRootMenuChoice("2") == std::string(kMenuComercial));
  REQUIRE(resolveRootMenuChoice("3") == std::string(kMenuReclamos));
  REQUIRE(resolveRootMenuChoice("4") == std::string(kMenuDocumentos));
  REQUIRE(resolveRootMenuChoice("5") == std::string(kMenuIa));
  REQUIRE(resolveRootMenuChoice("6") == std::string(kMenuEmergencia));
  REQUIRE(resolveRootMenuChoice("7") == std::string(kMenuAgenda));
  REQUIRE(resolveRootMenuChoice("8") == std::string(kMenuRrhh));
  REQUIRE(resolveRootMenuChoice("rrhh") == std::string(kMenuRrhh));
  REQUIRE(resolveRootMenuChoice("recursos humanos") == std::string(kMenuRrhh));
  REQUIRE(resolveRootMenuChoice("0") == std::string(kMenuVolver));
}

TEST_CASE("resolveRootMenuChoice es insensible a mayusculas y espacios", "[whatsapp][menu]") {
  REQUIRE(resolveRootMenuChoice("  SOPORTE  ") == std::string(kMenuSoporte));
  REQUIRE(resolveRootMenuChoice("Emergencia") == std::string(kMenuEmergencia));
  REQUIRE(resolveRootMenuChoice("URGENTE") == std::string(kMenuEmergencia));
}

TEST_CASE("resolveRootMenuChoice devuelve vacio ante entrada no reconocida", "[whatsapp][menu]") {
  REQUIRE(resolveRootMenuChoice("").empty());
  REQUIRE(resolveRootMenuChoice("banana").empty());
  REQUIRE(resolveRootMenuChoice("99").empty());
}

TEST_CASE("resolveReclamosSubmenuChoice acepta id, digito y palabra clave", "[whatsapp][menu]") {
  REQUIRE(resolveReclamosSubmenuChoice("1") == std::string(kReclamoNuevo));
  REQUIRE(resolveReclamosSubmenuChoice("nuevo") == std::string(kReclamoNuevo));
  REQUIRE(resolveReclamosSubmenuChoice("2") == std::string(kReclamoConsultar));
  REQUIRE(resolveReclamosSubmenuChoice("consultar") == std::string(kReclamoConsultar));
  REQUIRE(resolveReclamosSubmenuChoice("0") == std::string(kMenuVolver));
  REQUIRE(resolveReclamosSubmenuChoice("otra cosa").empty());
}

TEST_CASE("menuRootBodyText enumera las 9 opciones del menu", "[whatsapp][menu]") {
  const std::string body = menuRootBodyText();
  for (const char *digit : {"0.", "1.", "2.", "3.", "4.", "5.", "6.", "7.", "8."}) {
    REQUIRE(body.find(digit) != std::string::npos);
  }
}

TEST_CASE("resolveRootMenuChoice reconoce la palabra clave de administracion, sin digito",
         "[whatsapp][menu][admin]") {
  REQUIRE(resolveRootMenuChoice("menu_admin") == std::string(kMenuAdmin));
  REQUIRE(resolveRootMenuChoice("administracion") == std::string(kMenuAdmin));
  REQUIRE(resolveRootMenuChoice("ADMIN") == std::string(kMenuAdmin));
  // No tiene un digito asignado (ADR-114: opcion deliberadamente no
  // anunciada) -- confirma que ningun digito del menu numerado la resuelve
  // por accidente.
  for (const char *digit : {"0", "1", "2", "3", "4", "5", "6", "7", "8", "9"}) {
    REQUIRE(resolveRootMenuChoice(digit) != std::string(kMenuAdmin));
  }
}

TEST_CASE("menuRootBodyText no menciona la opcion de administracion", "[whatsapp][menu][admin]") {
  const std::string body = menuRootBodyText();
  REQUIRE(body.find("dministra") == std::string::npos);
}

TEST_CASE("resolveAdminMenuChoice acepta id, digito y palabra clave", "[whatsapp][menu][admin]") {
  REQUIRE(resolveAdminMenuChoice("1") == std::string(kAdminContactSoporte));
  REQUIRE(resolveAdminMenuChoice("soporte") == std::string(kAdminContactSoporte));
  REQUIRE(resolveAdminMenuChoice("2") == std::string(kAdminContactComercial));
  REQUIRE(resolveAdminMenuChoice("comercial") == std::string(kAdminContactComercial));
  REQUIRE(resolveAdminMenuChoice("3") == std::string(kAdminContactRrhh));
  REQUIRE(resolveAdminMenuChoice("rrhh") == std::string(kAdminContactRrhh));
  REQUIRE(resolveAdminMenuChoice("0") == std::string(kMenuVolver));
  REQUIRE(resolveAdminMenuChoice("volver") == std::string(kMenuVolver));
  REQUIRE(resolveAdminMenuChoice("otra cosa").empty());
}

TEST_CASE("resolveDocumentosSubmenuChoice acepta id, digito y palabras clave", "[whatsapp][menu][documentos]") {
  REQUIRE(resolveDocumentosSubmenuChoice("1") == std::string(kDocPlantillasWord));
  REQUIRE(resolveDocumentosSubmenuChoice("word") == std::string(kDocPlantillasWord));
  REQUIRE(resolveDocumentosSubmenuChoice("docx") == std::string(kDocPlantillasWord));
  REQUIRE(resolveDocumentosSubmenuChoice("informes") == std::string(kDocPlantillasWord));
  REQUIRE(resolveDocumentosSubmenuChoice("doc_plantillas_word") == std::string(kDocPlantillasWord));

  REQUIRE(resolveDocumentosSubmenuChoice("2") == std::string(kDocPlantillasPptx));
  REQUIRE(resolveDocumentosSubmenuChoice("powerpoint") == std::string(kDocPlantillasPptx));
  REQUIRE(resolveDocumentosSubmenuChoice("pptx") == std::string(kDocPlantillasPptx));
  REQUIRE(resolveDocumentosSubmenuChoice("presentaciones") == std::string(kDocPlantillasPptx));

  REQUIRE(resolveDocumentosSubmenuChoice("3") == std::string(kDocSolicitarFicha));
  REQUIRE(resolveDocumentosSubmenuChoice("solicitar") == std::string(kDocSolicitarFicha));
  REQUIRE(resolveDocumentosSubmenuChoice("ficha") == std::string(kDocSolicitarFicha));
  REQUIRE(resolveDocumentosSubmenuChoice("resumen") == std::string(kDocSolicitarFicha));

  REQUIRE(resolveDocumentosSubmenuChoice("0") == std::string(kMenuVolver));
  REQUIRE(resolveDocumentosSubmenuChoice("menu") == std::string(kMenuVolver));
  REQUIRE(resolveDocumentosSubmenuChoice("desconocido").empty());
}

TEST_CASE("resolveRrhhSubmenuChoice acepta id, digito y palabras clave (ADR-122)",
         "[whatsapp][menu][rrhh]") {
  REQUIRE(resolveRrhhSubmenuChoice("1") == std::string(kRrhhEnviarCv));
  REQUIRE(resolveRrhhSubmenuChoice("cv") == std::string(kRrhhEnviarCv));
  REQUIRE(resolveRrhhSubmenuChoice("curriculum") == std::string(kRrhhEnviarCv));
  REQUIRE(resolveRrhhSubmenuChoice("postular") == std::string(kRrhhEnviarCv));

  REQUIRE(resolveRrhhSubmenuChoice("2") == std::string(kRrhhOtraConsulta));
  REQUIRE(resolveRrhhSubmenuChoice("consulta") == std::string(kRrhhOtraConsulta));

  REQUIRE(resolveRrhhSubmenuChoice("0") == std::string(kMenuVolver));
  REQUIRE(resolveRrhhSubmenuChoice("volver") == std::string(kMenuVolver));
  REQUIRE(resolveRrhhSubmenuChoice("otra cosa").empty());
}
