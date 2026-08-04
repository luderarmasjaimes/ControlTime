# -*- coding: utf-8 -*-
"""
Genera los paneles de navegacion del proyecto AURIXA:

  PANEL_PROYECTO.html  -> explorador de TODA la documentacion (MD/PY/DOCX/XLSX/PDF/PPTX/HTML...)
                          con buscador y filtros por tipo. Abrir con doble clic.
  PANEL_SCRIPTS.hta    -> panel Windows que lista los scripts .py y permite EJECUTARLOS
                          con doble clic (boton Ejecutar), via WScript.Shell.

Reejecutar tras cambios en la documentacion:
  .venv\\Scripts\\python.exe soporte_mantenimiento\\scripts_python\\generar_paneles.py
"""
import os
import html
import json
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

EXCLUDE_DIRS = {
    ".git", ".venv", ".vscode", ".cursor", ".github", "node_modules", "__pycache__",
    "backend", "frontend", "ai_engine", "ai_engine_probe_logs", "formula_engine",
    "biometric-models", "dermalog-sdk", "ecw-plugin", "certs", "data", "db_scripts",
    "artifacts", "tmp",
}
INCLUDE_EXT = {
    ".md": "MD", ".py": "PY", ".docx": "DOCX", ".xlsx": "XLSX", ".xls": "XLSX",
    ".pdf": "PDF", ".pptx": "PPTX", ".ppt": "PPTX", ".html": "HTML", ".htm": "HTML",
    ".csv": "CSV", ".rtf": "RTF", ".svg": "SVG", ".ps1": "PS1", ".xml": "XML",
    ".srt": "SRT", ".puml": "PUML", ".js": "PY", ".sql": "SQL",
}
TYPE_COLORS = {
    "MD": "#2563eb", "PY": "#16a34a", "DOCX": "#1d4ed8", "XLSX": "#15803d",
    "PDF": "#dc2626", "PPTX": "#ea580c", "HTML": "#7c3aed", "CSV": "#0891b2",
    "RTF": "#64748b", "SVG": "#db2777", "PS1": "#0f766e", "XML": "#9333ea",
    "SRT": "#64748b", "PUML": "#9333ea",
}


def scan():
    items = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in INCLUDE_EXT or fn.startswith("~$"):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            folder = os.path.dirname(rel) or "."
            try:
                st = os.stat(full)
                size = st.st_size
                mtime = datetime.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d")
            except OSError:
                size, mtime = 0, ""
            items.append({
                "name": fn, "rel": rel, "folder": folder,
                "type": INCLUDE_EXT[ext], "size": size, "mtime": mtime,
            })
    items.sort(key=lambda x: (x["folder"], x["name"].lower()))
    return items


def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.0f} {u}"
        n /= 1024
    return f"{n:.1f} TB"


def build_html(items):
    counts = {}
    for it in items:
        counts[it["type"]] = counts.get(it["type"], 0) + 1
    data = json.dumps(items, ensure_ascii=False)
    types = sorted(counts, key=lambda t: -counts[t])
    chips = "".join(
        f'<span class="chip" data-t="{t}" style="--c:{TYPE_COLORS.get(t,"#555")}" '
        f'onclick="toggle(this)">{t} <b>{counts[t]}</b></span>'
        for t in types
    )
    gen = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    color_map = json.dumps(TYPE_COLORS)
    return f"""<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PANEL PROYECTO AURIXA</title>
<style>
:root{{color-scheme:light dark}}
*{{box-sizing:border-box}}
body{{margin:0;font-family:Segoe UI,Roboto,system-ui,sans-serif;background:#0f172a;color:#e2e8f0}}
header{{padding:22px 26px;background:linear-gradient(135deg,#1e3a8a,#0f766e);box-shadow:0 2px 14px #0008}}
h1{{margin:0;font-size:22px;letter-spacing:.5px}}
.sub{{opacity:.85;font-size:13px;margin-top:4px}}
.bar{{position:sticky;top:0;z-index:5;background:#0f172afa;backdrop-filter:blur(6px);padding:14px 26px;border-bottom:1px solid #1e293b}}
#q{{width:100%;max-width:520px;padding:10px 14px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:15px}}
.chips{{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px}}
.chip{{cursor:pointer;user-select:none;padding:5px 12px;border-radius:20px;font-size:12px;border:1px solid var(--c);color:#fff;background:transparent}}
.chip.on{{background:var(--c)}}
.chip b{{opacity:.8;font-weight:700}}
main{{padding:18px 26px 60px}}
.folder{{margin:22px 0 8px;font-size:14px;font-weight:700;color:#7dd3fc;border-bottom:1px solid #1e293b;padding-bottom:6px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}}
.card{{display:flex;align-items:center;gap:12px;padding:11px 14px;background:#1e293b;border:1px solid #293548;border-radius:11px;text-decoration:none;color:#e2e8f0;transition:.15s}}
.card:hover{{transform:translateY(-2px);border-color:#475569;background:#243042}}
.tag{{font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;color:#fff;flex-shrink:0;min-width:42px;text-align:center}}
.nm{{font-size:13px;word-break:break-word;line-height:1.3}}
.meta{{font-size:11px;opacity:.55;margin-top:2px}}
.empty{{opacity:.5;padding:40px;text-align:center}}
footer{{position:fixed;bottom:0;left:0;right:0;background:#0f172af2;border-top:1px solid #1e293b;padding:7px 26px;font-size:11px;opacity:.7}}
</style></head><body>
<header><h1>🛰️ PANEL PROYECTO AURIXA</h1>
<div class="sub">Plataforma de Telemetría y Automatización Minera IA — explorador documental · {len(items)} archivos · generado {gen}</div></header>
<div class="bar">
  <input id="q" placeholder="🔍 Buscar por nombre o carpeta…" oninput="render()" autofocus>
  <div class="chips">{chips}</div>
</div>
<main id="out"></main>
<footer>Doble clic en cualquier tarjeta abre el archivo. Para ejecutar scripts .py usa <b>PANEL_SCRIPTS.hta</b>. Regenerar: <code>generar_paneles.py</code></footer>
<script>
const DATA={data};
const COLORS={color_map};
let active=new Set();
function toggle(el){{const t=el.dataset.t;if(active.has(t)){{active.delete(t);el.classList.remove('on')}}else{{active.add(t);el.classList.add('on')}}render()}}
function render(){{
  const q=document.getElementById('q').value.toLowerCase();
  let rows=DATA.filter(d=>(active.size===0||active.has(d.type))&&(d.name.toLowerCase().includes(q)||d.folder.toLowerCase().includes(q)));
  const out=document.getElementById('out');
  if(!rows.length){{out.innerHTML='<div class="empty">Sin resultados.</div>';return}}
  let byF={{}};rows.forEach(r=>{{(byF[r.folder]=byF[r.folder]||[]).push(r)}});
  let h='';
  Object.keys(byF).sort().forEach(f=>{{
    h+=`<div class="folder">📁 ${{f}} <span style="opacity:.5;font-weight:400">(${{byF[f].length}})</span></div><div class="grid">`;
    byF[f].forEach(r=>{{
      const c=COLORS[r.type]||'#555';
      h+=`<a class="card" href="${{r.rel}}" target="_blank"><span class="tag" style="background:${{c}}">${{r.type}}</span><div><div class="nm">${{r.name}}</div><div class="meta">${{r.mtime}} · ${{human(r.size)}}</div></div></a>`;
    }});
    h+='</div>';
  }});
  out.innerHTML=h;
}}
function human(n){{const u=['B','KB','MB','GB'];let i=0;while(n>=1024&&i<3){{n/=1024;i++}}return n.toFixed(i?1:0)+' '+u[i]}}
render();
</script></body></html>"""


def build_hta(py_scripts, python_exe):
    rows = ""
    for s in py_scripts:
        rel = s.replace("\\", "/")
        full = os.path.join(ROOT, s).replace("\\", "\\\\")
        folder = os.path.dirname(rel)
        name = os.path.basename(rel)
        rid = rel.replace("/", "_").replace(".", "_")
        rows += (
            f'<tr><td class="t">PY</td><td><b>{html.escape(name)}</b>'
            f'<div class="f">{html.escape(folder)}</div></td>'
            f'<td><button onclick="runScript(\'{full}\')">&#9654; Ejecutar</button> '
            f'<button class="sec" onclick="openFolder(\'{os.path.join(ROOT, folder).replace(chr(92), chr(92)*2)}\')">Carpeta</button></td></tr>\n'
        )
    pyexe = python_exe.replace("\\", "\\\\")
    root_esc = ROOT.replace("\\", "\\\\")
    gen = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    return f"""<!DOCTYPE html>
<html><head><title>PANEL SCRIPTS AURIXA</title>
<HTA:APPLICATION ID="aurixa" APPLICATIONNAME="PanelScriptsAurixa"
  BORDER="thin" INNERBORDER="no" SCROLL="yes" SINGLEINSTANCE="yes"
  MAXIMIZEBUTTON="yes" ICON="" />
<style>
body{{font-family:Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;margin:0}}
header{{padding:18px 24px;background:linear-gradient(135deg,#14532d,#0f766e)}}
h1{{margin:0;font-size:19px}}
.sub{{font-size:12px;opacity:.85;margin-top:3px}}
.wrap{{padding:18px 24px}}
input{{padding:8px 12px;width:340px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0}}
table{{width:100%;border-collapse:collapse;margin-top:14px}}
td{{padding:9px 10px;border-bottom:1px solid #1e293b;font-size:13px;vertical-align:middle}}
.t{{color:#16a34a;font-weight:800;width:40px}}
.f{{font-size:11px;opacity:.5}}
button{{background:#16a34a;color:#fff;border:0;padding:6px 12px;border-radius:7px;cursor:pointer;font-size:12px}}
button:hover{{background:#15803d}}
button.sec{{background:#334155}}
button.sec:hover{{background:#475569}}
#log{{margin-top:14px;font-size:12px;opacity:.7;min-height:18px}}
</style>
<script language="JScript">
var PYEXE="{pyexe}";
var ROOT="{root_esc}";
function runScript(p){{
  try{{
    var sh=new ActiveXObject("WScript.Shell");
    sh.CurrentDirectory=ROOT;
    sh.Run('cmd /k ""'+PYEXE+'" "'+p+'""',1,false);
    document.getElementById('log').innerHTML='Ejecutando: '+p;
  }}catch(e){{document.getElementById('log').innerHTML='Error: '+e.message;}}
}}
function openFolder(f){{
  try{{new ActiveXObject("WScript.Shell").Run('explorer "'+f+'"',1,false);}}catch(e){{}}
}}
function filt(){{
  var q=document.getElementById('q').value.toLowerCase();
  var rows=document.getElementById('tb').getElementsByTagName('tr');
  for(var i=0;i<rows.length;i++){{
    var tx=rows[i].innerText.toLowerCase();
    rows[i].style.display=(tx.indexOf(q)>-1)?'':'none';
  }}
}}
</script></head><body>
<header><h1>&#9881; PANEL SCRIPTS AURIXA</h1>
<div class="sub">Ejecuta los scripts Python de soporte con un clic &middot; {len(py_scripts)} scripts &middot; generado {gen}</div></header>
<div class="wrap">
<input id="q" placeholder="Buscar script..." onkeyup="filt()">
<table><tbody id="tb">
{rows}</tbody></table>
<div id="log"></div>
</div></body></html>"""


def main():
    items = scan()
    html_out = build_html(items)
    with open(os.path.join(ROOT, "PANEL_PROYECTO.html"), "w", encoding="utf-8") as f:
        f.write(html_out)

    py_scripts = [it["rel"] for it in items
                  if it["rel"].endswith(".py")
                  and ("soporte_mantenimiento/scripts_python" in it["rel"] or it["rel"].startswith("scripts/"))]
    python_exe = os.path.join(ROOT, ".venv", "Scripts", "python.exe")
    if not os.path.exists(python_exe):
        python_exe = "python"
    hta_out = build_hta(sorted(py_scripts), python_exe)
    with open(os.path.join(ROOT, "PANEL_SCRIPTS.hta"), "w", encoding="utf-8") as f:
        f.write(hta_out)

    print(f"OK PANEL_PROYECTO.html  ({len(items)} archivos)")
    print(f"OK PANEL_SCRIPTS.hta    ({len(py_scripts)} scripts .py)")


if __name__ == "__main__":
    main()
