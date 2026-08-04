import xml.etree.ElementTree as ET
import datetime

tasks_data = [
    {"uid": 1, "id": 1, "name": "1. Análisis y Diseño", "level": 1, "duration": 0, "preds": [], "summary": 1},
    {"uid": 2, "id": 2, "name": "Análisis de Requisitos y Scope", "level": 2, "duration": 8, "preds": [], "summary": 0, "res": ["ARQ"]},
    {"uid": 3, "id": 3, "name": "Arquitectura & Modelado BDD", "level": 2, "duration": 8, "preds": [2], "summary": 0, "res": ["ARQ", "DBA"]},
    {"uid": 4, "id": 4, "name": "Diseño UX / Gráfico de Web", "level": 2, "duration": 10, "preds": [2], "summary": 0, "res": ["UX"]},
    {"uid": 5, "id": 5, "name": "Diseño Mockups iOS & Android", "level": 2, "duration": 8, "preds": [4], "summary": 0, "res": ["MOB"]},
    
    {"uid": 6, "id": 6, "name": "2. Insumos Base e Infra", "level": 1, "duration": 0, "preds": [], "summary": 1},
    {"uid": 7, "id": 7, "name": "Aprovisionamiento AWS/Cloud", "level": 2, "duration": 7, "preds": [3], "summary": 0, "res": ["CLD"]},
    {"uid": 8, "id": 8, "name": "Implementación Fisica Postgres", "level": 2, "duration": 7, "preds": [3], "summary": 0, "res": ["DBA"]},
    {"uid": 9, "id": 9, "name": "ETLs de Ingesta desde Legacy", "level": 2, "duration": 10, "preds": [8], "summary": 0, "res": ["DBA"]},
    
    {"uid": 10, "id": 10, "name": "3. Implementación Back & I.A", "level": 1, "duration": 0, "preds": [], "summary": 1},
    {"uid": 11, "id": 11, "name": "C++ Boost Framework y Sockets", "level": 2, "duration": 15, "preds": [7], "summary": 0, "res": ["BE1"]},
    {"uid": 12, "id": 12, "name": "APIs Biometría Python y NLP LLaMa", "level": 2, "duration": 15, "preds": [7], "summary": 0, "res": ["BE2"]},
    {"uid": 13, "id": 13, "name": "Integración C++ con Machine Learn", "level": 2, "duration": 10, "preds": [11, 12], "summary": 0, "res": ["BE1", "BE2"]},
    
    {"uid": 14, "id": 14, "name": "4. Implementación Front", "level": 1, "duration": 0, "preds": [], "summary": 1},
    {"uid": 15, "id": 15, "name": "Auth - Rutas y ReportStudio Web", "level": 2, "duration": 14, "preds": [4], "summary": 0, "res": ["FE1"]},
    {"uid": 16, "id": 16, "name": "Mapas IoT - CCTV y Dashboards", "level": 2, "duration": 14, "preds": [4], "summary": 0, "res": ["FE2"]},
    {"uid": 17, "id": 17, "name": "Desarrollo Código Android/iOS", "level": 2, "duration": 15, "preds": [5], "summary": 0, "res": ["MOB"]},
    {"uid": 18, "id": 18, "name": "Sincronización Web-Móvil APIs", "level": 2, "duration": 10, "preds": [13], "summary": 0, "res": ["ARQ", "BE1", "BE2", "FE1", "FE2", "MOB"]},
    
    {"uid": 19, "id": 19, "name": "5. QA y Pruebas", "level": 1, "duration": 0, "preds": [], "summary": 1},
    {"uid": 20, "id": 20, "name": "Pruebas Unitarias de Código API", "level": 2, "duration": 7, "preds": [13], "summary": 0, "res": ["QA"]},
    {"uid": 21, "id": 21, "name": "Pruebas Funcionales Web e Imp.", "level": 2, "duration": 7, "preds": [18], "summary": 0, "res": ["QA"]},
    {"uid": 22, "id": 22, "name": "Pruebas Stress y Liveness C.", "level": 2, "duration": 5, "preds": [21], "summary": 0, "res": ["QA", "CLD"]},
    {"uid": 23, "id": 23, "name": "Manuales y Documentación Final", "level": 2, "duration": 5, "preds": [22], "summary": 0, "res": ["QA", "ARQ"]},
    
    {"uid": 24, "id": 24, "name": "6. Pase A Producción", "level": 1, "duration": 0, "preds": [], "summary": 1},
    {"uid": 25, "id": 25, "name": "Pase Ambiente Certificación", "level": 2, "duration": 5, "preds": [22], "summary": 0, "res": ["CLD"]},
    {"uid": 26, "id": 26, "name": "Firma / Certificación Minera", "level": 2, "duration": 3, "preds": [25], "summary": 0, "res": ["ARQ", "Directorio"]},
    {"uid": 27, "id": 27, "name": "Marcha Blanca (Test Real Ops)", "level": 2, "duration": 10, "preds": [26], "summary": 0, "res": ["ARQ", "BE1", "BE2", "FE1", "FE2", "DBA", "UX", "MOB", "QA", "CLD"]},
    {"uid": 28, "id": 28, "name": "Lanzamiento Global LATAM", "level": 2, "duration": 2, "preds": [27], "summary": 0, "res": ["ARQ"]}
]

resources = ["ARQ", "BE1", "BE2", "FE1", "FE2", "DBA", "UX", "MOB", "QA", "CLD", "Directorio"]
res_map = {res: i+1 for i, res in enumerate(resources)}

xml_doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
xml_doc += '<Project xmlns="http://schemas.microsoft.com/project">\n'
xml_doc += '  <Title>Cronograma Proyecto Minero</Title>\n'
xml_doc += '  <StartDate>2026-04-20T08:00:00</StartDate>\n'
xml_doc += '  <MinutesPerDay>480</MinutesPerDay>\n'
xml_doc += '  <MinutesPerWeek>2400</MinutesPerWeek>\n'
xml_doc += '  <DaysPerMonth>20</DaysPerMonth>\n'

xml_doc += '  <Tasks>\n'
for t in tasks_data:
    xml_doc += f'    <Task>\n'
    xml_doc += f'      <UID>{t["uid"]}</UID>\n'
    xml_doc += f'      <ID>{t["id"]}</ID>\n'
    xml_doc += f'      <Name>{t["name"]}</Name>\n'
    xml_doc += f'      <OutlineLevel>{t["level"]}</OutlineLevel>\n'
    xml_doc += f'      <Summary>{t["summary"]}</Summary>\n'
    if t["summary"] == 0:
        minutes = t["duration"] * 480
        xml_doc += f'      <Duration>PT{t["duration"] * 8}H0M0S</Duration>\n'
        xml_doc += f'      <DurationFormat>5</DurationFormat>\n'
    for p in t["preds"]:
        xml_doc += f'      <PredecessorLink>\n'
        xml_doc += f'        <PredecessorUID>{p}</PredecessorUID>\n'
        xml_doc += f'      </PredecessorLink>\n'
    xml_doc += f'    </Task>\n'
xml_doc += '  </Tasks>\n'

xml_doc += '  <Resources>\n'
for res, uid in res_map.items():
    xml_doc += f'    <Resource>\n'
    xml_doc += f'      <UID>{uid}</UID>\n'
    xml_doc += f'      <ID>{uid}</ID>\n'
    xml_doc += f'      <Name>{res}</Name>\n'
    xml_doc += f'      <Type>1</Type>\n'
    xml_doc += f'    </Resource>\n'
xml_doc += '  </Resources>\n'

xml_doc += '  <Assignments>\n'
assn_uid = 1
for t in tasks_data:
    if "res" in t:
        for r_name in t["res"]:
            r_uid = res_map[r_name]
            xml_doc += f'    <Assignment>\n'
            xml_doc += f'      <UID>{assn_uid}</UID>\n'
            xml_doc += f'      <TaskUID>{t["uid"]}</TaskUID>\n'
            xml_doc += f'      <ResourceUID>{r_uid}</ResourceUID>\n'
            xml_doc += f'      <Units>1</Units>\n'
            xml_doc += f'    </Assignment>\n'
            assn_uid += 1
xml_doc += '  </Assignments>\n'

xml_doc += '</Project>\n'

with open(r'c:\InformeCliente\docs\Cronograma_Minero.xml', 'w', encoding='utf-8') as f:
    f.write(xml_doc)
