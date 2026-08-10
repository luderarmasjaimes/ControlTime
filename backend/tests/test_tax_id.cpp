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

// ADR-102 — validacion de RUC Ecuador (sociedad privada/persona natural),
// RUT Chile (modulo 11, incluye digito verificador 'K') y cedula juridica
// Costa Rica (validacion estructural, sin checksum real). Ejemplos de
// sociedad/persona verificados a mano contra la formula oficial del SRI
// antes de escribir el codigo (ver ADR-102), no inventados.
TEST_CASE("validateTaxIdChecksum acepta RUC Ecuador de sociedad privada valido", "[tax_id][ruc_ec]") {
    REQUIRE(auth::validateTaxIdChecksum("1792146739001", "EC"));
}

TEST_CASE("validateTaxIdChecksum acepta RUC Ecuador de persona natural valido", "[tax_id][ruc_ec]") {
    REQUIRE(auth::validateTaxIdChecksum("1710034065001", "EC"));
}

TEST_CASE("validateTaxIdChecksum rechaza RUC Ecuador con digito verificador incorrecto", "[tax_id][ruc_ec]") {
    REQUIRE_FALSE(auth::validateTaxIdChecksum("1792146730001", "EC"));
    REQUIRE_FALSE(auth::validateTaxIdChecksum("1710034060001", "EC"));
}

TEST_CASE("validateTaxIdChecksum rechaza RUC Ecuador con provincia o establecimiento invalido", "[tax_id][ruc_ec]") {
    REQUIRE_FALSE(auth::validateTaxIdChecksum("2592146739001", "EC")); // provincia 25 no existe
    REQUIRE_FALSE(auth::validateTaxIdChecksum("1792146739000", "EC")); // establecimiento 000
    REQUIRE_FALSE(auth::validateTaxIdChecksum("179214673900", "EC"));  // 12 digitos
}

TEST_CASE("validateTaxIdChecksum acepta RUT Chile valido, incluida K", "[tax_id][rut_cl]") {
    REQUIRE(auth::validateTaxIdChecksum("760864285", "CL"));  // 76.086.428-5
    REQUIRE(auth::normalizeTaxId("18.765.432-k") == "18765432K");
}

TEST_CASE("validateTaxIdChecksum rechaza RUT Chile con digito verificador incorrecto", "[tax_id][rut_cl]") {
    REQUIRE_FALSE(auth::validateTaxIdChecksum("760864284", "CL"));
}

TEST_CASE("validateTaxIdChecksum valida cedula juridica Costa Rica solo por forma", "[tax_id][cr]") {
    REQUIRE(auth::validateTaxIdChecksum("3101123456", "CR"));
    REQUIRE_FALSE(auth::validateTaxIdChecksum("0101123456", "CR")); // cero inicial
    REQUIRE_FALSE(auth::validateTaxIdChecksum("310112345", "CR"));  // 9 digitos
    REQUIRE_FALSE(auth::validateTaxIdChecksum("1111111111", "CR")); // repetido
}

TEST_CASE("validateTaxIdChecksum aplica fallback estructural al resto del catalogo", "[tax_id][fallback]") {
    REQUIRE(auth::validateTaxIdChecksum("123456789012", "MX"));
    REQUIRE(auth::validateTaxIdChecksum("900123456", "CO"));
    REQUIRE_FALSE(auth::validateTaxIdChecksum("11111", "MX"));       // muy corto
    REQUIRE_FALSE(auth::validateTaxIdChecksum("111111111", "MX"));   // repetido
}
