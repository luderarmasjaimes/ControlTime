#pragma once

#include <string>

namespace reports {

struct PdfExportResult {
  bool ok = false;
  std::string pdfBytes;  // Contenido binario del PDF (solo válido si ok).
  std::string error;
};

/** @brief Exporta un informe a PDF vía el sidecar Chromium headless (ADR-016): construye la URL interna `print-report.html?id=...&token=...`, pide al sidecar que la renderice y devuelve los bytes del PDF. Requiere `PDF_EXPORT_URL` configurado; si el sidecar no responde o no está habilitado, `ok=false` con `error` descriptivo. */
PdfExportResult exportReportPdf(const std::string &reportId, const std::string &sessionToken);

}  // namespace reports
