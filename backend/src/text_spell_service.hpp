#pragma once

#include <boost/json.hpp>
#include <string>

namespace text_spell {

void configureFromEnv();

/** POST /api/text/correct/quick */
boost::json::object handleCorrectQuick(const boost::json::value &body);

/** POST /api/text/correct/advanced — devuelve sugerencias + matches crudos opcionales */
boost::json::object handleCorrectAdvanced(const boost::json::value &body);

/** POST /api/text/rewrite — LanguageTool seguro + rápido + Ollama opcional */
boost::json::object handleRewrite(const boost::json::value &body);

/** POST /api/text/languagetool-check — respuesta cruda de LT (on-premise) */
boost::json::object handleLanguageToolCheck(const boost::json::value &body);

/**
 * POST /api/text/format-apa7 — da formato APA 7 a datos bibliográficos que
 * el usuario YA aportó/verificó (autor, año, título, fuente, url, tipo).
 * El LLM local (Ollama) solo puntúa/ordena esos mismos campos según la
 * norma APA 7 -- tiene instrucción explícita de NO agregar ni inventar
 * ningún dato que no esté en la entrada. Nunca busca ni inventa fuentes.
 */
boost::json::object handleFormatApa7(const boost::json::value &body);

/**
 * POST /api/text/search-references — busca fuentes REALES en internet para
 * un tema/contexto dado, y devuelve solo las que caen en dominios de
 * confianza curados (gobierno, universidades, organismos internacionales,
 * editoriales académicas reconocidas). El proveedor preferido es Tavily
 * (BEEMETRY_TAVILY_API_KEY); si no está configurado, se usa Serper.dev
 * (BEEMETRY_SERPER_API_KEY) como respaldo. Ni el LLM ni el proveedor deciden
 * qué fuente es confiable -- solo el filtro de dominio local. Si ninguno de
 * los dos está configurado, devuelve {"error":"search_not_configured"}.
 */
boost::json::object handleSearchReferences(const boost::json::value &body);

/**
 * POST /api/text/verify-reference — verificación programática (sin LLM) de
 * que una URL de referencia realmente contiene el título y/o año declarados
 * por el usuario. Usa Tavily /extract para obtener el contenido crudo de la
 * página y hace un chequeo de substring local. Si BEEMETRY_TAVILY_API_KEY no
 * está configurada, devuelve {"error":"tavily_not_configured"} -- esto NO
 * debe bloquear el flujo de inserción de la cita, solo indica que no se pudo
 * verificar automáticamente.
 */
boost::json::object handleVerifyReference(const boost::json::value &body);

} // namespace text_spell
