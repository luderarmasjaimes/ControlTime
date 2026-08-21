#include "cv_storage_pg.hpp"
#include "storage/pg_pool.hpp"
#include "storage/pg_result.hpp"
#include "../biometric/face_analysis.hpp" // encodeBase64/decodeBase64 (mismo helper que tenant_assets_routes.cpp)

#include <algorithm>
#include <cstdlib>
#include <iostream>

using biometric::decodeBase64;
using biometric::encodeBase64;

namespace support {

#if HAS_LIBPQ

namespace {

/** @brief Arma una cláusula SQL dinámica sobre `paramStorage` -- mismo
 * helper que support_storage_pg.cpp::DynamicWhere (duplicado a propósito,
 * ver convención de "cada archivo mantiene su propio helper mínimo
 * autocontenido" ya establecida en este codebase). */
struct DynamicWhere {
  std::vector<std::string> paramStorage;
  std::vector<std::string> clauses;

  std::string addParam(const std::string &value) {
    paramStorage.push_back(value);
    return "$" + std::to_string(paramStorage.size());
  }

  std::string sql() const {
    if (clauses.empty()) return "";
    std::string out = " WHERE ";
    for (size_t i = 0; i < clauses.size(); ++i) {
      if (i > 0) out += " AND ";
      out += clauses[i];
    }
    return out;
  }

  std::vector<const char *> paramPointers() const {
    std::vector<const char *> out;
    out.reserve(paramStorage.size());
    for (auto &s : paramStorage) out.push_back(s.c_str());
    return out;
  }
};

json::value nullableStr(const char *v) {
  if (!v || !*v) return json::value(nullptr);
  return json::value(std::string(v));
}

json::value nullableInt(const char *v) {
  if (!v || !*v) return json::value(nullptr);
  return json::value(std::atoll(v));
}

json::value nullableDouble(const char *v) {
  if (!v || !*v) return json::value(nullptr);
  return json::value(std::atof(v));
}

json::value jsonbCol(const char *v) {
  if (!v || !*v) return json::value(nullptr);
  try {
    return json::parse(v);
  } catch (...) {
    return json::value(nullptr);
  }
}

} // namespace

bool insertCvSubmissionPg(const std::string &databaseUrl, const std::string &phoneE164,
                          const std::string &lineId, const std::string &tenantId,
                          const std::string &waMediaId, const std::string &originalFilename,
                          const std::string &mimeType, int fileSizeBytes,
                          const std::vector<unsigned char> &fileBytes, CvSubmissionRecord &out,
                          std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = "database_unavailable";
    return false;
  }

  const std::string fileB64 = encodeBase64(fileBytes);
  const std::string sizeStr = std::to_string(fileSizeBytes);
  const char *params[8] = {phoneE164.c_str(),  lineId.c_str(),        tenantId.c_str(),
                           waMediaId.c_str(),  originalFilename.c_str(), mimeType.c_str(),
                           sizeStr.c_str(),    fileB64.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO cv_submission (phone_e164, line_id, tenant_id, wa_media_id, "
      "original_filename, mime_type, file_size_bytes, file_bytes) "
      "VALUES ($1, $2, NULLIF($3,'')::uuid, NULLIF($4,''), NULLIF($5,''), $6, $7::int, "
      "decode($8,'base64')) "
      "RETURNING id::text, phone_e164, line_id, COALESCE(tenant_id::text,''), "
      "COALESCE(original_filename,''), mime_type, file_size_bytes, status, created_at::text",
      8, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    error = "cv_submission_insert_failed: " + res.error();
    return false;
  }
  out.id = PQgetvalue(res.get(), 0, 0);
  out.phoneE164 = PQgetvalue(res.get(), 0, 1);
  out.lineId = PQgetvalue(res.get(), 0, 2);
  out.tenantId = PQgetvalue(res.get(), 0, 3);
  out.originalFilename = PQgetvalue(res.get(), 0, 4);
  out.mimeType = PQgetvalue(res.get(), 0, 5);
  out.fileSizeBytes = std::atoi(PQgetvalue(res.get(), 0, 6));
  out.status = PQgetvalue(res.get(), 0, 7);
  out.createdAt = PQgetvalue(res.get(), 0, 8);
  return true;
}

bool insertWebCvSubmissionPg(const std::string &databaseUrl, const std::string &tenantId,
                             const std::string &userId, const std::string &originalFilename,
                             const std::string &mimeType, int fileSizeBytes,
                             const std::vector<unsigned char> &fileBytes, CvSubmissionRecord &out,
                             std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = "database_unavailable";
    return false;
  }

  const std::string fileB64 = encodeBase64(fileBytes);
  const std::string sizeStr = std::to_string(fileSizeBytes);
  const char *params[6] = {tenantId.c_str(), userId.c_str(),  originalFilename.c_str(),
                           mimeType.c_str(), sizeStr.c_str(), fileB64.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "INSERT INTO cv_submission (channel, tenant_id, user_id, original_filename, mime_type, "
      "file_size_bytes, file_bytes) "
      "VALUES ('web', NULLIF($1,'')::uuid, NULLIF($2,'')::uuid, NULLIF($3,''), $4, $5::int, "
      "decode($6,'base64')) "
      "RETURNING id::text, COALESCE(phone_e164,''), COALESCE(line_id,''), "
      "COALESCE(tenant_id::text,''), COALESCE(original_filename,''), mime_type, "
      "file_size_bytes, status, created_at::text",
      6, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) {
    error = "web_cv_submission_insert_failed: " + res.error();
    return false;
  }
  out.id = PQgetvalue(res.get(), 0, 0);
  out.phoneE164 = PQgetvalue(res.get(), 0, 1);
  out.lineId = PQgetvalue(res.get(), 0, 2);
  out.tenantId = PQgetvalue(res.get(), 0, 3);
  out.originalFilename = PQgetvalue(res.get(), 0, 4);
  out.mimeType = PQgetvalue(res.get(), 0, 5);
  out.fileSizeBytes = std::atoi(PQgetvalue(res.get(), 0, 6));
  out.status = PQgetvalue(res.get(), 0, 7);
  out.createdAt = PQgetvalue(res.get(), 0, 8);
  return true;
}

bool updateCvSubmissionTextPg(const std::string &databaseUrl, const std::string &submissionId,
                              const std::string &rawText, const std::string &status) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return false;

  const char *params[3] = {submissionId.c_str(), rawText.c_str(), status.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "UPDATE cv_submission SET raw_text = NULLIF($2,''), status = $3, updated_at = now() "
      "WHERE id = $1::uuid",
      3, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    std::cerr << "[CV] fallo al actualizar texto de cv_submission " << submissionId << ": "
              << res.error() << std::endl;
    return false;
  }
  return true;
}

void updateCvSubmissionStatusPg(const std::string &databaseUrl, const std::string &submissionId,
                                const std::string &status) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return;

  const char *params[2] = {submissionId.c_str(), status.c_str()};
  storage::PgResult res{PQexecParams(
      conn, "UPDATE cv_submission SET status = $2, updated_at = now() WHERE id = $1::uuid", 2,
      nullptr, params, nullptr, nullptr, 0)};
  if (!res.okCommand()) {
    std::cerr << "[CV] fallo al actualizar estado de cv_submission " << submissionId << ": "
              << res.error() << std::endl;
  }
}

bool insertCvCandidateProfilePg(const std::string &databaseUrl, const std::string &submissionId,
                                const CvCandidateProfile &profile, std::string &error) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) {
    error = "database_unavailable";
    return false;
  }

  const std::string edadStr = profile.edad ? std::to_string(*profile.edad) : "";
  const std::string aniosStr = profile.aniosExperiencia ? std::to_string(*profile.aniosExperiencia) : "";
  const std::string scoreStr = profile.score ? std::to_string(*profile.score) : "";
  const std::string experienciaJson = json::serialize(json::value(profile.experienciaLaboral));
  const std::string cursosJson = json::serialize(json::value(profile.cursosCapacitacion));
  const std::string extraJson = json::serialize(json::value(profile.extraFields));
  const std::string warningsJson = json::serialize(json::value(profile.extractionWarnings));

  const char *params[20] = {
      submissionId.c_str(),
      profile.nombres.c_str(),
      profile.apellidos.c_str(),
      profile.telefonoFijo.c_str(),
      profile.celular.c_str(),
      profile.whatsapp.c_str(),
      profile.centroEstudios.c_str(),
      edadStr.c_str(),
      profile.lugarResidencia.c_str(),
      profile.pretensionesEconomicas.c_str(),
      aniosStr.c_str(),
      profile.cargoPostulado.c_str(),
      experienciaJson.c_str(),
      cursosJson.c_str(),
      profile.inglesLectura.c_str(),
      profile.inglesEscritura.c_str(),
      profile.inglesConversacion.c_str(),
      profile.otraInformacion.c_str(),
      extraJson.c_str(),
      scoreStr.c_str(),
  };
  storage::PgResult res1{PQexecParams(
      conn,
      "INSERT INTO cv_candidate_profile (submission_id, nombres, apellidos, telefono_fijo, "
      "celular, whatsapp, centro_estudios, edad, lugar_residencia, pretensiones_economicas, "
      "anios_experiencia, cargo_postulado, experiencia_laboral, cursos_capacitacion, "
      "ingles_lectura, ingles_escritura, ingles_conversacion, otra_informacion, extra_fields, "
      "score) "
      "VALUES ($1::uuid, NULLIF($2,''), NULLIF($3,''), NULLIF($4,''), NULLIF($5,''), "
      "NULLIF($6,''), NULLIF($7,''), NULLIF($8,'')::int, NULLIF($9,''), NULLIF($10,''), "
      "NULLIF($11,'')::numeric, NULLIF($12,''), $13::jsonb, $14::jsonb, NULLIF($15,''), "
      "NULLIF($16,''), NULLIF($17,''), NULLIF($18,''), $19::jsonb, NULLIF($20,'')::int)",
      20, nullptr, params, nullptr, nullptr, 0)};
  if (!res1.okCommand()) {
    error = "cv_candidate_profile_insert_failed: " + res1.error();
    return false;
  }

  // score_rationale/llm_model/extraction_warnings van aparte (columnas de
  // texto largo/auditoría, no forman parte del formulario principal) -- un
  // segundo UPDATE simple evita una lista de 23 parámetros posicionales.
  const char *params2[4] = {submissionId.c_str(), profile.scoreRationale.c_str(),
                            profile.llmModel.c_str(), warningsJson.c_str()};
  storage::PgResult res2{PQexecParams(
      conn,
      "UPDATE cv_candidate_profile SET score_rationale = NULLIF($2,''), "
      "llm_model = NULLIF($3,''), extraction_warnings = $4::jsonb WHERE submission_id = $1::uuid",
      4, nullptr, params2, nullptr, nullptr, 0)};
  if (!res2.okCommand()) {
    error = "cv_candidate_profile_update_failed: " + res2.error();
    return false;
  }
  return true;
}

namespace {

// Columnas de resumen para el listado del panel (sin raw_text/file_bytes --
// pesados y no necesarios para la tabla, ver getCvCandidateDetailPg para el
// detalle completo).
constexpr const char *kCandidateSummaryColumns =
    "s.id::text, s.phone_e164, s.original_filename, s.mime_type, s.status, "
    "s.created_at::text, COALESCE(p.nombres,''), COALESCE(p.apellidos,''), "
    "COALESCE(p.cargo_postulado,''), p.score::text, COALESCE(p.lugar_residencia,'')";

json::object candidateSummaryFromRow(PGresult *res, int row) {
  json::object o;
  o["submission_id"] = std::string(PQgetvalue(res, row, 0));
  o["phone_e164"] = std::string(PQgetvalue(res, row, 1));
  o["original_filename"] = std::string(PQgetvalue(res, row, 2));
  o["mime_type"] = std::string(PQgetvalue(res, row, 3));
  o["status"] = std::string(PQgetvalue(res, row, 4));
  o["created_at"] = std::string(PQgetvalue(res, row, 5));
  o["nombres"] = std::string(PQgetvalue(res, row, 6));
  o["apellidos"] = std::string(PQgetvalue(res, row, 7));
  o["cargo_postulado"] = std::string(PQgetvalue(res, row, 8));
  o["score"] = nullableInt(PQgetvalue(res, row, 9));
  o["lugar_residencia"] = std::string(PQgetvalue(res, row, 10));
  return o;
}

} // namespace

CvCandidateSearchPageResult searchCvCandidatesPg(const std::string &databaseUrl,
                                                 const CvCandidateSearchFilter &filter) {
  CvCandidateSearchPageResult out;
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return out;

  DynamicWhere where;
  if (filter.q && !filter.q->empty()) {
    const std::string p = where.addParam("%" + *filter.q + "%");
    where.clauses.push_back("(p.nombres ILIKE " + p + " OR p.apellidos ILIKE " + p +
                            " OR p.cargo_postulado ILIKE " + p + " OR s.phone_e164 ILIKE " + p +
                            ")");
  }
  if (filter.scoreMin) where.clauses.push_back("p.score >= " + where.addParam(std::to_string(*filter.scoreMin)) + "::int");
  if (filter.scoreMax) where.clauses.push_back("p.score <= " + where.addParam(std::to_string(*filter.scoreMax)) + "::int");
  if (filter.status && !filter.status->empty())
    where.clauses.push_back("s.status = " + where.addParam(*filter.status));
  if (filter.dateFrom && !filter.dateFrom->empty())
    where.clauses.push_back("s.created_at >= " + where.addParam(*filter.dateFrom) + "::date");
  if (filter.dateTo && !filter.dateTo->empty())
    where.clauses.push_back("s.created_at < (" + where.addParam(*filter.dateTo) +
                            "::date + interval '1 day')");

  const std::string fromSql =
      " FROM cv_submission s LEFT JOIN cv_candidate_profile p ON p.submission_id = s.id";
  const std::string whereSql = where.sql();

  {
    const std::string sql = "SELECT count(*)" + fromSql + whereSql;
    const auto params = where.paramPointers();
    storage::PgResult res{PQexecParams(conn, sql.c_str(), static_cast<int>(params.size()),
                                       nullptr, params.empty() ? nullptr : params.data(),
                                       nullptr, nullptr, 0)};
    if (res.okTuples() && PQntuples(res.get()) == 1) out.total = std::atol(PQgetvalue(res.get(), 0, 0));
  }

  const std::string limitParam = where.addParam(std::to_string(std::max(1, std::min(filter.limit, 100))));
  const std::string offsetParam = where.addParam(std::to_string(std::max(0, filter.offset)));
  const std::string sql = std::string("SELECT ") + kCandidateSummaryColumns + fromSql + whereSql +
                          " ORDER BY s.created_at DESC LIMIT " + limitParam + " OFFSET " +
                          offsetParam;
  const auto params = where.paramPointers();
  storage::PgResult res{PQexecParams(conn, sql.c_str(), static_cast<int>(params.size()), nullptr,
                                     params.data(), nullptr, nullptr, 0)};
  if (res.okTuples()) {
    for (int i = 0; i < PQntuples(res.get()); ++i) {
      out.items.push_back(candidateSummaryFromRow(res.get(), i));
    }
  }
  return out;
}

bool getCvCandidateDetailPg(const std::string &databaseUrl, const std::string &submissionId,
                            json::object &out) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return false;

  const char *params[1] = {submissionId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT s.id::text, s.phone_e164, s.original_filename, s.mime_type, s.file_size_bytes, "
      "s.status, s.created_at::text, COALESCE(s.raw_text,''), "
      "COALESCE(p.nombres,''), COALESCE(p.apellidos,''), COALESCE(p.telefono_fijo,''), "
      "COALESCE(p.celular,''), COALESCE(p.whatsapp,''), COALESCE(p.centro_estudios,''), "
      "p.edad::text, COALESCE(p.lugar_residencia,''), COALESCE(p.pretensiones_economicas,''), "
      "p.anios_experiencia::text, COALESCE(p.cargo_postulado,''), "
      "p.experiencia_laboral::text, p.cursos_capacitacion::text, "
      "COALESCE(p.ingles_lectura,''), COALESCE(p.ingles_escritura,''), "
      "COALESCE(p.ingles_conversacion,''), COALESCE(p.otra_informacion,''), "
      "p.extra_fields::text, p.score::text, COALESCE(p.score_rationale,''), "
      "COALESCE(p.llm_model,''), p.extraction_warnings::text "
      "FROM cv_submission s LEFT JOIN cv_candidate_profile p ON p.submission_id = s.id "
      "WHERE s.id = $1::uuid",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) return false;

  PGresult *r = res.get();
  out = json::object{
      {"submission_id", std::string(PQgetvalue(r, 0, 0))},
      {"phone_e164", std::string(PQgetvalue(r, 0, 1))},
      {"original_filename", std::string(PQgetvalue(r, 0, 2))},
      {"mime_type", std::string(PQgetvalue(r, 0, 3))},
      {"file_size_bytes", std::atoll(PQgetvalue(r, 0, 4))},
      {"status", std::string(PQgetvalue(r, 0, 5))},
      {"created_at", std::string(PQgetvalue(r, 0, 6))},
      {"raw_text", std::string(PQgetvalue(r, 0, 7))},
      {"nombres", std::string(PQgetvalue(r, 0, 8))},
      {"apellidos", std::string(PQgetvalue(r, 0, 9))},
      {"telefono_fijo", std::string(PQgetvalue(r, 0, 10))},
      {"celular", std::string(PQgetvalue(r, 0, 11))},
      {"whatsapp", std::string(PQgetvalue(r, 0, 12))},
      {"centro_estudios", std::string(PQgetvalue(r, 0, 13))},
      {"edad", nullableInt(PQgetvalue(r, 0, 14))},
      {"lugar_residencia", std::string(PQgetvalue(r, 0, 15))},
      {"pretensiones_economicas", std::string(PQgetvalue(r, 0, 16))},
      {"anios_experiencia", nullableDouble(PQgetvalue(r, 0, 17))},
      {"cargo_postulado", std::string(PQgetvalue(r, 0, 18))},
      {"experiencia_laboral", jsonbCol(PQgetvalue(r, 0, 19))},
      {"cursos_capacitacion", jsonbCol(PQgetvalue(r, 0, 20))},
      {"ingles_lectura", std::string(PQgetvalue(r, 0, 21))},
      {"ingles_escritura", std::string(PQgetvalue(r, 0, 22))},
      {"ingles_conversacion", std::string(PQgetvalue(r, 0, 23))},
      {"otra_informacion", std::string(PQgetvalue(r, 0, 24))},
      {"extra_fields", jsonbCol(PQgetvalue(r, 0, 25))},
      {"score", nullableInt(PQgetvalue(r, 0, 26))},
      {"score_rationale", std::string(PQgetvalue(r, 0, 27))},
      {"llm_model", std::string(PQgetvalue(r, 0, 28))},
      {"extraction_warnings", jsonbCol(PQgetvalue(r, 0, 29))},
  };
  return true;
}

bool getCvSubmissionFilePg(const std::string &databaseUrl, const std::string &submissionId,
                          std::vector<unsigned char> &fileBytes, std::string &mimeType,
                          std::string &filename) {
  auto lease = storage::PgPool::instance().acquire(databaseUrl);
  PGconn *conn = lease.get();
  if (PQstatus(conn) != CONNECTION_OK) return false;

  const char *params[1] = {submissionId.c_str()};
  storage::PgResult res{PQexecParams(
      conn,
      "SELECT encode(file_bytes,'base64'), mime_type, COALESCE(original_filename,'cv') "
      "FROM cv_submission WHERE id = $1::uuid AND file_bytes IS NOT NULL",
      1, nullptr, params, nullptr, nullptr, 0)};
  if (!res.okTuples() || PQntuples(res.get()) == 0) return false;

  const std::string b64 = PQgetvalue(res.get(), 0, 0);
  if (!decodeBase64(b64, fileBytes)) return false;
  mimeType = PQgetvalue(res.get(), 0, 1);
  filename = PQgetvalue(res.get(), 0, 2);
  return true;
}

#endif // HAS_LIBPQ

} // namespace support
