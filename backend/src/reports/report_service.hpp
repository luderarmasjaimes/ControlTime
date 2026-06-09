#pragma once

#include "../auth/auth_types.hpp"

#include <boost/json.hpp>
#include <string>
#include <vector>

namespace json = boost::json;

namespace reports {

using auth::Project;
using auth::Report;

std::vector<Project> listProjectsPg(const std::string &databaseUrl, std::string &error);

std::vector<Report> listReportsPg(const std::string &databaseUrl, const std::string &company, std::string &error);

bool getReportByIdPg(const std::string &databaseUrl, const std::string &id, const std::string &company, Report &out,
                     std::string &error);

bool createReportPg(const std::string &databaseUrl, const Report &r,
                    std::string &outNewId, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken);

bool updateReportPg(const std::string &databaseUrl, const std::string &id,
                    const std::string &company, const Report &r, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken);

bool deleteReportPg(const std::string &databaseUrl, const std::string &id,
                    const std::string &company, std::string &error,
                    const std::string &auditUsername, const std::string &auditCompany,
                    const std::string &auditToken);

} // namespace reports
