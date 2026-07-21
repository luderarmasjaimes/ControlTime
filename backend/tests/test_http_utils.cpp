// ADR-060 — primer test automatizado del backend: http_utils.cpp es lógica
// pura (parseo de strings, hashing determinístico) sin I/O de red/BD, ideal
// para arrancar cobertura sin necesitar Postgres/Redpanda/etc. levantados.

#include <catch2/catch_test_macros.hpp>

#include "http/http_utils.hpp"

TEST_CASE("extractCookie encuentra el valor exacto por nombre", "[http_utils][cookies]") {
    http::request<http::string_body> req;

    SECTION("una sola cookie") {
        req.set(http::field::cookie, "refresh_token=abc123");
        REQUIRE(http_utils::extractCookie(req, "refresh_token") == "abc123");
    }

    SECTION("varias cookies separadas por '; '") {
        req.set(http::field::cookie, "a=1; refresh_token=abc123; csrf_token=xyz789");
        REQUIRE(http_utils::extractCookie(req, "refresh_token") == "abc123");
        REQUIRE(http_utils::extractCookie(req, "csrf_token") == "xyz789");
        REQUIRE(http_utils::extractCookie(req, "a") == "1");
    }

    SECTION("cookie inexistente devuelve cadena vacia") {
        req.set(http::field::cookie, "a=1; b=2");
        REQUIRE(http_utils::extractCookie(req, "refresh_token").empty());
    }

    SECTION("sin header Cookie devuelve cadena vacia") {
        REQUIRE(http_utils::extractCookie(req, "refresh_token").empty());
    }

    SECTION("no debe matchear un nombre que es sufijo/prefijo de otro") {
        // Caso real que motivó el chequeo: "csrf_token_old" no debe
        // interferir con la búsqueda exacta de "csrf_token".
        req.set(http::field::cookie, "csrf_token_old=viejo; csrf_token=nuevo");
        REQUIRE(http_utils::extractCookie(req, "csrf_token") == "nuevo");
    }

    SECTION("valor vacio es valido (cookie recien vencida, Max-Age=0)") {
        req.set(http::field::cookie, "refresh_token=; csrf_token=");
        REQUIRE(http_utils::extractCookie(req, "refresh_token").empty());
        REQUIRE(http_utils::extractCookie(req, "csrf_token").empty());
    }
}

TEST_CASE("hashPassword es deterministico para la misma entrada", "[http_utils][auth]") {
    const auto h1 = http_utils::hashPassword("MiClaveSegura!2026");
    const auto h2 = http_utils::hashPassword("MiClaveSegura!2026");
    REQUIRE(h1 == h2);
    REQUIRE_FALSE(h1.empty());
}

TEST_CASE("hashPassword produce salidas distintas para entradas distintas", "[http_utils][auth]") {
    const auto h1 = http_utils::hashPassword("clave-a");
    const auto h2 = http_utils::hashPassword("clave-b");
    REQUIRE(h1 != h2);
}

TEST_CASE("safeStod usa el fallback en valores no numericos o nulos", "[http_utils][parsing]") {
    REQUIRE(http_utils::safeStod(nullptr, -1.0) == -1.0);
    REQUIRE(http_utils::safeStod("", -1.0) == -1.0);
    REQUIRE(http_utils::safeStod("no-es-numero", -1.0) == -1.0);
    REQUIRE(http_utils::safeStod("3.14", -1.0) == 3.14);
}

TEST_CASE("safeStoi usa el fallback en valores no numericos o nulos", "[http_utils][parsing]") {
    REQUIRE(http_utils::safeStoi(nullptr, -1) == -1);
    REQUIRE(http_utils::safeStoi("", -1) == -1);
    REQUIRE(http_utils::safeStoi("abc", -1) == -1);
    REQUIRE(http_utils::safeStoi("42", -1) == 42);
}

TEST_CASE("csvEscape solo entrecomilla cuando hace falta", "[http_utils][csv]") {
    REQUIRE(http_utils::csvEscape("simple") == "simple");
    REQUIRE(http_utils::csvEscape("con,coma") == "\"con,coma\"");
    REQUIRE(http_utils::csvEscape("con\"comillas") == "\"con\"\"comillas\"");
    REQUIRE(http_utils::csvEscape("con\nsalto") == "\"con\nsalto\"");
}

TEST_CASE("urlDecode revierte codificacion percent-encoded y '+'", "[http_utils][parsing]") {
    REQUIRE(http_utils::urlDecode("hola%20mundo") == "hola mundo");
    REQUIRE(http_utils::urlDecode("a+b") == "a b");
    REQUIRE(http_utils::urlDecode("sin_cambios") == "sin_cambios");
}
