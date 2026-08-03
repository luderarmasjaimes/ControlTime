#include "report_portable.hpp"

#include "../config/app_config.hpp"
#include "../http/http_utils.hpp"

#include <openssl/evp.h>
#include <openssl/rand.h>
#include <openssl/sha.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <optional>
#include <stdexcept>
#include <vector>

namespace reports::portable {

namespace {

constexpr char kMagic[8] = {'B', 'E', 'E', 'M', 'R', 'P', 'T', '1'};
constexpr int kIvLen = 12;
constexpr int kTagLen = 16;
constexpr int kKeyLen = 32;

// ── Clave de exportación ─────────────────────────────────────────────────
/** @brief Clave AES-256 derivada (SHA-256) de BEEMETRY_REPORT_EXPORT_KEY. A
 * diferencia de JWT_SECRET, esta clave NO puede ser efímera: un .mreport
 * exportado hoy debe poder importarse en cualquier terminal que hable con el
 * mismo backend, incluso tras un reinicio/reescalado. Si la variable no está
 * definida, cae a un literal de desarrollo (mismo patrón que
 * BEEMETRY_AUTH_PASSWORD_SALT en app_config.cpp) — advertencia visible en
 * logs de arranque; fijarla en producción con un valor real y estable. */
constexpr char kDevExportKey[] = "mining_local_export_key_change_me";

/**
 * @brief ¿Se autoriza explícitamente el uso de secretos de desarrollo?
 *
 * Requiere BEEMETRY_ALLOW_DEV_SECRETS=true. Sin ese permiso explícito, caer al
 * literal de desarrollo se considera un fallo de despliegue, no un modo válido.
 */
bool devSecretsAllowed() {
  std::string v = config::getenvOr("BEEMETRY_ALLOW_DEV_SECRETS", "");
  std::transform(v.begin(), v.end(), v.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return v == "true" || v == "1" || v == "yes";
}

/**
 * @brief ¿Está configurada una clave de exportación utilizable?
 *
 * Auditoría de seguridad 2026-08-02: antes, la ausencia de
 * BEEMETRY_REPORT_EXPORT_KEY derivaba la clave AES-256 de un literal que está
 * escrito en este mismo repositorio. Un `.mreport` es el informe minero
 * COMPLETO — imágenes de labores, KPIs de producción, ubicaciones de sensores —
 * y el diseño confía en que "no hay forma de abrirlo sin este backend". Con la
 * clave por defecto esa premisa es falsa: cualquiera con el archivo y acceso al
 * repo lo descifra en su portátil. El aviso por consola no basta, porque el
 * export sigue funcionando y nada distingue un archivo protegido de uno que no
 * lo está. Ahora, sin clave real, exportar/importar falla de forma explícita.
 */
bool exportKeyConfigured() {
  const std::string secret = config::getenvOr("BEEMETRY_REPORT_EXPORT_KEY", "");
  if (!secret.empty() && secret != kDevExportKey) return true;
  return devSecretsAllowed();
}

const std::array<unsigned char, kKeyLen> &exportKey() {
  static const std::array<unsigned char, kKeyLen> key = [] {
    const std::string secret =
        config::getenvOr("BEEMETRY_REPORT_EXPORT_KEY", kDevExportKey);
    if (secret == kDevExportKey) {
      std::cerr << "[REPORT_EXPORT] ADVERTENCIA: BEEMETRY_REPORT_EXPORT_KEY no "
                   "definida; usando clave de desarrollo PUBLICA (esta en el "
                   "repositorio). Los .mreport generados asi NO son "
                   "confidenciales. Fijela con un valor aleatorio largo y "
                   "estable."
                << std::endl;
    }
    std::array<unsigned char, kKeyLen> k{};
    unsigned char digest[SHA256_DIGEST_LENGTH];
    SHA256(reinterpret_cast<const unsigned char *>(secret.data()), secret.size(), digest);
    std::memcpy(k.data(), digest, kKeyLen);
    return k;
  }();
  return key;
}

// ── AES-256-GCM ──────────────────────────────────────────────────────────
std::string aesGcmEncrypt(const std::string &plaintext, const unsigned char *key,
                          unsigned char *ivOut, unsigned char *tagOut) {
  if (RAND_bytes(ivOut, kIvLen) != 1) {
    throw std::runtime_error("rand_bytes_failed");
  }
  EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
  if (!ctx) throw std::runtime_error("evp_ctx_new_failed");
  std::string ciphertext;
  ciphertext.resize(plaintext.size());
  int len = 0;
  int ciphertextLen = 0;
  EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr);
  EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, kIvLen, nullptr);
  EVP_EncryptInit_ex(ctx, nullptr, nullptr, key, ivOut);
  if (!plaintext.empty()) {
    EVP_EncryptUpdate(ctx, reinterpret_cast<unsigned char *>(ciphertext.data()), &len,
                      reinterpret_cast<const unsigned char *>(plaintext.data()),
                      static_cast<int>(plaintext.size()));
    ciphertextLen = len;
  }
  EVP_EncryptFinal_ex(ctx, reinterpret_cast<unsigned char *>(ciphertext.data()) + ciphertextLen,
                      &len);
  ciphertextLen += len;
  EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, kTagLen, tagOut);
  EVP_CIPHER_CTX_free(ctx);
  ciphertext.resize(ciphertextLen);
  return ciphertext;
}

/** @return nullopt si el tag de autenticación no valida (datos corruptos,
 * manipulados, o clave incorrecta — p.ej. archivo generado por otro backend
 * con otra BEEMETRY_REPORT_EXPORT_KEY). */
std::optional<std::string> aesGcmDecrypt(const std::string &ciphertext, const unsigned char *key,
                                         const unsigned char *iv, const unsigned char *tag) {
  EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
  if (!ctx) return std::nullopt;
  std::string plaintext;
  plaintext.resize(ciphertext.size());
  int len = 0;
  int plaintextLen = 0;
  EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr);
  EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, kIvLen, nullptr);
  EVP_DecryptInit_ex(ctx, nullptr, nullptr, key, iv);
  if (!ciphertext.empty()) {
    EVP_DecryptUpdate(ctx, reinterpret_cast<unsigned char *>(plaintext.data()), &len,
                      reinterpret_cast<const unsigned char *>(ciphertext.data()),
                      static_cast<int>(ciphertext.size()));
    plaintextLen = len;
  }
  EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, kTagLen, const_cast<unsigned char *>(tag));
  const int ret =
      EVP_DecryptFinal_ex(ctx, reinterpret_cast<unsigned char *>(plaintext.data()) + plaintextLen, &len);
  EVP_CIPHER_CTX_free(ctx);
  if (ret <= 0) return std::nullopt;
  plaintextLen += len;
  plaintext.resize(plaintextLen);
  return plaintext;
}

// ── Base64 estándar (con padding) — solo para el payload de data: URIs ───
std::string base64Encode(const std::string &raw) {
  static const char *chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string out;
  out.reserve(((raw.size() + 2) / 3) * 4);
  std::size_t i = 0;
  while (i + 3 <= raw.size()) {
    const unsigned int chunk = (static_cast<unsigned char>(raw[i]) << 16) |
                               (static_cast<unsigned char>(raw[i + 1]) << 8) |
                               static_cast<unsigned char>(raw[i + 2]);
    out.push_back(chars[(chunk >> 18) & 0x3F]);
    out.push_back(chars[(chunk >> 12) & 0x3F]);
    out.push_back(chars[(chunk >> 6) & 0x3F]);
    out.push_back(chars[chunk & 0x3F]);
    i += 3;
  }
  const std::size_t rem = raw.size() - i;
  if (rem == 1) {
    const unsigned int chunk = static_cast<unsigned char>(raw[i]) << 16;
    out.push_back(chars[(chunk >> 18) & 0x3F]);
    out.push_back(chars[(chunk >> 12) & 0x3F]);
    out.push_back('=');
    out.push_back('=');
  } else if (rem == 2) {
    const unsigned int chunk = (static_cast<unsigned char>(raw[i]) << 16) |
                               (static_cast<unsigned char>(raw[i + 1]) << 8);
    out.push_back(chars[(chunk >> 18) & 0x3F]);
    out.push_back(chars[(chunk >> 12) & 0x3F]);
    out.push_back(chars[(chunk >> 6) & 0x3F]);
    out.push_back('=');
  }
  return out;
}

std::optional<std::string> base64Decode(const std::string &encoded) {
  static const std::array<int, 256> table = [] {
    std::array<int, 256> t{};
    t.fill(-1);
    static const char *chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (int i = 0; i < 64; ++i) t[static_cast<unsigned char>(chars[i])] = i;
    return t;
  }();
  std::string out;
  out.reserve((encoded.size() * 3) / 4 + 3);
  int buffer = 0;
  int bits = 0;
  for (unsigned char c : encoded) {
    if (c == '=' || c == '\r' || c == '\n') continue;
    const int v = table[c];
    if (v < 0) return std::nullopt;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<char>((buffer >> bits) & 0xFF));
    }
  }
  return out;
}

// ── Framing binario de enteros de 32 bits (little-endian) ───────────────
void appendU32(std::string &out, std::uint32_t v) {
  char buf[4];
  buf[0] = static_cast<char>(v & 0xFF);
  buf[1] = static_cast<char>((v >> 8) & 0xFF);
  buf[2] = static_cast<char>((v >> 16) & 0xFF);
  buf[3] = static_cast<char>((v >> 24) & 0xFF);
  out.append(buf, 4);
}

std::uint32_t readU32(const std::string &buf, std::size_t &pos) {
  if (pos + 4 > buf.size()) throw std::runtime_error("truncated_u32");
  const std::uint32_t v = static_cast<unsigned char>(buf[pos]) |
                          (static_cast<unsigned char>(buf[pos + 1]) << 8) |
                          (static_cast<unsigned char>(buf[pos + 2]) << 16) |
                          (static_cast<unsigned char>(buf[pos + 3]) << 24);
  pos += 4;
  return v;
}

std::string readBlock(const std::string &buf, std::size_t &pos, std::uint32_t len) {
  if (pos + len > buf.size()) throw std::runtime_error("truncated_block");
  std::string out = buf.substr(pos, len);
  pos += len;
  return out;
}

// ── Bloques del documento (contrato con useEditorStore.ts: ReportDocument
// = { pages: [{ elements: [{ id, type, x, y, width, height, src?, props }] }] } ) ──
struct BinaryAsset {
  std::string mime;
  std::string raw;
};

/** Tipos cuyo texto es autoría directa del usuario y nunca se toca, sin
 * importar el tenant de destino: párrafos/listas, tablas (celdas escritas a
 * mano, sin binding a datos vivos) y la tabla de contenidos (autogenerada,
 * sin datos de otra unidad). */
bool isTextSafeType(const std::string &type) {
  return type == "text" || type == "table" || type == "toc";
}

/** Recorre `pages[].elements[]` invocando `fn(elementObject, type)` para cada
 * bloque. Evita repetir 4 veces el mismo recorrido anidado. */
template <typename Fn>
void forEachElement(json::value &doc, Fn &&fn) {
  if (!doc.is_object()) return;
  auto &obj = doc.as_object();
  if (!obj.if_contains("pages") || !obj.at("pages").is_array()) return;
  for (auto &pageVal : obj.at("pages").as_array()) {
    if (!pageVal.is_object()) continue;
    auto &page = pageVal.as_object();
    if (!page.if_contains("elements") || !page.at("elements").is_array()) continue;
    for (auto &elVal : page.at("elements").as_array()) {
      if (!elVal.is_object()) continue;
      auto &el = elVal.as_object();
      const std::string type = el.if_contains("type") && el.at("type").is_string()
                                    ? json::value_to<std::string>(el.at("type"))
                                    : std::string();
      fn(el, type);
    }
  }
}

/** Extrae imágenes `data:<mime>;base64,<datos>` de bloques image/map y las
 * mueve a un arreglo binario separado (referencia `@bin:N` en su lugar) —
 * evita el ~33% de inflado que deja el base64 embebido como texto en el JSON
 * cifrado; el ahorro real viene de decodificar antes de cifrar/comprimir. */
std::vector<BinaryAsset> extractBinaries(json::value &doc) {
  std::vector<BinaryAsset> assets;
  forEachElement(doc, [&assets](json::object &el, const std::string &type) {
    if (type != "image" && type != "map") return;
    if (!el.if_contains("src") || !el.at("src").is_string()) return;
    const std::string src = json::value_to<std::string>(el.at("src"));
    const auto marker = src.find(";base64,");
    if (src.rfind("data:", 0) != 0 || marker == std::string::npos) return;
    const std::string mime = src.substr(5, marker - 5);
    auto raw = base64Decode(src.substr(marker + 8));
    if (!raw) return;
    const std::size_t idx = assets.size();
    assets.push_back({mime, std::move(*raw)});
    el["src"] = "@bin:" + std::to_string(idx);
  });
  return assets;
}

void injectBinaries(json::value &doc, const std::vector<BinaryAsset> &assets) {
  forEachElement(doc, [&assets](json::object &el, const std::string & /*type*/) {
    if (!el.if_contains("src") || !el.at("src").is_string()) return;
    const std::string src = json::value_to<std::string>(el.at("src"));
    if (src.rfind("@bin:", 0) != 0) return;
    try {
      const std::size_t idx = std::stoul(src.substr(5));
      if (idx < assets.size()) {
        el["src"] = "data:" + assets[idx].mime + ";base64," + base64Encode(assets[idx].raw);
      }
    } catch (...) {
      // referencia @bin:N corrupta/fuera de rango: deja el ref tal cual, no crashea el import
    }
  });
}

/** @brief Redacta bloques con datos propios de la unidad minera de origen
 * cuando el importador pertenece a OTRA unidad. Texto/tabla/TOC nunca se
 * tocan. La portada conserva título/autor/fecha/clasificación (genéricos del
 * informe) pero blanquea company/unit/docCode (identifican la unidad de
 * origen). Cualquier otro tipo — image, map, chart, kpi, sensor, y
 * deliberadamente cualquier tipo futuro no listado aquí — se trata como dato
 * sensible por defecto: se conserva posición/tamaño/tipo (estructura) pero se
 * limpia `src` y `props` a un marcador neutro. */
json::value redactForForeignTenant(json::value doc) {
  forEachElement(doc, [](json::object &el, const std::string &type) {
    if (isTextSafeType(type)) return;

    if (type == "cover") {
      if (el.if_contains("props") && el.at("props").is_object()) {
        auto &props = el.at("props").as_object();
        props["company"] = "";
        props["unit"] = "";
        props["docCode"] = "";
      }
      return;
    }

    if (el.if_contains("src")) el["src"] = "";
    json::object placeholder;
    placeholder["title"] = "[No disponible - pertenece a otra unidad minera]";
    if (type == "kpi" || type == "sensor") {
      placeholder["value"] = "-";
    }
    el["props"] = std::move(placeholder);
  });
  return doc;
}

}  // namespace

ExportResult exportReport(const auth::Report &report, const std::string &exportedByUsername) {
  ExportResult result;
  if (!exportKeyConfigured()) {
    result.error = "export_key_not_configured";
    return result;
  }
  try {
    json::value docCopy = report.contentJson;
    const auto binaries = extractBinaries(docCopy);

    json::object envelope;
    envelope["magic"] = "BEEMETRY_MREPORT_V1";
    envelope["reportId"] = report.id;
    envelope["title"] = report.title;
    envelope["tenantId"] = report.tenantId;
    envelope["company"] = report.company;
    envelope["createdAt"] = report.createdAt;
    envelope["exportedAt"] = http_utils::nowIso8601();
    envelope["exportedBy"] = exportedByUsername;
    envelope["document"] = docCopy;
    const std::string metaJson = json::serialize(json::value(std::move(envelope)));

    // Plaintext interno (antes de cifrar): [u32 lenMeta][meta JSON]
    // [u32 binCount][por binario: u32 lenMime][mime][u32 lenData][datos crudos]
    std::string plain;
    appendU32(plain, static_cast<std::uint32_t>(metaJson.size()));
    plain += metaJson;
    appendU32(plain, static_cast<std::uint32_t>(binaries.size()));
    for (const auto &asset : binaries) {
      appendU32(plain, static_cast<std::uint32_t>(asset.mime.size()));
      plain += asset.mime;
      appendU32(plain, static_cast<std::uint32_t>(asset.raw.size()));
      plain += asset.raw;
    }

    unsigned char iv[kIvLen];
    unsigned char tag[kTagLen];
    const std::string ciphertext = aesGcmEncrypt(plain, exportKey().data(), iv, tag);

    std::string out;
    out.reserve(sizeof(kMagic) + kIvLen + kTagLen + ciphertext.size());
    out.append(kMagic, sizeof(kMagic));
    out.append(reinterpret_cast<char *>(iv), kIvLen);
    out.append(reinterpret_cast<char *>(tag), kTagLen);
    out += ciphertext;

    result.ok = true;
    result.bytes = std::move(out);
  } catch (const std::exception &ex) {
    result.error = ex.what();
  }
  return result;
}

ImportResult importReport(const std::string &fileBytes, const std::string &requesterTenantId,
                          const std::string &requesterCompany) {
  ImportResult result;
  if (!exportKeyConfigured()) {
    result.error = "export_key_not_configured";
    return result;
  }
  if (fileBytes.size() < sizeof(kMagic) + kIvLen + kTagLen ||
      std::memcmp(fileBytes.data(), kMagic, sizeof(kMagic)) != 0) {
    result.error = "invalid_mreport_format";
    return result;
  }

  std::size_t offset = sizeof(kMagic);
  unsigned char iv[kIvLen];
  std::memcpy(iv, fileBytes.data() + offset, kIvLen);
  offset += kIvLen;
  unsigned char tag[kTagLen];
  std::memcpy(tag, fileBytes.data() + offset, kTagLen);
  offset += kTagLen;
  const std::string ciphertext = fileBytes.substr(offset);

  const auto plainOpt = aesGcmDecrypt(ciphertext, exportKey().data(), iv, tag);
  if (!plainOpt) {
    result.error = "decrypt_failed_o_archivo_corrupto";
    return result;
  }

  try {
    const std::string &plain = *plainOpt;
    std::size_t pos = 0;
    const std::uint32_t metaLen = readU32(plain, pos);
    const std::string metaJson = readBlock(plain, pos, metaLen);

    const auto envelopeVal = json::parse(metaJson);
    if (!envelopeVal.is_object()) throw std::runtime_error("envelope_no_es_objeto");
    const auto &envelope = envelopeVal.as_object();
    if (!envelope.if_contains("magic") || !envelope.at("magic").is_string() ||
        json::value_to<std::string>(envelope.at("magic")) != "BEEMETRY_MREPORT_V1") {
      result.error = "invalid_mreport_envelope";
      return result;
    }

    const std::uint32_t binCount = readU32(plain, pos);
    std::vector<BinaryAsset> binaries;
    binaries.reserve(binCount);
    for (std::uint32_t i = 0; i < binCount; ++i) {
      const std::uint32_t mimeLen = readU32(plain, pos);
      std::string mime = readBlock(plain, pos, mimeLen);
      const std::uint32_t dataLen = readU32(plain, pos);
      std::string raw = readBlock(plain, pos, dataLen);
      binaries.push_back({std::move(mime), std::move(raw)});
    }

    json::value document =
        envelope.if_contains("document") ? envelope.at("document") : json::value(json::object{});
    injectBinaries(document, binaries);

    const std::string fileTenantId =
        envelope.if_contains("tenantId") && envelope.at("tenantId").is_string()
            ? json::value_to<std::string>(envelope.at("tenantId"))
            : std::string();
    const std::string fileCompany =
        envelope.if_contains("company") && envelope.at("company").is_string()
            ? json::value_to<std::string>(envelope.at("company"))
            : std::string();

    // Mismo criterio que auth::userBelongsToTenant (ADR-038/039/043): si
    // ambos lados tienen tenant_id real se compara por ahí; si alguno es
    // legacy (vacío) se cae a company_name. Dos vacíos de orígenes distintos
    // NUNCA se tratan como coincidencia — el default conservador es redactar.
    bool tenantMatch = false;
    if (!fileTenantId.empty() && !requesterTenantId.empty()) {
      tenantMatch = (fileTenantId == requesterTenantId);
    } else if (!fileCompany.empty() && !requesterCompany.empty()) {
      tenantMatch = (fileCompany == requesterCompany);
    }

    result.ok = true;
    result.title = envelope.if_contains("title") && envelope.at("title").is_string()
                       ? json::value_to<std::string>(envelope.at("title"))
                       : std::string();
    result.sourceCompany = fileCompany;
    result.tenantMatch = tenantMatch;
    result.redacted = !tenantMatch;
    result.document = tenantMatch ? document : redactForForeignTenant(document);
    return result;
  } catch (const std::exception &ex) {
    result.error = std::string("parse_error: ") + ex.what();
    return result;
  }
}

}  // namespace reports::portable
