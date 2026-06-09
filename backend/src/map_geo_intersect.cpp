#include "map_geo_intersect.hpp"

#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string_view>

namespace mapgeo {
namespace {

namespace json = boost::json;

double jsonNumber(const json::value &v) {
  if (v.is_double())
    return v.as_double();
  if (v.is_int64())
    return static_cast<double>(v.as_int64());
  if (v.is_uint64())
    return static_cast<double>(v.as_uint64());
  throw std::runtime_error("GeoJSON: coordenada no numérica");
}

std::string propStr(const json::object &props, std::string_view key, const std::string &def = "") {
  auto it = props.find(key);
  if (it == props.end())
    return def;
  const auto &v = it->value();
  if (v.is_string())
    return std::string(v.as_string());
  if (v.is_int64())
    return std::to_string(static_cast<int>(v.as_int64()));
  return def;
}

std::vector<std::string> propStrArray(const json::object &props, std::string_view key) {
  std::vector<std::string> out;
  auto it = props.find(key);
  if (it == props.end() || !it->value().is_array())
    return out;
  for (const auto &el : it->value().as_array()) {
    if (el.is_string())
      out.emplace_back(std::string(el.as_string()));
  }
  return out;
}

Ring parseRing(const json::array &ringJson) {
  Ring ring;
  ring.reserve(ringJson.size());
  for (const auto &ptv : ringJson) {
    const auto &pt = ptv.as_array();
    double lng = jsonNumber(pt.at(0));
    double lat = jsonNumber(pt.at(1));
    ring.push_back({lng, lat});
  }
  return ring;
}

PolygonRings parsePolygonCoords(const json::array &coords) {
  PolygonRings rings;
  rings.reserve(coords.size());
  for (const auto &ringv : coords)
    rings.push_back(parseRing(ringv.as_array()));
  return rings;
}

bool pointInRing(double lng, double lat, const Ring &ring) {
  const size_t n = ring.size();
  if (n < 3)
    return false;
  bool inside = false;
  for (size_t i = 0, j = n - 1; i < n; j = i++) {
    const double xi = ring[i].first;
    const double yi = ring[i].second;
    const double xj = ring[j].first;
    const double yj = ring[j].second;
    const double dy = yj - yi;
    if (((yi > lat) != (yj > lat)) && (dy != 0.0)) {
      const double xinters = (xj - xi) * (lat - yi) / dy + xi;
      if (lng < xinters)
        inside = !inside;
    }
  }
  return inside;
}

void pushOfficialPolygon(std::vector<OfficialPolygon> &out, OfficialZoneMeta meta, PolygonRings rings) {
  if (rings.empty())
    return;
  OfficialPolygon poly;
  poly.meta = std::move(meta);
  poly.multiparts.push_back(std::move(rings));
  out.push_back(std::move(poly));
}

} // namespace

std::string readFileUtf8(const std::string &path, std::string &err) {
  std::ifstream f(path, std::ios::binary);
  if (!f) {
    err = "no se pudo abrir archivo: " + path;
    return {};
  }
  std::ostringstream buf;
  buf << f.rdbuf();
  return buf.str();
}

bool pointInPolygonRings(double lng, double lat, const PolygonRings &rings) {
  if (rings.empty())
    return false;
  if (!pointInRing(lng, lat, rings[0]))
    return false;
  for (size_t h = 1; h < rings.size(); ++h) {
    if (pointInRing(lng, lat, rings[h]))
      return false;
  }
  return true;
}

bool pointInOfficialPolygon(double lng, double lat, const OfficialPolygon &poly) {
  for (const auto &part : poly.multiparts) {
    if (pointInPolygonRings(lng, lat, part))
      return true;
  }
  return false;
}

bool parseOfficialGeoJson(const std::string &text, std::vector<OfficialPolygon> &out, std::string &err) {
  out.clear();
  if (text.empty()) {
    err = "GeoJSON vacío";
    return false;
  }
  json::value rootv;
  try {
    rootv = json::parse(text);
  } catch (const std::exception &ex) {
    err = std::string("JSON inválido: ") + ex.what();
    return false;
  }
  if (!rootv.is_object()) {
    err = "GeoJSON: raíz debe ser objeto";
    return false;
  }
  const auto &root = rootv.as_object();
  auto itf = root.find("features");
  if (itf == root.end() || !itf->value().is_array()) {
    err = "GeoJSON: falta array 'features'";
    return false;
  }
  const auto &features = itf->value().as_array();
  for (const auto &fv : features) {
    if (!fv.is_object())
      continue;
    const auto &feat = fv.as_object();
    auto itg = feat.find("geometry");
    if (itg == feat.end() || !itg->value().is_object())
      continue;
    const auto &geom = itg->value().as_object();
    auto itt = geom.find("type");
    auto itc = geom.find("coordinates");
    if (itt == geom.end() || itc == geom.end() || !itc->value().is_array())
      continue;
    const std::string gtype = std::string(itt->value().as_string());

    json::object props{};
    auto itp = feat.find("properties");
    if (itp != feat.end() && itp->value().is_object())
      props = itp->value().as_object();

    OfficialZoneMeta meta;
    meta.id = propStr(props, "id", "");
    if (meta.id.empty())
      meta.id = propStr(props, "zone_id", "zone-" + std::to_string(out.size()));
    meta.name = propStr(props, "name", meta.id);
    meta.layer_type = propStr(props, "layer_type", "oficial");
    meta.severity = propStr(props, "severity", "medium");
    meta.rule_codes = propStrArray(props, "rule_codes");

    try {
      if (gtype == "Polygon") {
        PolygonRings rings = parsePolygonCoords(itc->value().as_array());
        pushOfficialPolygon(out, std::move(meta), std::move(rings));
      } else if (gtype == "MultiPolygon") {
        OfficialPolygon poly;
        poly.meta = std::move(meta);
        for (const auto &polyv : itc->value().as_array())
          poly.multiparts.push_back(parsePolygonCoords(polyv.as_array()));
        if (!poly.multiparts.empty())
          out.push_back(std::move(poly));
      }
    } catch (const std::exception &ex) {
      err = std::string("GeoJSON feature inválida: ") + ex.what();
      return false;
    }
  }
  return true;
}

json::object buildIntersectionsResponse(const std::string &generated_at, const std::string &zones_path,
                                        bool zones_loaded, const std::vector<OfficialPolygon> &zones,
                                        const std::vector<MapMarkerRow> &markers) {
  json::array intersections;
  int markers_in_zone = 0;

  for (const auto &m : markers) {
    json::array polys;
    for (const auto &z : zones) {
      if (!pointInOfficialPolygon(m.lng, m.lat, z)) {
        continue;
      }
      json::array rules;
      for (const auto &c : z.meta.rule_codes)
        rules.push_back(json::value(c));
      polys.push_back(json::object{
          {"id", z.meta.id},
          {"name", z.meta.name},
          {"layer_type", z.meta.layer_type},
          {"severity", z.meta.severity},
          {"rule_codes", rules},
      });
    }
    if (!polys.empty()) {
      markers_in_zone++;
      intersections.push_back(json::object{{"marker_id", m.id},
                                            {"marker_name", m.name},
                                            {"marker_type", m.type},
                                            {"lat", m.lat},
                                            {"lng", m.lng},
                                            {"status", m.status},
                                            {"polygons", polys}});
    }
  }

  return json::object{{"generated_at", generated_at},
                      {"zones_path", zones_path},
                      {"zones_loaded", zones_loaded},
                      {"zone_count", zones.size()},
                      {"markers_total", markers.size()},
                      {"markers_in_official_zone", markers_in_zone},
                      {"intersections", intersections}};
}

} // namespace mapgeo
