#!/usr/bin/env python3
"""Genera report.html a partir de los ADRs en docs/decisions/."""

from __future__ import annotations

import html
import re
from datetime import datetime, timezone
from pathlib import Path

DECISIONS_DIR = Path(__file__).resolve().parent
OUTPUT = DECISIONS_DIR / "report.html"

AMBITO_META = {
    "plataforma": {
        "label": "Plataforma",
        "desc": "Fundaciones transversales",
        "color": "#2563eb",
        "bg": "#eff6ff",
    },
    "core-iot": {
        "label": "Core IoT",
        "desc": "Plataforma IoT del core C++",
        "color": "#ea580c",
        "bg": "#fff7ed",
    },
    "datos": {
        "label": "Datos",
        "desc": "Bases de datos y almacenamiento",
        "color": "#7c3aed",
        "bg": "#f5f3ff",
    },
    "reports": {
        "label": "Reports",
        "desc": "Componente ReportStudio",
        "color": "#059669",
        "bg": "#ecfdf5",
    },
    "ia": {
        "label": "IA",
        "desc": "Inteligencia artificial local",
        "color": "#db2777",
        "bg": "#fdf2f8",
    },
    "geo": {
        "label": "Geo",
        "desc": "Cartografía y geoespacial",
        "color": "#0d9488",
        "bg": "#f0fdfa",
    },
}

AMBITO_ORDER = list(AMBITO_META.keys())

STATUS_COLORS = {
    "proposed": ("#64748b", "#f1f5f9"),
    "accepted": ("#15803d", "#dcfce7"),
    "deferred": ("#b45309", "#fef3c7"),
    "superseded": ("#9333ea", "#f3e8ff"),
}


def parse_adr(path: Path) -> dict | None:
    text = path.read_text(encoding="utf-8")
    m_num = re.match(r"^(\d{3})-", path.name)
    if not m_num:
        return None

    number = int(m_num.group(1))
    slug = path.stem[4:]

    title_match = re.search(r"^#\s*ADR-\d+\s*[—–-]\s*(.+)$", text, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else slug

    def field(name: str) -> str:
        m = re.search(rf"^\*\*{re.escape(name)}\*\*:\s*(.+)$", text, re.MULTILINE)
        return m.group(1).strip() if m else ""

    status_raw = field("Status")
    status = "proposed"
    status_note = ""
    if status_raw:
        lower = status_raw.lower()
        if "deferred" in lower:
            status = "deferred"
        elif "superseded" in lower:
            status = "superseded"
        elif "accepted" in lower:
            status = "accepted"
        elif "proposed" in lower:
            status = "proposed"
        if status_raw.lower() != status:
            status_note = status_raw

    ambito = field("Ámbito") or field("Ambito") or "sin-ambito"
    fecha = field("Fecha")
    autores = field("Autores")

    summary = ""
    ctx = re.search(r"^## Contexto\s*\n+(.+?)(?:\n##|\Z)", text, re.MULTILINE | re.DOTALL)
    if ctx:
        para = ctx.group(1).strip().split("\n\n")[0]
        summary = re.sub(r"\s+", " ", para).strip()
        if len(summary) > 220:
            summary = summary[:217].rstrip() + "…"

    return {
        "number": number,
        "slug": slug,
        "title": title,
        "status": status,
        "status_note": status_note,
        "ambito": ambito,
        "fecha": fecha,
        "autores": autores,
        "summary": summary,
        "file": path.name,
    }


def render_html(adrs: list[dict]) -> str:
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    total = len(adrs)
    by_ambito = {k: sum(1 for a in adrs if a["ambito"] == k) for k in AMBITO_ORDER}
    unknown = sum(1 for a in adrs if a["ambito"] not in AMBITO_META)

    cards = []
    for adr in sorted(adrs, key=lambda a: a["number"]):
        meta = AMBITO_META.get(adr["ambito"], {
            "label": adr["ambito"],
            "color": "#475569",
            "bg": "#f8fafc",
        })
        st_fg, st_bg = STATUS_COLORS.get(adr["status"], STATUS_COLORS["proposed"])
        status_label = adr["status"]
        if adr["status_note"]:
            status_title = html.escape(adr["status_note"])
        else:
            status_title = status_label

        cards.append(f"""
        <article class="card" data-ambito="{html.escape(adr['ambito'])}" data-status="{html.escape(adr['status'])}" data-search="{html.escape(f"ADR-{adr['number']:03d} {adr['title']} {adr['slug']} {adr['summary']}".lower())}">
          <header class="card-head">
            <span class="adr-id">ADR-{adr['number']:03d}</span>
            <span class="tag ambito-tag" style="--tag-color:{meta['color']};--tag-bg:{meta.get('bg','#f8fafc')}">{html.escape(meta['label'] if adr['ambito'] in AMBITO_META else adr['ambito'])}</span>
            <span class="tag status-tag" style="--tag-color:{st_fg};--tag-bg:{st_bg}" title="{html.escape(status_title)}">{html.escape(status_label)}</span>
          </header>
          <h2><a href="{html.escape(adr['file'])}">{html.escape(adr['title'])}</a></h2>
          <p class="summary">{html.escape(adr['summary'])}</p>
          <footer class="card-foot">
            <span>{html.escape(adr['fecha'] or '—')}</span>
            <span>{html.escape(adr['autores'] or '—')}</span>
            <code>{html.escape(adr['slug'])}</code>
          </footer>
        </article>""")

    filter_buttons = []
    filter_buttons.append(
        f'<button type="button" class="filter-btn active" data-filter="all">Todos <span class="count">{total}</span></button>'
    )
    for key in AMBITO_ORDER:
        if by_ambito[key]:
            meta = AMBITO_META[key]
            filter_buttons.append(
                f'<button type="button" class="filter-btn" data-filter="{key}" style="--tag-color:{meta["color"]}">'
                f'{html.escape(meta["label"])} <span class="count">{by_ambito[key]}</span></button>'
            )
    if unknown:
        filter_buttons.append(
            f'<button type="button" class="filter-btn" data-filter="_unknown">Otros <span class="count">{unknown}</span></button>'
        )

    sections = []
    for key in AMBITO_ORDER:
        group = [a for a in adrs if a["ambito"] == key]
        if not group:
            continue
        meta = AMBITO_META[key]
        section_cards = []
        for adr in sorted(group, key=lambda a: a["number"]):
            idx = next(i for i, a in enumerate(adrs) if a["number"] == adr["number"])
            section_cards.append(cards[idx])
        sections.append(f"""
        <section class="ambito-section" data-ambito="{key}">
          <div class="section-header" style="--accent:{meta['color']};--accent-bg:{meta['bg']}">
            <span class="section-tag">{html.escape(meta['label'])}</span>
            <div>
              <h2>{html.escape(meta['label'])}</h2>
              <p>{html.escape(meta['desc'])} · {len(group)} ADR{'s' if len(group) != 1 else ''}</p>
            </div>
          </div>
          <div class="grid">{''.join(section_cards)}</div>
        </section>""")

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ADRs Beemetry 2.0 — por ámbito</title>
  <style>
    :root {{
      --bg: #0f172a;
      --surface: #1e293b;
      --surface-2: #334155;
      --text: #f8fafc;
      --muted: #94a3b8;
      --border: #334155;
      --radius: 12px;
      --shadow: 0 4px 24px rgba(0,0,0,.35);
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      background: linear-gradient(160deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%);
      color: var(--text);
      min-height: 100vh;
      line-height: 1.5;
    }}
    .wrap {{ max-width: 1280px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }}
    header.page {{
      margin-bottom: 2rem;
    }}
    header.page h1 {{
      margin: 0 0 .35rem;
      font-size: clamp(1.6rem, 3vw, 2.2rem);
      letter-spacing: -.02em;
    }}
    header.page p {{ margin: 0; color: var(--muted); }}
    .meta-line {{ margin-top: .75rem; font-size: .85rem; color: var(--muted); }}
    .toolbar {{
      display: flex;
      flex-wrap: wrap;
      gap: .75rem;
      align-items: center;
      margin-bottom: 1.5rem;
      padding: 1rem;
      background: rgba(30,41,59,.75);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      backdrop-filter: blur(8px);
    }}
    .search {{
      flex: 1 1 220px;
      min-width: 180px;
      padding: .6rem .85rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg);
      color: var(--text);
      font-size: .95rem;
    }}
    .search:focus {{ outline: 2px solid #6366f1; border-color: transparent; }}
    .filters {{ display: flex; flex-wrap: wrap; gap: .45rem; }}
    .filter-btn {{
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--text);
      padding: .35rem .7rem;
      border-radius: 999px;
      font-size: .82rem;
      cursor: pointer;
      transition: .15s ease;
    }}
    .filter-btn .count {{
      opacity: .7;
      margin-left: .15rem;
    }}
    .filter-btn:hover {{ border-color: var(--tag-color, #6366f1); }}
    .filter-btn.active {{
      background: color-mix(in srgb, var(--tag-color, #6366f1) 22%, var(--surface));
      border-color: var(--tag-color, #6366f1);
    }}
    .view-toggle {{
      display: flex;
      gap: .35rem;
    }}
    .view-toggle button {{
      border: 1px solid var(--border);
      background: var(--surface);
      color: var(--muted);
      padding: .35rem .65rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: .82rem;
    }}
    .view-toggle button.active {{
      color: var(--text);
      border-color: #6366f1;
      background: rgba(99,102,241,.15);
    }}
    .legend {{
      display: flex;
      flex-wrap: wrap;
      gap: .5rem 1rem;
      margin-bottom: 2rem;
      font-size: .82rem;
      color: var(--muted);
    }}
    .legend-item {{ display: flex; align-items: center; gap: .35rem; }}
    .legend-dot {{
      width: 10px; height: 10px; border-radius: 50%;
    }}
    .ambito-section {{ margin-bottom: 2.5rem; }}
    .section-header {{
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
      padding: .85rem 1rem;
      border-left: 4px solid var(--accent);
      background: color-mix(in srgb, var(--accent-bg) 12%, transparent);
      border-radius: 0 var(--radius) var(--radius) 0;
    }}
    .section-tag {{
      font-size: .72rem;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 18%, transparent);
      padding: .25rem .55rem;
      border-radius: 6px;
    }}
    .section-header h2 {{ margin: 0; font-size: 1.15rem; }}
    .section-header p {{ margin: .15rem 0 0; font-size: .85rem; color: var(--muted); }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }}
    .card {{
      background: rgba(30,41,59,.85);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.1rem;
      display: flex;
      flex-direction: column;
      gap: .55rem;
      transition: .15s ease;
    }}
    .card:hover {{
      border-color: color-mix(in srgb, var(--tag-color, #6366f1) 50%, var(--border));
      transform: translateY(-1px);
      box-shadow: var(--shadow);
    }}
    .card.hidden {{ display: none; }}
    .card-head {{
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: .4rem;
    }}
    .adr-id {{
      font-family: ui-monospace, Consolas, monospace;
      font-size: .78rem;
      color: var(--muted);
      font-weight: 600;
    }}
    .tag {{
      font-size: .68rem;
      font-weight: 700;
      letter-spacing: .04em;
      text-transform: uppercase;
      padding: .18rem .45rem;
      border-radius: 999px;
      color: var(--tag-color);
      background: color-mix(in srgb, var(--tag-bg) 35%, transparent);
      border: 1px solid color-mix(in srgb, var(--tag-color) 35%, transparent);
    }}
    .card h2 {{
      margin: 0;
      font-size: 1rem;
      line-height: 1.35;
    }}
    .card h2 a {{
      color: var(--text);
      text-decoration: none;
    }}
    .card h2 a:hover {{ color: #a5b4fc; text-decoration: underline; }}
    .summary {{
      margin: 0;
      font-size: .86rem;
      color: var(--muted);
      flex: 1;
    }}
    .card-foot {{
      display: flex;
      flex-wrap: wrap;
      gap: .5rem 1rem;
      font-size: .75rem;
      color: var(--muted);
      border-top: 1px solid var(--border);
      padding-top: .55rem;
      margin-top: .2rem;
    }}
    .card-foot code {{
      font-size: .72rem;
      background: rgba(15,23,42,.6);
      padding: .1rem .35rem;
      border-radius: 4px;
    }}
    body.view-flat .ambito-section {{ display: none; }}
    body.view-flat .flat-grid {{ display: grid; }}
    .flat-grid {{
      display: none;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }}
    .empty-msg {{
      display: none;
      text-align: center;
      color: var(--muted);
      padding: 3rem 1rem;
    }}
    .empty-msg.visible {{ display: block; }}
    @media (max-width: 640px) {{
      .wrap {{ padding: 1.25rem .85rem 3rem; }}
      .grid, .flat-grid {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body class="view-grouped">
  <div class="wrap">
    <header class="page">
      <h1>Architecture Decision Records</h1>
      <p>Beemetry 2.0 — {total} decisiones agrupadas por ámbito</p>
      <p class="meta-line">Generado: {generated} · <a href="README.md" style="color:#a5b4fc">README</a></p>
    </header>

    <div class="toolbar">
      <input type="search" class="search" id="search" placeholder="Buscar por título, número o contexto…" autocomplete="off">
      <div class="filters" id="filters">
        {''.join(filter_buttons)}
      </div>
      <div class="view-toggle">
        <button type="button" id="view-grouped" class="active">Por ámbito</button>
        <button type="button" id="view-flat">Lista</button>
      </div>
    </div>

    <div class="legend">
      {''.join(f'<span class="legend-item"><span class="legend-dot" style="background:{m["color"]}"></span>{html.escape(m["label"])}</span>' for k, m in AMBITO_META.items())}
    </div>

    <div id="grouped-view">
      {''.join(sections)}
    </div>

    <div class="flat-grid" id="flat-view">
      {''.join(cards)}
    </div>

    <p class="empty-msg" id="empty">Ningún ADR coincide con el filtro actual.</p>
  </div>

  <script>
    const search = document.getElementById('search');
    const filterBtns = document.querySelectorAll('.filter-btn');
    const allCards = document.querySelectorAll('.card');
    const sections = document.querySelectorAll('.ambito-section');
    const emptyMsg = document.getElementById('empty');
    let activeFilter = 'all';

    function cardMatches(card) {{
      const q = search.value.trim().toLowerCase();
      const textOk = !q || card.dataset.search.includes(q);
      const ambito = card.dataset.ambito;
      const filterOk = activeFilter === 'all'
        || (activeFilter === '_unknown' && !{list(AMBITO_META.keys())!r}.includes(ambito))
        || activeFilter === ambito;
      return textOk && filterOk;
    }}

    function applyFilters() {{
      let visible = 0;
      allCards.forEach(card => {{
        const show = cardMatches(card);
        card.classList.toggle('hidden', !show);
        if (show) visible++;
      }});
      sections.forEach(sec => {{
        const any = [...sec.querySelectorAll('.card')].some(c => !c.classList.contains('hidden'));
        sec.style.display = any ? '' : 'none';
      }});
      emptyMsg.classList.toggle('visible', visible === 0);
    }}

    search.addEventListener('input', applyFilters);
    filterBtns.forEach(btn => {{
      btn.addEventListener('click', () => {{
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        activeFilter = btn.dataset.filter;
        applyFilters();
      }});
    }});

    document.getElementById('view-grouped').addEventListener('click', () => {{
      document.body.classList.add('view-grouped');
      document.body.classList.remove('view-flat');
      document.getElementById('view-grouped').classList.add('active');
      document.getElementById('view-flat').classList.remove('active');
    }});
    document.getElementById('view-flat').addEventListener('click', () => {{
      document.body.classList.remove('view-grouped');
      document.body.classList.add('view-flat');
      document.getElementById('view-flat').classList.add('active');
      document.getElementById('view-grouped').classList.remove('active');
    }});
  </script>
</body>
</html>"""


def main() -> None:
    adrs: list[dict] = []
    for path in sorted(DECISIONS_DIR.glob("[0-9][0-9][0-9]-*.md")):
        parsed = parse_adr(path)
        if parsed:
            adrs.append(parsed)

    html_out = render_html(adrs)
    OUTPUT.write_text(html_out, encoding="utf-8")
    print(f"Wrote {OUTPUT} ({len(adrs)} ADRs)")


if __name__ == "__main__":
    main()
