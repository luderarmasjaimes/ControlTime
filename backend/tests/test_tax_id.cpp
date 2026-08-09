// ADR-085/087 — validateTaxIdChecksum es lógica pura (sin I/O), igual criterio
// que test_http_utils.cpp: cubre el algoritmo real de dígito verificador
// usado por GET /api/auth/validate-company y POST/PUT /api/auth/companies,
// incluyendo los 6 RUC sintéticos del seed de prueba (ADR-088) para que
// cualquier cambio futuro al algoritmo los rompa de forma visible en CI.

#include <catch2/catch_test_macros.hpp>

#include "auth/tax_id.hpp"

TEST_CASE("validateTaxIdChecksum acepta los RUC sinteticos del seed ADR-088", "[tax_id][ruc]") {
    // TimeTelemetry, Beemetry, Ferreyros, Komatsu-Mitsui, Volvo Peru, Motored
    // (db_scripts/51_seed_companies_distribuidores_demo.sql) -- checksum
    // valido, NO verificado contra el padron real (ver advertencia del seed).
    REQUIRE(auth::validateTaxIdChecksum("20500000016", "PE"));
    REQUIRE(auth::validateTaxIdChecksum("20500000024", "PE"));
    REQUIRE(auth::validateTaxIdChecksum("20500000032", "PE"));
    REQUIRE(auth::validateTaxIdChecksum("20500000041", "PE"));
    REQUIRE(auth::validateTaxIdChecksum("20500000059", "PE"));
    REQUIRE(auth::validateTaxIdChecksum("20500000067", "PE"));
}

TEST_CASE("validateTaxIdChecksum rechaza un RUC con digito verificador incorrecto", "[tax_id][ruc]") {
    // Mismos 10 primeros digitos que un RUC valido (20500000016) con el
    // digito verificador cambiado -- debe fallar el modulo 11.
    REQUIRE_FALSE(auth::validateTaxIdChecksum("20500000017", "PE"));
    REQUIRE_FALSE(auth::validateTaxIdChecksum("20344735047", "PE"));
}

TEST_CASE("validateTaxIdChecksum rechaza prefijos fuera de 10/15/17/20", "[tax_id][ruc]") {
    REQUIRE_FALSE(auth::validateTaxIdChecksum("30500000016", "PE"));
    REQUIRE_FALSE(auth::validateTaxIdChecksum("00500000016", "PE"));
}

TEST_CASE("validateTaxIdChecksum rechaza longitud incorrecta", "[tax_id][ruc]") {
    REQUIRE_FALSE(auth::validateTaxIdChecksum("2050000001", "PE"));   // 10 digitos
    REQUIRE_FALSE(auth::validateTaxIdChecksum("205000000167", "PE")); // 12 digitos
    REQUIRE_FALSE(auth::validateTaxIdChecksum("", "PE"));
}

TEST_CASE("normalizeTaxId conserva solo digitos", "[tax_id]") {
    REQUIRE(auth::normalizeTaxId("205-000-00016") == "20500000016");
    REQUIRE(auth::normalizeTaxId("  20500000016  ") == "20500000016");
    REQUIRE(auth::normalizeTaxId("abc") == "");
}
