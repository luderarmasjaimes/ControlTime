// Extraido del inline de analisis.html (CSP: script-src sin unsafe-inline).

// ═══════════════════════════════════════════════════════════════
// FLOW DIAGRAM — ZOOM & PAN
// ═══════════════════════════════════════════════════════════════
(function(){
  let scale = 0.85, tx = 20, ty = 10;
  let dragging = false, startX = 0, startY = 0, startTX = 0, startTY = 0;

  function applyTransform(){
    const g = document.getElementById('flowG');
    if(g) g.setAttribute('transform', 'translate('+tx+','+ty+') scale('+scale+')');
  }

  window.flowZoom = function(delta){
    scale = Math.min(3, Math.max(0.2, scale + delta));
    applyTransform();
  };
  window.flowReset = function(){
    scale=1; tx=0; ty=0; applyTransform();
  };

  document.addEventListener('DOMContentLoaded', function(){
    const vp = document.getElementById('flowViewport');
    if(!vp) return;
    applyTransform();

    // Mouse wheel zoom centred on cursor
    vp.addEventListener('wheel', function(e){
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      const newScale = Math.min(3, Math.max(0.2, scale + delta));
      tx = mx - (mx - tx) * (newScale / scale);
      ty = my - (my - ty) * (newScale / scale);
      scale = newScale;
      applyTransform();
    }, {passive:false});

    // Drag to pan
    vp.addEventListener('mousedown', function(e){
      dragging=true; startX=e.clientX; startY=e.clientY; startTX=tx; startTY=ty;
      vp.classList.add('dragging');
    });
    window.addEventListener('mousemove', function(e){
      if(!dragging) return;
      tx = startTX + (e.clientX - startX);
      ty = startTY + (e.clientY - startY);
      applyTransform();
    });
    window.addEventListener('mouseup', function(){
      dragging=false;
      const vp2 = document.getElementById('flowViewport');
      if(vp2) vp2.classList.remove('dragging');
    });

    // Touch pan
    let lastTouchX=0, lastTouchY=0;
    vp.addEventListener('touchstart', function(e){
      if(e.touches.length===1){ lastTouchX=e.touches[0].clientX; lastTouchY=e.touches[0].clientY; }
    },{passive:true});
    vp.addEventListener('touchmove', function(e){
      if(e.touches.length===1){
        tx += e.touches[0].clientX - lastTouchX;
        ty += e.touches[0].clientY - lastTouchY;
        lastTouchX=e.touches[0].clientX; lastTouchY=e.touches[0].clientY;
        applyTransform(); e.preventDefault();
      }
    },{passive:false});
  });
})();

// ═══════════════════════════════════════════════════════════════
// SP SQL DEFINITION (shown in viewer and downloadable)
// ═══════════════════════════════════════════════════════════════
const SP_SQL = `-- ============================================================
-- FORMULA — Motor de Ejecución de Bloques
-- Lee el diagrama de bloques desde la tabla blocks/connections
-- y lo ejecuta dinámicamente para cada lectura de minería.
--
-- Flujo del diagrama FORMULA (del usuario):
--   [BLOQUE INICIO] paso1: temperatura = temperatura + 1
--                   paso2: temperatura = temperatura - 1  (neto: sin cambio)
--   [CONDICIÓN]     temperatura > 4
--       SI →  [Bloque b21301]  temperatura = temperatura * 2
--       NO →  [Bloque b78399]  temperatura = temperatura * 3
-- ============================================================

-- ─── Helper: evalúa expresión aritmética con sustitución de variables ─────
CREATE OR REPLACE FUNCTION fn_eval_expr_numeric(
    p_expr TEXT,
    p_vars JSONB   -- {"temperatura": 5.5, ...}
) RETURNS NUMERIC AS $$
DECLARE
    v_sql    TEXT    := p_expr;
    v_key    TEXT;
    v_val    NUMERIC;
    v_result NUMERIC;
BEGIN
    FOR v_key IN
        SELECT k FROM jsonb_object_keys(p_vars) AS k
        WHERE  k ~ '^[A-Za-z_][A-Za-z0-9_]*$'   -- solo nombres seguros
    LOOP
        v_val := (p_vars ->> v_key)::NUMERIC;
        v_sql := regexp_replace(v_sql, '\\m' || v_key || '\\M', v_val::TEXT, 'g');
    END LOOP;
    EXECUTE 'SELECT (' || v_sql || ')::NUMERIC' INTO v_result;
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'fn_eval_expr_numeric: error en expr "%" → %', p_expr, SQLERRM;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── Helper: evalúa condición booleana con sustitución de variables ────────
CREATE OR REPLACE FUNCTION fn_eval_expr_bool(
    p_expr TEXT,
    p_vars JSONB
) RETURNS BOOLEAN AS $$
DECLARE
    v_sql    TEXT    := p_expr;
    v_key    TEXT;
    v_val    NUMERIC;
    v_result BOOLEAN;
BEGIN
    FOR v_key IN
        SELECT k FROM jsonb_object_keys(p_vars) AS k
        WHERE  k ~ '^[A-Za-z_][A-Za-z0-9_]*$'
    LOOP
        v_val := (p_vars ->> v_key)::NUMERIC;
        v_sql := regexp_replace(v_sql, '\\m' || v_key || '\\M', v_val::TEXT, 'g');
    END LOOP;
    EXECUTE 'SELECT (' || v_sql || ')::BOOLEAN' INTO v_result;
    RETURN v_result;
EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'fn_eval_expr_bool: error en condición "%" → %', p_expr, SQLERRM;
END;
$$ LANGUAGE plpgsql STABLE;

-- ─── SP principal: ejecuta el diagrama FORMULA sobre los datos de minería ──
CREATE OR REPLACE FUNCTION sp_proceso_temperatura(
    p_empresa_id   INTEGER,
    p_mina_id      INTEGER,
    p_variable_id  INTEGER,
    p_fecha_inicio TIMESTAMPTZ,
    p_fecha_fin    TIMESTAMPTZ
)
RETURNS TABLE (
    timestamp_lectura   TIMESTAMPTZ,
    valor_original      DECIMAL(12,4),
    calidad             SMALLINT,
    umbral_alerta       DECIMAL(6,2),
    condicion_resultado VARCHAR(2),
    valor_procesado     DECIMAL(12,4),
    descripcion         TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
    rec               RECORD;
    v_umbral          DECIMAL(6,2);
    v_zona            VARCHAR(10);
    v_nombre          VARCHAR(200);
    v_inicio_id       TEXT;
    v_cur_id          TEXT;
    v_bloque          RECORD;
    v_vars            JSONB;
    v_steps           JSONB;
    v_step            JSONB;
    v_expr            TEXT;
    v_matched         TEXT[];
    v_val_nuevo       NUMERIC;
    v_cond_bool       BOOLEAN;
    v_cond_txt        VARCHAR(2);
    v_desc_parts      TEXT[];
    v_visited         TEXT[];
    v_iter            INT;
    v_max_iter        CONSTANT INT := 50;
    i                 INT;
BEGIN
    -- ── Validaciones de parámetros ────────────────────────────────────────
    IF p_empresa_id IS NULL OR p_mina_id IS NULL OR p_variable_id IS NULL THEN
        RAISE EXCEPTION 'Requeridos: empresa_id, mina_id, variable_id';
    END IF;
    IF p_fecha_inicio IS NULL OR p_fecha_fin IS NULL THEN
        RAISE EXCEPTION 'Requeridos: fecha_inicio, fecha_fin';
    END IF;
    IF p_fecha_inicio >= p_fecha_fin THEN
        RAISE EXCEPTION 'fecha_inicio debe ser anterior a fecha_fin';
    END IF;

    -- ── Cargar config de mina (umbral = referencia visual del chart) ──────
    SELECT m.umbral_temp_alerta, m.zona_tipo, m.nombre
    INTO   v_umbral, v_zona, v_nombre
    FROM   mineria_minas m
    WHERE  m.id = p_mina_id AND m.empresa_id = p_empresa_id AND m.activo = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mina id=% no encontrada para empresa_id=%',
            p_mina_id, p_empresa_id;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM mineria_variables
        WHERE  id = p_variable_id AND empresa_id = p_empresa_id AND activo = TRUE
    ) THEN
        RAISE EXCEPTION 'Variable id=% no encontrada para empresa_id=%',
            p_variable_id, p_empresa_id;
    END IF;

    -- ── Detectar bloque INICIO: primer bloque con fórmula sin entradas ───
    SELECT b.id INTO v_inicio_id
    FROM   blocks b
    LEFT  JOIN connections cin ON cin.to_id = b.id
    WHERE  cin.id IS NULL
      AND  b.meta ? 'formula'
    ORDER  BY b.created_at
    LIMIT  1;

    IF v_inicio_id IS NULL THEN
        RAISE EXCEPTION 'No se encontró bloque INICIO con fórmula en el diagrama';
    END IF;

    -- ── Para cada lectura: ejecutar el diagrama de bloques ───────────────
    FOR rec IN
        SELECT l.timestamp_lectura, l.valor, l.calidad
        FROM   mineria_lecturas l
        WHERE  l.empresa_id        = p_empresa_id
          AND  l.mina_id           = p_mina_id
          AND  l.variable_id       = p_variable_id
          AND  l.timestamp_lectura BETWEEN p_fecha_inicio AND p_fecha_fin
          AND  l.calidad           >= 50
        ORDER  BY l.timestamp_lectura
    LOOP
        v_vars       := jsonb_build_object('temperatura', rec.valor);
        v_cur_id     := v_inicio_id;
        v_cond_txt   := NULL;
        v_desc_parts := '{}';
        v_visited    := '{}';
        v_iter       := 0;

        WHILE v_cur_id IS NOT NULL AND v_iter < v_max_iter LOOP
            EXIT WHEN v_cur_id = ANY(v_visited);
            v_visited := array_append(v_visited, v_cur_id);
            v_iter    := v_iter + 1;

            SELECT b.id, b.label, b.meta INTO v_bloque
            FROM   blocks b WHERE b.id = v_cur_id;
            EXIT WHEN NOT FOUND;

            IF (v_bloque.meta ->> 'blockType') = 'decision' THEN
                -- ── CONDICIÓN ──────────────────────────────────────────────
                v_expr      := v_bloque.meta -> 'formula' ->> 'expression';
                v_cond_bool := fn_eval_expr_bool(v_expr, v_vars);
                v_cond_txt  := CASE WHEN v_cond_bool THEN 'SI' ELSE 'NO' END;
                v_desc_parts := array_append(v_desc_parts,
                    COALESCE(v_bloque.label,'COND') || ': ' || v_expr
                    || ' → ' || v_cond_txt);

                -- Conexión etiquetada con meta.backwardLabel = 'SI' o 'NO'
                SELECT c.to_id INTO v_cur_id
                FROM   connections c
                WHERE  c.from_id = v_bloque.id
                  AND  upper(c.meta ->> 'backwardLabel') = v_cond_txt
                LIMIT  1;

                -- Fallback: primera conexión = SI, segunda = NO
                IF v_cur_id IS NULL THEN
                    SELECT c.to_id INTO v_cur_id
                    FROM   connections c
                    WHERE  c.from_id = v_bloque.id
                    ORDER  BY c.id
                    OFFSET (CASE WHEN v_cond_bool THEN 0 ELSE 1 END)
                    LIMIT  1;
                END IF;

            ELSE
                -- ── PROCESO: ejecutar pasos JSON ────────────────────────────
                v_steps := v_bloque.meta -> 'formula' -> 'steps';
                IF v_steps IS NOT NULL AND jsonb_array_length(v_steps) > 0 THEN
                    FOR i IN 0 .. jsonb_array_length(v_steps) - 1 LOOP
                        v_step  := v_steps -> i;
                        v_expr  := trim(v_step ->> 'expression');

                        -- Detectar asignación: var = expr  (no >=, <=, !=, ==)
                        v_matched := regexp_match(v_expr,
                            '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)\s*(.+?)\s*$');

                        IF v_matched IS NOT NULL THEN
                            v_val_nuevo  := fn_eval_expr_numeric(v_matched[2], v_vars);
                            v_vars       := jsonb_set(v_vars,
                                                ARRAY[v_matched[1]],
                                                to_jsonb(v_val_nuevo));
                            v_desc_parts := array_append(v_desc_parts,
                                v_matched[1] || ':=' || round(v_val_nuevo::NUMERIC, 4));
                        END IF;
                    END LOOP;
                END IF;

                SELECT c.to_id INTO v_cur_id
                FROM   connections c
                WHERE  c.from_id = v_bloque.id
                LIMIT  1;
            END IF;
        END LOOP;

        timestamp_lectura   := rec.timestamp_lectura;
        valor_original      := rec.valor;
        calidad             := rec.calidad;
        umbral_alerta       := v_umbral;
        condicion_resultado := COALESCE(v_cond_txt, '?');
        valor_procesado     := COALESCE((v_vars ->> 'temperatura')::DECIMAL(12,4), rec.valor);
        descripcion         := array_to_string(v_desc_parts, ' | ');
        RETURN NEXT;
    END LOOP;
END;
$$;`;

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
let catalogos = [];
let chartOrig = null;
let chartComp = null;

// Current query state (for save)
let _lastRows    = [];
let _lastStats   = { total:0, si:0, no:0, pct:0 };

// GPS state
let _gpsLat      = null;
let _gpsLon      = null;
let _gpsAccuracy = null;
let _gpsLugar    = '';

// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// DINÁMICA: renderiza descripción y diagrama SVG desde /api/state
// ═══════════════════════════════════════════════════════════════
async function renderFormulaDiagram(){
  const descEl = document.getElementById('formulaDesc');
  const svgEl  = document.getElementById('flowDynContent');
  try{
    const res = await fetch('/api/state');
    const data = await res.json();
    const blocks = data.blocks || [];
    const conns  = data.connections || [];

    // ── helpers ─────────────────────────────────────────────────
    const isCond = b => b.meta && (b.meta.blockType === 'decision' || b.meta.tipo === 'CONDICION');
    const getTipo = b => (b.meta && b.meta.tipo) || '';
    const getExpr = b => (b.meta && b.meta.formula && b.meta.formula.expression) ? b.meta.formula.expression.trim() : '';

    // ── TEXT DESCRIPTION ────────────────────────────────────────
    if(descEl){
      if(blocks.length === 0){
        descEl.innerHTML = '<em style="color:#bbb">Sin bloques configurados — diseña tu fórmula en el editor principal.</em>';
      } else {
        // Build adjacency
        const adj = {};
        const inCount = {};
        blocks.forEach(b => { adj[b.id] = []; inCount[b.id] = 0; });
        conns.forEach(c => { if(adj[c.from]) adj[c.from].push(c); if(c.to in inCount) inCount[c.to]++; });

        let start = blocks.find(b => getTipo(b) === 'INICIO') ||
                    blocks.find(b => inCount[b.id] === 0) ||
                    blocks[0];

        const visited = new Set();
        let html = '<b>Diagrama FORMULA implementado (bloques reales):</b><br>';

        function walkDesc(b){
          if(!b || visited.has(b.id)) return;
          visited.add(b.id);
          const expr = getExpr(b);
          const tipo = getTipo(b);
          if(tipo === 'INICIO'){
            html += '<code style="background:#d1fae5;color:#065f46;padding:1px 5px;border-radius:3px">[' + escH(b.label) + ']</code>';
            if(expr) html += ' → <code>' + escH(expr) + '</code>';
            html += '<br>';
          } else if(isCond(b)){
            html += '<code style="background:#fef3c7;color:#92400e;padding:1px 5px;border-radius:3px">[CONDICIÓN: ' + escH(expr || b.label) + ']</code><br>';
            (adj[b.id] || []).forEach(c => {
              const tgt = blocks.find(bk => bk.id === c.to); if(!tgt) return;
              const lbl = (c.meta && c.meta.backwardLabel) || '→';
              const col = lbl === 'SI' ? '#065f46' : lbl === 'NO' ? '#991b1b' : '#555';
              const texpr = getExpr(tgt);
              html += '&nbsp;&nbsp;&nbsp;<b style="color:' + col + '">' + escH(lbl) + '</b> → <code style="background:#f4f4f8;padding:1px 4px;border-radius:3px">[' + escH(tgt.label) + ']</code>';
              if(texpr) html += ': <code>' + escH(texpr) + '</code>';
              html += '<br>';
              visited.add(tgt.id);
            });
          } else if(tipo !== 'FINAL'){
            html += '<code style="background:#dbeafe;color:#1e3a5f;padding:1px 5px;border-radius:3px">[' + escH(b.label) + ']</code>';
            if(expr) html += ': <code>' + escH(expr) + '</code>';
            html += '<br>';
          }
          if(!isCond(b)) (adj[b.id] || []).forEach(c => {
            const t = blocks.find(bk => bk.id === c.to);
            if(t && !visited.has(t.id)) walkDesc(t);
          });
        }
        walkDesc(start);
        blocks.forEach(b => { if(!visited.has(b.id) && getTipo(b) !== 'FINAL'){ const e=getExpr(b); html+='<code style="background:#f4f4f8;padding:1px 5px;border-radius:3px">['+escH(b.label)+']</code>'+(e?': <code>'+escH(e)+'</code>':'')+'<br>'; } });
        html += '<br><span style="color:#aaa">El SP lee las fórmulas directamente desde la tabla <b>blocks</b> y las ejecuta por cada lectura.</span>';
        descEl.innerHTML = html;
      }
    }

    // ── DYNAMIC SVG FLOW ────────────────────────────────────────
    if(svgEl){
      if(blocks.length === 0){
        svgEl.innerHTML = '<p style="color:#aaa;text-align:center;padding:40px">Sin bloques — crea tu diagrama en el editor principal.</p>';
      } else {
        // Use raw block coords, normalised so top-left = (PAD, PAD)
        // Wrap everything in <g id="flowG"> so the existing zoom/pan controls work
        const PAD = 40;
        const bx = blocks.map(b => b.x), by = blocks.map(b => b.y);
        const bx2 = blocks.map(b => b.x + b.w), by2 = blocks.map(b => b.y + b.h);
        const minX = Math.min(...bx), minY = Math.min(...by);
        const maxX = Math.max(...bx2), maxY = Math.max(...by2);
        const SVG_W = (maxX - minX) + PAD * 2;
        const SVG_H = (maxY - minY) + PAD * 2;

        // Normalise coords to start at PAD
        function rx(x){ return x - minX + PAD; }
        function ry(y){ return y - minY + PAD; }

        const blockMap = {};
        blocks.forEach(b => blockMap[b.id] = b);

        let svgParts = [
          '<svg xmlns="http://www.w3.org/2000/svg" width="' + SVG_W + '" height="' + SVG_H + '" overflow="visible" style="display:block">',
          '<defs>',
          '<marker id="fda"  markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L0,8 L10,4 z" fill="#334"/></marker>',
          '<marker id="fdaG" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L0,8 L10,4 z" fill="#16a34a"/></marker>',
          '<marker id="fdaR" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0,0 L0,8 L10,4 z" fill="#dc2626"/></marker>',
          '</defs>',
          '<g id="flowG" transform="translate(0,0) scale(1)">'
        ];

        // Draw connections
        conns.forEach(c => {
          const fa = blockMap[c.from], fb = blockMap[c.to];
          if(!fa || !fb) return;
          const x1 = rx(fa.x + fa.w/2), y1 = ry(fa.y + fa.h/2);
          const x2 = rx(fb.x + fb.w/2), y2 = ry(fb.y + fb.h/2);
          const lbl = c.meta && c.meta.backwardLabel;
          const col = lbl === 'SI' ? '#16a34a' : lbl === 'NO' ? '#dc2626' : '#334';
          const markId = lbl === 'SI' ? 'fdaG' : lbl === 'NO' ? 'fdaR' : 'fda';
          const sw = lbl ? 2.5 : 2;
          svgParts.push('<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="'+col+'" stroke-width="'+sw+'" marker-end="url(#'+markId+')"/>');
          if(lbl){
            const mx = (x1+x2)/2, my = (y1+y2)/2;
            const bw = lbl.length > 2 ? 36 : 30, bh = 22;
            svgParts.push('<rect x="'+(mx-bw/2)+'" y="'+(my-bh/2)+'" width="'+bw+'" height="'+bh+'" rx="5" fill="'+col+'" filter="drop-shadow(0 1px 2px rgba(0,0,0,.4))"/>');
            svgParts.push('<rect x="'+(mx-bw/2)+'" y="'+(my-bh/2)+'" width="'+bw+'" height="'+bh+'" rx="5" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>');
            svgParts.push('<text x="'+mx+'" y="'+(my+5)+'" text-anchor="middle" font-family="Poppins,Arial,sans-serif" font-size="13" font-weight="800" fill="#fff" letter-spacing="0.5">'+escH(lbl)+'</text>');
          }
        });

        // Draw blocks
        blocks.forEach(b => {
          const x = rx(b.x), y = ry(b.y), w = b.w, h = b.h;
          const cx = x + w/2, cy = y + h/2;
          const color = b.color || '#99ccff';
          const tipo = getTipo(b);
          const expr = getExpr(b);
          const label = b.label || b.id;

          if(isCond(b)){
            // Diamond
            svgParts.push('<polygon points="'+cx+','+(y)+' '+(x+w)+','+cy+' '+cx+','+(y+h)+' '+x+','+cy+'" fill="'+color+'" stroke="#333" stroke-width="2"/>');
          } else if(tipo === 'INICIO' || tipo === 'FINAL'){
            // Rounded pill
            const r = Math.min(h/2, 20);
            svgParts.push('<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="'+r+'" fill="'+color+'" stroke="#333" stroke-width="2"/>');
          } else {
            // Regular rect
            svgParts.push('<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="6" fill="'+color+'" stroke="#333" stroke-width="2"/>');
          }

          // Label
          svgParts.push('<text x="'+cx+'" y="'+(cy - (expr ? 8 : 0))+'" text-anchor="middle" dominant-baseline="middle" font-family="Poppins,Arial,sans-serif" font-size="13" font-weight="700" fill="#fff" stroke="rgba(0,0,0,0.5)" stroke-width="4" paint-order="stroke">' + escSvg(label) + '</text>');
          // Expression (small)
          if(expr){
            const shortExpr = expr.length > 35 ? expr.substring(0,33) + '…' : expr;
            svgParts.push('<text x="'+cx+'" y="'+(cy+10)+'" text-anchor="middle" dominant-baseline="middle" font-family="Roboto Mono,monospace" font-size="10" fill="#fff" opacity="0.92" stroke="rgba(0,0,0,0.45)" stroke-width="3" paint-order="stroke">' + escSvg(shortExpr) + '</text>');
          }
        });

        svgParts.push('</g>');
        svgParts.push('</svg>');
        svgEl.innerHTML = svgParts.join('\n');
        // Reset zoom/pan state to initial
        if(window.flowReset) window.flowReset();
      }
    }
  } catch(e){
    if(descEl) descEl.innerHTML = '<em style="color:#e74c3c">Error al cargar diagrama: ' + e.message + '</em>';
    console.error('renderFormulaDiagram error:', e);
  }
}

function escH(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escSvg(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.getElementById('spCode').value = SP_SQL;
cargarCatalogos();
renderFormulaDiagram();

// ═══════════════════════════════════════════════════════════════
// CATÁLOGOS
// ═══════════════════════════════════════════════════════════════
async function cargarCatalogos(){
  try{
    const r = await fetch('/api/analysis/catalogos');
    if(!r.ok) throw new Error('HTTP ' + r.status);
    catalogos = await r.json();
    poblarEmpresas();
  } catch(e){
    mostrarError('No se pudo cargar el catálogo: ' + e.message);
  }
}

function poblarEmpresas(){
  const sel = document.getElementById('selEmpresa');
  sel.innerHTML = '<option value="">— seleccione empresa —</option>';
  const empresas = [...new Map(catalogos.map(c=>[c.empresa_id, c])).values()];
  empresas.forEach(e=>{
    const o = document.createElement('option');
    o.value = e.empresa_id;
    o.textContent = e.empresa_nombre + ' (' + e.empresa_codigo + ')';
    sel.appendChild(o);
  });
  // Auto-apply context from editor localStorage
  poblarDesdeCtx();
}

// ─── Auto-populate + lock desde localStorage (formula_ctx) ──────────────
function poblarDesdeCtx(){
  let ctx = {};
  try{ ctx = JSON.parse(localStorage.getItem('formula_ctx') || '{}'); }catch(e){}

  const selE = document.getElementById('selEmpresa');
  const selM = document.getElementById('selMina');
  const selV = document.getElementById('selVariable');

  // ── Empresa ──
  if(ctx.empresa_id){
    for(let i=0;i<selE.options.length;i++){
      if(+selE.options[i].value === ctx.empresa_id){ selE.selectedIndex=i; break; }
    }
    selE.classList.add('locked-sel'); selE.disabled = true;

    // ── Mina ──
    const minas = [...new Map(catalogos.filter(c=>c.empresa_id===ctx.empresa_id).map(c=>[c.mina_id,c])).values()];
    selM.innerHTML = '<option value="">— seleccione mina —</option>';
    minas.forEach(m=>{
      const o = document.createElement('option');
      o.value = m.mina_id;
      o.textContent = m.mina_nombre + ' · ' + m.zona_tipo;
      if(ctx.mina_id && m.mina_id === ctx.mina_id) o.selected = true;
      selM.appendChild(o);
    });
    selM.classList.add('locked-sel'); selM.disabled = true;

    if(ctx.mina_id){
      // ── Variable ──
      const vars = catalogos.filter(c=>c.empresa_id===ctx.empresa_id && c.mina_id===ctx.mina_id);
      selV.innerHTML = '';
      vars.forEach(v=>{
        const o = document.createElement('option');
        o.value = v.variable_id; o.selected = true;
        o.textContent = v.variable_nombre + ' (' + v.unidad + ')';
        selV.appendChild(o);
      });
      selV.classList.add('locked-sel'); selV.disabled = true;

      if(vars.length){
        const m = vars[0];
        const el = document.getElementById('minaInfo');
        el.style.display='block';
        el.innerHTML =
          '<b>Zona:</b> ' + m.zona_tipo + ' &nbsp;|&nbsp; <b>Altitud:</b> ' + m.altitud_msnm + ' msnm<br>' +
          '<b>Umbral alerta:</b> ' + m.umbral_temp_alerta + ' °C — ' +
          '<em>SI cuando T &gt; ' + m.umbral_temp_alerta + '°C</em>';
      }
    }
  }

  // ── Header ctx bar ──
  poblarHdrCtxBar(ctx);
}

function poblarHdrCtxBar(ctx){
  const hdrE = document.getElementById('hdrSelEmpresa');
  const hdrM = document.getElementById('hdrSelMina');
  const hdrV = document.getElementById('hdrSelVariable');
  if(!hdrE) return;

  // Empresa
  const empresas = [...new Map(catalogos.map(c=>[c.empresa_id, c])).values()];
  hdrE.innerHTML = '';
  empresas.forEach(e=>{
    const o = document.createElement('option');
    o.value = e.empresa_id;
    o.textContent = e.empresa_nombre;
    if(ctx.empresa_id && e.empresa_id === ctx.empresa_id) o.selected = true;
    hdrE.appendChild(o);
  });

  if(!ctx.empresa_id){ hdrE.innerHTML = '<option>— sin selección —</option>'; return; }

  // Mina
  const minas = [...new Map(catalogos.filter(c=>c.empresa_id===ctx.empresa_id).map(c=>[c.mina_id,c])).values()];
  hdrM.innerHTML = '';
  minas.forEach(m=>{
    const o = document.createElement('option');
    o.value = m.mina_id;
    o.textContent = m.mina_nombre;
    if(ctx.mina_id && m.mina_id === ctx.mina_id) o.selected = true;
    hdrM.appendChild(o);
  });
  if(!ctx.mina_id){ hdrM.innerHTML = '<option>— sin selección —</option>'; return; }

  // Variable
  const vars = catalogos.filter(c=>c.empresa_id===ctx.empresa_id && c.mina_id===ctx.mina_id);
  hdrV.innerHTML = '';
  vars.forEach(v=>{
    const o = document.createElement('option');
    o.value = v.variable_id; o.selected = true;
    o.textContent = v.variable_nombre + ' (' + v.unidad + ')';
    hdrV.appendChild(o);
  });
}

document.getElementById('selEmpresa').addEventListener('change', function(){
  const eid = +this.value;
  const sm = document.getElementById('selMina');
  sm.innerHTML = '<option value="">— seleccione mina —</option>';
  document.getElementById('selVariable').innerHTML = '<option value="">— seleccione mina primero —</option>';
  document.getElementById('minaInfo').style.display='none';
  if(!eid) return;
  const minas = [...new Map(catalogos.filter(c=>c.empresa_id===eid).map(c=>[c.mina_id,c])).values()];
  minas.forEach(m=>{
    const o = document.createElement('option');
    o.value = m.mina_id;
    o.textContent = m.mina_nombre + ' · ' + m.zona_tipo + ' · ' + m.altitud_msnm + 'm';
    sm.appendChild(o);
  });
});

document.getElementById('selMina').addEventListener('change', function(){
  const mid = +this.value;
  const eid = +document.getElementById('selEmpresa').value;
  const sv = document.getElementById('selVariable');
  sv.innerHTML='';
  document.getElementById('minaInfo').style.display='none';
  if(!mid) return;
  const vars = catalogos.filter(c=>c.empresa_id===eid && c.mina_id===mid);
  vars.forEach(v=>{
    const o = document.createElement('option');
    o.value = v.variable_id; o.selected = true;
    o.textContent = v.variable_nombre + ' (' + v.unidad + ')';
    sv.appendChild(o);
  });
  if(vars.length){
    const m = vars[0];
    const el = document.getElementById('minaInfo');
    el.style.display='block';
    el.innerHTML =
      '<b>Zona:</b> ' + m.zona_tipo + ' &nbsp;|&nbsp; <b>Altitud:</b> ' + m.altitud_msnm + ' msnm<br>' +
      '<b>Umbral alerta:</b> ' + m.umbral_temp_alerta + ' °C — ' +
      '<em>SI cuando T &gt; ' + m.umbral_temp_alerta + '°C</em>';
  }
});

// ═══════════════════════════════════════════════════════════════
// TOGGLE PANELS
// ═══════════════════════════════════════════════════════════════
function scrollToPanel(id){
  const mc = document.getElementById('mainContent');
  const el = document.getElementById(id);
  if(!mc || !el) return;
  let top = 0, node = el;
  while(node && node !== mc){ top += node.offsetTop; node = node.offsetParent; }
  mc.scrollTop = top - 8;
}

function toggleFlow(){
  const p = document.getElementById('flowPanel');
  const btn = document.getElementById('btnFlow');
  const visible = p.style.display !== 'none' && p.style.display !== '';
  if(visible){ p.style.display='none'; btn.textContent='◇ Ver Diagrama de Flujo'; }
  else        { p.style.display='block'; btn.textContent='◇ Ocultar Diagrama de Flujo';
                setTimeout(()=>scrollToPanel('flowPanel'), 30); }
}

function toggleSP(){
  const p = document.getElementById('spPanel');
  const btn = document.getElementById('btnSP');
  const visible = p.style.display !== 'none' && p.style.display !== '';
  if(visible){ p.style.display='none'; btn.textContent='🗄 Ver Stored Procedure SQL'; }
  else        { p.style.display='block'; btn.textContent='🗄 Ocultar Stored Procedure SQL';
                setTimeout(()=>scrollToPanel('spPanel'), 30); }
}

// ═══════════════════════════════════════════════════════════════
// EJECUTAR SP
// ═══════════════════════════════════════════════════════════════
async function ejecutarSP(){
  ocultarError();
  const empresa_id  = +document.getElementById('selEmpresa').value  || 0;
  const mina_id     = +document.getElementById('selMina').value      || 0;
  const variable_id = +document.getElementById('selVariable').value  || 0;
  const fi = document.getElementById('fInicio').value;
  const ff = document.getElementById('fFin').value;

  if(!empresa_id || !mina_id || !variable_id){ mostrarError('Seleccione empresa, mina y variable.'); return; }
  if(!fi || !ff){ mostrarError('Ingrese rango de fechas válido.'); return; }
  if(fi >= ff){ mostrarError('Fecha inicio debe ser anterior a fecha fin.'); return; }

  const btn = document.getElementById('btnEjecutar');
  btn.disabled=true; btn.textContent='⏳ Ejecutando…';
  document.getElementById('spinnerOverlay').classList.add('on');

  try{
    const r = await fetch('/api/analysis/temperaturas',{
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ empresa_id, mina_id, variable_id,
        fecha_inicio: fi + ':00Z', fecha_fin: ff + ':00Z' })
    });
    if(!r.ok){ const t=await r.text().catch(()=>''); throw new Error('HTTP '+r.status+': '+t); }
    const data = await r.json();
    if(data.error) throw new Error(data.error);
    if(!data.rows || data.rows.length === 0){ mostrarError('No se encontraron datos para este rango.'); return; }

    document.getElementById('placeholderCard').style.display='none';
    renderGraficos(data.rows);
    renderStats(data.rows);
    renderTabla(data.rows);

    // Auto-scroll to chart 2
    document.getElementById('chart2Card').scrollIntoView({behavior:'smooth',block:'start'});

  } catch(e){
    mostrarError('Error ejecutando SP: ' + e.message);
  } finally {
    btn.disabled=false; btn.textContent='▶ EJECUTAR SP';
    document.getElementById('spinnerOverlay').classList.remove('on');
  }
}

// ═══════════════════════════════════════════════════════════════
// CHART ZOOM (manual X-axis min/max manipulation)
// ═══════════════════════════════════════════════════════════════
function zoomChartIn(){
  if(!chartComp) return;
  const xs = chartComp.scales.x;
  const range = xs.max - xs.min;
  const center = (xs.max + xs.min) / 2;
  const newRange = range * 0.65;
  chartComp.options.scales.x.min = center - newRange/2;
  chartComp.options.scales.x.max = center + newRange/2;
  chartComp.update('none');
}
function zoomChartOut(){
  if(!chartComp) return;
  const xs = chartComp.scales.x;
  const range = xs.max - xs.min;
  const center = (xs.max + xs.min) / 2;
  const newRange = Math.min(range * 1.5, _chartFullRange || range * 1.5);
  chartComp.options.scales.x.min = center - newRange/2;
  chartComp.options.scales.x.max = center + newRange/2;
  chartComp.update('none');
}
function zoomChartReset(){
  if(!chartComp) return;
  chartComp.options.scales.x.min = undefined;
  chartComp.options.scales.x.max = undefined;
  chartComp.update('none');
}
function descargarGrafico(){
  if(!chartComp) return;
  const a = document.createElement('a');
  a.href = chartComp.canvas.toDataURL('image/png');
  a.download = 'grafico_formula_sp.png';
  a.click();
}
let _chartFullRange = null;

// ═══════════════════════════════════════════════════════════════
// SAVE MODAL — GPS + guardar
// ═══════════════════════════════════════════════════════════════
function abrirModalGuardar(){
  // Populate params preview
  const empr = document.getElementById('selEmpresa');
  const mina = document.getElementById('selMina');
  const vari = document.getElementById('selVariable');
  const fin  = document.getElementById('fInicio').value;
  const ffen = document.getElementById('fFin').value;

  const emprNombre = empr.options[empr.selectedIndex]?.text || '—';
  const minaNombre = mina.options[mina.selectedIndex]?.text || '—';
  const variNombre = vari.options[vari.selectedIndex]?.text || '—';

  const hasResults = _lastRows.length > 0;
  document.getElementById('saveParamsPreview').innerHTML =
    `<b>Empresa:</b> ${emprNombre}<br>
     <b>Mina:</b> ${minaNombre}<br>
     <b>Variable:</b> ${variNombre}<br>
     <b>Período:</b> ${fin ? fin.replace('T',' ') : '—'} → ${ffen ? ffen.replace('T',' ') : '—'}<br>
     <b>Resultados:</b> ${hasResults
       ? `${_lastStats.total.toLocaleString('es-PE')} lecturas · ${_lastStats.si} SI · ${_lastStats.no} NO · ${_lastStats.pct}% alertas`
       : '<span style="color:#e74c3c">⚠ Ejecute el SP antes de guardar para incluir resultados</span>'}`;

  document.getElementById('modalGuardar').classList.add('on');

  // Request GPS
  _gpsLat = null; _gpsLon = null; _gpsAccuracy = null; _gpsLugar = '';
  const gpsBox = document.getElementById('gpsStatusBox');
  gpsBox.className = 'gps-status waiting';
  gpsBox.textContent = '📍 Solicitando ubicación GPS…';

  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(
      pos => {
        _gpsLat      = pos.coords.latitude;
        _gpsLon      = pos.coords.longitude;
        _gpsAccuracy = pos.coords.accuracy;
        _gpsLugar    = `${_gpsLat.toFixed(5)}, ${_gpsLon.toFixed(5)} (±${Math.round(_gpsAccuracy)}m)`;
        gpsBox.className = 'gps-status';
        gpsBox.textContent = `✅ Ubicación capturada: ${_gpsLugar}`;
      },
      err => {
        gpsBox.className = 'gps-status error';
        gpsBox.textContent = `⚠ GPS no disponible: ${err.message}`;
      },
      { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false }
    );
  } else {
    gpsBox.className = 'gps-status error';
    gpsBox.textContent = '⚠ Este navegador no soporta geolocalización.';
  }
}

function cerrarModalGuardar(){
  document.getElementById('modalGuardar').classList.remove('on');
}

async function confirmarGuardar(){
  const usuario = document.getElementById('saveUsuario').value.trim();
  if(!usuario){ alert('Por favor ingresa tu nombre completo.'); return; }

  const btn = document.getElementById('btnSaveConfirm');
  btn.disabled = true; btn.textContent = '⏳ Guardando…';

  try{
    const empr  = document.getElementById('selEmpresa');
    const mina  = document.getElementById('selMina');
    const vari  = document.getElementById('selVariable');
    const emprId = parseInt(empr.value)||0;
    const minaId = parseInt(mina.value)||0;
    const variId = parseInt(vari.value)||0;

    // Build formula snapshot from /api/state (returns blocks + connections)
    let formula_json = null;
    try{
      // Mismo diagram_id multitenant que el editor (sin esto, /api/state devuelve diagram_id "" → snapshot vacío)
      const diagramIdForSnap = (emprId && minaId) ? ('emp' + emprId + '_mina' + minaId) : '';
      const stateUrl = diagramIdForSnap
        ? ('/api/state?diagram_id=' + encodeURIComponent(diagramIdForSnap))
        : '/api/state';
      const stateRes = await fetch(stateUrl);
      if(stateRes.ok){
        const st = await stateRes.json();
        formula_json = {
          blocks:      st.blocks      || [],
          connections: st.connections || [],
          captured_at: new Date().toISOString()
        };
      }
    } catch(_){ /* formula snapshot optional */ }

    const emprNombre = empr.options[empr.selectedIndex]?.text || '';
    const minaNombre = mina.options[mina.selectedIndex]?.text || '';
    const variNombre = vari.options[vari.selectedIndex]?.text || '';

    const payload = {
      usuario_nombre: usuario,
      accion:         document.getElementById('saveAccion').value,
      empresa_id:     emprId,
      empresa_nombre: emprNombre,
      mina_id:        minaId,
      mina_nombre:    minaNombre,
      variable_id:    variId,
      variable_nombre:variNombre,
      fecha_inicio:   document.getElementById('fInicio').value || '',
      fecha_fin:      document.getElementById('fFin').value || '',
      formula_json:   formula_json,
      sp_sql_text:    SP_SQL,
      total_lecturas: _lastStats.total,
      total_si:       _lastStats.si,
      total_no:       _lastStats.no,
      pct_alertas:    parseFloat(_lastStats.pct)||0,
      gps_lat:        _gpsLat,
      gps_lon:        _gpsLon,
      gps_accuracy:   _gpsAccuracy,
      gps_lugar:      _gpsLugar,
      ip_cliente:     '',  // server won't have client IP via proxy naturally
    };

    const resp = await fetch('/api/analysis/guardar', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if(!resp.ok || !data.ok) throw new Error(data.error || 'Error al guardar');

    cerrarModalGuardar();
    showToast(`✅ Fórmula guardada (ID: ${data.id}) · ${data.created_at}`);
  } catch(e){
    alert('Error al guardar: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '💾 Guardar en DB';
  }
}

// ═══════════════════════════════════════════════════════════════
// GRÁFICOS
// ═══════════════════════════════════════════════════════════════
function buildChartOptions(titleText){
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode:'index', intersect:false },
    plugins: {
      legend: { position:'top', labels:{ font:{family:'Poppins',size:11}, boxWidth:14, padding:14 }},
      title:  { display:true, text:titleText,
                font:{family:'Poppins',size:12,weight:'600'}, color:'#1e3a5f',
                padding:{bottom:10} },
      tooltip: { callbacks:{ label: ctx => {
        const v = ctx.raw && ctx.raw.y !== undefined ? (+ctx.raw.y).toFixed(2) : (+ctx.raw).toFixed(2);
        return ' ' + ctx.dataset.label + ': ' + v + ' °C';
      }}}
    },
    scales: {
      x: { type:'time',
           time:{ displayFormats:{ minute:'HH:mm', hour:'dd/MM HH:mm', day:'dd/MM/yy' }},
           ticks:{ font:{family:'Poppins',size:10}, maxTicksLimit:12, maxRotation:30 },
           grid:{ color:'rgba(0,0,0,.04)' }},
      y: { title:{ display:true, text:'Temperatura (°C)', font:{family:'Poppins',size:11} },
           ticks:{ font:{family:'Poppins',size:10} },
           grid:{ color:'rgba(0,0,0,.06)' }}
    }
  };
}

function renderGraficos(rows){
  _lastRows = rows;   // store for save

  // Convert to {x,y} objects — more reliable with Chart.js time scale
  const umbral     = rows[0] ? +rows[0].umbral : 0;
  const origData   = rows.map(r => ({x: r.ts, y: +r.original}));
  const procData   = rows.map(r => ({x: r.ts, y: +r.procesado}));
  const umbralData = rows.map(r => ({x: r.ts, y: umbral}));

  // Store full time range for zoom-out clamping
  if(rows.length >= 2){
    _chartFullRange = new Date(rows[rows.length-1].ts) - new Date(rows[0].ts);
  }

  // Show card BEFORE creating chart so canvas has dimensions
  document.getElementById('chart2Card').style.display = 'block';

  // requestAnimationFrame ensures the browser has painted the card
  // before Chart.js reads canvas dimensions
  requestAnimationFrame(() => {
    // ─ Gráfico: original + procesado superpuestos + umbral ─
    if(chartComp){ chartComp.destroy(); chartComp = null; }
    chartComp = new Chart(document.getElementById('chartComparativo'), {
      type: 'line',
      data: { datasets: [
        { label: 'Original (°C)', data: origData,
          borderColor:'#2563eb', backgroundColor:'transparent',
          borderWidth:1.5, pointRadius:0, tension:.25 },
        { label: 'Procesado SP (°C)', data: procData,
          borderColor:'#e8921e', backgroundColor:'rgba(232,146,30,.10)',
          borderWidth:2.5, pointRadius:0, tension:.25, fill:true },
        { label: 'Umbral (' + umbral + ' °C)', data: umbralData,
          borderColor:'#dc2626', borderDash:[6,4],
          borderWidth:1.8, pointRadius:0, fill:false }
      ]},
      options: buildChartOptions('Comparativo: Original (azul) vs Procesado por SP (naranja) | Umbral (rojo)')
    });

    // Attach mouse-wheel zoom to the canvas
    chartComp.canvas.addEventListener('wheel', function(e){
      e.preventDefault();
      if(e.deltaY < 0) zoomChartIn(); else zoomChartOut();
    }, {passive:false});
  });
}

// ═══════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════
function renderStats(rows){
  const si  = rows.filter(r=>r.condicion==='SI').length;
  const no  = rows.length - si;
  const pct = ((si/rows.length)*100).toFixed(1);
  document.getElementById('statTotal').textContent = rows.length.toLocaleString('es-PE');
  document.getElementById('statSI').textContent    = si.toLocaleString('es-PE');
  document.getElementById('statNO').textContent    = no.toLocaleString('es-PE');
  document.getElementById('statPctSI').textContent = pct + '%';
  document.getElementById('statsBox').style.display='block';
}

// ═══════════════════════════════════════════════════════════════
// TABLA — todos los datos con scroll
// ═══════════════════════════════════════════════════════════════
function renderTabla(rows){
  const tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  rows.forEach(r => {
    const isSI = r.condicion === 'SI';
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid #eef';
    tr.innerHTML =
      `<td style="padding:6px 10px;font-family:'Roboto Mono',monospace;font-size:10px;white-space:nowrap">${r.ts.replace('T',' ').slice(0,16)}</td>
       <td style="padding:6px 10px;text-align:right;font-weight:600">${(+r.original).toFixed(2)}</td>
       <td style="padding:6px 10px;text-align:center;color:#7a5000">${r.umbral}</td>
       <td style="padding:6px 10px;text-align:center">
         <span style="padding:3px 9px;border-radius:10px;font-size:10px;font-weight:700;
           background:${isSI?'#fee2e2':'#dcfce7'};color:${isSI?'#7f1d1d':'#14532d'}">${r.condicion}</span>
       </td>
       <td style="padding:6px 10px;text-align:right;font-weight:600;color:${isSI?'#c0392b':'#27ae60'}">${(+r.procesado).toFixed(2)}</td>
       <td style="padding:6px 10px;font-size:10px;color:#555;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.descripcion}</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('tableTitle').textContent = '📋 Todos los Datos SP (' + rows.length.toLocaleString('es-PE') + ' filas)';
  document.getElementById('tableCard').style.display='block';
}

// ═══════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════
function mostrarError(msg){ const e=document.getElementById('errMsg'); e.textContent='⚠ '+msg; e.classList.add('on'); }
function ocultarError(){ document.getElementById('errMsg').classList.remove('on'); }

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2200);
}

function copiarSQL(){
  navigator.clipboard.writeText(SP_SQL)
    .then(()=>showToast('✔ SQL copiado al portapapeles'))
    .catch(()=>{ document.getElementById('spCode').select(); document.execCommand('copy'); showToast('✔ Copiado'); });
}

function descargarSQL(){
  const blob = new Blob([SP_SQL], {type:'text/plain'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sp_proceso_temperatura.sql';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('⬇ Descarga iniciada');
}
