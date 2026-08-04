# -*- coding: utf-8 -*-
"""
Genera API_AURIXA.html: documentación navegable de las APIs de la plataforma
(backend C++, formula_engine, ai_engine) para compartir con el equipo.

Buscador + filtros por servicio y por método. Reejecutable:
  .venv\\Scripts\\python.exe soporte_mantenimiento\\scripts_python\\generar_api_docs.py
"""
import os
import html
import json
import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# servicio, puerto
SERVICES = {
    "backend":  "Backend C++ · 8081/8443",
    "formula":  "Formula Engine · 8020",
    "ai":       "AI Engine (Python) · 5000",
}

# E = (servicio, dominio, método, ruta, propósito, params, respuesta)
E = [
 # ---- backend: auth ----
 ("backend","Auth","GET","/api/auth/companies","Listar empresas activas","—","{companies:[]}"),
 ("backend","Auth","GET","/api/auth/login/check-identity","Verificar existencia de identidad","?company&identity","{ok,username}"),
 ("backend","Auth","POST","/api/auth/login/check-identity","Verificar identidad (body)","{company,identity}","{ok,username}"),
 ("backend","Auth","GET","/api/auth/validate-company","Validar RUC de empresa","?company&ruc","{valid}"),
 ("backend","Auth","GET","/api/auth/users","Listar usuarios de empresa (sesión)","?company","{users:[]}"),
 ("backend","Auth","POST","/api/auth/users/maintenance","Operación de mantenimiento de usuarios","{payload}","{status,audit}"),
 ("backend","Auth","GET","/api/auth/users/maintenance/audit","Auditoría de mantenimiento","?company&page","{logs:[]}"),
 ("backend","Auth","POST","/api/auth/register","Registrar usuario con biometría","{company,dni,username,password,face_*}","201 {user}"),
 ("backend","Auth","POST","/api/auth/login/password","Login con contraseña","{company,username,password}","{authenticated,user}"),
 ("backend","Auth","POST","/api/auth/login/face","Login con biometría facial","{company,face_*,username}","{authenticated,score,user}"),
 ("backend","Auth","GET","/api/auth/audit","Auditoría de accesos (admin)","?page&company&action","{logs,total,pages}"),
 ("backend","Auth","GET","/api/auth/audit/export.csv","Exportar auditoría CSV (admin)","?company&action","CSV"),
 # ---- backend: biometric ----
 ("backend","Biometría","GET","/api/auth/biometric/status","Estado del motor biométrico","—","{provider,dnn}"),
 ("backend","Biometría","POST","/api/auth/biometric/verify-frame","Verificar fotograma facial","{face_image_base64}","{ok,issues,quality_score}"),
 ("backend","Biometría","POST","/api/process_frame","Procesar fotograma de captura","JPEG","{ok,state}"),
 ("backend","Biometría","GET","/api/status","Estado de captura en vivo","—","{state,icao,liveness_score}"),
 ("backend","Biometría","GET","/api/reset_capture","Resetear captura biométrica","—","{status:reset}"),
 ("backend","Biometría","GET","/api/captured_images","Imágenes capturadas (sesión)","—","[base64]"),
 # ---- backend: mining/telemetría ----
 ("backend","Minería/KPIs","GET","/api/dashboard/metrics","KPIs y heatmap del dashboard","—","{kpis,heatmap}"),
 ("backend","Minería/KPIs","GET","/api/config/mining-locations","Coordenadas GPS de minas","—","[{company,lat,lng,zoom}]"),
 ("backend","Minería/KPIs","GET","/api/mining/kpis","Obtener KPIs de minería","—","[kpi]"),
 ("backend","Minería/KPIs","POST","/api/mining/kpis/upsert","Upsert de KPI","{kpi}","{status}"),
 ("backend","Minería/KPIs","POST","/api/mining/kpis/sync-from-dashboard","Sincronizar KPIs desde dashboard","—","{synced}"),
 ("backend","Minería/KPIs","POST","/api/mining/kpis/sync-from-external","Sincronizar KPIs externos","—","{synced}"),
 ("backend","Minería/KPIs","GET","/api/mining/kpis/points","Puntos históricos de KPI","?kpi_id&start&end","[{ts,value}]"),
 ("backend","Telemetría","GET","/api/sensors/data","Datos de sensores (tenant scoped)","?sensor_id&limit","[{sensor_id,reading,ts}]"),
 ("backend","Vigilancia","GET","/api/surveillance/cameras","Listar cámaras CCTV","—","[{id,name,status}]"),
 ("backend","Vigilancia","GET","/api/surveillance/camera-snapshot","Snapshot de cámara","?camera_id","JPEG"),
 # ---- backend: reports ----
 ("backend","Reportes","GET","/api/projects","Listar proyectos","—","{projects:[]}"),
 ("backend","Reportes","GET","/api/reports","Listar informes","—","{reports:[]}"),
 ("backend","Reportes","GET","/api/reports/{id}","Obtener informe por ID","—","{id,title,content_json,status}"),
 ("backend","Reportes","POST","/api/reports","Crear informe","{title,content_json}","201 {id}"),
 ("backend","Reportes","PUT","/api/reports/{id}","Actualizar informe (autosave)","{title,content_json}","{updated}"),
 ("backend","Reportes","DELETE","/api/reports/{id}","Eliminar informe","—","{deleted}"),
 # ---- backend: formula/analysis ----
 ("backend","Fórmulas","GET","/api/formula/dictionary","Diccionario de variables","—","{items:[...]}"),
 ("backend","Fórmulas","GET","/api/analysis/catalogos","Catálogo empresas/minas/sensores","—","{rows,usuarios}"),
 ("backend","Fórmulas","POST","/api/analysis/temperaturas","Análisis térmico por rango","{mina_id,sensor_id,fecha_*}","{rows,summary}"),
 # ---- backend: map/GIS ----
 ("backend","Mapas/GIS","GET","/api/map/markers","Marcadores del mapa","—","{markers:[...]}"),
 ("backend","Mapas/GIS","GET","/api/map/official-zones","Zonas oficiales (GeoJSON)","—","FeatureCollection"),
 ("backend","Mapas/GIS","GET","/api/map/compliance-intersections","Intersecciones de cumplimiento","—","{zones_loaded,intersections}"),
 # ---- backend: gdal ----
 ("backend","GDAL","GET","/api/capabilities","Capacidades GDAL","—","{ecw_supported}"),
 ("backend","GDAL","GET","/api/demo-data","Datos demo (testigos)","—","{assets}"),
 ("backend","GDAL","GET","/api/demo-image/{id}","Imagen demo","—","JPEG"),
 ("backend","GDAL","POST","/api/convert","Convertir raster (async)","{input_format,output_format,source_path}","202 {job_id}"),
 ("backend","GDAL","GET","/api/jobs/{id}","Estado de job de conversión","—","{id,status,logs}"),
 ("backend","GDAL","POST","/api/analyze-core","Analizar testigo de perforación","{image_path}","{fractures,rqd}"),
 ("backend","GDAL","GET","/health","Health check","—","{status,cartoon_onnx_linked}"),
 # ---- backend: text ----
 ("backend","Texto","POST","/api/text/correct/quick","Corrección ortográfica rápida","{text}","{corrected}"),
 ("backend","Texto","POST","/api/text/correct/advanced","Corrección avanzada (LanguageTool)","{text}","{corrected,issues}"),
 ("backend","Texto","POST","/api/text/rewrite","Reescritura (Ollama)","{text,style}","{rewritten}"),
 ("backend","Texto","POST","/api/text/languagetool-check","Verificación LanguageTool","{text}","{matches}"),
 # ---- backend: platform ----
 ("backend","Plataforma","GET","/api/platform/countries","Países LATAM","—","{countries:[...]}"),
 ("backend","Plataforma","GET","/api/platform/ui-languages","Idiomas de UI","—","{languages:[...]}"),
 ("backend","Legacy","GET","/api/users","Usuarios legados (facial)","—","[{id,name,confidence}]"),
 ("backend","Legacy","POST","/api/enroll","Enrolamiento biométrico legado","{empresa,nombre}","{userId}"),
 # ---- formula_engine ----
 ("formula","Diagrama","GET","/api/state","Estado del diagrama (multitenant)","?diagram_id","{blocks,connections}"),
 ("formula","Diagrama","POST","/api/block","Crear/actualizar bloque","{id,x,y,label,diagram_id}","{ok}"),
 ("formula","Diagrama","POST","/api/block/delete","Eliminar bloque","{id}","{ok}"),
 ("formula","Diagrama","POST","/api/connection","Crear conexión","{from,to,diagram_id}","{ok}"),
 ("formula","Diagrama","POST","/api/connection/update","Actualizar conexión","{id,meta}","{ok}"),
 ("formula","Diagrama","POST","/api/connection/delete","Eliminar conexión","{id}","{ok}"),
 ("formula","Reglas","GET","/api/rules","Listar reglas","?block_id","[{id,expr}]"),
 ("formula","Reglas","POST","/api/rule","Crear/actualizar regla","{block_id,expr}","{ok,id}"),
 ("formula","Reglas","POST","/api/rule/delete","Eliminar regla","{id}","{ok}"),
 ("formula","Catálogos","GET","/api/catalogos","Empresas y minas","—","{empresas,minas}"),
 ("formula","Catálogos","GET","/api/sensores","Sensores de una mina","?mina_id","[{id,codigo,variable_id}]"),
 ("formula","Catálogos","GET","/api/analysis/catalogos","Catálogo completo","—","[...]"),
 ("formula","Análisis","POST","/api/analysis/temperaturas","SP térmico por rango","{empresa_id,mina_id,fecha_*}","{count,rows}"),
 ("formula","Sesiones","POST","/api/analysis/guardar","Guardar sesión (snapshot)","{usuario,formula_json,gps_*}","{ok,id}"),
 ("formula","Sesiones","GET","/api/analysis/sesiones","Listar sesiones","?empresa_id&limit&page","{total,sesiones}"),
 ("formula","Sesiones","GET","/api/analysis/sesiones/{id}","Obtener sesión completa","—","{id,formula_json}"),
 ("formula","Sesiones","POST","/api/analysis/sesiones/{id}/restaurar","Restaurar diagrama","—","{ok}"),
 ("formula","Datos","GET","/api/variables","Variables del diccionario","—","[{id,name,unit}]"),
 ("formula","Datos","GET","/api/operators","Operadores","—","[{symbol,category}]"),
 ("formula","Datos","GET","/api/render","Render PNG del diagrama (cache 2s)","—","PNG"),
 ("formula","WebSocket","WS","/ws","Canal en vivo (ping/heartbeat/broadcast)","?token / Bearer","JSON eventos"),
 # ---- ai_engine ----
 ("ai","Visión","POST","/analyze_eyes","Análisis ojos/boca/lentes","image (JPEG)","{detected,ear,glasses_score}"),
 ("ai","Visión","POST","/cartoon_avatar","Avatar cartoon","JPEG","{image_base64}"),
 ("ai","Visión","POST","/face_embedding","Embedding facial (InsightFace)","JPEG","{embedding[512]}"),
 ("ai","Visión","GET","/health","Health del motor IA","—","{status,model}"),
 ("ai","Visión","GET","/glasses_debug","Debug del último análisis de gafas","—","{...}"),
]

METHOD_COLORS = {"GET":"#16a34a","POST":"#2563eb","PUT":"#d97706","DELETE":"#dc2626","WS":"#7c3aed"}
SVC_COLORS = {"backend":"#0ea5e9","formula":"#a855f7","ai":"#16a34a"}


def build():
    rows = [{"svc":s,"dom":d,"method":m,"path":p,"purpose":pu,"params":pa,"resp":r}
            for (s,d,m,p,pu,pa,r) in E]
    data = json.dumps(rows, ensure_ascii=False)
    svc_count = {k: sum(1 for x in rows if x["svc"]==k) for k in SERVICES}
    gen = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    svc_chips = "".join(
        f'<span class="chip" data-k="svc" data-v="{k}" style="--c:{SVC_COLORS[k]}" onclick="tog(this)">'
        f'{html.escape(SERVICES[k])} <b>{svc_count[k]}</b></span>' for k in SERVICES)
    meth_chips = "".join(
        f'<span class="chip" data-k="method" data-v="{m}" style="--c:{c}" onclick="tog(this)">{m}</span>'
        for m,c in METHOD_COLORS.items())
    mcolors = json.dumps(METHOD_COLORS); scolors = json.dumps(SVC_COLORS)
    snames = json.dumps(SERVICES, ensure_ascii=False)
    return f"""<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>API AURIXA · Documentación</title>
<style>
*{{box-sizing:border-box}} body{{margin:0;font-family:Segoe UI,Roboto,system-ui,sans-serif;background:#0f172a;color:#e2e8f0}}
header{{padding:22px 26px;background:linear-gradient(135deg,#0c4a6e,#155e75);box-shadow:0 2px 14px #0008}}
h1{{margin:0;font-size:22px}} .sub{{opacity:.85;font-size:13px;margin-top:4px}}
.bar{{position:sticky;top:0;z-index:5;background:#0f172afa;backdrop-filter:blur(6px);padding:14px 26px;border-bottom:1px solid #1e293b}}
#q{{width:100%;max-width:520px;padding:10px 14px;border-radius:10px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;font-size:15px}}
.chips{{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px}}
.chip{{cursor:pointer;user-select:none;padding:5px 12px;border-radius:20px;font-size:12px;border:1px solid var(--c);color:#fff;background:transparent}}
.chip.on{{background:var(--c)}} .chip b{{opacity:.8}}
main{{padding:18px 26px 70px}}
.dom{{margin:22px 0 8px;font-size:14px;font-weight:700;color:#7dd3fc;border-bottom:1px solid #1e293b;padding-bottom:6px}}
.ep{{display:grid;grid-template-columns:64px 1fr;gap:12px;padding:11px 14px;background:#1e293b;border:1px solid #293548;border-radius:11px;margin:7px 0}}
.m{{font-size:11px;font-weight:800;padding:4px 0;border-radius:6px;color:#fff;text-align:center;height:fit-content}}
.path{{font-family:Consolas,monospace;font-size:13px;color:#e2e8f0;word-break:break-all}}
.pur{{font-size:12px;opacity:.8;margin-top:3px}}
.meta{{font-size:11px;opacity:.6;margin-top:4px;display:flex;gap:18px;flex-wrap:wrap}}
.meta code{{background:#0f172a;padding:1px 6px;border-radius:4px}}
.svc{{font-size:10px;padding:1px 7px;border-radius:5px;color:#fff;margin-left:8px;vertical-align:middle}}
footer{{position:fixed;bottom:0;left:0;right:0;background:#0f172af2;border-top:1px solid #1e293b;padding:7px 26px;font-size:11px;opacity:.7}}
.empty{{opacity:.5;padding:40px;text-align:center}}
</style></head><body>
<header><h1>🛰️ API AURIXA — Documentación para el equipo</h1>
<div class="sub">{len(rows)} endpoints · 3 servicios · generado {gen}</div></header>
<div class="bar"><input id="q" placeholder="🔍 Buscar ruta, dominio o propósito…" oninput="render()" autofocus>
<div class="chips">{svc_chips}<span style="width:14px"></span>{meth_chips}</div></div>
<main id="out"></main>
<footer>Filtra por servicio y método. Regenerar: <code>generar_api_docs.py</code>. Servicios: Backend C++ (8081/8443) · Formula (8020) · AI (5000)</footer>
<script>
const DATA={data}, MC={mcolors}, SC={scolors}, SN={snames};
let f={{svc:new Set(),method:new Set()}};
function tog(el){{const k=el.dataset.k,v=el.dataset.v;f[k].has(v)?f[k].delete(v):f[k].add(v);el.classList.toggle('on');render()}}
function render(){{
 const q=document.getElementById('q').value.toLowerCase();
 let rows=DATA.filter(d=>(f.svc.size===0||f.svc.has(d.svc))&&(f.method.size===0||f.method.has(d.method))
   &&(d.path.toLowerCase().includes(q)||d.dom.toLowerCase().includes(q)||d.purpose.toLowerCase().includes(q)));
 const out=document.getElementById('out');
 if(!rows.length){{out.innerHTML='<div class="empty">Sin resultados.</div>';return}}
 let by={{}};rows.forEach(r=>{{(by[r.dom]=by[r.dom]||[]).push(r)}});
 let h='';Object.keys(by).sort().forEach(dom=>{{
  h+=`<div class="dom">${{dom}} <span style="opacity:.5;font-weight:400">(${{by[dom].length}})</span></div>`;
  by[dom].forEach(r=>{{
   h+=`<div class="ep"><div class="m" style="background:${{MC[r.method]}}">${{r.method}}</div>
   <div><div class="path">${{r.path}}<span class="svc" style="background:${{SC[r.svc]}}">${{SN[r.svc].split(' · ')[0]}}</span></div>
   <div class="pur">${{r.purpose}}</div>
   <div class="meta"><span>params: <code>${{r.params}}</code></span><span>resp: <code>${{r.resp}}</code></span></div></div></div>`;
  }});
 }});
 out.innerHTML=h;
}}
render();
</script></body></html>"""


def main():
    out = os.path.join(ROOT, "API_AURIXA.html")
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print(f"OK API_AURIXA.html ({len(E)} endpoints)")


if __name__ == "__main__":
    main()
