#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
translate_thingsboard_formulas.py

Traduce (cuando es seguro hacerlo con confianza) los nodos de transformación
del ThingsBoard legado exportados en
docs/development/thingsboard_formulas_export_2026-09-17.psv hacia
expresiones tinyexpr, el lenguaje real que usa sensor_formula_def en la
plataforma nueva (sensor_formula_evaluator.cpp, backend/third_party/tinyexpr).

Pedido explícito del usuario (2026-09-18): "implementa" la traducción de las
175 fórmulas legadas. Este script SÍ implementa esa traducción -- pero
deliberadamente NO escribe nada en la base de datos ni asume a qué sensor_id
del sistema nuevo corresponde cada una. Motivo: al parsear el export real se
confirmó que la mayoría de los 175 nodos "TbTransformMsgNode" NO son
fórmulas de calibración -- son plomería de metadata/enrutamiento (fechas,
nombres de archivo, msgType, nombres de dispositivo). Forzar una traducción
de control de flujo (if/else, `new Date`, concatenación de strings) a una
expresión aritmética pura sería inventar semántica que no existe en el
original -- el mismo tipo de fabricación que este proyecto evita en todo lo
demás (ver ADR-121/190: nunca coordenadas GPS inferidas por IA; mismo
criterio acá con fórmulas de seguridad geotécnica).

Lo que SÍ hace, de punta a punta:
  1. Parsea el PSV real (registros multi-línea: cadena|nodo|tipo|código_js).
  2. Para cada nodo TbTransformMsgNode, busca una asignación
     `msg.<campo> = <expresión aritmética pura>;` -- la única forma real
     encontrada en el export de "esto calcula un valor nuevo".
  3. Si la expresión solo usa: otros campos `msg.<x>`, literales numéricos,
     operadores aritméticos, paréntesis, y funciones Math.* mapeables 1:1 a
     tinyexpr (sqrt/pow/abs/log/log10/exp/trig), la traduce y la marca
     'translated'.
  4. Cualquier otra cosa (if/else, Date, metadata, strings, funciones sin
     mapeo, múltiples asignaciones ambiguas, sin asignación reconocible)
     queda 'needs_manual_review' CON EL MOTIVO EXACTO -- nunca se adivina.
  5. Los nodos TbJsFilterNode/TbJsSwitchNode se listan aparte como
     'not_a_formula' (son compuertas booleanas/enrutamiento, no fórmulas de
     valor) -- fuera de alcance de sensor_formula_def por diseño.

Salida: un CSV revisable en
docs/development/thingsboard_formulas_translated_2026-09-18.csv -- el
siguiente paso (fuera de este script, requiere decisión humana) es mapear
cada fila 'translated' a un sensor_id real de `sensors` antes de insertarla
en sensor_formula_def -- eso requiere saber qué dispositivo TB legado
corresponde a qué sensor nuevo, dato que este script no tiene ni inventa.

Uso:
    python scripts/translate_thingsboard_formulas.py
    python scripts/translate_thingsboard_formulas.py --input otro.psv --output otro.csv
"""
import argparse
import csv
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = REPO_ROOT / "docs/development/thingsboard_formulas_export_2026-09-17.psv"
DEFAULT_OUTPUT = REPO_ROOT / "docs/development/thingsboard_formulas_translated_2026-09-18.csv"

# Cabecera de registro real del export: "Cadena|Nodo|org.thingsboard...|codigo"
# -- el código en sí puede tener muchas líneas hasta el próximo registro.
RECORD_START_RE = re.compile(
    r'^([^|\n]+)\|([^|\n]+)\|(org\.thingsboard\.rule\.engine\.[A-Za-z0-9_.]+)\|(.*)$'
)

# Math.<fn> de JS -> función tinyexpr real (third_party/tinyexpr/tinyexpr.c).
# Math.log de JS es logaritmo NATURAL -> tinyexpr 'ln' (no el 'log' ambiguo,
# que en tinyexpr depende de un #define de compilación -- se evita esa
# ambigüedad usando siempre los nombres explícitos ln/log10).
MATH_FUNC_MAP = {
    'Math.sqrt': 'sqrt', 'Math.pow': 'pow', 'Math.abs': 'abs',
    'Math.log10': 'log10', 'Math.log': 'ln', 'Math.exp': 'exp',
    'Math.sin': 'sin', 'Math.cos': 'cos', 'Math.tan': 'tan',
    'Math.asin': 'asin', 'Math.acos': 'acos', 'Math.atan': 'atan',
    'Math.atan2': 'atan2', 'Math.floor': 'floor', 'Math.ceil': 'ceil',
    'Math.sinh': 'sinh', 'Math.cosh': 'cosh', 'Math.tanh': 'tanh',
    # 2026-09-18 (ADR-198): antes descalificaban la expresión entera --
    # ahora tinyexpr.c tiene max/min/round nativos, mapeo 1:1 igual que el
    # resto de Math.*.
    'Math.max': 'max', 'Math.min': 'min', 'Math.round': 'round',
}

# Funciones/tokens de JS que NO tienen equivalente tinyexpr seguro -- su sola
# presencia descalifica la expresión (no se intenta "arreglar").
DISQUALIFYING_SUBSTRINGS = [
    'new Date', 'msgType', 'parseInt',
    'JSON.', '.toFixed', '.toString', 'console.', 'var ', 'let ', 'const ',
    'function', '=>', 'for (', 'for(', 'while (', 'while(', 'switch',
    "'", '"', '`', 'Math.random', 'Math.sign', 'Math.log2',
]
# 2026-09-18 (ADR-198): 'parseFloat' salió de la lista de arriba. Nuestras
# variables tinyexpr YA son double -- parseFloat(X) en el legado es solo
# un cast de seguridad de JS sin equivalente necesario acá, así que
# strip_parsefloat_calls() lo desenreda a X antes de traducir (ver abajo)
# en vez de descalificar la expresión completa solo por tenerlo. 'Math.max'
# y 'Math.min' también salieron: ahora tinyexpr tiene max()/min() nativos
# (extensión de este mismo cambio, ver tinyexpr.c) y MATH_FUNC_MAP los
# mapea 1:1 igual que el resto de Math.*. 'Math.round' igual, mapea a la
# función nativa nueva 'round'.
#
# 'metadata.' TAMBIÉN salió de la lista (segunda pasada, misma fecha):
# contar los usos reales de metadata.<clave> en los 175 registros (ver
# investigación previa a este cambio) mostró que la ENORME mayoría son
# constantes de calibración por dispositivo -- shared_altitud, shared_tk,
# shared_offset, shared_FreqIni, shared_param_a/b/c, ss_umbral1..5 -- el
# equivalente EXACTO de lo que `sensor_input_parameter_def` ya modela en
# la plataforma nueva (ADR-187/189). Antes se rechazaban TODAS por igual;
# ahora METADATA_KEY_DENYLIST (abajo) descalifica solo las que por USO
# real no son parámetros numéricos (timestamp, nombre de dispositivo,
# campos de texto de reporte) -- METADATA_ALLOWED_AS_PARAM se resuelve en
# translate_expression() igual que msg.<campo>, con la diferencia de que
# el resultado depende de que exista un sensor_input_parameter_def real
# con ese param_key -- se documenta en la columna source_params del CSV,
# nunca se asume silenciosamente.
METADATA_KEY_DENYLIST_EXACT = {
    'ts', 'sincets', 'untilts', 'devicename', 'devicetype', 'texto',
    'umbral_texto', 'location', 'equation',
}
METADATA_KEY_DENYLIST_RE = re.compile(r'^(valor\d+|.*unidad.*|.*anexo\d*)$', re.IGNORECASE)


def metadata_key_is_denylisted(key):
    low = key.lower()
    return low in METADATA_KEY_DENYLIST_EXACT or bool(METADATA_KEY_DENYLIST_RE.match(low))


META_FIELD_REF_RE = re.compile(r'\bmetadata\.([A-Za-z_][A-Za-z0-9_]*)\b')

## NOTA 2026-09-18: el legado usa mayormente ASI (JS sin punto y coma al
# final de cada línea, common en export de rule-chains de ThingsBoard) --
# la versión original de este regex exigía ';' como terminador y por eso
# en la práctica capturaba, en muchos registros, TODO el resto del bloque
# (hasta el próximo ';' real, a veces dentro del 'return {...};' final)
# como si fuera una sola "expresión" gigante -- eso inflaba artificialmente
# el rechazo por tokens descalificantes/residuales en vez de reconocer el
# verdadero límite de la asignación. Ahora el terminador es ';' O salto de
# línea (ambos válidos en JS real), igual que LOCAL_ASSIGN_RE más abajo.
ASSIGN_RE = re.compile(r'\bmsg\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\n]+);?')
FIELD_REF_RE = re.compile(r'\bmsg\.([A-Za-z_][A-Za-z0-9_]*)\b')
# Solo dígitos/operadores/paréntesis/espacios/nombres de función tinyexpr
# tras remover las referencias msg.<campo> -- valida que no quedó NINGÚN
# token JS no reconocido (nombre de variable suelto, operador raro, etc.).
SAFE_RESIDUAL_RE = re.compile(r'^[0-9.\s()+\-*/,]*$')

# --- Extensión 2026-09-18: patrón "selector de N vías" -------------------
# El motor tinyexpr vendoreado (backend/third_party/tinyexpr/tinyexpr.c) fue
# extendido en este mismo cambio con iif(cond, a, b) + comparaciones/lógicos
# (ya existían >,<,>=,<=,==,!=,&&,||,! -- ver commit de tinyexpr.c). Eso
# permite traducir UN patrón real encontrado en el export: una cadena de
#   if (msg.<selector> == <entero>) { <var_local> = <referencia_simple>; }
# (sin 'else', cada rama comparando el mismo selector contra un entero
# DISTINTO, y cada rama asignando una simple referencia -- msg.<x>,
# metadata.<x> o un número -- nunca una sub-expresión con su propia lógica)
# seguida de EXACTAMENTE una asignación final msg.<campo> = <var_local>;.
# Es seguro traducir esto a iif() anidado porque las ramas son mutuamente
# excluyentes por construcción (mismo selector contra literales distintos)
# y cada rama es una referencia, no lógica nueva.
#
# Lo que este detector NO hace: no adivina qué pasa si el selector no
# calza con ningún caso (el JS original deja la variable `undefined`, sin
# equivalente numérico limpio en tinyexpr). Por eso el resultado queda
# como 'needs_manual_review' con un tinyexpr SUGERIDO -- una persona debe
# decidir y aprobar el valor por defecto antes de usarlo.
IF_EQ_BLOCK_RE = re.compile(
    r'if\s*\(\s*msg\.([A-Za-z_][A-Za-z0-9_]*)\s*==\s*(-?\d+(?:\.\d+)?)\s*\)\s*\{([^{}]*)\}'
)
LOCAL_ASSIGN_RE = re.compile(r'^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;]+?);?\s*$')
SAFE_REF_RE = re.compile(
    r'^(?:metadata\.[A-Za-z_][A-Za-z0-9_]*|msg\.[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)$'
)


def try_integer_selector_chain(code):
    """Ver comentario arriba. Devuelve un dict con 'tinyexpr_suggested',
    'output_field', 'source_fields', 'note' si el código calza EXACTO con
    el patrón, o None si no -- nunca fuerza un caso que no calce 100%."""
    blocks = list(IF_EQ_BLOCK_RE.finditer(code))
    if len(blocks) < 2:
        return None

    selector_fields = set(m.group(1) for m in blocks)
    if len(selector_fields) != 1:
        return None
    selector_field = selector_fields.pop()

    branch_exprs = []
    for m in blocks:
        body = m.group(3).strip()
        lm = LOCAL_ASSIGN_RE.match(body)
        if not lm:
            return None
        local_var, ref = lm.group(1), lm.group(2).strip()
        if not SAFE_REF_RE.match(ref):
            return None
        branch_exprs.append((m.group(2), local_var, ref))

    local_vars = set(v for _, v, _ in branch_exprs)
    if len(local_vars) != 1:
        return None
    local_var = local_vars.pop()

    # El resto del código (fuera de los bloques if ya reconocidos) no debe
    # tener NINGUNA otra ramificación -- eso sí es global a propósito
    # (mismo criterio que el camino no-ramificado: no se puede saber si hay
    # más lógica condicional relevante sin un parser real).
    remaining = IF_EQ_BLOCK_RE.sub('', code)
    if has_branching(remaining):
        return None

    # Igual que el camino no-ramificado: puede haber bookkeeping de
    # metadata/fechas en otras líneas del bloque sin que afecte el cálculo
    # real -- solo importa qué CAMPO(S) msg.<x> se asignan y, de esos, cuál
    # es "la fórmula". Si se asigna más de un campo distinto (ej. el nodo
    # también hace `msg.campo_anterior = metadata.campo_anterior` para
    # arrastrar estado del ciclo previo), es ambiguo cuál es el resultado
    # real y se descarta -- no es un caso de selector simple.
    all_msg_assigns = ASSIGN_RE.findall(remaining)
    distinct_fields = sorted(set(f for f, _ in all_msg_assigns))
    if len(distinct_fields) != 1:
        return None
    output_field = distinct_fields[0]

    # La ÚLTIMA asignación a ese campo debe ser justo la variable local que
    # produjo el selector -- si se reescribe con otra cosa después, el
    # selector ya no decide el valor final.
    last_rhs = [rhs for f, rhs in all_msg_assigns if f == output_field][-1].strip()
    if last_rhs != local_var:
        return None
    for tok in DISQUALIFYING_SUBSTRINGS:
        if tok in last_rhs:
            return None

    def ref_to_tinyexpr(ref):
        if ref.startswith('metadata.'):
            return ref[len('metadata.'):]
        if ref.startswith('msg.'):
            return ref[len('msg.'):]
        return ref

    expr = '/*DEFAULT_SIN_DECIDIR*/0'
    for literal, _, ref in reversed(branch_exprs):
        expr = f'iif({selector_field}=={literal}, {ref_to_tinyexpr(ref)}, {expr})'

    source_fields = sorted(set(
        [selector_field] +
        [ref_to_tinyexpr(r) for _, _, r in branch_exprs if not SAFE_REF_RE.match(r) or not r.lstrip('-').replace('.', '', 1).isdigit()]
    ))
    note = (
        f"patrón selector de {len(blocks)} vías reconocido (if msg.{selector_field}==N -> {local_var}=<ref>, "
        f"luego msg.{output_field}={local_var}) -- traducible con la extensión iif() de tinyexpr, PERO el "
        f"original deja {local_var} indefinido si {selector_field} no calza con ningún caso (sin equivalente "
        "limpio en tinyexpr); reemplazar /*DEFAULT_SIN_DECIDIR*/0 por el valor correcto y aprobar antes de usar"
    )
    return {
        'tinyexpr_suggested': expr,
        'output_field': output_field,
        'source_fields': ','.join(source_fields),
        'note': note,
    }


def parse_records(text):
    lines = text.split('\n')
    records = []
    cur = None
    for line in lines:
        m = RECORD_START_RE.match(line)
        if m:
            if cur is not None:
                records.append(cur)
            cur = {
                'chain': m.group(1).strip(),
                'node': m.group(2).strip(),
                'type': m.group(3).strip(),
                'code_lines': [m.group(4)],
            }
        else:
            if cur is not None:
                cur['code_lines'].append(line)
    if cur is not None:
        records.append(cur)
    for r in records:
        r['code'] = '\n'.join(r['code_lines']).strip()
        del r['code_lines']
    return records


def has_branching(code):
    return bool(re.search(r'\bif\s*\(', code)) or bool(re.search(r'\belse\b', code)) or ('?' in code and ':' in code)


def strip_js_comments(code):
    """Quita comentarios // y /* */ ANTES de cualquier parseo. Necesario:
    el export real trae bloques /* ... */ comentados con asignaciones
    msg.<x>=... que parecen reales (ej. nodo 'Prism' de PrismB3) -- sin
    esto, el traductor podría 'traducir' código que en realidad está
    deshabilitado en el legado. No distingue comentarios dentro de un
    string (el dataset real no los tiene en los bloques relevantes,
    verificado por muestreo) -- riesgo aceptado y documentado."""
    code = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)
    code = re.sub(r'//[^\n]*', '', code)
    return code


def strip_parsefloat_calls(expr):
    """parseFloat(X) -> X. Nuestras variables tinyexpr ya son double --
    parseFloat es solo un cast de seguridad de JS sin equivalente
    necesario en el motor nuevo (ADR-198). Maneja paréntesis anidados a
    mano (regex simple se rompe con casos como
    parseFloat(msg.a - (msg.b/2))); si algo no calza deja el texto igual
    -- translate_expression lo rechazará después por token residual, así
    que nunca se traduce mal, en el peor caso queda sin traducir."""
    out = []
    i, n = 0, len(expr)
    while i < n:
        m = re.match(r'parseFloat\s*\(', expr[i:])
        if m:
            start_inner = i + m.end()
            depth = 1
            j = start_inner
            while j < n and depth > 0:
                if expr[j] == '(':
                    depth += 1
                elif expr[j] == ')':
                    depth -= 1
                j += 1
            if depth == 0:
                inner = expr[start_inner:j - 1]
                out.append(strip_parsefloat_calls(inner))
                i = j
                continue
        out.append(expr[i])
        i += 1
    return ''.join(out)


def translate_expression(expr, sibling_msg_fields=frozenset()):
    """Devuelve (tinyexpr_str, None, params_usados) si se pudo traducir con
    confianza, o (None, motivo, []) si no. NUNCA adivina -- cualquier duda
    es needs_manual_review. params_usados son claves metadata.<x> que se
    tradujeron asumiendo que existirán como sensor_input_parameter_def
    numérico del sensor real (ADR-198) -- el llamador las reporta aparte,
    nunca se insertan solas.

    `sibling_msg_fields`: TODOS los campos msg.<x> que el registro asigna
    y/o lee (no solo los de esta expresión puntual) -- necesario para el
    chequeo de colisión de abajo."""
    original = expr

    # 0) parseFloat(X) -> X (ver docstring de strip_parsefloat_calls).
    expr = strip_parsefloat_calls(expr)

    # 0.5) metadata.<clave> -- si la clave está en la lista negra (por uso
    # real: timestamp, nombre/tipo de dispositivo, campos de texto de
    # reporte), la expresión entera se rechaza con motivo específico. Si
    # no, se trata como parámetro de calibración candidato (ver comentario
    # de METADATA_KEY_DENYLIST_EXACT más arriba) -- CON UNA EXCEPCIÓN real
    # encontrada y corregida durante la propia verificación: si
    # metadata.<clave> tiene el MISMO NOMBRE EXACTO que un msg.<clave> del
    # mismo registro, NO es un parámetro de calibración -- es el idioma
    # real de ThingsBoard para "el valor de este campo en el ciclo
    # anterior" (atributo persistido con el mismo nombre del campo, ej.
    # metadata.wx_precipitation = precipitación del ciclo previo). Tratarlo
    # como parámetro producía `wx_precipitation - wx_precipitation` = 0
    # SIEMPRE -- un resultado numéricamente incorrecto y silencioso, no
    # solo "no traducible". Ahora se descalifica explícitamente como
    # ESTADO (ver prev_value en sensor_formula_evaluator.cpp, parte 1 de
    # este mismo ADR) en vez de fabricar un parámetro que no existe.
    meta_keys = sorted(set(META_FIELD_REF_RE.findall(expr)))
    state_collision = [k for k in meta_keys if k in sibling_msg_fields]
    if state_collision:
        return None, (f"metadata.{state_collision[0]} tiene el mismo nombre que msg.{state_collision[0]} -- "
                       "es ESTADO (valor del ciclo anterior persistido con el mismo nombre), no un parámetro de "
                       "calibración; requiere modelarse con prev_value, no como sensor_input_parameter_def"), []
    denylisted = [k for k in meta_keys if metadata_key_is_denylisted(k)]
    if denylisted:
        return None, f"usa metadata.{denylisted[0]} -- no es un parámetro de calibración (timestamp/nombre de dispositivo/texto de reporte), sin equivalente numérico", []
    for k in meta_keys:
        expr = re.sub(r'\bmetadata\.' + re.escape(k) + r'\b', k, expr)

    # 1) Funciones Math.* mapeables -> nombre tinyexpr. Cualquier Math.* NO
    # listado ya fue rechazado por DISQUALIFYING_SUBSTRINGS antes de llegar
    # acá (ver classify_record), así que este reemplazo es seguro.
    for js_fn, te_fn in sorted(MATH_FUNC_MAP.items(), key=lambda kv: -len(kv[0])):
        expr = expr.replace(js_fn, te_fn)

    # 2) msg.<campo> -> <campo> (nombre de variable tinyexpr desnudo, mismo
    # criterio que las 27 plantillas de calibración ya portadas -- ver
    # db_scripts/95_sensor_formula_template_catalog.sql, Freq/Temp/accel_x...).
    fields = sorted(set(FIELD_REF_RE.findall(expr)))
    for f in fields:
        expr = re.sub(r'\bmsg\.' + re.escape(f) + r'\b', f, expr)

    # 3) Validación final: tras quitar nombres de función tinyexpr conocidos,
    # campos y parámetros ya sustituidos, no debe quedar NINGÚN identificador
    # JS sin traducir (una variable local, un método desconocido, etc.).
    residual = expr
    for te_fn in set(MATH_FUNC_MAP.values()):
        residual = re.sub(r'\b' + re.escape(te_fn) + r'\b', '', residual)
    for f in fields:
        residual = re.sub(r'\b' + re.escape(f) + r'\b', '', residual)
    for k in meta_keys:
        residual = re.sub(r'\b' + re.escape(k) + r'\b', '', residual)
    if not SAFE_RESIDUAL_RE.match(residual):
        return None, f"quedó un token no traducido tras limpiar funciones/campos/parámetros conocidos: residual={residual!r} (expresión original: {original!r})", []

    return expr.strip(), None, meta_keys


LOCAL_DECL_RE = re.compile(r'^\s*(?:var\s+)?((?:msg\.|metadata\.)?[A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^;\n]+);?\s*$')


def split_statements(code):
    return [s.strip() for s in re.split(r'[;\n]', code) if s.strip()]


def substitute_locals(expr, env, msg_field_current):
    # Variables locales (bare) primero -- con guarda para no tocar el "z"
    # dentro de "msg.z"/"metadata.z" (ver comentario de la función llamante).
    for name in sorted(env.keys(), key=len, reverse=True):
        expr = re.sub(r'(?<!msg\.)(?<!metadata\.)\b' + re.escape(name) + r'\b',
                       '(' + env[name] + ')', expr)
    # Después, referencias msg.<campo> que YA fueron asignadas antes en este
    # mismo bloque -- JS trata `msg` como un objeto mutable: leer msg.z
    # DESPUÉS de reescribir msg.z ve el valor nuevo, no el original. Sin
    # esto, una salida que lee un campo msg.<x> ya recalculado por una
    # línea anterior (patrón real: "msg.z = msg.z + offset; msg.MCA =
    # msg.z;") se traduciría al valor SIN corregir -- un resultado
    # numéricamente incorrecto, no solo "no traducible". Se prefiere
    # encadenar la sustitución (y dejar que la descalificación de más abajo
    # rechace el resultado si offset no es seguro) antes que arriesgar un
    # número equivocado.
    for field in sorted(msg_field_current.keys(), key=len, reverse=True):
        expr = re.sub(r'\bmsg\.' + re.escape(field) + r'\b',
                       '(' + msg_field_current[field] + ')', expr)
    return expr


def try_multi_output_inline(code, distinct_fields, all_msg_fields):
    """Soporte de MÚLTIPLES SALIDAS (ADR-198). Antes, un registro con más de
    un campo msg.<x> se rechazaba entero por ambigüedad ("¿cuál es la
    fórmula?"). En realidad sensor_formula_def YA soporta esto de forma
    nativa -- son sencillamente VARIAS filas (una por output_channel_code)
    del mismo sensor, exactamente el mismo patrón usado por las 27
    plantillas de calibración ya portadas. Lo único que faltaba era
    reconocer cada campo msg.<x> como su propia fórmula independiente en
    vez de exigir una sola.

    Recorre el código en orden como una secuencia de asignaciones
    'var? nombre = expr' (sin punto y coma o con, ambos válidos -- ASI):
    - 'metadata.<x> = ...' se ignora (bookkeeping, nunca es una salida real).
    - 'msg.<x> = ...' es una salida candidata independiente.
    - cualquier otro nombre es una variable LOCAL: su expresión (ya con
      locales previas sustituidas) se recuerda para sustituir inline en
      cualquier referencia posterior -- así una salida que use 3 variables
      intermedias termina como UNA expresión tinyexpr autocontenida.

    Devuelve dict campo -> (tinyexpr_o_None, motivo_si_falló). Nunca
    adivina: un campo que no calza simplemente no se traduce, sin afectar
    a los demás campos del mismo registro."""
    env = {}
    msg_field_current = {}
    last_rhs_by_field = {}
    for stmt in split_statements(code):
        if stmt.startswith('return'):
            continue
        m = LOCAL_DECL_RE.match(stmt)
        if not m:
            continue
        lhs, rhs = m.group(1), m.group(2).strip()
        if lhs.startswith('metadata.'):
            continue
        rhs_sub = substitute_locals(rhs, env, msg_field_current)
        if lhs.startswith('msg.'):
            field = lhs[len('msg.'):]
            msg_field_current[field] = rhs_sub
            last_rhs_by_field[field] = rhs_sub
        else:
            env[lhs] = rhs_sub

    out = {}
    for field in distinct_fields:
        if field not in last_rhs_by_field:
            out[field] = (None, f"no se encontró una asignación con la forma 'var? nombre = expr;' para msg.{field}", [])
            continue
        rhs_sub = last_rhs_by_field[field]
        disq = next((tok for tok in DISQUALIFYING_SUBSTRINGS if tok in rhs_sub), None)
        if disq:
            out[field] = (None, f"la expresión de msg.{field} (tras sustituir variables locales) contiene '{disq}': {rhs_sub!r}", [])
            continue
        tinyexpr_str, err, params = translate_expression(rhs_sub, all_msg_fields)
        out[field] = (tinyexpr_str, err, params)
    return out


def classify_record(record):
    """Devuelve una LISTA de resultados -- normalmente 1, pero puede ser
    varios cuando el registro tiene múltiples salidas (ver
    try_multi_output_inline) o ninguno útil que reportar aparte de un solo
    rechazo genérico."""
    if record['type'] != 'org.thingsboard.rule.engine.transform.TbTransformMsgNode':
        return [{'status': 'not_a_formula', 'tinyexpr': '', 'output_field': '', 'source_fields': '',
                 'reason': 'nodo de filtro/switch (compuerta booleana o enrutamiento), no calcula un valor de telemetría'}]

    code = strip_js_comments(record['code'])

    # El chequeo de ramificación es GLOBAL a propósito (conservador): si el
    # bloque tiene if/else/ternario en cualquier parte, no se puede saber
    # con una regex simple si la asignación msg.<campo> que se va a extraer
    # queda dentro de una rama condicional (en cuyo caso extraerla sin más
    # sería incorrecto -- perdería la condición real). Se prefiere marcar de
    # más para revisión manual que traducir mal una fórmula de seguridad.
    if has_branching(code):
        selector = try_integer_selector_chain(code)
        if selector:
            return [{'status': 'needs_manual_review', 'tinyexpr': '', 'output_field': selector['output_field'],
                      'source_fields': selector['source_fields'],
                      'tinyexpr_suggested': selector['tinyexpr_suggested'], 'reason': selector['note']}]
        return [{'status': 'needs_manual_review', 'tinyexpr': '', 'output_field': '', 'source_fields': '',
                 'reason': 'contiene if/else o ternario -- tinyexpr no tiene control de flujo, requiere decisión manual de cómo modelarlo (o si corresponde partir en 2 fórmulas + alarma)'}]

    # TODOS los campos msg.<x> que el registro toca, asignados o solo
    # leídos -- usado por translate_expression para detectar colisión
    # metadata.<x>/msg.<x> (patrón de ESTADO, ver docstring ahí).
    all_msg_fields = frozenset(FIELD_REF_RE.findall(code))

    assigns = list(ASSIGN_RE.finditer(code))
    # Distintos CAMPOS asignados (msg.a=... y luego msg.a=... de nuevo no
    # cuenta como ambiguo, es la práctica normal de reescribir el mismo
    # campo).
    distinct_fields = sorted(set(m.group(1) for m in assigns))
    if not assigns:
        return [{'status': 'needs_manual_review', 'tinyexpr': '', 'output_field': '', 'source_fields': '',
                 'reason': 'no se encontró ninguna asignación msg.<campo> = <expresión> reconocible'}]

    if len(distinct_fields) > 1:
        # ADR-198: ya NO se rechaza entero -- cada campo es su propia
        # fórmula candidata (ver try_multi_output_inline).
        per_field = try_multi_output_inline(code, distinct_fields, all_msg_fields)
        results = []
        for field in distinct_fields:
            tinyexpr_str, err, params = per_field[field]
            if err is None and tinyexpr_str:
                source_fields = sorted(set(FIELD_REF_RE.findall(tinyexpr_str)))
                results.append({'status': 'translated', 'tinyexpr': tinyexpr_str, 'output_field': field,
                                 'source_fields': ','.join(source_fields), 'source_params': ','.join(params), 'reason': '',
                                 'multi_output_sibling_fields': ','.join(f for f in distinct_fields if f != field)})
            else:
                results.append({'status': 'needs_manual_review', 'tinyexpr': '', 'output_field': field,
                                 'source_fields': '', 'reason': err or 'no traducible',
                                 'multi_output_sibling_fields': ','.join(f for f in distinct_fields if f != field)})
        return results

    # Toma la ÚLTIMA asignación a ese campo (el valor final tras cualquier
    # reescritura previa del mismo campo dentro del mismo bloque).
    expr = assigns[-1].group(2).strip()
    output_field = distinct_fields[0]

    # El chequeo de tokens descalificantes se aplica SOLO a la expresión que
    # se va a traducir, no a todo el bloque -- un nodo puede hacer
    # bookkeeping de metadata/fechas en otras líneas (común en el legado,
    # confirmado en el export real) sin que eso afecte el cálculo real del
    # campo msg.<x> que sí importa acá.
    for tok in DISQUALIFYING_SUBSTRINGS:
        if tok in expr:
            return [{'status': 'needs_manual_review', 'tinyexpr': '', 'output_field': output_field, 'source_fields': '',
                     'reason': f"la expresión asignada a msg.{output_field} contiene '{tok}' -- no es aritmética pura traducible a tinyexpr"}]

    tinyexpr_str, err, params = translate_expression(expr, all_msg_fields)
    if err:
        return [{'status': 'needs_manual_review', 'tinyexpr': '', 'output_field': output_field, 'source_fields': '',
                 'reason': err}]

    source_fields = sorted(set(FIELD_REF_RE.findall(assigns[-1].group(2))))
    return [{'status': 'translated', 'tinyexpr': tinyexpr_str, 'output_field': output_field,
             'source_fields': ','.join(source_fields), 'source_params': ','.join(params), 'reason': ''}]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input', type=Path, default=DEFAULT_INPUT)
    ap.add_argument('--output', type=Path, default=DEFAULT_OUTPUT)
    args = ap.parse_args()

    text = args.input.read_text(encoding='utf-8', errors='replace')
    records = parse_records(text)

    rows = []
    for r in records:
        results = classify_record(r)
        multi = len(results) > 1
        for result in results:
            rows.append({
                'rule_chain': r['chain'],
                'node_name': r['node'],
                'node_type': r['type'].rsplit('.', 1)[-1],
                'status': result['status'],
                'output_field': result['output_field'],
                'source_fields': result['source_fields'],
                'source_params': result.get('source_params', ''),
                'tinyexpr': result['tinyexpr'],
                'tinyexpr_suggested': result.get('tinyexpr_suggested', ''),
                'multi_output_sibling_fields': result.get('multi_output_sibling_fields', ''),
                'reason': result['reason'],
                'original_code': r['code'],
            })

    with args.output.open('w', encoding='utf-8', newline='') as f:
        w = csv.DictWriter(f, fieldnames=[
            'rule_chain', 'node_name', 'node_type', 'status', 'output_field',
            'source_fields', 'source_params', 'tinyexpr', 'tinyexpr_suggested',
            'multi_output_sibling_fields', 'reason', 'original_code',
        ])
        w.writeheader()
        w.writerows(rows)

    counts = {}
    for row in rows:
        counts[row['status']] = counts.get(row['status'], 0) + 1
    suggested_n = sum(1 for row in rows if row['tinyexpr_suggested'])
    multi_translated_n = sum(1 for row in rows if row['status'] == 'translated' and row['multi_output_sibling_fields'])
    params_n = sum(1 for row in rows if row['status'] == 'translated' and row['source_params'])

    print(f"Registros parseados: {len(records)}")
    print(f"Filas de salida (algunos registros generan varias filas -- múltiples salidas, ADR-198): {len(rows)}")
    for status, n in sorted(counts.items()):
        print(f"  {status}: {n}")
    print(f"  (de las 'translated', {multi_translated_n} vienen de un registro de MÚLTIPLES salidas -- ver columna multi_output_sibling_fields)")
    print(f"  (de las 'translated', {params_n} dependen de al menos 1 parámetro metadata.* -- ver columna source_params, requiere que exista como sensor_input_parameter_def real del sensor)")
    print(f"  (de los needs_manual_review, {suggested_n} tienen un tinyexpr SUGERIDO en la columna tinyexpr_suggested -- borrador vía iif(), requiere decidir el default y aprobar)")
    print(f"Reporte completo: {args.output}")

    translated = [r for r in rows if r['status'] == 'translated']
    if translated:
        print("\nEjemplos traducidos (primeros 10):")
        for r in translated[:10]:
            print(f"  [{r['rule_chain']} / {r['node_name']}] {r['output_field']} = {r['tinyexpr']}")


if __name__ == '__main__':
    sys.exit(main())
