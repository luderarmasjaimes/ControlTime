#pragma once

// --------------------------------------------------------------------------
// pdf_ocr_client.hpp — Importación de PDF con OCR avanzado (ADR-199)
// --------------------------------------------------------------------------
// Mirror de support/cv_extraction_client.cpp (mismo patrón de multipart POST
// a ai_engine), pero hacia /ocr_pdf en vez de /extract_cv_text: la respuesta
// no es texto plano, es una estructura por página (texto digital vs OCR real
// vía PaddleOCR PP-StructureV2 en el sidecar ocr_engine/, ver ese mismo ADR
// para el porqué de un sidecar aparte). Nunca lanza.
// --------------------------------------------------------------------------

#include <optional>
#include <string>
#include <vector>

namespace reports {

/** Estilo de un rango de caracteres dentro de `PdfOcrBlock::text` -- mismo
 * contrato que `TextStyleSpan` en frontend/.../lib/textSpans.ts (fidelidad
 * ampliada, ver ADR-199 §7): permite que el párrafo importado lleve
 * negrita/cursiva/color/fuente reales (páginas digitales, vía PyMuPDF) y
 * que `headingStyle`/`textAlign` (un span que cubre el párrafo COMPLETO)
 * activen el mismo mecanismo que ya usa la Tabla de Contenidos del editor,
 * sin tocar código del editor. Todos los campos opcionales quedan vacíos/
 * `nullopt` cuando esa información no está disponible (ej. cualquier estilo
 * de carácter en páginas OCR -- una imagen rasterizada no lo trae). */
struct PdfOcrSpan {
  int start = 0;
  int end = 0;
  std::optional<bool> bold;
  std::optional<bool> italic;
  std::optional<bool> underline;
  std::string color;        // "#rrggbb", vacío si no aplica
  std::optional<double> fontSize;   // puntos (pt), el frontend convierte a px
  std::string fontFamily;   // vacío si no aplica
  std::string headingStyle; // 'h1'..'h6', vacío = no es encabezado
  std::string textAlign;    // 'left'|'center'|'right'|'justify', vacío = default
};

/** Posición/tamaño real del bloque en la página de origen (puntos, mismo
 * origen que PdfOcrPageGeometry -- x0,y0 = esquina superior izquierda).
 * Fidelidad posicional (pedido explícito: "no pierdas las ubicaciones...
 * documentos con secciones de 2 o más columnas"): sin esto, todo bloque se
 * reacomodaba en un único flujo vertical de una columna, perdiendo layout
 * multi-columna, posición relativa imagen/texto y fondos de página a todo
 * el ancho/alto. Ausente (`nullopt`) para el único caso sin bbox real: el
 * salvavidas de texto crudo sin estructura en `_extract_digital_page`. */
struct PdfOcrBlockBBox {
  double x0 = 0;
  double y0 = 0;
  double x1 = 0;
  double y1 = 0;
};

/** Geometría de línea real de un párrafo en modo réplica (ADR-209): la
 * línea base de su PRIMERA línea, el paso real entre líneas y el tamaño de
 * fuente dominante (puntos) -- el frontend posiciona la caja por la línea
 * base (no por el bbox) con las métricas de la fuente que el navegador
 * realmente usa, así el texto cae exactamente donde estaba en el PDF. */
struct PdfOcrTextLayout {
  double baselinePt = 0;
  double pitchPt = 0;
  double fontSizePt = 0;
  int lineCount = 1;
};

struct PdfOcrBlock {
  std::string type; // "paragraph" | "table" | "figure"
  std::string text;                                  // type == paragraph
  std::vector<PdfOcrSpan> spans;                      // type == paragraph
  std::vector<std::vector<std::string>> tableRows;   // type == table
  std::string imageBase64;                           // type == figure
  std::string imageMime;                             // type == figure (ej. "image/png")
  std::optional<PdfOcrBlockBBox> bbox;               // ver PdfOcrBlockBBox
  std::optional<PdfOcrTextLayout> layout;            // type == paragraph, modo réplica
};

/** Tamaño/orientación/márgenes reales de la página de origen (ver
 * `_page_geometry` en ocr_engine/pdf_ocr_pipeline.py) -- permite configurar
 * el documento importado con `setPaperSize`/`setOrientation`/
 * `setPageMargins` (ya existentes en useEditorStore.ts) en vez de dejarlo
 * siempre en el A4 vertical por defecto. Medidas en puntos (pt), mismo
 * criterio que PdfOcrSpan::fontSize. */
struct PdfOcrPageGeometry {
  double widthPt = 0;
  double heightPt = 0;
  std::string paperSize;  // "A4" | "A3"
  std::string orientation; // "portrait" | "landscape"
  double marginLeftPt = 0;
  double marginTopPt = 0;
  double marginRightPt = 0;
  double marginBottomPt = 0;
};

struct PdfOcrPage {
  int pageNumber = 0;
  std::string source; // "digital" | "ocr"
  std::optional<double> confidence;
  std::vector<PdfOcrBlock> blocks;
  std::optional<PdfOcrPageGeometry> geometry;
  /** "replica" (ADR-209): la página trae una capa de fondo (la página
   * renderizada SIN el texto que llega como bloques editables) y cada
   * párrafo trae `layout`. Vacío = contrato v1 (bloques sueltos). */
  std::string layout;
  std::string backgroundBase64; // vacío si la página no tiene nada detrás del texto
  std::string backgroundMime;   // "image/png" | "image/jpeg"
  std::string error; // no vacío si esta página en particular falló, el resto del documento sigue
};

struct PdfOcrImportResult {
  bool ok = false;
  int pageCount = 0;
  std::vector<PdfOcrPage> pages;
  std::string error; // vacío si ok. Valores conocidos: ai_engine_disabled,
                      // file_too_large, not_a_pdf, too_many_scanned_pages,
                      // ai_engine_unavailable, ai_engine_http_not_ok, ...
  int scannedPages = 0; // solo con error == "too_many_scanned_pages"
  int scannedPagesLimit = 0;
};

/** @brief Importa un PDF con OCR avanzado vía el sidecar ocr_engine (a
 * través de ai_engine, que actúa de gateway único -- ver ADR-199). Nunca
 * lanza; `error` queda vacío si `ok`. */
PdfOcrImportResult importPdfWithOcr(const std::vector<unsigned char> &fileBytes,
                                    const std::string &filename);

} // namespace reports
