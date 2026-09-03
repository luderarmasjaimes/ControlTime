// ADR-060 — primer test automatizado del backend: http_utils.cpp es lógica
// pura (parseo de strings y primitivas de autenticación) sin I/O de red/BD, ideal
// para arrancar cobertura sin necesitar Postgres/Redpanda/etc. levantados.

#include <catch2/catch_test_macros.hpp>

#include "http/http_utils.hpp"

#include <set>

TEST_CASE("extractCookie encuentra el valor exacto por nombre", "[http_utils][cookies]") {
    http::request<http::string_body> req;

    SECTION("una sola cookie") {
        req.set(http::field::cookie, "refresh_token=abc123");
        REQUIRE(http_utils::extractCookie(req, "refresh_token") == "abc123");
    }

    SECTION("varias cookies separadas por '; '") {
        req.set(http::field::cookie, "a=1; refresh_token=abc123; csrf_token_v2=xyz789");
        REQUIRE(http_utils::extractCookie(req, "refresh_token") == "abc123");
        REQUIRE(http_utils::extractCookie(req, "csrf_token_v2") == "xyz789");
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
        req.set(http::field::cookie, "csrf_token_v2_old=viejo; csrf_token_v2=nuevo");
        REQUIRE(http_utils::extractCookie(req, "csrf_token_v2") == "nuevo");
    }

    SECTION("valor vacio es valido (cookie recien vencida, Max-Age=0)") {
        req.set(http::field::cookie, "refresh_token=; csrf_token_v2=");
        REQUIRE(http_utils::extractCookie(req, "refresh_token").empty());
        REQUIRE(http_utils::extractCookie(req, "csrf_token_v2").empty());
    }
}

TEST_CASE("makeId usa 128 bits CSPRNG con formato fijo", "[http_utils][auth][csprng]") {
    std::set<std::string> ids;
    for (int i = 0; i < 256; ++i) {
        const auto id = http_utils::makeId();
        REQUIRE(id.size() == 32);
        REQUIRE(id.find_first_not_of("0123456789abcdef") == std::string::npos);
        ids.insert(id);
    }
    REQUIRE(ids.size() == 256);
}

TEST_CASE("secureRandomHex entrega secretos independientes", "[http_utils][auth][csprng]") {
    const auto first = http_utils::secureRandomHex(32);
    const auto second = http_utils::secureRandomHex(32);
    REQUIRE(first.size() == 64);
    REQUIRE(second.size() == 64);
    REQUIRE(first != second);
}

TEST_CASE("hashPassword usa Argon2id con salt aleatorio", "[http_utils][auth][argon2]") {
    const auto h1 = http_utils::hashPassword("MiClaveSegura!2026");
    const auto h2 = http_utils::hashPassword("MiClaveSegura!2026");
    REQUIRE(h1.rfind("$argon2id$", 0) == 0);
    REQUIRE(h2.rfind("$argon2id$", 0) == 0);
    REQUIRE(h1 != h2);
    REQUIRE(http_utils::verifyPassword("MiClaveSegura!2026", h1));
    REQUIRE(http_utils::verifyPassword("MiClaveSegura!2026", h2));
    REQUIRE_FALSE(http_utils::verifyPassword("incorrecta", h1));
    REQUIRE_FALSE(http_utils::passwordNeedsRehash(h1));
}

TEST_CASE("verifyPassword mantiene compatibilidad y marca hash legado", "[http_utils][auth][migration]") {
    const auto legacy = http_utils::legacyHashPassword("ClaveLegada!2025");
    REQUIRE(http_utils::verifyPassword("ClaveLegada!2025", legacy));
    REQUIRE_FALSE(http_utils::verifyPassword("incorrecta", legacy));
    REQUIRE(http_utils::passwordNeedsRehash(legacy));
    REQUIRE(http_utils::isRawLegacyHash(legacy));
    REQUIRE_FALSE(http_utils::isWrappedLegacyHash(legacy));
}

TEST_CASE("wrapLegacyHash migra a Argon2id sin la contrasena en claro",
          "[http_utils][auth][migration][argon2]") {
    // El servidor no tiene la contraseña: solo el hash legado guardado.
    const auto legacy = http_utils::legacyHashPassword("ClaveLegada!2025");
    const auto wrapped = http_utils::wrapLegacyHash(legacy);

    SECTION("el valor almacenado deja de ser el hash debil") {
        REQUIRE(http_utils::isWrappedLegacyHash(wrapped));
        REQUIRE_FALSE(http_utils::isRawLegacyHash(wrapped));
        // Lo importante: el hash de 64 bits ya no aparece en reposo.
        REQUIRE(wrapped.find(legacy) == std::string::npos);
        REQUIRE(wrapped.find("$argon2id$") != std::string::npos);
    }

    SECTION("el usuario sigue autenticandose con su contrasena de siempre") {
        REQUIRE(http_utils::verifyPassword("ClaveLegada!2025", wrapped));
        REQUIRE_FALSE(http_utils::verifyPassword("incorrecta", wrapped));
    }

    SECTION("sigue pendiente el rehash real, que ocurre en ese login") {
        REQUIRE(http_utils::passwordNeedsRehash(wrapped));
        const auto real = http_utils::hashPassword("ClaveLegada!2025");
        REQUIRE_FALSE(http_utils::passwordNeedsRehash(real));
        REQUIRE(http_utils::verifyPassword("ClaveLegada!2025", real));
    }

    SECTION("envolver dos veces el mismo hash da valores distintos (salt aleatorio)") {
        REQUIRE(http_utils::wrapLegacyHash(legacy) != wrapped);
    }
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

// ADR-081 — CORS multiorigen: BEEMETRY_CORS_ALLOWED_ORIGIN pasa a admitir una
// lista separada por comas (segunda app frontend, mismo backend), reflejada
// por request en router::Router::dispatch() vía resolveCorsOrigin().
TEST_CASE("parseCorsOriginsList separa por coma, recorta espacios e ignora vacios", "[http_utils][cors]") {
    REQUIRE(http_utils::parseCorsOriginsList("http://localhost:5173") ==
           std::vector<std::string>{"http://localhost:5173"});

    REQUIRE(http_utils::parseCorsOriginsList(
               "https://app1.example.com,https://app2.example.com") ==
           std::vector<std::string>{"https://app1.example.com",
                                    "https://app2.example.com"});

    REQUIRE(http_utils::parseCorsOriginsList(
               " https://app1.example.com , https://app2.example.com ") ==
           std::vector<std::string>{"https://app1.example.com",
                                    "https://app2.example.com"});

    REQUIRE(http_utils::parseCorsOriginsList("https://app1.example.com,,https://app2.example.com") ==
           std::vector<std::string>{"https://app1.example.com",
                                    "https://app2.example.com"});

    // Entrada vacia/solo-espacios cae al default seguro, nunca a una lista vacia
    // (una allowlist vacia no debe interpretarse como "cualquier origen").
    REQUIRE(http_utils::parseCorsOriginsList("") ==
           std::vector<std::string>{"http://localhost:5173"});
    REQUIRE(http_utils::parseCorsOriginsList("   ") ==
           std::vector<std::string>{"http://localhost:5173"});
}

TEST_CASE("resolveCorsOrigin refleja solo origenes de la allowlist configurada", "[http_utils][cors]") {
    // corsAllowedOrigins() cachea el resultado del env var en un static de
    // proceso; sin BEEMETRY_CORS_ALLOWED_ORIGIN definido, el default vigente
    // durante los tests es la lista de un solo elemento "http://localhost:5173".
    const auto &allowed = http_utils::corsAllowedOrigins();
    REQUIRE_FALSE(allowed.empty());
    const std::string knownOrigin = allowed.front();

    REQUIRE(http_utils::resolveCorsOrigin(knownOrigin) == knownOrigin);
    REQUIRE(http_utils::corsAllowedOrigin() == knownOrigin);

    SECTION("origen no listado no se refleja") {
        REQUIRE(http_utils::resolveCorsOrigin("http://evil.example").empty());
    }

    SECTION("sin header Origin (mismo origen) no se refleja") {
        REQUIRE(http_utils::resolveCorsOrigin("").empty());
    }
}

TEST_CASE("PDF de enlace directo se sirve inline y sin cabecera de contrasena",
          "[http_utils][pdf][adr138]") {
    const std::string bytes{"%PDF-1.7\0binario", 16};
    auto response = http_utils::makeInlinePdfResponse("informe.pdf", bytes);

    REQUIRE(response.result() == http::status::ok);
    REQUIRE(response[http::field::content_type] == "application/pdf");
    REQUIRE(response[http::field::content_disposition] ==
            "inline; filename=\"informe.pdf\"");
    REQUIRE(response.find("X-Pdf-Password") == response.end());
    REQUIRE(response.body() == bytes);
}
