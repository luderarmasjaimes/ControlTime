#pragma once

#include <string>

namespace reports {

struct PdfExportResult {
  bool ok = false;
  std::string pdfBytes;  // Contenido binario del PDF (solo válido si ok).
  std::string error;
  // ADR-080: contraseña de usuario generada por el sidecar para ESTA
  // descarga (el PDF viene cifrado con ella) — nunca se persiste, solo se
  // entrega una vez al llamador.
  std::string userPassword;
};

/** @brief Exporta un informe a PDF vía el sidecar Chromium headless (ADR-016): construye la URL interna `print-report.html?id=...&token=...`, pide al sidecar que la renderice — con marca de agua (`watermarkText`, ADR-080) y cifrado por contraseña (`result.userPassword`) — y devuelve los bytes del PDF ya protegido. Requiere `PDF_EXPORT_URL` configurado; si el sidecar no responde o no está habilitado, `ok=false` con `error` descriptivo. */
PdfExportResult exportReportPdf(const std::string &reportId, const std::string &sessionToken,
                                const std::string &watermarkText);

}  // namespace reports
