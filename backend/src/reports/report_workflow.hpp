// --------------------------------------------------------------------------
// report_workflow.hpp — Máquina de estados canónica del informe (ADR-017)
// --------------------------------------------------------------------------
// Antes de este archivo, el backend NO validaba transiciones de workflow en
// absoluto: `handleUpdateReport` aceptaba cualquier string como `status` y lo
// persistía sin cuestionarlo (verificado: GAP_ANALYSIS_2026-07-04.md). El
// frontend (`WorkflowPanel.jsx`) tampoco coincidía con el vocabulario del ADR
// (usaba 'review' en vez de 'in_review', sin estado 'archived').
//
// Este header centraliza la máquina de estados única (ADR-017) para que el
// servidor sea la autoridad real de las transiciones, no un mero receptor.
// --------------------------------------------------------------------------
#pragma once

#include <map>
#include <set>
#include <string>

namespace reports {

/// Vocabulario canónico de estados del informe (ADR-017). Cualquier valor
/// fuera de este conjunto es rechazado por isValidStatus().
inline const std::set<std::string>& validReportStatuses() {
  static const std::set<std::string> kValid = {
      "draft", "in_review", "approved", "signed", "archived", "rejected"};
  return kValid;
}

/// Transiciones permitidas por estado de origen (ADR-017):
///   draft → in_review → approved → signed → archived
///                ↘ rejected → draft
inline const std::map<std::string, std::set<std::string>>&
reportWorkflowTransitions() {
  static const std::map<std::string, std::set<std::string>> kTransitions = {
      {"draft", {"in_review"}},
      {"in_review", {"approved", "rejected"}},
      {"approved", {"signed", "in_review"}},
      {"signed", {"archived"}},
      {"rejected", {"draft"}},
      {"archived", {}},  // terminal
  };
  return kTransitions;
}

/// @brief Valida que `status` pertenezca al vocabulario canónico.
inline bool isValidReportStatus(const std::string& status) {
  return validReportStatuses().count(status) > 0;
}

/// @brief Valida que la transición `from -> to` esté permitida por la máquina
///        de estados. `from == to` (sin cambio real) siempre se permite: no
///        es una transición, es una actualización de contenido sin tocar el
///        workflow.
/// @param from Estado actual almacenado en BD.
/// @param to Estado propuesto por el cliente.
/// @return true si la transición es válida o no hay cambio de estado.
inline bool isValidReportTransition(const std::string& from,
                                    const std::string& to) {
  if (from == to) return true;
  if (!isValidReportStatus(from) || !isValidReportStatus(to)) return false;
  const auto& transitions = reportWorkflowTransitions();
  const auto it = transitions.find(from);
  if (it == transitions.end()) return false;
  return it->second.count(to) > 0;
}

}  // namespace reports
