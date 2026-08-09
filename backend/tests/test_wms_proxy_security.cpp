#include <catch2/catch_test_macros.hpp>
#include "map/wms_proxy_security.hpp"

using namespace map_mod;

TEST_CASE("WMS proxy accepts only strict HTTPS endpoints and exact hosts") {
    WmsEndpoint endpoint;
    REQUIRE(parseHttpsWmsEndpoint("https://geocatmin.ingemmet.gob.pe/geoserver/wms", endpoint));
    CHECK(endpoint.host == "geocatmin.ingemmet.gob.pe");
    CHECK_FALSE(parseHttpsWmsEndpoint("http://geocatmin.ingemmet.gob.pe/wms", endpoint));
    CHECK_FALSE(parseHttpsWmsEndpoint("https://user@geocatmin.ingemmet.gob.pe/wms", endpoint));
    CHECK_FALSE(parseHttpsWmsEndpoint("https://geocatmin.ingemmet.gob.pe/wms#fragment", endpoint));
    CHECK_FALSE(parseHttpsWmsEndpoint("https://geocatmin.ingemmet.gob.pe/wms?redirect=http://127.0.0.1", endpoint));
    CHECK(isAllowedWmsHost("GEOCATMIN.INGEMMET.GOB.PE", "geocatmin.ingemmet.gob.pe,www.idep.gob.pe"));
    CHECK_FALSE(isAllowedWmsHost("evil.geocatmin.ingemmet.gob.pe", "geocatmin.ingemmet.gob.pe"));
}

TEST_CASE("WMS proxy blocks private and reserved destinations") {
    using boost::asio::ip::make_address;
    CHECK(isPrivateOrReserved(make_address("127.0.0.1")));
    CHECK(isPrivateOrReserved(make_address("10.20.30.40")));
    CHECK(isPrivateOrReserved(make_address("169.254.169.254")));
    CHECK(isPrivateOrReserved(make_address("fc00::1")));
    CHECK(isPrivateOrReserved(make_address("::ffff:127.0.0.1")));
    CHECK_FALSE(isPrivateOrReserved(make_address("8.8.8.8")));
}

TEST_CASE("WMS proxy validates GetMap shape and dimensions") {
    WmsEndpoint endpoint{"example.org", "443", "/wms"};
    std::unordered_map<std::string, std::string> query{
        {"source", "https://example.org/wms"}, {"service", "WMS"},
        {"request", "GetMap"}, {"layers", "mining"}, {"bbox", "-71,-18,-70,-17"},
        {"format", "image/png"}, {"width", "512"}, {"height", "512"}
    };
    std::string target, error;
    REQUIRE(buildWmsTarget(endpoint, query, target, error));
    CHECK(target.find("source=") == std::string::npos);

    query["width"] = "4096";
    CHECK_FALSE(buildWmsTarget(endpoint, query, target, error));
    query["width"] = "512";
    query["redirect"] = "http://127.0.0.1";
    CHECK_FALSE(buildWmsTarget(endpoint, query, target, error));
}
