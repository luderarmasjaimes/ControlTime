import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
import re, os

wb = openpyxl.Workbook()

# Styles
hdr_font = Font(name='Calibri', bold=True, size=14, color='FFFFFF')
sec_font = Font(name='Calibri', bold=True, size=12, color='FFFFFF')
sub_font = Font(name='Calibri', bold=True, size=11, color='1a1a2e')
tbl_font = Font(name='Calibri', bold=True, size=10, color='FFFFFF')
cell_font = Font(name='Calibri', size=10)
hdr_fill = PatternFill('solid', fgColor='1a1a2e')
sec_fill = PatternFill('solid', fgColor='2d6a4f')
sub_fill = PatternFill('solid', fgColor='d4edda')
tbl_fill = PatternFill('solid', fgColor='264653')
alt_fill1 = PatternFill('solid', fgColor='f0f4f8')
alt_fill2 = PatternFill('solid', fgColor='FFFFFF')
risk_fill = PatternFill('solid', fgColor='fff3cd')
ent_fill = PatternFill('solid', fgColor='d1ecf1')
thin = Side(style='thin', color='cccccc')
border = Border(top=thin, left=thin, right=thin, bottom=thin)
wrap = Alignment(wrap_text=True, vertical='center')

def parse_md(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def add_title(ws, row, title, cols=4):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=cols)
    c = ws.cell(row=row, column=1, value=title)
    c.font = hdr_font; c.fill = hdr_fill; c.alignment = Alignment(horizontal='center', vertical='center')
    ws.row_dimensions[row].height = 35
    return row + 2

def add_section(ws, row, title, cols=4):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=cols)
    c = ws.cell(row=row, column=1, value=title)
    c.font = sec_font; c.fill = sec_fill; c.alignment = Alignment(horizontal='left', vertical='center')
    ws.row_dimensions[row].height = 28
    return row + 1

def add_subsection(ws, row, title, cols=4):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=cols)
    c = ws.cell(row=row, column=1, value=title)
    c.font = sub_font; c.fill = sub_fill; c.alignment = Alignment(horizontal='left', vertical='center')
    ws.row_dimensions[row].height = 24
    return row + 1

def add_table_header(ws, row, headers):
    for i, h in enumerate(headers, 1):
        c = ws.cell(row=row, column=i, value=h)
        c.font = tbl_font; c.fill = tbl_fill; c.alignment = wrap; c.border = border
    ws.row_dimensions[row].height = 22
    return row + 1

def add_row(ws, row, values, alt=False):
    fill = alt_fill1 if alt else alt_fill2
    for i, v in enumerate(values, 1):
        c = ws.cell(row=row, column=i, value=v)
        c.font = cell_font; c.fill = fill; c.alignment = wrap; c.border = border
    ws.row_dimensions[row].height = 20
    return row + 1

def add_note(ws, row, text, cols=4, fill=None):
    ws.merge_cells(start_row=row, start_column=1, end_row=row, end_column=cols)
    c = ws.cell(row=row, column=1, value=text)
    c.font = Font(name='Calibri', italic=True, size=10, color='555555')
    if fill: c.fill = fill
    c.alignment = wrap; c.border = border
    ws.row_dimensions[row].height = 20
    return row + 1

def add_matrix_table(ws, row, headers, rows, fill=None):
    for ci, header in enumerate(headers, 1):
        c = ws.cell(row=row, column=ci, value=header)
        c.font = tbl_font
        c.fill = tbl_fill
        c.alignment = wrap
        c.border = border
    row += 1

    body_fill = fill or alt_fill2
    for row_data in rows:
        for ci, value in enumerate(row_data, 1):
            c = ws.cell(row=row, column=ci, value=value)
            c.font = cell_font
            c.fill = body_fill
            c.alignment = wrap
            c.border = border
        row += 1
    return row

def finalize_sheet(ws, freeze_cell='A5'):
    max_col = max(1, ws.max_column)
    max_row = max(1, ws.max_row)
    ws.freeze_panes = freeze_cell
    ws.sheet_view.zoomScale = 90
    ws.sheet_view.showGridLines = False
    ws.auto_filter.ref = f'A1:{get_column_letter(max_col)}{max_row}'
    ws.page_setup.orientation = 'landscape'
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.print_title_rows = '$1:$4'
    ws.page_margins.left = 0.25
    ws.page_margins.right = 0.25
    ws.page_margins.top = 0.4
    ws.page_margins.bottom = 0.4
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    return ws

def extract_tables(text):
    """Extract markdown tables as list of (headers, rows)"""
    tables = []
    lines = text.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith('|') and i+1 < len(lines) and '---' in lines[i+1]:
            headers = [c.strip().replace('**','') for c in line.split('|')[1:-1]]
            i += 2  # skip separator
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                vals = [c.strip().replace('**','') for c in lines[i].split('|')[1:-1]]
                rows.append(vals)
                i += 1
            tables.append((headers, rows))
        else:
            i += 1
    return tables

# ===== ETAPA 1 =====
ws1 = wb.active
ws1.title = "ETAPA1"
ws1.sheet_properties.tabColor = '2d6a4f'

# Column widths
ws1.column_dimensions['A'].width = 8
ws1.column_dimensions['B'].width = 70
ws1.column_dimensions['C'].width = 10
ws1.column_dimensions['D'].width = 18
ws1.column_dimensions['E'].width = 22
ws1.column_dimensions['F'].width = 18
ws1.column_dimensions['G'].width = 18
ws1.column_dimensions['H'].width = 18

md1 = parse_md(r'c:\InformeCliente\etapa1_funcionalidad_core.md')
tables1 = extract_tables(md1)

stage1_risks = [
    ['Dependencia de base externa en AWS para extraer datos', 'Puede retrasar pruebas integrales y estabilizacion del flujo de datos.', 'Alta', 'Ventanas de extraccion inestables o cambios no coordinados en el esquema.', 'Acordar contrato de datos, validar conectores desde el mes 1 y mantener ambiente de pruebas con datos representativos.', 'ARQ + BE3', 'Usar dataset de contingencia para pruebas y desacoplar integraciones no criticas mientras se normaliza la fuente.'],
    ['Demora en provisionamiento de VPS Linux y seguridad base', 'Afecta el inicio de desarrollo e integracion temprana.', 'Alta', 'Pendientes de firewall, VPN o certificados sin cerrar en semanas 1 y 2.', 'Definir checklist de infraestructura, responsables y validacion tecnica ejecutiva antes de iniciar desarrollo intensivo.', 'SYS + ARQ', 'Priorizar ambiente minimo viable seguro para habilitar desarrollo e integracion progresiva.'],
    ['Resistencia de usuarios al reemplazo del flujo actual de informes', 'Impacta adopcion y velocidad de salida a valor.', 'Media', 'Observaciones recurrentes sobre usabilidad o preferencia por herramientas actuales.', 'Diseñar experiencia tipo Office, incorporar revisiones tempranas con gerencia y ajustar plantillas desde el mes 3.', 'FE1 + ARQ', 'Activar demos ejecutivas y plan de ajustes rapidos sobre componentes de mayor friccion.'],
    ['Sobrecarga del equipo backend en integracion + editor + sensores', 'Puede degradar calidad y afectar hitos de meses 2 a 4.', 'Alta', 'Retrasos simultaneos en tareas de motor, integracion y exportacion documental.', 'Rebalancear carga con FE y SYS, priorizar camino critico y revisar ocupacion semanal en comite de proyecto.', 'ARQ + BE1', 'Reasignar paquetes de soporte y congelar cambios no criticos hasta recuperar el camino critico.'],
    ['Desempeno insuficiente en captura y visualizacion de sensores', 'Compromete confianza en tableros y alarmas.', 'Alta', 'Latencias mayores a las metas o pruebas de carga fallidas.', 'Ejecutar pruebas progresivas desde el mes 1, afinar almacenamiento y mensajeria antes de QA final.', 'BE1 + SYS', 'Ajustar almacenamiento, colas y consultas; escalar capacidad de VPS antes de pasar a QA final.'],
]

stage1_deliverables = [
    ['Arquitectura y gobierno de solucion aprobados', 'Planificacion y arquitectura', 'Modelo VPS Linux Lima, lineamientos de servicio, seguridad y dependencias validados.', 'Cierre Mes 1', 'ARQ'],
    ['SOW y mapa de dependencias operativas', 'Gobierno del proyecto', 'Alcance, responsables, hitos y supuestos formalizados para direccion y equipo.', 'Cierre Mes 1', 'ARQ'],
    ['Editor maestro tipo Word para informes mineros', 'Frontend core', 'Edicion rica con estilos, tablas, caratulas e indice automatico.', 'Cierre Mes 3', 'FE1'],
    ['Modelo de datos e integracion con historicos', 'Integracion de datos', 'Esquema local y conectores controlados para consumir datos de la plataforma actual.', 'Cierre Mes 2', 'BE3'],
    ['Motor central y servicios base del negocio', 'Backend core', 'Captura de eventos, trazabilidad, guardado automatico y versionado documental.', 'Cierre Mes 2', 'BE1'],
    ['Tablero gerencial y monitoreo en tiempo real', 'Visualizacion y sensores', 'KPIs, alarmas y vista GIS operativa para seguimiento ejecutivo.', 'Cierre Mes 3', 'BE1 + FE2'],
    ['Exportacion documental de alta fidelidad', 'Documentos y salida', 'PDF, Word y PowerPoint listos para uso ejecutivo y tecnico.', 'Cierre Mes 4', 'BE2 + BE3'],
    ['Modo offline y reconciliacion controlada', 'Continuidad operativa', 'Edicion y resguardo temporal ante indisponibilidad de red o fuente externa.', 'Cierre Mes 4', 'FE1 + BE3'],
    ['Workflow de aprobacion y trazabilidad', 'Control y cumplimiento', 'Revision, aprobacion y bitacora de cambios para auditoria.', 'Cierre Mes 4', 'FE1'],
    ['QA funcional con evidencias de cierre', 'Calidad de etapa', 'Casos criticos ejecutados y observaciones priorizadas con evidencia.', 'Cierre Mes 4', 'QA'],
]

stage1_resource_plan = [
    ['ARQ', 'Gobierno, arquitectura y decisiones criticas', '100%', '55%', '40%', '50%', '61%', 'Conduce arquitectura, decisiones ejecutivas y control de calidad.'],
    ['BE1', 'Motor central, rendimiento e integracion de eventos', '60%', '100%', '100%', '100%', '90%', 'Rol critico del camino de datos; alta carga sostenida desde mes 2.'],
    ['BE2', 'Seguridad, IA local y automatizacion documental', '40%', '100%', '95%', '100%', '84%', 'Incrementa carga desde mes 2 para evitar cuello de botella al cierre.'],
    ['BE3', 'Integracion, notificaciones y continuidad de datos', '35%', '95%', '100%', '100%', '82%', 'Aumenta ocupacion para estabilizar la dependencia con la fuente externa.'],
    ['FE1', 'Editor principal, UX core y flujos de aprobacion', '70%', '35%', '100%', '100%', '76%', 'Carga distribuida para sostener diseno temprano y construccion fuerte desde mes 3.'],
    ['FE2', 'UX complementaria, plantillas y soporte gerencial', '35%', '30%', '100%', '100%', '66%', 'Se eleva desde mes 2 para maximizar adopcion, calidad visual y soporte gerencial.'],
    ['SYS', 'Infraestructura, seguridad y plataformas VPS', '95%', '55%', '45%', '70%', '66%', 'Alta carga temprana y cierre tecnico reforzado para rendimiento y continuidad.'],
    ['QA', 'Estrategia de pruebas y cierre funcional', '20%', '25%', '45%', '100%', '48%', 'Se incorpora de forma incremental para asegurar calidad sin desplazar el camino critico.'],
]

r = 1
r = add_title(ws1, r, 'ETAPA 1 — IMPLEMENTACION FUNCIONAL CORE (Meses 1-4 | Semanas 1-16 de 26)')
r = add_note(ws1, r, 'Base del cronograma: 26 semanas totales. La etapa 1 concentra definicion, construccion funcional, integracion con la base externa actual y validacion operativa del nucleo de la solucion en VPS Linux Lima.')

# Equipo
r = add_section(ws1, r, 'EQUIPO Y ROLES')
if tables1:
    r = add_table_header(ws1, r, tables1[0][0])
    for idx, row_data in enumerate(tables1[0][1]):
        r = add_row(ws1, r, row_data, idx % 2 == 0)
r += 1

# Mes 1
r = add_section(ws1, r, 'MES 1 — ANALISIS, ARQUITECTURA Y ALISTAMIENTO (S1-S4)')
if len(tables1) > 1:
    r = add_table_header(ws1, r, tables1[1][0])
    for idx, row_data in enumerate(tables1[1][1]):
        r = add_row(ws1, r, row_data, idx % 2 == 0)
r = add_note(ws1, r, 'Utilizacion S1-S4: ARQ 100% | BE1 60% | BE2 40% | BE3 35% | FE1 70% | FE2 35% | SYS 95% | QA 20%')
r = add_note(ws1, r, 'Objetivo ejecutivo del mes: dejar resueltas las decisiones de arquitectura, seguridad, integracion externa y base operativa de infraestructura en Lima.')
r += 1

# Mes 2
r = add_section(ws1, r, 'MES 2 — MOTOR CENTRAL, SEGURIDAD Y SERVICIOS DE NEGOCIO (S5-S8)')
if len(tables1) > 2:
    r = add_table_header(ws1, r, tables1[2][0])
    for idx, row_data in enumerate(tables1[2][1]):
        r = add_row(ws1, r, row_data, idx % 2 == 0)
r = add_note(ws1, r, 'Utilizacion S5-S8: BE1 100% | BE2 100% | BE3 95% | FE1 35% | FE2 30% | ARQ 55% | SYS 55% | QA 25%')
r = add_note(ws1, r, 'Objetivo ejecutivo del mes: consolidar seguridad, trazabilidad, mensajeria y servicios base para soportar el editor y la lectura de sensores.')
r += 1

# Mes 3
r = add_section(ws1, r, 'MES 3 — EXPERIENCIA DE USUARIO, SENSORES Y VISUALIZACION GERENCIAL (S9-S12)')
if len(tables1) > 3:
    r = add_table_header(ws1, r, tables1[3][0])
    for idx, row_data in enumerate(tables1[3][1]):
        r = add_row(ws1, r, row_data, idx % 2 == 0)
r = add_note(ws1, r, 'Utilizacion S9-S12: FE1 100% | FE2 100% | BE1 100% | BE2 95% | BE3 100% | ARQ 40% | SYS 45% | QA 45%')
r = add_note(ws1, r, 'Objetivo ejecutivo del mes: materializar la experiencia tipo Office, el tablero gerencial y la lectura de sensores con soporte GIS en un flujo entendible para negocio.')
r += 1

# Mes 4
r = add_section(ws1, r, 'MES 4 — INTEGRACION FINAL, IA LOCAL Y QA DE ETAPA 1 (S13-S16)')
if len(tables1) > 4:
    r = add_table_header(ws1, r, tables1[4][0])
    for idx, row_data in enumerate(tables1[4][1]):
        r = add_row(ws1, r, row_data, idx % 2 == 0)
r = add_note(ws1, r, 'Utilizacion S13-S16: BE1 100% | BE2 100% | BE3 100% | FE1 100% | FE2 100% | QA 100% | SYS 70% | ARQ 50%')
r = add_note(ws1, r, 'Objetivo ejecutivo del mes: cerrar integracion documental, IA local, conectividad con historicos y pruebas funcionales para habilitar el hardening de la etapa 2.')
r += 1

# Riesgos E1
r = add_section(ws1, r, 'RIESGOS ETAPA 1', 5)
r = add_matrix_table(
    ws1,
    r,
    ['Riesgo', 'Impacto en el proyecto', 'Criticidad', 'Alerta temprana', 'Mitigacion', 'Responsable', 'Contingencia'],
    stage1_risks,
    fill=risk_fill,
)
r += 1

# Ocupacion E1
r = add_section(ws1, r, 'OCUPACION PLANIFICADA DE RECURSOS ETAPA 1', 8)
r = add_matrix_table(
    ws1,
    r,
    ['Rol', 'Foco principal', 'S1-S4', 'S5-S8', 'S9-S12', 'S13-S16', 'Promedio etapa', 'Observacion ejecutiva'],
    stage1_resource_plan,
    fill=alt_fill1,
)
r += 1

# Entregables E1
r = add_section(ws1, r, 'ENTREGABLES ETAPA 1', 5)
r = add_matrix_table(
    ws1,
    r,
    ['Entregable', 'Paquete de trabajo', 'Resultado esperado', 'Hito de cierre', 'Responsable'],
    stage1_deliverables,
    fill=ent_fill,
)

# ===== ETAPA 2 =====
ws2 = wb.create_sheet("ETAPA2")
ws2.sheet_properties.tabColor = 'e63946'

ws2.column_dimensions['A'].width = 8
ws2.column_dimensions['B'].width = 70
ws2.column_dimensions['C'].width = 10
ws2.column_dimensions['D'].width = 18
ws2.column_dimensions['E'].width = 22
ws2.column_dimensions['F'].width = 18
ws2.column_dimensions['G'].width = 18
ws2.column_dimensions['H'].width = 18

md2 = parse_md(r'c:\InformeCliente\etapa2_hardening_golive.md')
tables2 = extract_tables(md2)

stage2_risks = [
    ['Cambios o indisponibilidad de la base externa en AWS durante la estabilizacion', 'Puede afectar la marcha blanca y la validacion gerencial de punta a punta.', 'Alta', 'Incidentes repetidos en la extraccion o diferencias entre datos esperados y datos recibidos.', 'Establecer mesa conjunta de cambios, monitoreo del conector y plan de contingencia con datos cacheados para pruebas controladas.', 'ARQ + BE3', 'Activar ventana controlada de pruebas con data congelada y priorizar validaciones no dependientes de la fuente.'],
    ['Capacidad insuficiente de los VPS Linux ante picos de carga', 'Riesgo de degradacion en alertas, vistas gerenciales y procesos de cierre.', 'Alta', 'Pruebas de estres con saturacion de CPU, memoria o almacenamiento.', 'Ejecutar tuning, definir reservas de capacidad y validar escalamiento vertical antes del go-live.', 'SYS + BE1', 'Incrementar capacidad de VPS y reducir cargas no prioritarias mientras se estabiliza la operacion.'],
    ['Retraso en cierre de hallazgos de seguridad o continuidad', 'Puede postergar aprobacion de produccion.', 'Alta', 'Pendientes de hardening, backup o DRP abiertos al inicio del mes 6.', 'Mantener tablero de hallazgos criticos, responsables por remediacion y simulacros de recuperacion con acta.', 'SYS + ARQ', 'Escalar hallazgos criticos al comite ejecutivo y congelar liberaciones no esenciales hasta el cierre.'],
    ['Baja adopcion operativa en marcha blanca', 'Afecta salida a produccion y confianza del cliente.', 'Media', 'Incidencias repetidas de uso, capacitacion insuficiente o rechazo a los nuevos flujos.', 'Capacitar por perfiles, acompanar en sitio y priorizar mejoras de alto impacto antes del corte final.', 'FE2 + QA', 'Extender acompanamiento focalizado y reforzar capacitacion por perfil hasta estabilizar el uso.'],
    ['Desalineacion entre entregables tecnicos y expectativa de gerencia', 'Riesgo de observaciones tardias y retrabajo en cierre.', 'Media', 'Solicitudes de aclaracion sobre tareas tecnicas o falta de visibilidad de valor por entregable.', 'Mantener lenguaje ejecutivo en reportes, demos quincenales y matriz de entregables vinculada a resultados de negocio.', 'ARQ', 'Reenfocar narrativa de avances en valor de negocio y validar expectativas en cada demo ejecutiva.'],
]

stage2_deliverables = [
    ['Plataforma endurecida sobre VPS Linux Lima', 'Hardening e infraestructura', 'Accesos, cifrado, segmentacion y respaldo operativo verificados.', 'Cierre Mes 5', 'SYS'],
    ['Integracion estabilizada con la base externa actual', 'Integracion y datos', 'Monitoreo, contingencias y flujo de datos validados con el sistema fuente.', 'Cierre Mes 5', 'BE3'],
    ['Capacidad validada para procesamiento intensivo', 'Performance y escalabilidad', 'Sensores, alarmas y consultas gerenciales dentro de umbrales comprometidos.', 'Cierre Mes 5', 'BE1 + SYS'],
    ['Mejoras visuales y comparador documental', 'Frontend avanzado', 'Comparador de cambios, soporte tablet y mejor rendimiento percibido.', 'Cierre Mes 5', 'FE1 + FE2'],
    ['Servicios de IA y automatizacion aprobados', 'IA aplicada', 'Casos de uso habilitados dentro del marco aprobado del proyecto.', 'Cierre Mes 5', 'BE2 + IA'],
    ['Plan de continuidad y recuperacion validado', 'Continuidad operativa', 'Simulacro documentado de recuperacion y respaldo regional probado.', 'Cierre Mes 6', 'SYS + ARQ'],
    ['Pruebas de performance, seguridad y UAT cerradas', 'Calidad de etapa', 'Actas, evidencias y hallazgos priorizados con cierre formal.', 'Cierre Mes 6', 'QA'],
    ['Marcha blanca con soporte y estabilizacion', 'Transicion operativa', 'Operacion controlada con incidencias atendidas y plan de estabilizacion aplicado.', 'Cierre Mes 6', 'ARQ + FE2'],
    ['Go-live aprobado y transferencia formal', 'Salida a produccion', 'Conocimiento, documentacion y responsabilidades operativas entregadas al cliente.', 'Cierre Mes 6', 'ARQ'],
    ['Matriz final de riesgos y gobierno operativo', 'Cierre ejecutivo', 'Riesgos, mitigaciones y criterios de operacion formalmente aceptados.', 'Cierre Mes 6', 'ARQ + QA'],
]

stage2_resource_plan = [
    ['ARQ', 'Gobierno de cierre, UAT y transferencia', '45%', '100%', '78%', 'Escala dedicacion en mes 6 para cierre ejecutivo y productivo.'],
    ['BE1', 'Rendimiento, motor de alertas y estabilidad', '100%', '85%', '92%', 'Mantiene carga alta para asegurar rendimiento y go-live.'],
    ['BE2', 'Seguridad e IA aplicada', '100%', '85%', '91%', 'Contribuye al hardening y estabilizacion de automatizaciones aprobadas.'],
    ['BE3', 'Integracion con fuente externa y notificaciones', '100%', '80%', '88%', 'Sostiene la dependencia critica de datos durante estabilizacion.'],
    ['FE1', 'Comparador, UX avanzada y soporte de salida', '100%', '95%', '98%', 'Alta carga continua para soporte ejecutivo y acompanamiento.'],
    ['FE2', 'Adopcion, soporte a usuarios y tablets', '100%', '90%', '95%', 'Se utiliza intensamente para maximizar adopcion y estabilizacion.'],
    ['SYS', 'Hardening, capacidad y continuidad', '100%', '100%', '100%', 'Recurso totalmente ocupado por criticidad de infraestructura.'],
    ['QA', 'Pruebas avanzadas, UAT y cierre de hallazgos', '35%', '100%', '68%', 'Incremento fuerte en mes 6 para asegurar salida con control.'],
    ['IA', 'Servicios de IA priorizados y soporte tecnico', '100%', '70%', '82%', 'Carga concentrada en mes 5 y soporte selectivo en salida.'],
]

r = 1
r = add_title(ws2, r, 'ETAPA 2 — HARDENING, ESTABILIZACION Y GO-LIVE (Meses 5-6 | Semanas 17-26 de 26)')
r = add_note(ws2, r, 'Base del cronograma: 26 semanas totales. La etapa 2 consolida seguridad, rendimiento, continuidad, adopcion y salida a produccion sobre VPS Linux Lima, manteniendo la dependencia controlada con la base externa existente en AWS.')

# Equipo E2
r = add_section(ws2, r, 'EQUIPO Y ROLES (ROTACION DE FOCO)')
if tables2:
    r = add_table_header(ws2, r, tables2[0][0])
    for idx, row_data in enumerate(tables2[0][1]):
        r = add_row(ws2, r, row_data, idx % 2 == 0)
r += 1

r = add_section(ws2, r, 'MES 5 — HARDENING DE PLATAFORMA Y CAPACIDADES AVANZADAS (S17-S20)')

subsections_m5_1 = [
    'Seguridad e infraestructura base en Lima (S17-S18)',
    'IA aplicada y mejoras visuales aprobadas (S17-S18)',
    'Biometria y captura intensiva de datos (S19-S20)',
    'Archivo historico y respaldo regional (S19-S20)',
]
for si, sub_title in enumerate(subsections_m5_1):
    ti = si + 1  # tables index (0 is equipo)
    r = add_subsection(ws2, r, sub_title)
    if ti < len(tables2):
        r = add_table_header(ws2, r, tables2[ti][0])
        for idx, row_data in enumerate(tables2[ti][1]):
            r = add_row(ws2, r, row_data, idx % 2 == 0)
    r += 1

r = add_note(ws2, r, 'Utilizacion S17-S20: BE1 100% | BE2 100% | BE3 100% | FE1 100% | FE2 100% | SYS 100% | IA 100% | QA 35% | ARQ 45%')
r = add_note(ws2, r, 'Objetivo ejecutivo del mes 5: blindar la plataforma, estabilizar el acceso a datos externos y dejar listas las capacidades diferenciales que elevan el valor gerencial de la solucion.')
r += 1

r = add_section(ws2, r, 'MES 6 — QA EJECUTIVO, MARCHA BLANCA Y GO-LIVE (S21-S26)')
subsections_m6 = [
    'Calidad extrema, continuidad y cierre de hallazgos (S21-S23)',
    'UAT, marcha blanca y salida a produccion (S24-S26)',
]
for si, sub_title in enumerate(subsections_m6):
    ti = si + 5
    r = add_subsection(ws2, r, sub_title)
    if ti < len(tables2):
        r = add_table_header(ws2, r, tables2[ti][0])
        for idx, row_data in enumerate(tables2[ti][1]):
            r = add_row(ws2, r, row_data, idx % 2 == 0)
    r += 1

r = add_note(ws2, r, 'Utilizacion S21-S26: ARQ 100% | BE1 85% | BE2 85% | BE3 80% | FE1 95% | FE2 90% | SYS 100% | QA 100% | IA 70%')
r = add_note(ws2, r, 'Objetivo ejecutivo del mes 6: validar resiliencia, cerrar UAT, acompanar operacion inicial y formalizar la transferencia de la plataforma al cliente.')
r += 1

# Riesgos E2
r = add_section(ws2, r, 'RIESGOS ETAPA 2', 5)
r = add_matrix_table(
    ws2,
    r,
    ['Riesgo', 'Impacto en el proyecto', 'Criticidad', 'Alerta temprana', 'Mitigacion', 'Responsable', 'Contingencia'],
    stage2_risks,
    fill=risk_fill,
)
r += 1

# Ocupacion E2
r = add_section(ws2, r, 'OCUPACION PLANIFICADA DE RECURSOS ETAPA 2', 5)
r = add_matrix_table(
    ws2,
    r,
    ['Rol', 'Foco principal', 'S17-S20', 'S21-S26', 'Promedio etapa', 'Observacion ejecutiva'],
    stage2_resource_plan,
    fill=alt_fill1,
)
r += 1

# Entregables E2
r = add_section(ws2, r, 'ENTREGABLES ETAPA 2', 5)
r = add_matrix_table(
    ws2,
    r,
    ['Entregable', 'Paquete de trabajo', 'Resultado esperado', 'Hito de cierre', 'Responsable'],
    stage2_deliverables,
    fill=ent_fill,
)

# Métricas
r += 1
r = add_section(ws2, r, 'METRICAS DE EXITO GLOBALES')
metricas = {
    'Performance': [
        'Latencia de intercambio de datos dentro de los umbrales definidos para operacion y gerencia.',
        'Autosave y trazabilidad documental dentro de los tiempos objetivo acordados.',
        'Exportacion documental dentro de las metas de respuesta para informes ejecutivos y tecnicos.',
        'Pruebas de carga superadas sin degradacion critica del servicio.',
    ],
    'Disponibilidad': [
        'Disponibilidad alineada a los niveles de servicio comprometidos.',
        'Plan de continuidad y recuperacion validado con simulacro documentado.',
        'Actualizaciones controladas sin afectar la continuidad del servicio critico.',
    ],
    'Calidad': [
        'Evidencias de cierre funcional y tecnico para los casos criticos del negocio.',
        'Pruebas integrales y UAT completadas con observaciones priorizadas y cerradas.',
        'Fidelidad de exportacion documental dentro del umbral aceptado por negocio.',
    ],
    'UX': [
        'Experiencia de edicion y consulta comprensible para gerencia, supervisores y usuarios operativos.',
        'Navegacion, lectura y comparacion documental con tiempos de respuesta consistentes.',
        'Capacitacion y adopcion con satisfaccion suficiente para salida a produccion.',
    ],
    'IA': [
        'Servicios de IA aprobados ejecutandose dentro del marco definido por el proyecto.',
        'Automatizaciones priorizadas aportando valor real sin comprometer estabilidad ni seguridad.',
        'Precision y tiempos de respuesta medidos y aceptados para los casos de uso habilitados.',
    ],
}
for cat, items in metricas.items():
    r = add_subsection(ws2, r, cat)
    for item in items:
        ws2.merge_cells(start_row=r, start_column=1, end_row=r, end_column=4)
        c = ws2.cell(row=r, column=1, value=f'  ☐  {item}')
        c.font = cell_font; c.fill = alt_fill1; c.alignment = wrap; c.border = border
        r += 1

finalize_sheet(ws1)
finalize_sheet(ws2)

out = r'c:\InformeCliente\Plan_Proyecto_Etapas_1_2.xlsx'
wb.save(out)
print(f'Excel generado: {out}')
