#include "sensor_formula_evaluator.hpp"
#include "../config/app_config.hpp"

#ifndef HAS_LIBPQ
#  if __has_include(<libpq-fe.h>)
#    define HAS_LIBPQ 1
#  else
#    define HAS_LIBPQ 0
#  endif
#endif

#if HAS_LIBPQ
#include "storage/pg_result.hpp"
#include <libpq-fe.h>
#endif

#include "tinyexpr.h"

#include <atomic>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using config::AppConfig;

namespace mining_iot {

namespace {

std::atomic<bool> gFormulaEvaluatorRunning{false};
std::atomic<bool> gFormulaEvaluatorStopRequested{false};
std::thread gFormulaEvaluatorThread;

#if HAS_LIBPQ

// FIX N+1 (auditoría de latencia, ver evaluateFormulasOnce): construye el
// literal de arreglo Postgres `{a,b,c}` a partir de sensor_id ya conocidos
// (siempre `sensor_id::text` de una columna UUID de sensor_formula_def, ver
// FormulaRow) para poder resolver telemetría/parámetros de TODOS los
// sensores que hacen falta este ciclo en una sola consulta batcheada, en vez
// de una consulta por fórmula. Mismo patrón exacto que
// sensor_telemetry_wizard.cpp::toPgUuidArrayLiteral -- no se reusa esa
// función (misma razón de siempre en este archivo: no acoplar dos motores
// independientes a la misma unidad de compilación), pero es idéntica: el
// literal entra como texto de un único bind param `$N::uuid[]`, sin
// superficie de inyección; looksLikeUuid es un blindaje defensivo para que
// un valor absurdo no tumbe la query con un error de cast, no una defensa
// contra un input hostil real.
bool looksLikeUuid(const std::string &s) {
    if (s.size() != 36) return false;
    for (std::size_t i = 0; i < s.size(); ++i) {
        const char c = s[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (c != '-') return false;
        } else if (!std::isxdigit(static_cast<unsigned char>(c))) {
            return false;
        }
    }
    return true;
}

std::string toPgUuidArrayLiteral(const std::vector<std::string> &ids) {
    std::string out = "{";
    bool first = true;
    for (const auto &id : ids) {
        if (!looksLikeUuid(id)) continue;
        if (!first) out += ",";
        out += id;
        first = false;
    }
    out += "}";
    return out;
}

struct FormulaRow {
    std::string formulaId;
    std::string tenantId;
    std::string sensorId;
    std::string expression;
    std::string outputChannelCode;
    bool hasWarningLow{false}, hasWarningHigh{false}, hasErrorLow{false}, hasErrorHigh{false};
    double warningLow{0}, warningHigh{0}, errorLow{0}, errorHigh{0};
};

std::vector<FormulaRow> loadEnabledFormulas(PGconn *conn) {
    std::vector<FormulaRow> out;
    storage::PgResult res{PQexec(conn,
        "SELECT formula_id::text, tenant_id::text, sensor_id::text, expression, "
        "output_channel_code, warning_low, warning_high, error_low, error_high "
        "FROM sensor_formula_def WHERE enabled")};
    if (!res.okTuples()) return out;
    const int n = PQntuples(res.get());
    out.reserve(static_cast<std::size_t>(n));
    for (int i = 0; i < n; ++i) {
        FormulaRow row;
        row.formulaId = PQgetvalue(res.get(), i, 0);
        row.tenantId = PQgetvalue(res.get(), i, 1);
        row.sensorId = PQgetvalue(res.get(), i, 2);
        row.expression = PQgetvalue(res.get(), i, 3);
        row.outputChannelCode = PQgetvalue(res.get(), i, 4);
        if (!PQgetisnull(res.get(), i, 5)) { row.hasWarningLow = true; row.warningLow = std::atof(PQgetvalue(res.get(), i, 5)); }
        if (!PQgetisnull(res.get(), i, 6)) { row.hasWarningHigh = true; row.warningHigh = std::atof(PQgetvalue(res.get(), i, 6)); }
        if (!PQgetisnull(res.get(), i, 7)) { row.hasErrorLow = true; row.errorLow = std::atof(PQgetvalue(res.get(), i, 7)); }
        if (!PQgetisnull(res.get(), i, 8)) { row.hasErrorHigh = true; row.errorHigh = std::atof(PQgetvalue(res.get(), i, 8)); }
        out.push_back(std::move(row));
    }
    return out;
}

// ADR-189: canales de entrada crudos nombrados (Freq/Temp/Press...) para
// sensores multivariados -- ver sensor_input_channel_def
// (db_scripts/95_sensor_formula_template_catalog.sql). Un sensor SIN filas
// ahí sigue exactamente en el camino de una sola variable `value` de
// siempre -- cero regresión para las fórmulas existentes de un solo canal.
struct NamedChannel { std::string channelCode; double value; };

// Parámetros numéricos configurados del sensor: valor si existe fila en
// sensor_input_parameter_value, si no default_value de la definición. Solo
// data_type='numeric' -- un parámetro texto/boolean/json/timestamp jamás
// entra como variable ligada; si una fórmula lo nombra igual, tinyexpr falla
// con "variable no definida" al compilar (fallo seguro, no un valor basura).
struct NamedParam { std::string key; double value; };

// FIX N+1 (auditoría de latencia): las 3 funciones de abajo reemplazan a
// las versiones anteriores de "una consulta por fórmula, por sensor" --
// evaluateFormulasOnce() ahora resuelve telemetría/parámetros de TODOS los
// sensor_id distintos que hacen falta este ciclo en 3 consultas (una por
// tipo de dato), no en hasta 3*N. Con fórmulas que comparten sensor_id
// (varias plantillas/canales de salida sobre el mismo sensor físico --
// catálogo de 27 plantillas de ADR-189, sensores reales de SPEC-027) esto
// elimina consultas repetidas idénticas dentro del mismo ciclo de 10s
// (BEEMETRY_FORMULA_EVAL_INTERVAL_MS). La ventana de 15 min y el resto de
// la lógica (canal declarado pero sin telemetría reciente => se salta el
// ciclo) son EXACTAMENTE los mismos que antes -- ver evaluateFormulaRow.

// Última telemetría real por sensor (ventana de 15 min, canal crudo
// channel_id=0) -- mismo bugfix de ADR-186 (acotar captured_at para
// constraint exclusion en TimescaleDB) que evaluateRulesOnce() en
// device_alarm_routes.cpp, batcheado con DISTINCT ON en vez de una
// consulta por sensor. Solo se llama con los sensor_id que NO declaran
// sensor_input_channel_def (ver evaluateFormulasOnce) -- un sensor ausente
// del mapa devuelto significa "sin telemetría reciente", igual que antes.
std::unordered_map<std::string, double>
loadLatestTelemetryValuesForSensors(PGconn *conn, const std::vector<std::string> &sensorIds) {
    std::unordered_map<std::string, double> out;
    if (sensorIds.empty()) return out;
    const std::string arr = toPgUuidArrayLiteral(sensorIds);
    const char *p[1] = {arr.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT DISTINCT ON (ds.sensor_id) ds.sensor_id::text, tf.value_numeric "
        "FROM telemetry_fact tf "
        "JOIN dim_sensor ds ON ds.sensor_id_sk = tf.sensor_id_sk "
        "WHERE ds.sensor_id = ANY($1::uuid[]) AND tf.channel_id = 0 "
        "AND tf.captured_at > NOW() - INTERVAL '15 minutes' "
        "AND tf.value_numeric IS NOT NULL "
        "ORDER BY ds.sensor_id, tf.captured_at DESC",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (!res.okTuples()) return out;
    const int n = PQntuples(res.get());
    for (int i = 0; i < n; ++i) {
        out[PQgetvalue(res.get(), i, 0)] = std::atof(PQgetvalue(res.get(), i, 1));
    }
    return out;
}

// Canales nombrados de TODOS los sensor_id dados, en una sola consulta.
// Presencia de una clave en el mapa devuelto == ese sensor SÍ declara
// sensor_input_channel_def (camino multicanal); ausencia == camino de
// `value` de siempre. Un vector presente pero VACÍO == declaró canales pero
// falta telemetría reciente de alguno -- mismo criterio que antes (se salta
// el ciclo, nunca se liga una fórmula con variables a medio resolver).
std::unordered_map<std::string, std::vector<NamedChannel>>
loadNamedInputChannelsForSensors(PGconn *conn, const std::vector<std::string> &sensorIds) {
    std::unordered_map<std::string, std::vector<NamedChannel>> out;
    if (sensorIds.empty()) return out;
    const std::string arr = toPgUuidArrayLiteral(sensorIds);
    const char *p[1] = {arr.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT sic.sensor_id::text, sic.channel_code, "
        "  (SELECT tf.value_numeric FROM telemetry_fact tf "
        "   JOIN dim_sensor ds ON ds.sensor_id_sk = tf.sensor_id_sk "
        "   JOIN dim_channel dc ON dc.channel_id = tf.channel_id "
        "   WHERE ds.sensor_id = sic.sensor_id AND dc.channel_code = sic.channel_code "
        "     AND tf.captured_at > NOW() - INTERVAL '15 minutes' AND tf.value_numeric IS NOT NULL "
        "   ORDER BY tf.captured_at DESC LIMIT 1) AS value_numeric "
        "FROM sensor_input_channel_def sic "
        "WHERE sic.sensor_id = ANY($1::uuid[]) ORDER BY sic.sensor_id, sic.sort_order",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (!res.okTuples()) return out;
    // Un sensor puede tener varias filas (una por canal); en cuanto aparece
    // una con value_numeric NULL se marca "incompleto" y se ignoran el resto
    // de sus canales (aunque vengan después con valor) -- mismo resultado
    // final que la versión de antes ("out.clear(); return true" apenas
    // aparecía un NULL).
    std::unordered_set<std::string> incomplete;
    const int n = PQntuples(res.get());
    for (int i = 0; i < n; ++i) {
        const std::string sensorId = PQgetvalue(res.get(), i, 0);
        if (incomplete.count(sensorId)) continue;
        if (PQgetisnull(res.get(), i, 2)) {
            incomplete.insert(sensorId);
            out[sensorId].clear();
            continue;
        }
        out[sensorId].push_back({PQgetvalue(res.get(), i, 1), std::atof(PQgetvalue(res.get(), i, 2))});
    }
    return out;
}

// Parámetros numéricos de TODOS los sensor_id dados, en una sola consulta.
// Un sensor sin ningún parámetro numérico simplemente no aparece en el mapa
// -- el caller lo trata como "sin parámetros", igual que el vector vacío de
// antes.
std::unordered_map<std::string, std::vector<NamedParam>>
loadNumericParamsForSensors(PGconn *conn, const std::vector<std::string> &sensorIds) {
    std::unordered_map<std::string, std::vector<NamedParam>> out;
    if (sensorIds.empty()) return out;
    const std::string arr = toPgUuidArrayLiteral(sensorIds);
    const char *p[1] = {arr.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT d.sensor_id::text, d.param_key, COALESCE(v.value, d.default_value) AS val "
        "FROM sensor_input_parameter_def d "
        "LEFT JOIN sensor_input_parameter_value v "
        "  ON v.sensor_id = d.sensor_id AND v.param_key = d.param_key "
        "WHERE d.sensor_id = ANY($1::uuid[]) AND d.data_type = 'numeric'",
        1, nullptr, p, nullptr, nullptr, 0)};
    if (!res.okTuples()) return out;
    const int n = PQntuples(res.get());
    for (int i = 0; i < n; ++i) {
        if (PQgetisnull(res.get(), i, 2)) continue;  // sin valor y sin default -- no se liga
        const std::string sensorId = PQgetvalue(res.get(), i, 0);
        const std::string valText = PQgetvalue(res.get(), i, 2);
        try {
            out[sensorId].push_back({PQgetvalue(res.get(), i, 1), std::stod(valText)});
        } catch (...) {
            // default_value/value no era un número JSON pese a data_type='numeric'
            // (dato mal cargado) -- se omite esa variable, no se aborta el ciclo.
        }
    }
    return out;
}

// Soporte de ESTADO (ADR-198): algunas fórmulas necesitan el valor que
// ELLAS MISMAS calcularon en el ciclo anterior -- histéresis, suavizado
// exponencial (alpha*value + (1-alpha)*prev_value), o "arrastrar" el
// último valor calculado como un campo aparte (patrón real encontrado en
// el legado ThingsBoard: msg.tipo_alerta_anterior = metadata.tipo_alerta_actual
// del ciclo previo -- ver addendum ADR-197/198). tinyexpr evalúa cada
// fórmula desde cero en cada ciclo sin memoria propia; esto le da esa
// memoria de UN ciclo sin tocar el motor tinyexpr ni el esquema de
// sensor_formula_def -- se lee el último valor que ESTA MISMA fórmula ya
// escribió en telemetry_multivariate (mismo tenant_id+sensor_id+
// output_channel_code), de ANTES del ciclo actual.
//
// Ventana de 15 min: mismo bugfix de ADR-186 (acotar captured_at para que
// TimescaleDB pueda hacer constraint exclusion sobre los chunks de la
// hypertable en vez de tener que considerarlos todos al planificar) y
// mismo criterio de ventana ya usado para telemetry_multivariate en
// device_alarm_routes.cpp::evaluateRulesOnce() (rama ADR-189 de
// formula_output_channel_code) -- amplio margen frente al ciclo de
// evaluación de 10s por defecto (BEEMETRY_FORMULA_EVAL_INTERVAL_MS). Efecto
// secundario correcto: si el evaluador estuvo detenido más de 15 min, la
// primera evaluación al volver ya no arrastra un prev_value viejo -- se
// trata igual que "primera evaluación" (ver el caller).
bool loadPreviousOutputValue(PGconn *conn, const FormulaRow &f, double &out) {
    const char *p[3] = {f.tenantId.c_str(), f.sensorId.c_str(), f.outputChannelCode.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "SELECT value_numeric FROM telemetry_multivariate "
        "WHERE tenant_id = $1::uuid AND sensor_id = $2::uuid AND channel_code = $3 "
        "AND captured_at > NOW() - INTERVAL '15 minutes' "
        "ORDER BY captured_at DESC LIMIT 1",
        3, nullptr, p, nullptr, nullptr, 0)};
    if (!res.okTuples() || PQntuples(res.get()) == 0) return false;
    if (PQgetisnull(res.get(), 0, 0)) return false;
    out = std::atof(PQgetvalue(res.get(), 0, 0));
    return true;
}

std::string computeStatus(double result, const FormulaRow &f) {
    if (f.hasErrorLow && result < f.errorLow) return "error";
    if (f.hasErrorHigh && result > f.errorHigh) return "error";
    if (f.hasWarningLow && result < f.warningLow) return "warning";
    if (f.hasWarningHigh && result > f.warningHigh) return "warning";
    return "ok";
}

bool writeResult(PGconn *conn, const FormulaRow &f, double value, const std::string &status) {
    const std::string valueStr = std::to_string(value);
    const char *p[5] = {f.tenantId.c_str(), f.sensorId.c_str(),
                        f.outputChannelCode.c_str(), valueStr.c_str(), status.c_str()};
    storage::PgResult res{PQexecParams(
        conn,
        "INSERT INTO telemetry_multivariate "
        "(tenant_id, sensor_id, captured_at, channel_code, value_numeric, status) "
        "VALUES ($1::uuid, $2::uuid, NOW(), $3, $4::double precision, $5) "
        "ON CONFLICT (tenant_id, sensor_id, captured_at, channel_code) DO NOTHING",
        5, nullptr, p, nullptr, nullptr, 0)};
    return res.okCommand();
}

void evaluateFormulaRow(PGconn *conn, const FormulaRow &f,
                         const std::unordered_map<std::string, std::vector<NamedChannel>> &channelsBySensor,
                         const std::unordered_map<std::string, double> &telemetryBySensor,
                         const std::unordered_map<std::string, std::vector<NamedParam>> &paramsBySensor) {
    formulaEngineStats().evaluations.fetch_add(1, std::memory_order_relaxed);

    // ADR-189: si el sensor declara sensor_input_channel_def (Freq/Temp/
    // Press...), esas son las variables de telemetría a ligar, con su propio
    // nombre -- no la única `value` de siempre. Presencia de f.sensorId en
    // channelsBySensor equivale a lo que antes devolvía loadNamedInputChannels
    // (false cuando el sensor no declara ningún canal -- sensor de una sola
    // variable, camino sin cambios); ambos mapas ya vienen resueltos en bloque
    // por evaluateFormulasOnce() (fix N+1), no se consulta la BD acá.
    static const std::vector<NamedChannel> kEmptyChannels;
    const auto channelsIt = channelsBySensor.find(f.sensorId);
    const bool isMultiChannel = channelsIt != channelsBySensor.end();
    const std::vector<NamedChannel> &namedChannels = isMultiChannel ? channelsIt->second : kEmptyChannels;
    double telemetryValue = 0.0;
    if (isMultiChannel) {
        if (namedChannels.empty()) {
            // Declaró canales pero falta telemetría reciente de alguno.
            formulaEngineStats().skipped_no_value.fetch_add(1, std::memory_order_relaxed);
            return;
        }
    } else {
        const auto tIt = telemetryBySensor.find(f.sensorId);
        if (tIt == telemetryBySensor.end()) {
            formulaEngineStats().skipped_no_value.fetch_add(1, std::memory_order_relaxed);
            return;
        }
        telemetryValue = tIt->second;
    }
    static const std::vector<NamedParam> kEmptyParams;
    const auto paramsIt = paramsBySensor.find(f.sensorId);
    const std::vector<NamedParam> &params = paramsIt != paramsBySensor.end() ? paramsIt->second : kEmptyParams;

    // ADR-198: `prev_value` solo se resuelve (y solo es obligatorio tener
    // un valor previo real) si la fórmula la menciona -- así el 99% de las
    // fórmulas que no usan estado no pagan una consulta extra por ciclo.
    // Búsqueda de substring simple (no de identificador con límites de
    // palabra): un falso positivo solo agregaría una variable sin usar al
    // compilar, nunca produce un resultado incorrecto.
    const bool usesPrevValue = f.expression.find("prev_value") != std::string::npos;
    double prevValue = 0.0;
    if (usesPrevValue && !loadPreviousOutputValue(conn, f, prevValue)) {
        // Primera evaluación de esta fórmula -- todavía no hay "ciclo
        // anterior" real. Nunca se inventa un 0 con apariencia de dato
        // real: se salta este ciclo igual que "sin telemetría todavía",
        // hasta que exista al menos un valor previo genuino.
        formulaEngineStats().skipped_no_value.fetch_add(1, std::memory_order_relaxed);
        return;
    }

    // tinyexpr necesita punteros a double estables durante te_compile()+
    // te_eval() -- por eso `boundValues` vive hasta el final del scope, y
    // `te_variable.address` apunta dentro de ese vector (nunca a una copia
    // temporal). En el camino de un solo canal, `value` va primero y por
    // separado porque no viene de params (es telemetría, no un parámetro
    // configurado); en el camino multicanal, cada canal nombrado ocupa su
    // propio slot antes que los parámetros, mismo criterio. `prev_value`
    // va al final, siempre presente en el vector para que el puntero sea
    // estable, se use o no la fórmula (tinyexpr no exige que toda variable
    // declarada se use).
    const std::size_t telemetrySlots = isMultiChannel ? namedChannels.size() : 1;
    std::vector<double> boundValues;
    boundValues.reserve(telemetrySlots + params.size() + 1);
    if (isMultiChannel) {
        for (const auto &ch : namedChannels) boundValues.push_back(ch.value);
    } else {
        boundValues.push_back(telemetryValue);
    }
    for (const auto &p : params) boundValues.push_back(p.value);
    boundValues.push_back(prevValue);
    const std::size_t prevValueSlot = telemetrySlots + params.size();

    std::vector<te_variable> vars;
    vars.reserve(boundValues.size());
    if (isMultiChannel) {
        for (std::size_t i = 0; i < namedChannels.size(); ++i) {
            vars.push_back({namedChannels[i].channelCode.c_str(), &boundValues[i], TE_VARIABLE, nullptr});
        }
    } else {
        vars.push_back({"value", &boundValues[0], TE_VARIABLE, nullptr});
    }
    for (std::size_t i = 0; i < params.size(); ++i) {
        vars.push_back({params[i].key.c_str(), &boundValues[telemetrySlots + i], TE_VARIABLE, nullptr});
    }
    vars.push_back({"prev_value", &boundValues[prevValueSlot], TE_VARIABLE, nullptr});

    int err = 0;
    te_expr *compiled = te_compile(f.expression.c_str(), vars.data(),
                                    static_cast<int>(vars.size()), &err);
    if (!compiled) {
        formulaEngineStats().compile_errors.fetch_add(1, std::memory_order_relaxed);
        std::cerr << "[FORMULA-ENGINE] Fórmula " << f.formulaId
                  << " no compiló (posición " << err << "): " << f.expression << "\n";
        return;
    }
    const double result = te_eval(compiled);
    te_free(compiled);

    if (!std::isfinite(result)) {
        // división por cero, NaN de una función matemática, etc. -- no se
        // escribe un resultado sin sentido; cuenta como error de cómputo,
        // no de compilación (la expresión era válida, el dato no).
        formulaEngineStats().compile_errors.fetch_add(1, std::memory_order_relaxed);
        return;
    }
    const std::string status = computeStatus(result, f);
    if (writeResult(conn, f, result, status)) {
        formulaEngineStats().computed.fetch_add(1, std::memory_order_relaxed);
    } else {
        formulaEngineStats().write_errors.fetch_add(1, std::memory_order_relaxed);
    }
}

void evaluateFormulasOnce(PGconn *conn) {
    const std::vector<FormulaRow> formulas = loadEnabledFormulas(conn);
    if (formulas.empty()) return;

    // FIX N+1 (auditoría de latencia): antes, evaluateFormulaRow() disparaba
    // hasta 3 consultas de lectura (canales nombrados, telemetría de una
    // variable, parámetros numéricos) POR FÓRMULA, cada ~10s
    // (BEEMETRY_FORMULA_EVAL_INTERVAL_MS). Con fórmulas que comparten
    // sensor_id (varios canales de salida o plantillas del catálogo de
    // ADR-189 aplicadas al mismo sensor físico) eso repetía exactamente la
    // misma consulta. Acá se junta el conjunto de sensor_id DISTINTOS que
    // hacen falta este ciclo y se resuelven en 3 consultas batcheadas (una
    // por tipo de dato) en vez de hasta 3*N -- ver las 3 funciones *_ForSensors
    // arriba. loadPreviousOutputValue() y writeResult() se dejan SIN
    // batchear a propósito (ver nota más abajo).
    std::vector<std::string> distinctSensorIds;
    {
        std::unordered_set<std::string> seen;
        distinctSensorIds.reserve(formulas.size());
        for (const auto &f : formulas) {
            if (seen.insert(f.sensorId).second) distinctSensorIds.push_back(f.sensorId);
        }
    }
    const auto channelsBySensor = loadNamedInputChannelsForSensors(conn, distinctSensorIds);
    // Solo hace falta resolver `value` (camino de una sola variable) para los
    // sensores que NO declararon sensor_input_channel_def -- los que sí
    // declararon ya quedaron resueltos arriba, y evaluateFormulaRow() nunca
    // usa telemetryBySensor para ellos (los dos caminos son mutuamente
    // excluyentes).
    std::vector<std::string> singleChannelSensorIds;
    singleChannelSensorIds.reserve(distinctSensorIds.size());
    for (const auto &sid : distinctSensorIds) {
        if (!channelsBySensor.count(sid)) singleChannelSensorIds.push_back(sid);
    }
    const auto telemetryBySensor = loadLatestTelemetryValuesForSensors(conn, singleChannelSensorIds);
    const auto paramsBySensor = loadNumericParamsForSensors(conn, distinctSensorIds);

    // loadPreviousOutputValue() (estado ADR-198) y writeResult() se dejan
    // por-fórmula, sin batchear: (1) solo corren para el subconjunto de
    // fórmulas que de verdad usan `prev_value` en su expresión -- ya es la
    // excepción, no la regla, así que el ahorro de batchear sería marginal
    // frente al riesgo de tocar lógica de estado/escritura sensible a
    // correctitud; (2) writeResult hace un INSERT por fórmula con su propio
    // status de éxito/error (write_errors) -- batchear el INSERT complicaría
    // ese conteo por fila sin reducir proporcionalmente los round-trips que
    // importan (los de LECTURA, que sí escalan con el catálogo de fórmulas).
    for (const auto &f : formulas) {
        try {
            evaluateFormulaRow(conn, f, channelsBySensor, telemetryBySensor, paramsBySensor);
        } catch (const std::exception &e) {
            // Una fórmula rota (excepción de cualquier tipo -- stod, etc.)
            // jamás debe tumbar el ciclo completo ni el hilo.
            std::cerr << "[FORMULA-ENGINE] Excepción evaluando fórmula "
                      << f.formulaId << ": " << e.what() << "\n";
        } catch (...) {
            std::cerr << "[FORMULA-ENGINE] Excepción desconocida evaluando fórmula "
                      << f.formulaId << "\n";
        }
    }
}

void formulaEvaluatorLoop() {
    auto &cfg = AppConfig::instance();
    int intervalMs = 10000;
    if (const char *e = std::getenv("BEEMETRY_FORMULA_EVAL_INTERVAL_MS")) {
        try { intervalMs = std::max(2000, std::stoi(e)); } catch (...) {}
    }
    PGconn *conn = PQconnectdb(cfg.gDatabaseUrl.c_str());
    if (PQstatus(conn) != CONNECTION_OK) {
        std::cerr << "[FORMULA-ENGINE] No se pudo conectar a Postgres, evaluador no arranca\n";
        PQfinish(conn);
        gFormulaEvaluatorRunning.store(false);
        return;
    }
    std::cout << "[FORMULA-ENGINE] Evaluador iniciado, intervalo=" << intervalMs << "ms\n";
    while (!gFormulaEvaluatorStopRequested.load()) {
        if (PQstatus(conn) != CONNECTION_OK) {
            PQfinish(conn);
            conn = PQconnectdb(cfg.gDatabaseUrl.c_str());
        }
        if (PQstatus(conn) == CONNECTION_OK) {
            try { evaluateFormulasOnce(conn); }
            catch (const std::exception &e) {
                std::cerr << "[FORMULA-ENGINE] Error en ciclo de evaluación: " << e.what() << "\n";
            }
        }
        for (int waited = 0; waited < intervalMs && !gFormulaEvaluatorStopRequested.load(); waited += 200) {
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
        }
    }
    PQfinish(conn);
    gFormulaEvaluatorRunning.store(false);
    std::cout << "[FORMULA-ENGINE] Evaluador detenido\n";
}

#endif // HAS_LIBPQ

} // namespace

FormulaEngineStats &formulaEngineStats() {
    static FormulaEngineStats stats;
    return stats;
}

void startFormulaEvaluator() {
#if HAS_LIBPQ
    bool expected = false;
    if (!gFormulaEvaluatorRunning.compare_exchange_strong(expected, true)) return;
    gFormulaEvaluatorStopRequested.store(false);
    gFormulaEvaluatorThread = std::thread(formulaEvaluatorLoop);
    gFormulaEvaluatorThread.detach();
#endif
}

void stopFormulaEvaluator() {
#if HAS_LIBPQ
    gFormulaEvaluatorStopRequested.store(true);
#endif
}

} // namespace mining_iot
