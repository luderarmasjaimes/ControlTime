#pragma once

#include <boost/json.hpp>
#include <string>
#include <utility>
#include <vector>

namespace mapgeo {

struct MapMarkerRow {
  int id{};
  std::string type;
  double lat{};
  double lng{};
  std::string name;
  std::string status;
};

struct OfficialZoneMeta {
  std::string id;
  std::string name;
  std::string layer_type;
  std::string severity;
  std::vector<std::string> rule_codes;
};

using Ring = std::vector<std::pair<double, double>>;
using PolygonRings = std::vector<Ring>;

struct OfficialPolygon {
  OfficialZoneMeta meta;
  /** MultiPolygon: cada elemento es un polígono (anillos: exterior + agujeros). */
  std::vector<PolygonRings> multiparts;
};

std::string readFileUtf8(const std::string &path, std::string &err);

bool parseOfficialGeoJson(const std::string &text, std::vector<OfficialPolygon> &out, std::string &err);

bool pointInPolygonRings(double lng, double lat, const PolygonRings &rings);

bool pointInOfficialPolygon(double lng, double lat, const OfficialPolygon &poly);

boost::json::object buildIntersectionsResponse(const std::string &generated_at, const std::string &zones_path,
                                               bool zones_loaded, const std::vector<OfficialPolygon> &zones,
                                               const std::vector<MapMarkerRow> &markers);

} // namespace mapgeo
