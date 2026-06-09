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

} // namespace text_spell
