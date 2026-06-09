"""Utilidades compartidas de capacidad y programacion para importadores ClickUp."""
from datetime import date, timedelta, datetime
import math

HOURS_PER_WORKDAY = 8.5
CONTINGENCY_FACTOR = 0.95
TARGET_LOAD_PCT = 90
TARGET_LOAD_MAX_PCT = 100

PERU_NATIONAL_HOLIDAYS = {
    date(2026, 3, 30): "Viernes Santo",
    date(2026, 4, 1):  "Jueves Santo",
    date(2026, 6, 29): "San Pedro y San Pablo",
    date(2026, 7, 23): "FAP",
    date(2026, 7, 28): "Fiestas Patrias",
    date(2026, 7, 29): "Fiestas Patrias",
    date(2026, 8, 6):  "Batalla de Junin",
    date(2026, 10, 8): "Combate de Angamos",
    date(2026, 12, 8): "Inmaculada",
    date(2026, 12, 25): "Navidad",
    date(2027, 1, 1):  "Ano Nuevo",
    date(2027, 4, 1):  "Jueves Santo 2027",
    date(2027, 4, 2):  "Viernes Santo 2027",
}

MONTH_LABELS = {
    1: "Enero", 2: "Febrero", 3: "Marzo", 4: "Abril", 5: "Mayo", 6: "Junio",
    7: "Julio", 8: "Agosto", 9: "Septiembre", 10: "Octubre", 11: "Noviembre", 12: "Diciembre",
}

def is_workday(d):
    d = d if isinstance(d, date) else d.date()
    return d.weekday() < 5 and d not in PERU_NATIONAL_HOLIDAYS

def next_workday(d):
    d = d if isinstance(d, date) else d.date()
    while not is_workday(d):
        d += timedelta(days=1)
    return d

def add_workdays(start, num_days):
    d = next_workday(start)
    if num_days <= 1:
        return d
    added = 1
    while added < num_days:
        d += timedelta(days=1)
        if is_workday(d):
            added += 1
    return d

def count_workdays(start, end):
    d = next_workday(start)
    end = end if isinstance(end, date) else end.date()
    n = 0
    while d <= end:
        if is_workday(d):
            n += 1
        d += timedelta(days=1)
    return max(1, n)

def month_net_workdays(m_start, m_end):
    return count_workdays(m_start, m_end)

def build_month_capacity(month_bounds):
    return {
        m: round(month_net_workdays(b[0], b[1]) * HOURS_PER_WORKDAY, 1)
        for m, b in month_bounds.items()
    }

def format_clickup_date(d):
    return d.strftime("%Y-%m-%d")

def parse_assignees(s):
    return [a.strip() for a in (s or "").split(",") if a.strip()]

def hours_to_workdays(hours, n=1):
    return max(1, math.ceil(hours / max(1, n) / HOURS_PER_WORKDAY))

def task_tuple(folder, list_name, tid, name, desc, assignees, tags, priority,
               sw, ew, release, depends, complexity, risk, stream, hours, avance=0):
    return (folder, list_name, tid, name, desc, assignees, tags, priority,
            sw, ew, release, depends, complexity, risk, stream, hours, avance)
