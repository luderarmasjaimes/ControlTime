#include "sensor_formula_diagram.hpp"

#if HAS_LIBPQ

#include "storage/pg_result.hpp"

#include <boost/json.hpp>
#include <cctype>
#include <sstream>
#include <vector>

namespace json = boost::json;

namespace mining_iot {

namespace {

struct DiagramBlock {
  std::string id;
  double x = 0, y = 0, w = 140, h = 60;
  std::string label;
  std::string color;
  json::object meta;
};

struct DiagramConnection {
  std::string from;
  std::string to;
  json::object meta;
};

// Formatea sin ceros de más (5 en vez de 5.000000) -- solo cosmético, para
// que las etiquetas de los bloques de decisión sean legibles.
std::string formatNum(double v) {
  std::ostringstream oss;
  oss.precision(6);
  oss << v;
  return oss.str();
}

bool referencesVariable(const std::string &expr, const std::string &name) {
  if (name.empty()) return false;
  std::size_t pos = 0;
  while ((pos = expr.find(name, pos)) != std::string::npos) {
    const bool leftOk = (pos == 0) ||
        !(std::isalnum(static_cast<unsigned char>(expr[pos - 1])) || expr[pos - 1] == '_');
    const std::size_t end = pos + name.size();
    const bool rightOk = (end >= expr.size()) ||
        !(std::isalnum(static_cast<unsigned char>(expr[end])) || expr[end] == '_');
    if (leftOk && rightOk) return true;
    pos = end;
  }
  return false;
}

// Mismas dos consultas que validateExpression() en sensor_formula_routes.cpp
// (canales de telemetría nombrados ADR-189 + parámetros numéricos) -- son las
// únicas variables que la expresión puede referenciar en la práctica.
std::vector<std::string> referencedVariables(PGconn *conn, const std::string &sensorId,
                                             const std::string &expression) {
  std::vector<std::string> candidates;
  const char *p[1] = {sensorId.c_str()};
  storage::PgResult chRes{PQexecParams(
      conn, "SELECT channel_code FROM sensor_input_channel_def WHERE sensor_id = $1::uuid ORDER BY sort_order",
      1, nullptr, p, nullptr, nullptr, 0)};
  if (chRes.okTuples()) {
    for (int i = 0; i < PQntuples(chRes.get()); ++i) candidates.push_back(PQgetvalue(chRes.get(), i, 0));
  }
  if (candidates.empty()) candidates.push_back("value");
  storage::PgResult pRes{PQexecParams(
      conn, "SELECT param_key FROM sensor_input_parameter_def WHERE sensor_id = $1::uuid AND data_type = 'numeric'",
      1, nullptr, p, nullptr, nullptr, 0)};
  if (pRes.okTuples()) {
    for (int i = 0; i < PQntuples(pRes.get()); ++i) candidates.push_back(PQgetvalue(pRes.get(), i, 0));
  }
  std::vector<std::string> used;
  for (const auto &name : candidates) {
    if (referencesVariable(expression, name)) used.push_back(name);
  }
  return used;
}

DiagramBlock makeBlock(std::string id, double x, double y, std::string label, std::string color) {
  DiagramBlock b;
  b.id = std::move(id);
  b.x = x; b.y = y;
  b.label = std::move(label);
  b.color = std::move(color);
  return b;
}

void setFormulaExpr(DiagramBlock &b, const std::string &expr) {
  b.meta["formula"] = json::object{{"expression", expr}};
}

} // namespace

void regenerateFormulaDiagram(PGconn *conn,
                              const std::string &formulaId,
                              const std::string &sensorId,
                              const std::string &formulaName,
                              const std::string &expression,
                              const std::string &outputChannelCode,
                              const std::string &outputUnit,
                              bool hasWarningLow, double warningLow,
                              bool hasWarningHigh, double warningHigh,
                              bool hasErrorLow, double errorLow,
                              bool hasErrorHigh, double errorHigh) {
  const std::string diagramId = "formula_" + formulaId;
  const std::string idPrefix = "f" + formulaId + "_";

  std::vector<DiagramBlock> blocks;
  std::vector<DiagramConnection> connections;

  // ── INICIO ────────────────────────────────────────────────────────────
  const std::string inicioId = idPrefix + "inicio";
  {
    DiagramBlock b = makeBlock(inicioId, 40, 30, "INICIO", "#4CAF50");
    b.meta["blockType"] = "INICIO";
    b.w = 110; b.h = 46;
    blocks.push_back(std::move(b));
  }

  // ── Entradas (una por variable referenciada en la expresión) ────────────
  // En fila, envolviendo cada kInputsPerRow bloques -- una fórmula con
  // canales+parámetros nombrados (ADR-189) puede tener 8-10 variables, que
  // en una sola fila quedan fuera del ancho visible del canvas por defecto
  // (~800px) sin que el usuario sepa que tiene que hacer scroll. Confirmado
  // en vivo contra linear_geokon_ALT (9 variables).
  const auto vars = referencedVariables(conn, sensorId, expression);
  std::vector<std::string> inputIds;
  constexpr int kInputsPerRow = 4;
  constexpr double kInputRowHeight = 100;
  const double inputY0 = 130;
  for (std::size_t i = 0; i < vars.size(); ++i) {
    const auto &varName = vars[i];
    const double ix = 40 + static_cast<double>(i % kInputsPerRow) * 160;
    const double iy = inputY0 + static_cast<double>(i / kInputsPerRow) * kInputRowHeight;
    const std::string bid = idPrefix + "in_" + varName;
    DiagramBlock b = makeBlock(bid, ix, iy, varName, "#99ccff");
    setFormulaExpr(b, varName);
    blocks.push_back(std::move(b));
    connections.push_back({inicioId, bid, json::object{{"direction", "backward"}}});
    inputIds.push_back(bid);
  }
  const int inputRows = vars.empty() ? 0 : static_cast<int>((vars.size() - 1) / kInputsPerRow) + 1;

  // ── Cálculo (expresión completa, tal cual la evalúa el motor real) ─────
  const std::string calcId = idPrefix + "calc";
  const double calcY = inputY0 + inputRows * kInputRowHeight;
  {
    DiagramBlock b = makeBlock(calcId, 40, calcY, formulaName.empty() ? "CÁLCULO" : formulaName, "#3b82f6");
    setFormulaExpr(b, expression);
    blocks.push_back(std::move(b));
  }
  if (inputIds.empty()) {
    connections.push_back({inicioId, calcId, json::object{{"direction", "backward"}}});
  } else {
    for (const auto &inId : inputIds) {
      connections.push_back({inId, calcId, json::object{{"direction", "backward"}}});
    }
  }

  // ── Decisiones de umbral + terminales ───────────────────────────────────
  // Replica exactamente lo que computeStatus() decide en
  // sensor_formula_evaluator.cpp: primero fuera de rango de error, luego de
  // warning, si ninguna aplica el resultado es OK.
  const std::string okId = idPrefix + "ok";
  const std::string warnTermId = idPrefix + "warning";
  const std::string errTermId = idPrefix + "error";
  const std::string chLabel = outputChannelCode.empty() ? "resultado" : outputChannelCode;
  double y = calcY + 130;
  std::string lastSource = calcId;

  if (hasErrorLow || hasErrorHigh) {
    const std::string decId = idPrefix + "dec_error";
    std::string cond;
    if (hasErrorLow && hasErrorHigh) cond = chLabel + " < " + formatNum(errorLow) + " O " + chLabel + " > " + formatNum(errorHigh) + " ?";
    else if (hasErrorLow) cond = chLabel + " < " + formatNum(errorLow) + " ?";
    else cond = chLabel + " > " + formatNum(errorHigh) + " ?";
    DiagramBlock b = makeBlock(decId, 40, y, "¿Fuera de rango ERROR?", "#f4d03f");
    b.meta["blockType"] = "decision";
    b.w = 200; b.h = 90;
    setFormulaExpr(b, cond);
    blocks.push_back(std::move(b));
    connections.push_back({lastSource, decId, json::object{{"direction", "backward"}}});
    connections.push_back({decId, errTermId, json::object{{"direction", "backward"}, {"backwardLabel", "SI"}}});
    {
      DiagramBlock t = makeBlock(errTermId, 260, y, "ERROR", "#dc2626");
      t.w = 120; t.h = 56;
      setFormulaExpr(t, chLabel + " -> ERROR");
      blocks.push_back(std::move(t));
    }
    lastSource = decId;
    y += 130;
  }

  if (hasWarningLow || hasWarningHigh) {
    const std::string decId = idPrefix + "dec_warning";
    std::string cond;
    if (hasWarningLow && hasWarningHigh) cond = chLabel + " < " + formatNum(warningLow) + " O " + chLabel + " > " + formatNum(warningHigh) + " ?";
    else if (hasWarningLow) cond = chLabel + " < " + formatNum(warningLow) + " ?";
    else cond = chLabel + " > " + formatNum(warningHigh) + " ?";
    DiagramBlock b = makeBlock(decId, 40, y, "¿Fuera de rango WARNING?", "#f4d03f");
    b.meta["blockType"] = "decision";
    b.w = 200; b.h = 90;
    setFormulaExpr(b, cond);
    blocks.push_back(std::move(b));
    json::object inConnMeta{{"direction", "backward"}};
    if (lastSource != calcId) inConnMeta["backwardLabel"] = "NO";
    connections.push_back({lastSource, decId, inConnMeta});
    connections.push_back({decId, warnTermId, json::object{{"direction", "backward"}, {"backwardLabel", "SI"}}});
    {
      DiagramBlock t = makeBlock(warnTermId, 260, y, "WARNING", "#f59e0b");
      t.w = 120; t.h = 56;
      setFormulaExpr(t, chLabel + " -> WARNING");
      blocks.push_back(std::move(t));
    }
    lastSource = decId;
    y += 130;
  }

  {
    DiagramBlock t = makeBlock(okId, 40, y, "OK -> " + outputChannelCode + (outputUnit.empty() ? "" : " (" + outputUnit + ")"), "#16a34a");
    t.w = 200; t.h = 56;
    setFormulaExpr(t, chLabel + " -> OK");
    blocks.push_back(std::move(t));
  }
  json::object okConnMeta{{"direction", "backward"}};
  if (lastSource != calcId) okConnMeta["backwardLabel"] = "NO";
  connections.push_back({lastSource, okId, okConnMeta});

  // ── Persistencia: reemplaza TODO lo que hubiera bajo este diagram_id ────
  const char *dp[1] = {diagramId.c_str()};
  { storage::PgResult r{PQexecParams(conn, "DELETE FROM connections WHERE diagram_id = $1", 1, nullptr, dp, nullptr, nullptr, 0)}; }
  { storage::PgResult r{PQexecParams(conn, "DELETE FROM blocks WHERE diagram_id = $1", 1, nullptr, dp, nullptr, nullptr, 0)}; }

  for (const auto &b : blocks) {
    const std::string xs = formatNum(b.x), ys = formatNum(b.y), ws = formatNum(b.w), hs = formatNum(b.h);
    const std::string metaStr = json::serialize(b.meta);
    const char *bp[9] = {b.id.c_str(), xs.c_str(), ys.c_str(), ws.c_str(), hs.c_str(),
                         b.label.c_str(), b.color.c_str(), metaStr.c_str(), diagramId.c_str()};
    storage::PgResult r{PQexecParams(conn,
        "INSERT INTO blocks (id,x,y,w,h,label,color,meta,diagram_id) "
        "VALUES ($1,$2::double precision,$3::double precision,$4::double precision,"
        "$5::double precision,$6,$7,$8::jsonb,$9)",
        9, nullptr, bp, nullptr, nullptr, 0)};
  }
  for (const auto &c : connections) {
    const std::string metaStr = json::serialize(c.meta);
    const char *cp[4] = {c.from.c_str(), c.to.c_str(), metaStr.c_str(), diagramId.c_str()};
    storage::PgResult r{PQexecParams(conn,
        "INSERT INTO connections (from_id,to_id,meta,diagram_id) VALUES ($1,$2,$3::jsonb,$4)",
        4, nullptr, cp, nullptr, nullptr, 0)};
  }

  // Mismo canal que usa el sidecar (formula_engine) para refrescar en vivo
  // cualquier lienzo abierto -- un lienzo con este diagram_id abierto en otra
  // pestaña se entera del regenerado sin que el usuario tenga que recargar.
  json::object notifyPayload{{"type", "diagram_regenerated"}, {"diagram_id", diagramId}};
  const std::string notifyStr = json::serialize(notifyPayload);
  const char *np[1] = {notifyStr.c_str()};
  { storage::PgResult r{PQexecParams(conn, "SELECT pg_notify('formula_changes', $1)", 1, nullptr, np, nullptr, nullptr, 0)}; }
  { storage::PgResult r{PQexecParams(conn, "INSERT INTO events (channel, payload) VALUES ('formula_changes', $1::jsonb)",
              1, nullptr, np, nullptr, nullptr, 0)}; }
}

void deleteFormulaDiagram(PGconn *conn, const std::string &formulaId) {
  const std::string diagramId = "formula_" + formulaId;
  const char *dp[1] = {diagramId.c_str()};
  { storage::PgResult r{PQexecParams(conn, "DELETE FROM connections WHERE diagram_id = $1", 1, nullptr, dp, nullptr, nullptr, 0)}; }
  { storage::PgResult r{PQexecParams(conn, "DELETE FROM blocks WHERE diagram_id = $1", 1, nullptr, dp, nullptr, nullptr, 0)}; }
}

} // namespace mining_iot

#endif // HAS_LIBPQ
