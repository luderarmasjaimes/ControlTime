#include <catch2/catch_test_macros.hpp>
#include "map/geocode_proxy_security.hpp"

using namespace map_mod;

TEST_CASE("Geocode proxy sanitizes free-text queries") {
    std::string out, error;
    CHECK(sanitizeGeocodeQuery("  Toquepala, Tacna  ", out, error));
    CHECK(out == "Toquepala, Tacna");

    CHECK_FALSE(sanitizeGeocodeQuery("a", out, error));
    CHECK(error == "invalid_query_length");

    CHECK_FALSE(sanitizeGeocodeQuery(std::string(201, 'x'), out, error));
    CHECK(error == "invalid_query_length");

    CHECK_FALSE(sanitizeGeocodeQuery("evil\r\nHost: x", out, error));
    CHECK(error == "invalid_query_chars");
}

TEST_CASE("Geocode proxy clamps result limit") {
    CHECK(clampGeocodeLimit("") == kDefaultGeocodeResults);
    CHECK(clampGeocodeLimit("100") == kMaxGeocodeResults);
    CHECK(clampGeocodeLimit("-5") == kDefaultGeocodeResults);
    CHECK(clampGeocodeLimit("abc") == kDefaultGeocodeResults);
    CHECK(clampGeocodeLimit("2") == 2);
}
