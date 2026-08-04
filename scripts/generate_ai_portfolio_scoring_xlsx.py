from __future__ import annotations

import csv
from pathlib import Path

from openpyxl import Workbook
from openpyxl.formatting.rule import ColorScaleRule
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "docs" / "Matriz_Scoring_Portafolio_IA_Minera_2026.csv"
XLSX_PATH = ROOT / "docs" / "Matriz_Scoring_Portafolio_IA_Minera_2026.xlsx"

HEADER_FILL = PatternFill(fill_type="solid", fgColor="1F4E78")
HEADER_FONT = Font(color="FFFFFF", bold=True)
SECTION_FILL = PatternFill(fill_type="solid", fgColor="D9EAF7")
GREEN_FILL = PatternFill(fill_type="solid", fgColor="63BE7B")
YELLOW_FILL = PatternFill(fill_type="solid", fgColor="FFEB84")
RED_FILL = PatternFill(fill_type="solid", fgColor="F8696B")

CRITERIA_COLUMNS = {
    "Coding": "E",
    "DocumentAI": "F",
    "Multimodalidad": "G",
    "Gobierno_Enterprise": "H",
    "Portabilidad": "I",
    "Costos": "J",
    "Compatibilidad_Stack": "K",
}

AUDIENCE_WEIGHTS = {
    "Directorio": {
        "Coding": 0.10,
        "DocumentAI": 0.15,
        "Multimodalidad": 0.10,
        "Gobierno_Enterprise": 0.25,
        "Portabilidad": 0.10,
        "Costos": 0.20,
        "Compatibilidad_Stack": 0.10,
    },
    "TI": {
        "Coding": 0.20,
        "DocumentAI": 0.15,
        "Multimodalidad": 0.10,
        "Gobierno_Enterprise": 0.15,
        "Portabilidad": 0.15,
        "Costos": 0.10,
        "Compatibilidad_Stack": 0.15,
    },
    "Operaciones": {
        "Coding": 0.10,
        "DocumentAI": 0.20,
        "Multimodalidad": 0.15,
        "Gobierno_Enterprise": 0.10,
        "Portabilidad": 0.05,
        "Costos": 0.15,
        "Compatibilidad_Stack": 0.25,
    },
}

ANNUAL_BUDGET = [
    ["T1", 4210, 9350],
    ["T2", 9210, 20350],
    ["T3", 14210, 34350],
    ["T4", 16500, 39000],
]

SCENARIO_WEIGHTS = {
    "Conservador": {
        "Coding": 0.08,
        "DocumentAI": 0.12,
        "Multimodalidad": 0.08,
        "Gobierno_Enterprise": 0.27,
        "Portabilidad": 0.10,
        "Costos": 0.25,
        "Compatibilidad_Stack": 0.10,
    },
    "Agresivo": {
        "Coding": 0.20,
        "DocumentAI": 0.18,
        "Multimodalidad": 0.14,
        "Gobierno_Enterprise": 0.10,
        "Portabilidad": 0.12,
        "Costos": 0.06,
        "Compatibilidad_Stack": 0.20,
    },
}


def load_rows() -> list[list[str]]:
    with CSV_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.reader(handle))


def autosize_columns(ws) -> None:
    for column_cells in ws.columns:
        max_length = 0
        letter = get_column_letter(column_cells[0].column)
        for cell in column_cells:
            if cell.value is not None:
                max_length = max(max_length, len(str(cell.value)))
        ws.column_dimensions[letter].width = min(max(max_length + 2, 12), 30)


def style_header(row) -> None:
    for cell in row:
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)


def weighted_formula(row: int, weights: dict[str, float]) -> str:
    parts = [f"{CRITERIA_COLUMNS[criterion]}{row}*{weight:.2f}" for criterion, weight in weights.items()]
    return f"=ROUND({'+'.join(parts)},2)"


def weighted_score_from_row(row: list[str], weights: dict[str, float]) -> float:
    return round(
        int(row[4]) * weights["Coding"]
        + int(row[5]) * weights["DocumentAI"]
        + int(row[6]) * weights["Multimodalidad"]
        + int(row[7]) * weights["Gobierno_Enterprise"]
        + int(row[8]) * weights["Portabilidad"]
        + int(row[9]) * weights["Costos"]
        + int(row[10]) * weights["Compatibilidad_Stack"],
        2,
    )


def score_fill(score: int) -> PatternFill:
    if score >= 8:
        return GREEN_FILL
    if score >= 6:
        return YELLOW_FILL
    return RED_FILL


def build_scoring_sheet(workbook: Workbook, rows: list[list[str]]) -> None:
    ws = workbook.active
    ws.title = "Scoring"
    for row in rows:
        ws.append(row)

    style_header(ws[1])
    ws.freeze_panes = "A2"

    extra_headers = [
        "Puntaje Tecnico",
        "Puntaje Directorio",
        "Ranking Directorio",
        "Puntaje TI",
        "Ranking TI",
        "Puntaje Operaciones",
        "Ranking Operaciones",
        "Puntaje Conservador",
        "Ranking Conservador",
        "Puntaje Agresivo",
        "Ranking Agresivo",
    ]
    start_col = ws.max_column + 1
    for offset, header in enumerate(extra_headers):
        ws.cell(1, start_col + offset, header)
    style_header(ws[1][start_col - 1 : start_col + len(extra_headers) - 1])

    for row in range(2, ws.max_row + 1):
        ws.cell(row, start_col, f"=ROUND(AVERAGE(E{row}:K{row}),2)")
        ws.cell(row, start_col + 1, weighted_formula(row, AUDIENCE_WEIGHTS["Directorio"]))
        ws.cell(row, start_col + 2, f"=RANK(M{row},$M$2:$M${ws.max_row},0)")
        ws.cell(row, start_col + 3, weighted_formula(row, AUDIENCE_WEIGHTS["TI"]))
        ws.cell(row, start_col + 4, f"=RANK(O{row},$O$2:$O${ws.max_row},0)")
        ws.cell(row, start_col + 5, weighted_formula(row, AUDIENCE_WEIGHTS["Operaciones"]))
        ws.cell(row, start_col + 6, f"=RANK(Q{row},$Q$2:$Q${ws.max_row},0)")
        ws.cell(row, start_col + 7, weighted_formula(row, SCENARIO_WEIGHTS["Conservador"]))
        ws.cell(row, start_col + 8, f"=RANK(S{row},$S$2:$S${ws.max_row},0)")
        ws.cell(row, start_col + 9, weighted_formula(row, SCENARIO_WEIGHTS["Agresivo"]))
        ws.cell(row, start_col + 10, f"=RANK(U{row},$U$2:$U${ws.max_row},0)")

    for col in range(5, start_col + 1):
        letter = get_column_letter(col)
        ws.conditional_formatting.add(
            f"{letter}2:{letter}{ws.max_row}",
            ColorScaleRule(start_type="num", start_value=1, start_color="F8696B", mid_type="num", mid_value=5, mid_color="FFEB84", end_type="num", end_value=10, end_color="63BE7B"),
        )

    for col in range(start_col + 1, start_col + 11, 2):
        letter = get_column_letter(col)
        ws.conditional_formatting.add(
            f"{letter}2:{letter}{ws.max_row}",
            ColorScaleRule(start_type="num", start_value=1, start_color="F8696B", mid_type="num", mid_value=5, mid_color="FFEB84", end_type="num", end_value=10, end_color="63BE7B"),
        )

    autosize_columns(ws)


def build_weights_sheet(workbook: Workbook) -> None:
    ws = workbook.create_sheet("Pesos")
    ws.append(["Audiencia", "Criterio", "Peso", "Lectura ejecutiva"])
    style_header(ws[1])

    explanations = {
        "Coding": "Impacto en productividad de desarrollo y mantenimiento",
        "DocumentAI": "Uso para OCR, RAG, redaccion y mejora documental",
        "Multimodalidad": "Texto, imagen, audio, documentos y vision",
        "Gobierno_Enterprise": "SSO, auditabilidad, seguridad y admin central",
        "Portabilidad": "Capacidad hybrid, on-prem o multicloud",
        "Costos": "TCO visible para fase inicial y escalamiento",
        "Compatibilidad_Stack": "Ajuste con JavaScript, React, Python, Docker y AWS/VPS",
    }

    for audience, weights in AUDIENCE_WEIGHTS.items():
        for criterion, weight in weights.items():
            ws.append([audience, criterion, f"{weight:.0%}", explanations[criterion]])
        note_row = ws.max_row + 1
        ws.append([f"Lectura {audience}", "", "", "El puntaje ponderado ayuda a priorizar el shortlist segun la audiencia decisora."])
        for cell in ws[note_row]:
            cell.fill = SECTION_FILL
            cell.font = Font(bold=True)

    for scenario, weights in SCENARIO_WEIGHTS.items():
        for criterion, weight in weights.items():
            ws.append([scenario, criterion, f"{weight:.0%}", explanations[criterion]])
        note_row = ws.max_row + 1
        ws.append([f"Lectura {scenario}", "", "", "Escenario conservador protege costo y gobierno; escenario agresivo prioriza aceleracion y amplitud funcional."])
        for cell in ws[note_row]:
            cell.fill = SECTION_FILL
            cell.font = Font(bold=True)
    autosize_columns(ws)


def build_audience_summary_sheet(workbook: Workbook) -> None:
    ws = workbook.create_sheet("Resumen Audiencias")
    rows = [
        ["Audiencia", "Top 1", "Top 2", "Top 3", "Lectura"],
        ["Directorio", "Claude Sonnet 4.6 / Gemini 2.5 Flash / Mistral Medium 3.1", "Azure OpenAI / GitHub Copilot", "Amazon Bedrock", "Prioriza gobierno, costo controlado y escalamiento seguro"],
        ["TI", "Claude Sonnet 4.6 / GitHub Copilot / GPT-5.4", "Mistral Medium 3.1 / Windsurf Teams", "Azure OpenAI / Amazon Bedrock", "Prioriza desarrollo, integracion y portabilidad"],
        ["Operaciones", "Gemini 2.5 Flash / Claude Sonnet 4.6 / GitHub Copilot", "Azure OpenAI / GPT-5.4", "PyTorch + XGBoost + MLflow", "Prioriza document AI, asistentes y ajuste al flujo operativo"],
    ]
    for row in rows:
        ws.append(row)
    style_header(ws[1])
    autosize_columns(ws)


def build_scenario_summary_sheet(workbook: Workbook) -> None:
    ws = workbook.create_sheet("Escenarios Scoring")
    rows = [
        ["Escenario", "Enfoque", "Top esperado", "Lectura ejecutiva"],
        ["Conservador", "Control de costo, gobierno y riesgo", "GitHub Copilot / Azure OpenAI / Gemini 2.5 Flash / Amazon Bedrock", "Adecuado para arranque corporativo con comite de control y adopcion gradual"],
        ["Agresivo", "Velocidad, amplitud funcional y productividad", "Claude Sonnet 4.6 / GPT-5.4 / Windsurf Teams / Mistral Medium 3.1", "Adecuado para acelerar construccion, experimentacion y ventaja operativa"],
    ]
    for row in rows:
        ws.append(row)
    style_header(ws[1])
    autosize_columns(ws)


def build_executive_semaphore_sheet(workbook: Workbook, rows: list[list[str]]) -> None:
    ws = workbook.create_sheet("Semaforo Ejecutivo")
    headers = [
        "Plataforma",
        "Proveedor",
        "Caso principal",
        "Puntaje Comite",
        "Coding",
        "DocumentAI",
        "Multimodalidad",
        "Gobierno",
        "Portabilidad",
        "Costos",
        "Lectura",
    ]
    ws.append(headers)
    style_header(ws[1])

    ranked_rows: list[tuple[float, list[str]]] = []
    for row in rows[1:]:
        committee_score = round(
            (
                weighted_score_from_row(row, AUDIENCE_WEIGHTS["Directorio"])
                + weighted_score_from_row(row, AUDIENCE_WEIGHTS["TI"])
                + weighted_score_from_row(row, AUDIENCE_WEIGHTS["Operaciones"])
            )
            / 3,
            2,
        )
        ranked_rows.append((committee_score, row))

    top_rows = sorted(ranked_rows, key=lambda item: item[0], reverse=True)[:5]

    for committee_score, row in top_rows:
        scores = {
            "Coding": int(row[4]),
            "DocumentAI": int(row[5]),
            "Multimodalidad": int(row[6]),
            "Gobierno": int(row[7]),
            "Portabilidad": int(row[8]),
            "Costos": int(row[9]),
        }
        average = sum(scores.values()) / len(scores)
        if average >= 8:
            lectura = "Verde ejecutivo"
        elif average >= 6:
            lectura = "Amarillo controlado"
        else:
            lectura = "Rojo selectivo"

        ws.append([
            row[2],
            row[1],
            row[3],
            committee_score,
            scores["Coding"],
            scores["DocumentAI"],
            scores["Multimodalidad"],
            scores["Gobierno"],
            scores["Portabilidad"],
            scores["Costos"],
            lectura,
        ])

        current_row = ws.max_row
        ws.cell(current_row, 4).alignment = Alignment(horizontal="center")
        for col in range(5, 11):
            ws.cell(current_row, col).fill = score_fill(int(ws.cell(current_row, col).value))
            ws.cell(current_row, col).alignment = Alignment(horizontal="center")

        lectura_cell = ws.cell(current_row, 11)
        if lectura == "Verde ejecutivo":
            lectura_cell.fill = GREEN_FILL
        elif lectura == "Amarillo controlado":
            lectura_cell.fill = YELLOW_FILL
        else:
            lectura_cell.fill = RED_FILL
        lectura_cell.font = Font(bold=True)

    ws.append([])
    note_row = ws.max_row + 1
    ws.append(["", "", "", "Top 5", "", "", "", "", "", "", "Shortlist resumido para comite con base en promedio de Directorio, TI y Operaciones."])
    for cell in ws[note_row]:
        cell.fill = SECTION_FILL
        cell.font = Font(bold=True)

    autosize_columns(ws)


def build_budget_sheet(workbook: Workbook) -> None:
    ws = workbook.create_sheet("Presupuesto Anual")
    ws.append(["Trimestre", "Min USD", "Max USD", "Escenario medio USD"])
    style_header(ws[1])

    for quarter, min_value, max_value in ANNUAL_BUDGET:
        ws.append([quarter, min_value, max_value, round((min_value + max_value) / 2, 2)])

    total_row = ws.max_row + 1
    ws.append([
        "Total anual",
        f"=SUM(B2:B{ws.max_row})",
        f"=SUM(C2:C{ws.max_row})",
        f"=SUM(D2:D{ws.max_row})",
    ])
    for cell in ws[total_row]:
        cell.fill = SECTION_FILL
        cell.font = Font(bold=True)

    ws.append([])
    ws.append(["Escenario", "Monto anual", "Promedio mensual", "Lectura"])
    style_header(ws[ws.max_row])
    ws.append(["Conservador", 44130, 3677.5, "Adopcion controlada, foco en copilotos y PoC"])
    ws.append(["Medio", 83000, 6916.67, "Operacion estable con RAG, document AI y gateway"])
    ws.append(["Expandido", 103050, 8587.5, "Escala corporativa con ML y mayor carga operativa"])
    autosize_columns(ws)


def build_shortlist_sheet(workbook: Workbook) -> None:
    ws = workbook.create_sheet("Shortlist")
    rows = [
        ["Decision", "Recomendacion"],
        ["Base corporativa de copiloto", "GitHub Copilot"],
        ["Capa senior de ingenieria", "Claude Code Team o Windsurf Teams"],
        ["Modelo premium para documentos y razonamiento", "Claude Sonnet 4.6 o GPT-5.4"],
        ["Modelo de alto volumen y bajo costo", "Gemini 2.5 Flash / Flash-Lite"],
        ["Portabilidad y despliegue hybrid", "Mistral Medium 3.1 y Codestral"],
        ["Continuidad e integracion AWS", "Amazon Bedrock"],
        ["Prediccion minera", "PyTorch + XGBoost + MLflow"],
    ]
    for row in rows:
        ws.append(row)
    style_header(ws[1])
    autosize_columns(ws)


def main() -> None:
    rows = load_rows()
    workbook = Workbook()
    build_scoring_sheet(workbook, rows)
    build_weights_sheet(workbook)
    build_audience_summary_sheet(workbook)
    build_scenario_summary_sheet(workbook)
    build_executive_semaphore_sheet(workbook, rows)
    build_budget_sheet(workbook)
    build_shortlist_sheet(workbook)
    workbook.save(XLSX_PATH)
    print(f"Generated {XLSX_PATH}")


if __name__ == "__main__":
    main()
