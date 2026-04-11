// Dentro de InformeCliente: /formula-api → proxy al motor FORMULA (mismo origen, sin puerto 8021).
const FORMULA_API_PREFIX =
  typeof window !== 'undefined' && window.FORMULA_API_PREFIX ? window.FORMULA_API_PREFIX : '';
const apiBase = FORMULA_API_PREFIX;

// ── In-page toast (replaces browser alert — avoids popup-blocker issues) ──
function showToast(msg, isError = false) {
  const t = document.createElement('div');
  t.style.cssText = [
    'position:fixed;top:66px;left:50%;transform:translateX(-50%);z-index:99999;',
    'padding:13px 28px;border-radius:8px;font-size:14px;font-weight:600;',
    'max-width:520px;text-align:center;color:#fff;pointer-events:none;',
    'box-shadow:0 4px 20px rgba(0,0,0,.35);opacity:1;transition:opacity .4s;',
    'background:' + (isError ? '#e74c3c' : '#27ae60') + ';'
  ].join('');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, 3800);
}

// ── In-page confirm modal (replaces browser confirm — avoids popup-blocker issues) ──
function showConfirm(msg, onYes, btnLabel) {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:99998;display:flex;align-items:center;justify-content:center;';
  const box = document.createElement('div');
  box.style.cssText = 'background:#fff;padding:28px 32px;border-radius:12px;max-width:420px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.3);';
  const safeMsg = String(msg).replace(/</g,'&lt;').replace(/\n/g,'<br>');
  box.innerHTML = `<p style="margin:0 0 22px;font-size:15px;color:#1e3a5f;line-height:1.5;">${safeMsg}</p>
    <button id="_cfNo"  style="padding:9px 22px;margin-right:12px;border:2px solid #7f8c8d;background:#fff;color:#7f8c8d;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600;">Cancelar</button>
    <button id="_cfYes" style="padding:9px 22px;background:#e74c3c;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600;">${btnLabel || 'Eliminar'}</button>`;
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  box.querySelector('#_cfNo').onclick  = close;
  box.querySelector('#_cfYes').onclick = () => { close(); onYes(); };
  overlay.onclick = e => { if(e.target === overlay) close(); };
}

async function postJSON(path, obj) {
  const url = apiBase + path;
  const res = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj)});
  if(!res.ok){
    const txt = await res.text().catch(()=>res.statusText||'error');
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  try{ return await res.json(); }catch(e){ return null; }
}

async function getJSON(path){
  const r = await fetch(apiBase + path);
  return r.json();
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT SELECTORS — Empresa / Mina / Sensor / Variable
// ═══════════════════════════════════════════════════════════════
(function initContextSelectors(){
  const CTX_KEY = 'formula_ctx';

  function saveCtx(obj){
    try{ localStorage.setItem(CTX_KEY, JSON.stringify(obj)); }catch(e){}
  }
  function loadCtx(){
    try{ return JSON.parse(localStorage.getItem(CTX_KEY) || '{}'); }catch(e){ return {}; }
  }

  let allEmpresas = [], allMinas = [], allSensores = [];
  let ctx = loadCtx(); // { empresa_id, mina_id, sensor_id }

  const selEmpresa = document.getElementById('ctxEmpresa');
  const selMina    = document.getElementById('ctxMina');
  const selSensor  = document.getElementById('ctxSensor');
  const infoBox    = document.getElementById('ctxSensorInfo');

  function poblateEmpresas(){
    selEmpresa.innerHTML = '<option value="">— seleccione empresa —</option>';
    allEmpresas.forEach(e => {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.nombre;
      if(ctx.empresa_id && parseInt(ctx.empresa_id) === e.id) o.selected = true;
      selEmpresa.appendChild(o);
    });
    if(!selEmpresa.value && allEmpresas.length > 0){
      const activos = allEmpresas.find(e => String(e.nombre || '').toLowerCase() === 'activos mineros');
      selEmpresa.value = String((activos || allEmpresas[0]).id);
    }
    onEmpresaChange(false);
  }

  function poblate(select, items, savedId, emptyText){
    select.innerHTML = '<option value="">' + emptyText + '</option>';
    items.forEach(it => {
      const o = document.createElement('option');
      o.value = it.id;
      o.textContent = it.nombre || it.codigo;
      if(savedId && parseInt(savedId) === it.id) o.selected = true;
      select.appendChild(o);
    });
  }

  function onEmpresaChange(resetChild){
    const eId = parseInt(selEmpresa.value);
    if(!eId){
      selMina.innerHTML = '<option value="">— seleccione empresa —</option>';
      selMina.disabled = true;
      onMinaChange(true);
      return;
    }
    const minas = allMinas.filter(m => m.empresa_id === eId);
    selMina.disabled = false;
    const savedMina = resetChild ? null : ctx.mina_id;
    poblate(selMina, minas, savedMina, '— seleccione mina —');
    onMinaChange(resetChild);
    saveCtx({ empresa_id: eId, mina_id: parseInt(selMina.value)||null, sensor_id: parseInt(selSensor.value)||null });
  }

  async function onMinaChange(resetChild){
    const mId = parseInt(selMina.value);
    selSensor.innerHTML = '<option value="">— cargando sensores… —</option>';
    selSensor.disabled = true;
    updateSensorInfo(null);
    if(!mId){
      selSensor.innerHTML = '<option value="">— seleccione mina —</option>';
      return;
    }
    try{
      allSensores = await getJSON('/api/sensores?mina_id=' + mId);
    }catch(e){ allSensores = []; }
    selSensor.disabled = false;
    const savedSensor = resetChild ? null : ctx.sensor_id;
    poblate(selSensor, allSensores, savedSensor, '— seleccione sensor —');
    onSensorChange();
    saveCtx({ empresa_id: parseInt(selEmpresa.value)||null, mina_id: mId, sensor_id: parseInt(selSensor.value)||null });
  }

  function onSensorChange(){
    const sId = parseInt(selSensor.value);
    const sensor = allSensores.find(s => s.id === sId);
    updateSensorInfo(sensor);
    saveCtx({ empresa_id: parseInt(selEmpresa.value)||null, mina_id: parseInt(selMina.value)||null, sensor_id: sId||null });
  }

  function updateSensorInfo(sensor){
    if(!sensor){ infoBox.style.display = 'none'; return; }
    infoBox.style.display = 'block';
    const ub = sensor.ubicacion ? '<br>📍 ' + sensor.ubicacion : '';
    const prof = sensor.profundidad_m !== null && sensor.profundidad_m !== undefined ? '<br>⬇ Profundidad: ' + sensor.profundidad_m + ' m' : '';
    const fab = sensor.fabricante ? ' · ' + sensor.fabricante : '';
    const mod = sensor.modelo ? ' (' + sensor.modelo + ')' : '';
    infoBox.innerHTML =
      '<b>' + sensor.nombre + '</b>' + fab + mod + ub + prof +
      '<br>Variable: <span class="si-var">' + sensor.variable_nombre + '</span>' +
      '&nbsp;Unidad: <span class="si-unit">' + (sensor.unidad || '—') + '</span>';
  }

  // Wire events — dispatch formulaCtxChange so canvas reloads the right diagram
  selEmpresa.addEventListener('change', () => { onEmpresaChange(true); window.dispatchEvent(new Event('formulaCtxChange')); });
  selMina.addEventListener('change',    async () => { await onMinaChange(true); window.dispatchEvent(new Event('formulaCtxChange')); });
  selSensor.addEventListener('change',  () => onSensorChange());

  // Initial load
  async function init(){
    try{
      const data = await getJSON('/api/catalogos');
      allEmpresas = data.empresas || [];
      allMinas    = data.minas    || [];
    }catch(e){ allEmpresas = []; allMinas = []; }
    poblateEmpresas();
  }
  init();

  // Expose ctx accessor so other code can read current selection
  window.getFormulaCtx = () => ({
    empresa_id: parseInt(selEmpresa.value) || null,
    mina_id:    parseInt(selMina.value)    || null,
    sensor_id:  parseInt(selSensor.value)  || null,
    sensor:     allSensores.find(s => s.id === parseInt(selSensor.value)) || null
  });
})();

// ── Multi-tenant diagram isolation ────────────────────────────────────────
// Each empresa+mina pair is an independent diagram workspace.
// Base id: 'empX_minaY'. Optional suffix (localStorage) starts a new empty canvas
// without deleting rows stored under the base id in the database.
const FORMULA_DIAGRAM_VARIANTS = 'formula_diagram_variants';
function diagramContextKey(ctx) {
  if(!ctx || !ctx.empresa_id || !ctx.mina_id) return null;
  return 'emp' + ctx.empresa_id + '_mina' + ctx.mina_id;
}
function getDiagramId() {
  try {
    const ctx = JSON.parse(localStorage.getItem('formula_ctx') || '{}');
    const base = diagramContextKey(ctx);
    if(!base) return null;
    const map = JSON.parse(localStorage.getItem(FORMULA_DIAGRAM_VARIANTS) || '{}');
    const suffix = map[base];
    if(suffix) return base + '_' + suffix;
    return base;
  } catch(e) { return null; }
}


const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
// ensure canvas fits the container and handle resize
function resizeCanvas(){
  // make canvas match its CSS size
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(800, Math.floor(rect.width));
  canvas.height = Math.max(600, Math.floor(rect.height));
}
window.addEventListener('resize', ()=>{ resizeCanvas(); draw(); });
resizeCanvas();
let state = { blocks: [], connections: [] };
let dragging = null;
let dragOffset = {x:0,y:0};
let selected = null;
let connectMode = false;
let connectionStart = null;
let draggingConn = null; // { id } while dragging midpoint of a connection
let threeMgr = null; // Three.js manager for 3D view (initialized on demand)
let connEditorActiveId = null; // id of connection currently open in connEditor
let selectedBlockType = null;  // authoritative blockType of currently selected block (set only by showProps from DB data)

function randColor(){
  const r = Math.floor(100 + Math.random()*155);
  const g = Math.floor(100 + Math.random()*155);
  const b = Math.floor(100 + Math.random()*155);
  return `#${((1<<24) + (r<<16) + (g<<8) + b).toString(16).slice(1)}`;
}

function distToSeg(px, py, x1, y1, x2, y2){
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if(len2 < 1e-6) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx, qy = y1 + t * dy;
  return Math.hypot(px - qx, py - qy);
}

function getConnAnchors(c){
  const a = state.blocks.find(b => b.id === c.from);
  const b = state.blocks.find(bk => bk.id === c.to);
  if(!a || !b) return null;
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2, by = b.y + b.h / 2;
  const meta = c.meta || {};
  let mx = meta.mx, my = meta.my;
  if(typeof mx !== 'number' || typeof my !== 'number'){
    mx = (ax + bx) / 2;
    my = (ay + by) / 2;
  }
  return { ax, ay, bx, by, mx, my };
}

function hitTestConnection(x, y){
  let best = null;
  let bestD = 14;
  for(const c of state.connections){
    const g = getConnAnchors(c);
    if(!g) continue;
    const d = Math.min(
      distToSeg(x, y, g.ax, g.ay, g.mx, g.my),
      distToSeg(x, y, g.mx, g.my, g.bx, g.by)
    );
    if(d < bestD){ bestD = d; best = c; }
  }
  return best;
}

// Returns the point on the border of block blk where the line from (fromX,fromY) to its center exits
function blockEdgePt(blk, fromX, fromY){
  const cx = blk.x + blk.w/2, cy = blk.y + blk.h/2;
  const dx = fromX - cx, dy = fromY - cy;
  if(Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return {x:cx, y:cy};
  const hw = blk.w/2, hh = blk.h/2;
  const tx = Math.abs(dx) > 0.001 ? hw/Math.abs(dx) : Infinity;
  const ty = Math.abs(dy) > 0.001 ? hh/Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + t*dx, y: cy + t*dy };
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // draw background sheet/grid when empty
  if(!state.blocks || state.blocks.length === 0){
    // light paper background
    ctx.fillStyle = '#fbfdff'; ctx.fillRect(0,0,canvas.width,canvas.height);
    // draw grid
    ctx.strokeStyle = '#eee'; ctx.lineWidth = 1;
    const step = 24;
    for(let x=0;x<canvas.width;x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for(let y=0;y<canvas.height;y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
    // centered hint text
    ctx.fillStyle = '#666'; ctx.font = '18px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Hoja de diseño vacía — use "Añadir bloque" para comenzar', canvas.width/2, canvas.height/2 - 10);
    ctx.fillStyle = '#999'; ctx.font = '13px Arial'; ctx.fillText('También puede usar comandos de voz: "crear bloque <nombre>"', canvas.width/2, canvas.height/2 + 18);
  }

  // Phase 1: draw connection lines only (no arrowheads yet — blocks drawn on top next)
  state.connections.forEach(c => {
    const g = getConnAnchors(c);
    if(!g) return;
    const { ax, ay, bx, by, mx, my } = g;
    ctx.strokeStyle = '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(mx, my);
    ctx.lineTo(bx, by);
    ctx.stroke();
  });

  // Phase 2: draw blocks on top of lines
  state.blocks.forEach(b => {
    const isDecision = (b.meta && (b.meta.blockType === 'decision' || b.meta.tipo === 'CONDICION')) || b.color === '#f4d03f';
    ctx.fillStyle = b.color || (isDecision ? '#f4d03f' : '#99ccff');
    ctx.strokeStyle = (selected && selected.id === b.id) ? '#ff8800' : '#333';
    ctx.lineWidth = 2;
    if(isDecision){
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      ctx.beginPath();
      ctx.moveTo(cx, b.y);
      ctx.lineTo(b.x + b.w, cy);
      ctx.lineTo(cx, b.y + b.h);
      ctx.lineTo(b.x, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      roundRect(ctx, b.x, b.y, b.w, b.h, 6, true, true);
    }
    // Label: white text with dark stroke for contrast on any block color
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 13px Poppins, Arial, sans-serif';
    const labelX = b.x + b.w/2, labelY = b.y + b.h/2;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.strokeText(b.label || b.id, labelX, labelY);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(b.label || b.id, labelX, labelY);
  });

  // Phase 3: draw arrowheads and midpoint dots on top of blocks
  state.connections.forEach(c => {
    const g = getConnAnchors(c);
    if(!g) return;
    const { ax, ay, bx, by, mx, my } = g;
    const blkA = state.blocks.find(b => b.id === c.from);
    const blkB = state.blocks.find(b => b.id === c.to);
    const dir = (c.meta && c.meta.direction) || 'backward';
    const arrowSize = 13;
    function drawArrowTip(tip, fromX, fromY){
      const ang = Math.atan2(tip.y - fromY, tip.x - fromX);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - arrowSize * Math.cos(ang - 0.38), tip.y - arrowSize * Math.sin(ang - 0.38));
      ctx.lineTo(tip.x - arrowSize * Math.cos(ang + 0.38), tip.y - arrowSize * Math.sin(ang + 0.38));
      ctx.closePath();
      ctx.fillStyle = '#1e3a5f';
      ctx.fill();
    }
    if(dir === 'backward'){
      const tip = blkB ? blockEdgePt(blkB, mx, my) : {x: bx, y: by};
      drawArrowTip(tip, mx, my);
    } else {
      const tip = blkA ? blockEdgePt(blkA, mx, my) : {x: ax, y: ay};
      drawArrowTip(tip, mx, my);
    }
    // orange midpoint handle dot (drawn before badges so badges appear on top)
    ctx.fillStyle = '#e8921e';
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Phase 4: SI/NO badges — drawn last so they are always on top of everything
  state.connections.forEach(c => {
    const g = getConnAnchors(c);
    if(!g) return;
    const { ax, ay, mx, my } = g;
    const blkA = state.blocks.find(b => b.id === c.from);
    const blkB = state.blocks.find(b => b.id === c.to);
    const dir = (c.meta && c.meta.direction) || 'backward';
    if(dir !== 'backward') return;
    const fromIsCond = _isCondBlk(blkA);
    const toIsCond   = _isCondBlk(blkB);
    const label = fromIsCond && c.meta && c.meta.backwardLabel;
    if(!label) return;

    // Position badge at the block border + offset outward along the connection
    const srcTip = blkA ? blockEdgePt(blkA, mx, my) : {x: ax, y: ay};
    const outAng = Math.atan2(my - ay, mx - ax);
    const lx = srcTip.x + Math.cos(outAng) * 30;
    const ly = srcTip.y + Math.sin(outAng) * 30;

    ctx.save();
    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(label).width;
    const padX = 10, padY = 7;
    const bw = Math.max(tw + padX * 2, 36);
    const bh = 26;
    const bgColor = (label === 'SI') ? '#16a34a' : '#dc2626';

    // shadow
    ctx.shadowColor = 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = bgColor;
    roundRect(ctx, lx - bw/2, ly - bh/2, bw, bh, 5, true, false);

    // inner white border
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, lx - bw/2, ly - bh/2, bw, bh, 5, false, true);

    // text: dark outline + white fill for max readability
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, lx, ly);
    ctx.restore();
  });
}

function roundRect(ctx, x, y, w, h, r, fill, stroke){
  if (typeof r === 'undefined') r = 5;
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.lineTo(x+w-r, y);
  ctx.quadraticCurveTo(x+w, y, x+w, y+r);
  ctx.lineTo(x+w, y+h-r);
  ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
  ctx.lineTo(x+r, y+h);
  ctx.quadraticCurveTo(x, y+h, x, y+h-r);
  ctx.lineTo(x, y+r);
  ctx.quadraticCurveTo(x, y, x+r, y);
  ctx.closePath();
  if(fill) ctx.fill();
  if(stroke) ctx.stroke();
}

function hitTest(x,y){
  for(let i = state.blocks.length-1; i>=0; i--){
    const b = state.blocks[i];
    if(x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

canvas.addEventListener('mousedown', async e => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left; const y = e.clientY - rect.top;
  const b = hitTest(x,y);
  if(connectMode){
    if(b){
      if(!connectionStart) { 
        connectionStart = b; 
        selected = b; 
        showProps(b);
        console.log('Conexión inicio:', b.id);
      }
      else if(connectionStart && connectionStart.id !== b.id){
        // create connection
        try{
          const fromId = connectionStart.id;
          const toId = b.id;
          // Prevent duplicate connections between the same pair of blocks
          const key1 = [String(fromId), String(toId)].sort().join('|');
          const duplicate = state.connections.find(c => [String(c.from), String(c.to)].sort().join('|') === key1);
          if(duplicate){
            showToast('Ya existe una conexión entre estos bloques. Use el panel lateral para cambiar la dirección.', true);
            connectionStart = null;
            draw();
            return;
          }
          // Condition blocks can only have 2 outgoing connections (SI and NO)
          const fromBlkForLimit = state.blocks.find(bk => bk.id === fromId);
          if(_isCondBlk(fromBlkForLimit)){
            const outgoing = state.connections.filter(c =>
              String(c.from) === String(fromId) &&
              (c.meta && c.meta.direction) !== 'forward'
            );
            if(outgoing.length >= 2){
              showToast('Un bloque de condición solo puede tener 2 conexiones de salida (SI y NO). Elimine una conexión existente antes de crear esta nueva.', true);
              connectionStart = null;
              draw();
              return;
            }
          }
          await postJSON('/api/connection', {from: fromId, to: toId, meta: {direction: 'backward'}, diagram_id: getDiagramId()||''});
          console.log('Connection created:', fromId, '->', toId);
          connectionStart = null;
          await refreshState();
          connectMode = false;
          document.getElementById('connectMode').style.background = '';
          // Auto-assign SI/NO only for CONDICION→BLOQUE connections
          // (source is condition AND target is NOT condition)
          const fromBlockForLabel = state.blocks.find(bk => bk.id === fromId);
          const toBlockForLabel   = state.blocks.find(bk => bk.id === toId);
          const fromIsCondition   = _isCondBlk(fromBlockForLabel);
          const toIsCondition     = _isCondBlk(toBlockForLabel);
          if(fromIsCondition){
            const backwardFromBlock = state.connections.filter(c =>
              String(c.from) === String(fromId) &&
              (c.meta && c.meta.direction) !== 'forward'
            );
            if(backwardFromBlock.length === 1){
              const c0 = backwardFromBlock[0];
              const m0 = Object.assign({}, c0.meta || {}, { backwardLabel: 'SI' });
              await postJSON('/api/connection/update', { id: c0.id, meta: m0 });
              await refreshState();
            } else if(backwardFromBlock.length >= 2){
              const hasSI = backwardFromBlock.some(c =>
                c.meta && c.meta.backwardLabel === 'SI'
              );
              if(hasSI){
                const noLabel = backwardFromBlock.find(c => !(c.meta && c.meta.backwardLabel));
                if(noLabel){
                  const mn = Object.assign({}, noLabel.meta || {}, { backwardLabel: 'NO' });
                  await postJSON('/api/connection/update', { id: noLabel.id, meta: mn });
                  await refreshState();
                }
              }
            }
          }
          draw();
          if(threeMgr) threeMgr.updateBlocks(state.blocks);
        }catch(e){
          console.error('Connection failed:', e);
          showToast('Error creando conexión: ' + e.message, true);
          connectionStart = null;
        }
      }
    }
    draw();
    return;
  }
  if(b){
    dragging = b;
    dragOffset.x = x - b.x; dragOffset.y = y - b.y;
    selected = b; showProps(b);
  } else {
    const hc = hitTestConnection(x, y);
    if(hc){
      draggingConn = { id: hc.id };
      selected = null;
      hideProps();
    } else {
      selected = null;
      hideProps();
    }
  }
  draw();
});

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left; const y = e.clientY - rect.top;
  if(draggingConn){
    const c = state.connections.find(cc => cc.id === draggingConn.id);
    if(c){
      c.meta = c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta) ? c.meta : {};
      c.meta.mx = x;
      c.meta.my = y;
    }
    draw();
    return;
  }
  if(!dragging) return;
  dragging.x = x - dragOffset.x; dragging.y = y - dragOffset.y;
  draw();
});

canvas.addEventListener('mouseup', async e => {
  if(draggingConn){
    const cid = draggingConn.id;
    draggingConn = null;
    const c = state.connections.find(cc => cc.id === cid);
    if(c){
      try{
        await postJSON('/api/connection/update', { id: c.id, meta: c.meta || {} });
      }catch(err){
        console.error(err);
    alert('Error guardando trazado de conexión: ' + err.message);
        await refreshState();
      }
    }
    draw();
    return;
  }
  if(dragging){
    const savedState = JSON.parse(JSON.stringify(dragging));
    try{
      const dragPayload = Object.assign({}, dragging, { diagram_id: getDiagramId()||'' });
      await postJSON('/api/block', dragPayload);
      console.log('Block position updated:', dragging.id);
    } catch(err){
      console.error('Failed to update block position:', err);
      const idx = state.blocks.findIndex(b => b.id === dragging.id);
      if(idx >= 0) state.blocks[idx] = savedState;
      showToast('Error al guardar posición: ' + err.message, true);
      draw();
    }
  }
  dragging = null;
  draw();
});

document.getElementById('addBlock').addEventListener('click', async () => {
  const btn = document.getElementById('addBlock');
  const diagramId = getDiagramId();
  if(!diagramId){
    showToast('Seleccione empresa y mina antes de crear bloques', true);
    return;
  }
  let newBlockId = null;
  try{
    btn.disabled = true;
    btn.textContent = 'Agregando...';
    newBlockId = 'b' + Math.floor(Math.random()*100000);
    const x = 40 + Math.floor(Math.random()*600);
    const y = 40 + Math.floor(Math.random()*400);
    const w = 120;
    const h = 60;
    // First block on an empty canvas → INICIO
    const isFirst = state.blocks.length === 0;
    const label = isFirst ? 'INICIO' : 'Bloque_' + newBlockId;
    const color = isFirst ? '#4CAF50' : randColor();
    const meta  = isFirst ? { blockType: 'INICIO' } : {};
    const formula = '';
    const payload = { id: newBlockId, x, y, w, h, label, color, formula, meta, diagram_id: diagramId };
    state.blocks.push(Object.assign({}, payload));
    draw();
    if(threeMgr) threeMgr.updateBlocks(state.blocks);
    const result = await postJSON('/api/block', payload);
    console.log('Block created:', result);
    await refreshState();
    btn.disabled = false;
    btn.textContent = 'Añadir bloque';
  }catch(e){
    console.error('create block failed', e);
    showToast('Error creando bloque: '+e.message, true);
    if(newBlockId){
      state.blocks = state.blocks.filter(b => b.id !== newBlockId);
      draw();
      if(threeMgr) threeMgr.updateBlocks(state.blocks);
    }
    await refreshState();
    btn.disabled = false;
    btn.textContent = 'Añadir bloque';
  }
});

document.getElementById('addDecision').addEventListener('click', async () => {
  const btn = document.getElementById('addDecision');
  const diagramId = getDiagramId();
  if(!diagramId){
    showToast('Seleccione empresa y mina antes de crear bloques de condición', true);
    return;
  }
  let newBlockId = null;
  try{
    btn.disabled = true;
    newBlockId = 'd' + Math.floor(Math.random()*100000);
    const x = 60 + Math.floor(Math.random()*500);
    const y = 60 + Math.floor(Math.random()*350);
    const w = 160;
    const h = 90;
    const label = 'Condición_' + newBlockId;
    const color = '#f4d03f';
    const meta = { blockType: 'decision' };
    const payload = { id: newBlockId, x, y, w, h, label, color, formula: '', meta, diagram_id: diagramId };
    state.blocks.push(Object.assign({}, payload));
    draw();
    if(threeMgr) threeMgr.updateBlocks(state.blocks);
    await postJSON('/api/block', payload);
    await refreshState();
    btn.disabled = false;
  } catch(e){
    console.error('create decision failed', e);
    showToast('Error creando bloque de decisión: ' + e.message, true);
    if(newBlockId){ state.blocks = state.blocks.filter(b => b.id !== newBlockId); draw(); }
    await refreshState();
    btn.disabled = false;
  }
});

document.getElementById('connectMode').addEventListener('click', ()=>{
  connectMode = !connectMode; connectionStart = null; document.getElementById('connectMode').style.background = connectMode ? '#ffd' : '';
});

document.getElementById('nuevoDiagrama').addEventListener('click', async () => {
  if(!confirm('Se abrirá un lienzo vacío para esta empresa y mina.\n\nNo se borran en el servidor los bloques del diagrama guardado (identificador emp…_mina…). ¿Continuar?')) return;
  const ctx = JSON.parse(localStorage.getItem('formula_ctx') || '{}');
  const base = diagramContextKey(ctx);
  if(!base){
    alert('Seleccione empresa y mina antes de iniciar un diagrama nuevo.');
    return;
  }
  const btn = document.getElementById('nuevoDiagrama');
  btn.disabled = true;
  btn.textContent = 'Preparando...';
  try{
    const map = JSON.parse(localStorage.getItem(FORMULA_DIAGRAM_VARIANTS) || '{}');
    map[base] = 'd' + Date.now();
    localStorage.setItem(FORMULA_DIAGRAM_VARIANTS, JSON.stringify(map));
    state.blocks = [];
    state.connections = [];
    selected = null;
    connectMode = false;
    connectionStart = null;
    hideProps();
    await refreshState();
    draw();
    renderConnectionsList();
    if(threeMgr) threeMgr.updateBlocks(state.blocks);
  } catch(e){
    alert('Error al preparar el lienzo: ' + e.message);
    await refreshState();
  }
  btn.disabled = false;
  btn.textContent = '🗑 Nuevo Diagrama';
});

document.getElementById('deleteBlock').addEventListener('click', ()=>{
  if(!selected){ showToast('Seleccione un bloque para eliminar', true); return; }
  const blkLabel = selected.label || selected.id;
  showConfirm('¿Eliminar el bloque "' + blkLabel + '" y todas sus conexiones?', async () => {
    const btn = document.getElementById('deleteBlock');
    // Store original state for rollback (declared outside try so catch can access)
    const origBlocks = JSON.parse(JSON.stringify(state.blocks));
    const origConns  = JSON.parse(JSON.stringify(state.connections));
    const delId = selected.id;
    try{
      btn.disabled = true;
      btn.textContent = 'Eliminando...';
      // Optimistic remove
      state.blocks = state.blocks.filter(b=>b.id !== delId);
      state.connections = state.connections.filter(c=> c.from !== delId && c.to !== delId);
      selected = null; hideProps(); draw(); if(threeMgr) threeMgr.updateBlocks(state.blocks);
      // POST to server
      await postJSON('/api/block/delete', {id: delId});
      await refreshState();
      btn.disabled = false;
      btn.textContent = 'Eliminar bloque';
    } catch(e){
      console.error('delete failed', e);
      showToast('Error eliminando bloque: ' + e.message, true);
      // Restore original state
      state.blocks = origBlocks;
      state.connections = origConns;
      draw();
      if(threeMgr) threeMgr.updateBlocks(state.blocks);
      btn.disabled = false;
      btn.textContent = 'Eliminar bloque';
      await refreshState();
    }
  }, 'Eliminar bloque');
});

// Sidebar props
function showProps(b){
  document.getElementById('noSelection').style.display='none'; document.getElementById('props').style.display='block';
  document.getElementById('propId').innerText = b.id;
  document.getElementById('propLabel').value = b.label || '';
  document.getElementById('propColor').value = b.color || '#99ccff';
  document.getElementById('propW').value = b.w || 120;
  document.getElementById('propH').value = b.h || 60;
  // Determine and lock blockType from authoritative DB data
  selectedBlockType = (b.meta && (b.meta.blockType === 'decision' || b.meta.tipo === 'CONDICION')) || (b.color || '').toLowerCase() === '#f4d03f' ? 'decision' : null;
  // Populate FORMULA tab from meta.formula.expression (or raw string)
  const formulaExpr = (b.meta && b.meta.formula && b.meta.formula.expression) ? b.meta.formula.expression : '';
  document.getElementById('propFormula').value = formulaExpr;
  // Populate JSON tab — always include blockType for decision blocks so it is never lost
  const metaForDisplay = Object.assign({}, b.meta || {});
  if(selectedBlockType) metaForDisplay.blockType = selectedBlockType;
  const metaStr = Object.keys(metaForDisplay).length ? JSON.stringify(metaForDisplay, null, 2) : '';
  document.getElementById('propMeta').value = metaStr;
  updateMetaLineCount(metaStr ? metaStr.split('\n').length : 0);
  const fb = document.getElementById('metaFeedback');
  if(fb){ fb.style.display='none'; fb.className='meta-feedback'; }
}
function hideProps(){
  document.getElementById('noSelection').style.display='block'; document.getElementById('props').style.display='none';
}

document.getElementById('saveProps').addEventListener('click', async ()=>{
  if(!selected) return;
  try{
    selected.label = document.getElementById('propLabel').value;
    selected.color = document.getElementById('propColor').value;
    selected.w = parseFloat(document.getElementById('propW').value) || selected.w;
    selected.h = parseFloat(document.getElementById('propH').value) || selected.h;
    try{
      selected.meta = JSON.parse(document.getElementById('propMeta').value || '{}');
      // selectedBlockType is the authoritative source — always force-inject it, no conditions
      if(selectedBlockType) selected.meta.blockType = selectedBlockType;
    } catch(e){ alert('Meta JSON inválido'); return; }
    // Merge raw formula expression from FORMULA tab into meta.formula.expression
    const rawFormula = (document.getElementById('propFormula').value || '').trim();
    if(rawFormula){
      if(!selected.meta.formula) selected.meta.formula = {};
      selected.meta.formula.expression = rawFormula;
    }
    const btn = document.getElementById('saveProps');
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.textContent = 'Guardando...';
    await postJSON('/api/block', selected);
    btn.textContent = 'Guardar';
    btn.disabled = false;
    btn.style.opacity = '1';
    console.log('Block props saved:', selected.id);
    await refreshState();
  } catch(e){
    console.error('Error saving props:', e);
    alert('Error guardando propiedades: ' + e.message);
    document.getElementById('saveProps').textContent = 'Guardar';
    document.getElementById('saveProps').disabled = false;
    document.getElementById('saveProps').style.opacity = '1';
  }
});

document.getElementById('cancelProps').addEventListener('click', ()=>{ if(selected) showProps(selected); });

// ─── Meta 4-tab system ───────────────────────────────────────────────────────
let currentMetaTab = 'formula';

function switchMetaTab(tab){
  currentMetaTab = tab;
  ['formula','json'].forEach(t => {
    const panel = document.getElementById('mpanel-' + t);
    const btn   = document.getElementById('mtab-' + t);
    if(panel) panel.style.display = (t === tab) ? 'block' : 'none';
    if(btn)   btn.classList.toggle('active', t === tab);
  });
  // When switching to JSON, optionally sync formula into JSON
  if(tab === 'json'){
    const formulaEl = document.getElementById('propFormula');
    const metaEl    = document.getElementById('propMeta');
    const rawExpr   = (formulaEl ? formulaEl.value : '').trim();
    if(rawExpr && (!metaEl.value.trim() || metaEl.value.trim() === '{}')){
      // Auto-populate propMeta from formula — always preserve selectedBlockType
      const generated = JSON.parse(buildFormulaJson(rawExpr));
      if(selectedBlockType) generated.blockType = selectedBlockType;
      metaEl.value = JSON.stringify(generated, null, 2);
      updateMetaLineCount(metaEl.value.split('\n').length);
    }
  }
}

function extractVarsFromExpr(expr){
  const stopWords = new Set(['if','then','else','and','or','not','true','false','null',
    'in','is','when','return','function','var','let','const','for','while']);
  const re = /\b([a-zA-Z_][a-zA-Z0-9_]{2,})\b/g;
  const found = [];
  let m;
  while((m = re.exec(expr)) !== null){
    const v = m[1];
    if(!stopWords.has(v.toLowerCase()) && !found.includes(v))
      found.push(v);
  }
  return found;
}

function buildFormulaJson(expr){
  // Split by newlines or semicolons into individual steps
  const lines = expr.split(/[\n;]+/).map(l => l.trim()).filter(l => l.length > 0);
  const steps = lines.map((line, idx) => ({
    paso: idx + 1,
    expression: line,
    type: 'condition',
    variables: extractVarsFromExpr(line)
  }));
  return JSON.stringify({ formula: { steps } }, null, 2);
}

function generateSqlFromFormula(){
  const expr   = (document.getElementById('propFormula').value || '').trim();
  const sqlEl  = document.getElementById('propSql');
  if(!sqlEl) return;
  if(!expr){ sqlEl.value = '-- Ingrese una fórmula en la pestaña FORMULA'; return; }
  let sql = expr
    .replace(/\bAND\b/gi, '\n  AND')
    .replace(/\bOR\b/gi,  '\n  OR ')
    .replace(/\bNOT\b/gi, 'NOT ')
    .replace(/<>/g, '!=');
  sqlEl.value = 'WHERE\n  ' + sql.trim();
}

function _splitByOp(expr, op){
  const re = new RegExp('\\b' + op + '\\b', 'gi');
  const parts = [];
  let last = 0, match;
  const tmp = new RegExp('\\b' + op + '\\b', 'gi');
  while((match = tmp.exec(expr)) !== null){
    parts.push(expr.slice(last, match.index).trim());
    last = match.index + match[0].length;
  }
  parts.push(expr.slice(last).trim());
  return parts.filter(p => p.length > 0);
}

function _buildTree(expr, depth){
  const pad = '  '.repeat(depth);
  const orParts = _splitByOp(expr, 'OR');
  if(orParts.length > 1)
    return pad + '◆ OR\n' + orParts.map(p => _buildTree(p.trim(), depth + 1)).join('\n');
  const andParts = _splitByOp(expr, 'AND');
  if(andParts.length > 1)
    return pad + '◆ AND\n' + andParts.map(p => _buildTree(p.trim(), depth + 1)).join('\n');
  return pad + '├─ ' + expr.trim();
}

function generateVisualTree(){
  const expr    = (document.getElementById('propFormula').value || '').trim();
  const visEl   = document.getElementById('propVisual');
  if(!visEl) return;
  if(!expr){ visEl.textContent = '-- Ingrese una fórmula en la pestaña FORMULA'; return; }
  try { visEl.textContent = _buildTree(expr, 0); }
  catch(e){ visEl.textContent = expr; }
}

function toggleMetaSection(){
  const col  = document.getElementById('metaCollapsible');
  const icon = document.getElementById('metaToggleIcon');
  if(!col) return;
  if(col.style.display === 'none'){
    col.style.display = 'block';
    if(icon) icon.textContent = '▲';
  } else {
    col.style.display = 'none';
    if(icon) icon.textContent = '▼';
  }
}

function updateMetaLineCount(n){
  const el = document.getElementById('metaLineCount');
  if(el) el.textContent = n > 0 ? n + ' líneas' : '—';
}

function showMetaFeedback(type, msg){
  const fb = document.getElementById('metaFeedback');
  if(!fb) return;
  fb.className = 'meta-feedback ' + type;
  fb.textContent = msg;
  fb.style.display = 'block';
}

// Live line count on JSON editor
const propMetaEl = document.getElementById('propMeta');
if(propMetaEl){
  propMetaEl.addEventListener('input', function(){
    updateMetaLineCount(this.value ? this.value.split('\n').length : 0);
    const fb = document.getElementById('metaFeedback');
    if(fb){ fb.style.display='none'; fb.className='meta-feedback'; }
  });
}

// Verificar button: validate JSON tab or convert formula tab → JSON
document.getElementById('verifyProps').addEventListener('click', ()=>{
  if(currentMetaTab === 'formula'){
    // Auto-generate JSON from formula and switch to JSON tab
    const expr = (document.getElementById('propFormula').value || '').trim();
    if(!expr){ showMetaFeedback('info', 'ℹ Ingrese una fórmula primero.'); switchMetaTab('json'); return; }
    // Merge formula JSON into existing meta to preserve blockType and other fields
    let existing = {};
    try{ existing = JSON.parse(document.getElementById('propMeta').value || '{}'); }catch(e){ existing = {}; }
    // selectedBlockType is the single authoritative source — always inject it
    if(selectedBlockType) existing.blockType = selectedBlockType;
    const formulaJson = JSON.parse(buildFormulaJson(expr));
    const merged = Object.assign({}, existing, formulaJson);
    // Guarantee blockType survives the merge
    if(selectedBlockType) merged.blockType = selectedBlockType;
    const pretty = JSON.stringify(merged, null, 2);
    document.getElementById('propMeta').value = pretty;
    updateMetaLineCount(pretty.split('\n').length);
    switchMetaTab('json');
    showMetaFeedback('success', '✔ Fórmula convertida a JSON. Revise y guarde.');
    return;
  }
  // JSON tab: validate / pretty-print
  const textarea = document.getElementById('propMeta');
  const raw = textarea.value.trim();
  if(!raw){
    textarea.value = '{}';
    updateMetaLineCount(1);
    showMetaFeedback('info', 'ℹ Campo vacío — establecido como {}.');
    return;
  }
  try{
    const pretty = JSON.stringify(JSON.parse(raw), null, 2);
    textarea.value = pretty;
    updateMetaLineCount(pretty.split('\n').length);
    showMetaFeedback('success', '✔ JSON válido y formateado. Listo para guardar.');
  } catch(e){
    // Try as formula expression
    const oneLine = raw.replace(/\n/g,' ').replace(/\s+/g,' ').trim();
    if(/[><=!&|+\-*/]/.test(oneLine) || /\b(AND|OR|NOT)\b/i.test(oneLine) || /\b\w+_\w+\b/.test(oneLine)){
      const _fj = JSON.parse(buildFormulaJson(oneLine));
      if(selectedBlockType) _fj.blockType = selectedBlockType;
      const pretty = JSON.stringify(_fj, null, 2);
      textarea.value = pretty;
      updateMetaLineCount(pretty.split('\n').length);
      showMetaFeedback('success', '✔ Expresión convertida a JSON.');
    } else {
      showMetaFeedback('error', '✘ JSON inválido: ' + e.message.slice(0, 100));
    }
  }
});
// ─── end Meta tabs ────────────────────────────────────────────────────────────

function normalizeMeta(m){
  if(m && typeof m === 'object' && !Array.isArray(m)) return m;
  return {};
}

async function refreshState(){
  const diagramId = getDiagramId();
  if(!diagramId){
    // No context selected → blank canvas (multi-tenant: don't show other users' diagrams)
    state.blocks = [];
    state.connections = [];
    selected = null;
    hideProps();
    draw();
    renderConnectionsList();
    return;
  }
  try{
    const res = await getJSON('/api/state?diagram_id=' + encodeURIComponent(diagramId));
    state.blocks = res.blocks.map(b => ({
      ...b,
      x: parseFloat(b.x),
      y: parseFloat(b.y),
      w: parseFloat(b.w),
      h: parseFloat(b.h),
      meta: normalizeMeta(b.meta)
    }));
    // Map connections, then deduplicate — keep highest id per block-pair (prevents ghost arrows from duplicate DB rows)
    const rawConns = (res.connections || []).map(c => ({
      from: c.from,
      to: c.to,
      id: c.id,
      meta: normalizeMeta(c.meta)
    }));
    const pairMap = new Map();
    rawConns.sort((a, b) => a.id - b.id).forEach(c => {
      const key = [String(c.from), String(c.to)].sort().join('|');
      pairMap.set(key, c); // last write (highest id) wins
    });
    state.connections = Array.from(pairMap.values());
    draw();
    renderConnectionsList();
    if(selected){
      const still = state.blocks.find(b => b.id === selected.id);
      if(still) showProps(still);
      else { selected = null; hideProps(); }
    }
    if(selected) await loadRulesFor(selected.id);
  }catch(e){ console.error('refresh failed', e); }
}

function renderConnectionsList(){
  const el = document.getElementById('connectionsList');
  if(!el) return;
  if(!state.connections || state.connections.length === 0){
    el.innerHTML = '<p style="color:#95a5a6; font-size:12px; margin:0;">Sin conexiones. Use «Modo conexión» y pulse dos bloques.</p>';
    return;
  }
  const dirLabel = { forward:'→', backward:'←' };
  el.innerHTML = state.connections.map(c => {
    const safeFrom = String(c.from).replace(/</g,'&lt;');
    const safeTo   = String(c.to).replace(/</g,'&lt;');
    const dir = (c.meta && c.meta.direction) === 'forward' ? 'forward' : 'backward';
    const sym = dir === 'backward' ? '←' : '→';
    const opt = (v, lbl) => `<option value="${v}"${dir===v?' selected':''}>${lbl}</option>`;
    return `<div style="display:flex;align-items:center;gap:5px;padding:6px;margin-bottom:6px;background:#fff;border:1px solid #e0e4e8;border-radius:4px;font-size:11px;">
      <span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="id ${c.id}">${safeFrom} <b>${sym}</b> ${safeTo}</span>
      <select class="conn-dir" data-cid="${c.id}" title="Dirección de la flecha" style="font-size:12px;padding:2px 6px;border:1px solid #c8d6e3;border-radius:3px;cursor:pointer;background:#f0f4f8;color:#1e3a5f;font-weight:700;flex-shrink:0;">
        ${opt('forward','Dir 1 →')}${opt('backward','Dir 2 ←')}
      </select>
      <button type="button" class="conn-edit" data-cid="${c.id}" title="Editar conexión" style="padding:3px 8px;font-size:11px;cursor:pointer;background:#16543a;color:#fff;border:none;border-radius:3px;flex-shrink:0;">✏️</button>
      <button type="button" class="conn-del" data-cid="${c.id}" title="Eliminar conexión" style="padding:3px 8px;font-size:11px;cursor:pointer;background:#e74c3c;color:#fff;border:none;border-radius:3px;flex-shrink:0;">✕</button>
    </div>`;
  }).join('');

  // Use event delegation on the container — immune to innerHTML rebuilds
  // Remove any previously attached delegated listener before adding a fresh one
  if(el._delegatedHandler) el.removeEventListener('click', el._delegatedHandler);
  if(el._delegatedChange) el.removeEventListener('change', el._delegatedChange);

  el._delegatedChange = async (e) => {
    const sel = e.target.closest('.conn-dir');
    if(!sel) return;
    const id = parseInt(sel.getAttribute('data-cid'), 10);
    const c = state.connections.find(x => x.id === id);
    if(!c) return;
    const meta = Object.assign({}, c.meta || {}, { direction: sel.value });
    try{
      await postJSON('/api/connection/update', { id, meta });
      await refreshState();
      draw();
    }catch(err){ showToast('Error al cambiar dirección: ' + err.message, true); }
  };
  el.addEventListener('change', el._delegatedChange);

  el._delegatedHandler = (e) => {
    // Edit button
    const editBtn = e.target.closest('.conn-edit');
    if(editBtn){ openConnEditor(parseInt(editBtn.getAttribute('data-cid'), 10)); return; }

    // Delete button
    const delBtn = e.target.closest('.conn-del');
    if(!delBtn) return;
    const id = parseInt(delBtn.getAttribute('data-cid'), 10);
    if(isNaN(id) || id <= 0) return;
    const conn = state.connections.find(x => x.id === id);
    const fromLbl = conn ? (state.blocks.find(b=>b.id===conn.from)||{label:conn.from}).label : id;
    const toLbl   = conn ? (state.blocks.find(b=>b.id===conn.to  )||{label:conn.to  }).label : '';
    showConfirm(
      '¿Eliminar la conexión entre\n"' + fromLbl + '" y "' + toLbl + '"?',
      async () => {
        try{
          await postJSON('/api/connection/delete', { id });
          await refreshState();
        }catch(err){ showToast('Error al eliminar conexión: ' + err.message, true); }
      },
      'Eliminar conexión'
    );
  };
  el.addEventListener('click', el._delegatedHandler);
}

// Load and display variables (data dictionary) in left sidebar
async function loadVariables(){
  try{
    const vars = await getJSON('/api/variables');
    const list = document.getElementById('variablesList');
    list.innerHTML = '';
    if(!vars || vars.length === 0){
      list.innerHTML = '<p style="color:#95a5a6; font-size:13px; padding:10px; text-align:center;">No hay variables</p>';
      return;
    }
    vars.forEach(v => {
      const item = document.createElement('div');
      item.className = 'variable-item';
      item.innerHTML = `
        <div class="variable-name">${v.name}</div>
        <div class="variable-unit">${v.type}${v.unit ? ' [' + v.unit + ']' : ''}</div>
      `;
      item.title = `${v.name}\n${v.description || ''}\nTipo: ${v.type}\n— doble-clic para insertar en Expresión —`;
      item.addEventListener('click', ()=>{
        navigator.clipboard.writeText(v.name).then(()=>{
          console.log(`Variable "${v.name}" copiada al portapapeles`);
        });
      });
      item.addEventListener('dblclick', ()=>{
        let target;
        if(connEditorActiveId !== null){
          target = document.getElementById('connCondition');
        } else if(currentMetaTab === 'formula'){
          target = document.getElementById('propFormula');
        } else {
          target = document.getElementById('ruleExpr');
        }
        if(target){
          const pos = target.selectionStart || target.value.length || 0;
          const val = target.value;
          target.value = val.slice(0, pos) + v.name + val.slice(pos);
          target.selectionStart = target.selectionEnd = pos + v.name.length;
          target.focus();
        }
      });
      list.appendChild(item);
    });
  }catch(e){ 
    console.error('Error cargando variables:', e);
    const list = document.getElementById('variablesList');
    list.innerHTML = '<p style="color:#e74c3c; font-size:12px;">Error cargando variables</p>';
  }
}

// Load and display operators (math/logical) in left sidebar
async function loadOperators(){
  try {
    const ops = await getJSON('/api/operators');
    const list = document.getElementById('operatorsList');
    list.innerHTML = '';
    if(!ops || ops.length === 0) {
      list.innerHTML = '<p style="color:#95a5a6; font-size:13px; padding:10px; text-align:center;">No hay operadores</p>';
      return;
    }
    
    // Group by category
    const grouped = {};
    ops.forEach(o => {
      const cat = o.category || 'otro';
      if(!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(o);
    });
    
    Object.keys(grouped).sort().forEach(category => {
      const catLabel = document.createElement('div');
      catLabel.style.cssText = 'font-size:11px; font-weight:600; color:#1e3a5f; margin-top:12px; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.5px; padding:0 4px; border-bottom:1px solid #e0e4e8;';
      const catName = category.charAt(0).toUpperCase() + category.slice(1);
      const categoryIcons = {
        'arithmetic': '🔢',
        'comparison': '⚖️',
        'logical': '✔️',
        'functions': '⚙️',
        'conditional': '❓'
      };
      catLabel.textContent = (categoryIcons[category] || '•') + ' ' + catName;
      list.appendChild(catLabel);
      
      grouped[category].forEach(o => {
        const item = document.createElement('div');
        item.className = 'operator-item';
        const icon = o.icon_emoji || o.symbol;
        item.innerHTML = '<div class="operator-name"><span style="font-size:18px; margin-right:6px;">' + icon + '</span>' + o.name + '</div><div class="operator-category">' + o.symbol + (o.description ? ' — ' + o.description : '') + '</div>';
        item.title = o.name + '\nSímbolo: ' + o.symbol + '\n' + (o.description || '') + '\n— doble-clic para insertar en Expresión —';
        item.addEventListener('click', function() {
          navigator.clipboard.writeText(o.symbol).then(function() {
            console.log('Operador "' + o.symbol + '" copiado al portapapeles');
          });
        });
        item.addEventListener('dblclick', function() {
          let target;
          if(connEditorActiveId !== null){
            target = document.getElementById('connCondition');
          } else if(currentMetaTab === 'formula'){
            target = document.getElementById('propFormula');
          } else {
            target = document.getElementById('ruleExpr');
          }
          if(target){
            const pos = target.selectionStart || target.value.length || 0;
            const val = target.value;
            target.value = val.slice(0, pos) + o.symbol + val.slice(pos);
            target.selectionStart = target.selectionEnd = pos + o.symbol.length;
            target.focus();
          }
        });
        list.appendChild(item);
      });
    });
  } catch(e) { 
    console.error('Error cargando operadores:', e);
    const list = document.getElementById('operatorsList');
    list.innerHTML = '<p style="color:#e74c3c; font-size:12px;">Error cargando operadores</p>';
  }
}

// WebSocket manager: automatic reconnect, ping/pong and batched handling
// build WS URL dynamically including token from localStorage
// WebSocket uses same host/port as the page (nginx proxies /ws to backend_cpp)
function buildWsUrl(){
  const token = localStorage.getItem('AUTH_TOKEN') || '';
  const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  const prefix = FORMULA_API_PREFIX || '';
  const base = proto + location.host + prefix + '/ws';
  return token ? base + '?token=' + encodeURIComponent(token) : base;
}
let _refreshTimer = null;
function debouncedRefresh(){
  if(_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(()=>{
    refreshState();
    _refreshTimer = null;
  }, 120);
}

function setWsStatus(text, color){
  const el = document.getElementById('wsStatus');
  if(!el) return;
  el.textContent = text;
  el.style.color = color || '#888';
}

class WSManager{
  constructor(){
    this.ws = null;
    this.backoff = 500;
    this.maxBackoff = 10000;
    this.pingInterval = 15000;
    this.lastSeen = Date.now();
    this.pingTimer = null;
    this.watchdog = null;
    this.connecting = false;
  }

  connect(){
    if(this.connecting) return;
    this.connecting = true;
    setWsStatus('conectando', '#f90');
    const url = buildWsUrl();
    try{
      this.ws = new WebSocket(url);
    } catch(e){
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }
    
    this.ws.onopen = () => {
      console.log('ws open');
      this.connecting = false;
      this.backoff = 1000;
      setWsStatus('conectado', '#0a0');
      this.lastSeen = Date.now();
      this.startPing();
    };

    this.ws.onmessage = (ev) => {
      try{
        const msg = JSON.parse(ev.data);
        this.lastSeen = Date.now();
        if(msg.type === 'pong'){
          console.log('got pong');
          return;
        }
        if(msg.type === 'batch' || msg.type === 'block_upsert' || msg.type === 'connection_create' || msg.type === 'connection_update' || msg.type === 'connection_delete' || msg.type === 'block_delete'){
          debouncedRefresh();
          return;
        }
        if(msg.type === 'heartbeat'){
          debouncedRefresh();
        } else {
          debouncedRefresh();
        }
      } catch(e){
        console.error('ws parse', e);
        debouncedRefresh();
      }
    };

    this.ws.onclose = () => {
      console.warn('ws closed');
      setWsStatus('desconectado', '#a00');
      this.connecting = false;
      this.stopPing();
      this.scheduleReconnect();
    };

    this.ws.onerror = (e) => {
      console.error('ws error', e);
      setWsStatus('error', '#a00');
      this.ws.close();
    };
  }

  scheduleReconnect(){
    const delay = this.backoff;
    console.log('reconnect in', delay);
    setWsStatus('reconectando...', '#f90');
    setTimeout(()=>{
      this.connect();
    }, delay);
    this.backoff = Math.min(Math.floor(this.backoff * 1.8), this.maxBackoff);
  }

  startPing(){
    if(this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(()=>{
      try{
        if(this.ws && this.ws.readyState === WebSocket.OPEN){
          this.send({type:'ping', ts: Date.now()});
        }
        if(Date.now() - this.lastSeen > this.pingInterval * 2){
          console.warn('watchdog: stale connection, reconnecting');
          try{ this.ws.close(); } catch(e){}
        }
      } catch(e){
        console.error('ping failed', e);
      }
    }, this.pingInterval);
  }

  stopPing(){
    if(this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  send(obj){
    try{
      if(this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
    } catch(e){
      console.error('ws send failed', e);
    }
  }

  close(){
    try{ if(this.ws) this.ws.close(); } catch(e){}
  }
}

const wsManager = new WSManager();
document.getElementById('wsReconnect').addEventListener('click', ()=>{
  try{ wsManager.close(); } catch(e){}
  wsManager.backoff = 1000;
  wsManager.connect();
});

// Token UI: save token to localStorage
document.getElementById('saveToken').addEventListener('click', ()=>{
  const v = document.getElementById('authToken').value || '';
  localStorage.setItem('AUTH_TOKEN', v);
  alert('Token guardado en localStorage');
});

// Prefill auth input from storage
document.getElementById('authToken').value = localStorage.getItem('AUTH_TOKEN') || '';

// Start connection
wsManager.connect();

// Initial load — load existing blocks/connections from DB immediately (scoped to empresa+mina context)
draw();
loadVariables();
loadOperators();
refreshState(); // populate canvas from DB on page open (returns blank if no context selected)

// When empresa or mina selector changes, reload the diagram for the new context
window.addEventListener('formulaCtxChange', () => { refreshState(); });

// Rules UI: load rules for block
async function loadRulesFor(blockId){
  try{
    const res = await getJSON('/api/rules?block_id=' + encodeURIComponent(blockId));
    const container = document.getElementById('rulesList');
    container.innerHTML = '';
    res.forEach(r => {
      const div = document.createElement('div');
      div.style.borderTop = '1px solid #eee';
      div.style.padding = '6px 0';
      div.innerHTML = '<div><strong>Rule #' + r.id + '</strong></div><div><pre style="white-space:pre-wrap">' + escapeHtml(r.expr) + '</pre></div>';
      const btnEdit = document.createElement('button');
      btnEdit.textContent = 'Editar';
      btnEdit.style.marginRight = '6px';
      const btnDel = document.createElement('button');
      btnDel.textContent = 'Eliminar';
      btnEdit.onclick = ()=>{ openRuleEditor(r); };
      btnDel.onclick = async ()=>{
        if(confirm('Eliminar regla?')){
          await postJSON('/api/rule/delete', {id:r.id});
          debouncedRefresh();
        }
      };
      div.appendChild(btnEdit);
      div.appendChild(btnDel);
      container.appendChild(div);
    });
  } catch(e){
    console.error('load rules failed', e);
  }
}

function escapeHtml(s){
  return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Connection Editor — Floating Draggable Panel ─────────────────────────

// Helper: identifies a condition/decision block by blockType OR color (color is the fallback
// for blocks that lost blockType in DB)
function _isCondBlk(blk){
  return !!(blk && ((blk.meta && (blk.meta.blockType === 'decision' || blk.meta.tipo === 'CONDICION')) || blk.color === '#f4d03f'));
}

function closeConnEditor(){
  document.getElementById('connEditor').style.display = 'none';
  connEditorActiveId = null;
}

function setConnLabel(val){
  document.getElementById('connLabelSI').classList.toggle('active-label', val === 'SI');
  document.getElementById('connLabelNO').classList.toggle('active-label', val === 'NO');
}

function connTargetIsCondition(){
  if(connEditorActiveId === null) return false;
  const c = state.connections.find(x => x.id === connEditorActiveId);
  if(!c) return false;
  const toBlock = state.blocks.find(b => b.id === c.to);
  return _isCondBlk(toBlock);
}

// Returns true if source block is a condition (CONDICION→BLOQUE or CONDICION→CONDICION)
function connSourceIsCondition(){
  if(connEditorActiveId === null) return false;
  const c = state.connections.find(x => x.id === connEditorActiveId);
  if(!c) return false;
  const fromBlock = state.blocks.find(b => b.id === c.from);
  return _isCondBlk(fromBlock);
}

function updateBackwardLabelVisibility(){
  const dir = document.getElementById('connEditorDir').value;
  const row = document.getElementById('connBackwardLabelRow');
  // Show SI/NO only for CONDICION→BLOQUE (source is condition, target is not)
  // Hide for BLOQUE→CONDICION (target is condition) and for non-backward directions
  if(dir === 'backward' && connSourceIsCondition()){
    row.style.display = 'block';
  } else {
    row.style.display = 'none';
    setConnLabel(null);
  }
}

function switchConnTab(tab){
  ['formula','json'].forEach(t => {
    const panel = document.getElementById('cpanel-' + t);
    const btn   = document.getElementById('ctab-' + t);
    if(panel) panel.style.display = (t === tab) ? 'block' : 'none';
    if(btn)   btn.classList.toggle('active', t === tab);
  });
  if(tab === 'json'){
    const cond    = (document.getElementById('connCondition').value || '').trim();
    const preview = document.getElementById('connJsonPreview');
    if(cond){
      preview.value = buildFormulaJson(cond);
    } else {
      preview.value = '// Sin condición ingresada.';
    }
  }
}

function openConnEditor(cid){
  const c = state.connections.find(x => x.id === cid);
  if(!c){ alert('Conexión no encontrada'); return; }
  const fromBlock = state.blocks.find(b => b.id === c.from);
  const toBlock   = state.blocks.find(b => b.id === c.to);
  const fromName  = fromBlock ? (fromBlock.label || fromBlock.id) : c.from;
  const toName    = toBlock   ? (toBlock.label   || toBlock.id)   : c.to;
  const dir       = (c.meta && c.meta.direction) ? c.meta.direction : 'backward';
  const cond      = (c.meta && c.meta.condition) ? c.meta.condition : '';

  document.getElementById('connEditorId').value         = cid;
  document.getElementById('connEditorInfo').textContent = fromName + '  →  ' + toName;
  document.getElementById('connEditorDir').value        = dir;
  document.getElementById('connCondition').value        = cond;
  document.getElementById('connJsonPreview').value      = '';

  connEditorActiveId  = cid;

  const backwardLabel = (c.meta && c.meta.backwardLabel) ? c.meta.backwardLabel : null;
  setConnLabel(backwardLabel);
  updateBackwardLabelVisibility();

  switchConnTab('formula');

  const panel = document.getElementById('connEditor');
  panel.style.display = 'block';
  panel.style.right   = '500px';
  panel.style.top     = '80px';
  panel.style.left    = '';
  document.getElementById('connCondition').focus();
}

// Make connEditor panel draggable
(function(){
  const panel = document.getElementById('connEditor');
  const bar   = document.getElementById('connEditorGrabBar');
  if(!panel || !bar) return;
  let isDragging = false, startX, startY, origLeft, origTop;
  bar.addEventListener('mousedown', function(e){
    if(e.target.id === 'connEditorCloseBtn') return;
    isDragging = true;
    const rect = panel.getBoundingClientRect();
    origLeft = rect.left; origTop = rect.top;
    startX = e.clientX; startY = e.clientY;
    panel.style.right = ''; panel.style.left = origLeft + 'px'; panel.style.top = origTop + 'px';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e){
    if(!isDragging) return;
    let newLeft = origLeft + (e.clientX - startX);
    let newTop  = origTop  + (e.clientY - startY);
    newLeft = Math.max(0, Math.min(window.innerWidth  - panel.offsetWidth,  newLeft));
    newTop  = Math.max(0, Math.min(window.innerHeight - 60,                 newTop));
    panel.style.left = newLeft + 'px'; panel.style.top = newTop + 'px';
  });
  document.addEventListener('mouseup', function(){ isDragging = false; });
})();

document.getElementById('connEditorCloseBtn').addEventListener('click', closeConnEditor);
document.getElementById('connEditorCancel').addEventListener('click', closeConnEditor);
document.getElementById('connEditorDir').addEventListener('change', updateBackwardLabelVisibility);

document.getElementById('connEditorVerify').addEventListener('click', ()=>{
  const cond = (document.getElementById('connCondition').value || '').trim();
  if(!cond){
    document.getElementById('connJsonPreview').value = '// Sin condición ingresada.';
  } else {
    document.getElementById('connJsonPreview').value = buildFormulaJson(cond);
  }
  switchConnTab('json');
});

document.getElementById('connEditorSave').addEventListener('click', async ()=>{
  try{
    const id   = parseInt(document.getElementById('connEditorId').value, 10);
    const dir  = document.getElementById('connEditorDir').value;
    const cond = document.getElementById('connCondition').value.trim();
    if(!id){ alert('Error: id de conexión no válido'); return; }
    const c    = state.connections.find(x => x.id === id);
    const toBlockForSave   = c ? state.blocks.find(b => b.id === c.to)   : null;
    const fromBlockForSave = c ? state.blocks.find(b => b.id === c.from) : null;
    // backwardLabel whenever source is condition (CONDICION→BLOQUE or CONDICION→CONDICION)
    const saveIsCondToBlk = _isCondBlk(fromBlockForSave);
    let backwardLabel = null;
    if(dir === 'backward' && saveIsCondToBlk){
      if(document.getElementById('connLabelSI').classList.contains('active-label')) backwardLabel = 'SI';
      else if(document.getElementById('connLabelNO').classList.contains('active-label')) backwardLabel = 'NO';
    }
    const meta = Object.assign({}, c ? (c.meta || {}) : {}, { direction: dir, condition: cond, backwardLabel });
    const btn  = document.getElementById('connEditorSave');
    btn.disabled = true; btn.textContent = '⏳ Guardando...';
    await postJSON('/api/connection/update', { id, meta });
    btn.disabled = false; btn.textContent = '💾 Guardar';
    closeConnEditor();
    await refreshState();
    draw();
  } catch(err){
    alert('Error guardando conexión: ' + err.message);
    const btn = document.getElementById('connEditorSave');
    btn.disabled = false; btn.textContent = '💾 Guardar';
  }
});
// ─────────────────────────────────────────────────────────────────────────────

// Rule editor — Floating draggable panel
function closeRuleEditor(){
  document.getElementById('ruleEditor').style.display = 'none';
}

function openRuleEditor(rule){
  document.getElementById('ruleExpr').value = rule ? rule.expr : '';
  document.getElementById('ruleBlockId').value = rule ? rule.block_id : (selected ? selected.id : '');
  document.getElementById('ruleId').value = rule ? (rule.id || '') : '';
  // Pre-populate JSON preview if editing an existing rule
  const preview = document.getElementById('ruleJsonPreview');
  const fb = document.getElementById('ruleVerifyFeedback');
  if(rule && rule.expr){
    try {
      preview.value = buildFormulaJson(rule.expr);
      const parsed = JSON.parse(preview.value);
      fb.style.display = 'block';
      fb.style.color = '#27ae60';
      fb.textContent = '✔ ' + parsed.formula.steps.length + ' paso(s) cargado(s).';
    } catch(e){ preview.value = ''; fb.style.display = 'none'; }
  } else {
    preview.value = '';
    fb.style.display = 'none';
  }
  const panel = document.getElementById('ruleEditor');
  panel.style.display = 'block';
  // Reset position to default right side on each open so panel is always visible
  panel.style.right = '20px';
  panel.style.top = '80px';
  panel.style.left = '';
  document.getElementById('ruleExpr').focus();
}

// Make rule editor panel draggable via grab bar
(function(){
  const panel = document.getElementById('ruleEditor');
  const bar = document.getElementById('ruleEditorGrabBar');
  if(!panel || !bar) return;
  let dragging = false, startX, startY, origLeft, origTop;
  bar.addEventListener('mousedown', function(e){
    if(e.target.id === 'ruleEditorCloseBtn') return; // let close button work normally
    dragging = true;
    const rect = panel.getBoundingClientRect();
    origLeft = rect.left;
    origTop = rect.top;
    startX = e.clientX;
    startY = e.clientY;
    // switch from right-anchored to left-anchored so we can freely drag
    panel.style.right = '';
    panel.style.left = origLeft + 'px';
    panel.style.top = origTop + 'px';
    e.preventDefault();
  });
  document.addEventListener('mousemove', function(e){
    if(!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    let newLeft = origLeft + dx;
    let newTop = origTop + dy;
    // clamp within viewport
    newLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, newLeft));
    newTop = Math.max(0, Math.min(window.innerHeight - 60, newTop));
    panel.style.left = newLeft + 'px';
    panel.style.top = newTop + 'px';
  });
  document.addEventListener('mouseup', function(){ dragging = false; });
})();

document.getElementById('ruleNew').addEventListener('click', ()=> openRuleEditor(null));
document.getElementById('ruleCancel').addEventListener('click', closeRuleEditor);
document.getElementById('ruleEditorCloseBtn').addEventListener('click', closeRuleEditor);

document.getElementById('ruleVerify').addEventListener('click', ()=>{
  const expr = (document.getElementById('ruleExpr').value || '').trim();
  const fb   = document.getElementById('ruleVerifyFeedback');
  if(!expr){
    fb.style.display = 'block';
    fb.style.color   = '#c0392b';
    fb.textContent   = '⚠ Ingrese una expresión primero.';
    document.getElementById('ruleJsonPreview').value = '';
    return;
  }
  const json = buildFormulaJson(expr);
  document.getElementById('ruleJsonPreview').value = json;
  fb.style.display = 'block';
  fb.style.color   = '#27ae60';
  fb.textContent   = '✔ JSON generado — ' + JSON.parse(json).formula.steps.length + ' paso(s).';
});

document.getElementById('ruleSave').addEventListener('click', async ()=>{
  try{
    const id = document.getElementById('ruleId').value;
    const block_id = document.getElementById('ruleBlockId').value;
    const expr = document.getElementById('ruleExpr').value;
    if(!block_id || !expr) return alert('block_id y expr requeridos');
    const numId = id ? parseInt(id, 10) : null;
    // Auto-generate JSON meta from formula steps
    let metaObj = {};
    try { metaObj = JSON.parse(buildFormulaJson(expr)); } catch(e){ /* ignore */ }
    const payload = { id: numId, block_id, expr, meta: metaObj };
    const btn = document.getElementById('ruleSave');
    btn.disabled = true;
    btn.textContent = '⏳ Guardando...';
    await postJSON('/api/rule', payload);
    btn.disabled = false;
    btn.textContent = '💾 Guardar regla';
    console.log('Rule saved');
    closeRuleEditor();
    debouncedRefresh();
  } catch(e){
    console.error('Error saving rule:', e);
    alert('Error guardando regla: ' + e.message);
    const btn = document.getElementById('ruleSave');
    btn.disabled = false;
    btn.textContent = '💾 Guardar regla';
  }
});

// Voice control: simple STT mapping using Web Speech API
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer = null;
if(SpeechRecognition){
  recognizer = new SpeechRecognition();
  recognizer.lang = 'es-ES';
  recognizer.continuous = false;
  recognizer.onresult = async (ev)=>{
    const text = ev.results[0][0].transcript.trim().toLowerCase();
    console.log('voice:', text);
    await handleVoiceCommand(text);
  };
  recognizer.onerror = (e)=> console.error('stt error', e);
}

document.getElementById('voiceBtn').addEventListener('click', ()=>{
  if(!recognizer) return alert('SpeechRecognition no disponible en este navegador');
  try{ recognizer.start(); document.getElementById('voiceBtn').style.background='#dfd'; }catch(e){}
});

async function handleVoiceCommand(text){
  // Very simple parsing: crear bloque <label>, eliminar bloque <label>, conectar <a> con <b>
  if(text.startsWith('crear bloque')){
    const label = text.replace('crear bloque','').trim() || ('b'+Math.floor(Math.random()*99999));
    const id = 'b' + Math.floor(Math.random()*100000);
    const payload = { id, x:50, y:50, w:120, h:60, label, color: randColor(), meta: {} };
    await postJSON('/api/block', payload); debouncedRefresh(); return;
  }
  if(text.startsWith('eliminar bloque')){
    const label = text.replace('eliminar bloque','').trim();
    const b = state.blocks.find(bb => (bb.label||'').toLowerCase() === label);
    if(b){ await postJSON('/api/block/delete', {id: b.id}); debouncedRefresh(); } else alert('Bloque no encontrado: '+label);
    return;
  }
  if(text.startsWith('conectar')){
    // conectar A con B
    const m = text.match(/conectar\s+(.+)\s+con\s+(.+)/);
    if(m){
      const a = state.blocks.find(bb => (bb.label||'').toLowerCase() === m[1].trim());
      const b = state.blocks.find(bb => (bb.label||'').toLowerCase() === m[2].trim());
      if(a && b){ await postJSON('/api/connection', {from: a.id, to: b.id, meta: {}}); debouncedRefresh(); }
      else alert('No se hallaron bloques para conectar');
    }
    return;
  }
  alert('Comando no reconocido: '+text);
}

// Three.js 3D view manager
class ThreeManager{
  constructor(containerId){
    this.container = document.getElementById(containerId);
    this.renderer = null; this.scene = null; this.camera = null; this.controls = null; this.meshMap = new Map(); this.animateId = null;
    this.init();
  }
  init(){
    if(!this.container) return;
    // load THREE from global (included via CDN if available)
    if(typeof THREE === 'undefined') return;
    const width = Math.max(400, this.container.clientWidth || 800);
    const height = Math.max(300, this.container.clientHeight || 600);
    this.renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
    this.renderer.setPixelRatio(window.devicePixelRatio || 1);
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0xf8fbff);
    this.camera = new THREE.PerspectiveCamera(50, width/height, 1, 5000); this.camera.position.set(0, -300, 700); this.camera.lookAt(0,0,0);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6); this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.9); dir.position.set(300, 400, 300); dir.castShadow = true; dir.shadow.radius = 4; dir.shadow.mapSize.width=2048; dir.shadow.mapSize.height=2048; this.scene.add(dir);
    const ambient = new THREE.AmbientLight(0xffffff, 0.25); this.scene.add(ambient);
    // ground plane
    const gmat = new THREE.MeshStandardMaterial({color:0xf2f4f8, roughness:0.9, metalness:0});
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(3000,3000,1,1), gmat); plane.rotation.x = -Math.PI/2; plane.position.y = 0; plane.receiveShadow = true; this.scene.add(plane);
    // orbit controls if available
    if(THREE.OrbitControls){ this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement); this.controls.target.set(0,0,0); }
    window.addEventListener('resize', ()=> this.onResize());
    // ensure proper sizing after attach
    this.onResize();
    this.animate();
  }
  onResize(){ if(!this.renderer) return; const w = this.container.clientWidth; const h = this.container.clientHeight; this.renderer.setSize(w,h); this.camera.aspect = w/h; this.camera.updateProjectionMatrix(); }
  animate(){ this.animateId = requestAnimationFrame(()=>this.animate()); if(this.controls) this.controls.update(); this.renderer.render(this.scene, this.camera); }
  updateBlocks(blocks){ if(!this.scene) return; const existing = new Set(this.meshMap.keys());
    // map canvas coordinates to 3D plane coordinates
    const canvasEl = document.getElementById('canvas');
    const cw = (canvasEl && canvasEl.width) ? canvasEl.width : Math.max(800, this.container.clientWidth);
    const ch = (canvasEl && canvasEl.height) ? canvasEl.height : Math.max(600, this.container.clientHeight);
    blocks.forEach(b=>{ existing.delete(b.id); const mesh = this.meshMap.get(b.id); const sx = Math.max(30, b.w/40); const sy = Math.max(20, b.h/40);
      // center-based mapping
      const x3 = (b.x + b.w/2) - cw/2;
      const y3 = -((b.y + b.h/2) - ch/2);
      if(mesh){ mesh.position.set(x3, y3, sy/2); mesh.scale.set(sx, sy, 1); } else {
        const color = new THREE.Color(b.color || '#99ccff'); const mat = new THREE.MeshStandardMaterial({color: color, metalness:0.1, roughness:0.5}); const geom = new THREE.BoxGeometry(1,1,1);
        const m = new THREE.Mesh(geom, mat); m.castShadow = true; m.receiveShadow = true; m.position.set(x3, y3, sy/2); m.scale.set(sx, sy, 1); this.scene.add(m); this.meshMap.set(b.id, m);
        // label via sprite
        const canvas = document.createElement('canvas'); canvas.width=256; canvas.height=64; const ctx = canvas.getContext('2d'); ctx.fillStyle='rgba(255,255,255,0.95)'; ctx.fillRect(0,0,256,64); ctx.fillStyle='#000'; ctx.font='24px Arial'; ctx.textAlign='center'; ctx.fillText(b.label||b.id,128,40);
        const tex = new THREE.CanvasTexture(canvas); tex.needsUpdate = true; const spriteMat = new THREE.SpriteMaterial({map:tex}); const sprite = new THREE.Sprite(spriteMat); sprite.scale.set(160,40,1); sprite.position.set(0,0, (sy) + 4); m.add(sprite);
    }});
    // remove stale
    existing.forEach(id=>{ const m = this.meshMap.get(id); if(m){ this.scene.remove(m); this.meshMap.delete(id); } });
  }
  destroy(){ if(this.animateId) cancelAnimationFrame(this.animateId); if(this.renderer && this.renderer.domElement) this.container.removeChild(this.renderer.domElement); this.renderer = null; this.scene = null; this.camera = null; }
}

// update 3D view when state refreshes
const origRefreshState = refreshState;
refreshState = async function(){ await origRefreshState(); if(threeMgr) threeMgr.updateBlocks(state.blocks || []); };

// ── Canvas ResizeObserver: keep canvas buffer matched to CSS display size ──
(function(){
  if(typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(() => {
    const old_w = canvas.width, old_h = canvas.height;
    resizeCanvas();
    if(canvas.width !== old_w || canvas.height !== old_h) draw();
  });
  ro.observe(canvas);
})();

// ═══════════════════════════════════════════════════════════════════════════
// BÚSQUEDA AVANZADA DE HISTORIAL DE FÓRMULAS
// ═══════════════════════════════════════════════════════════════════════════

(function(){
  // ── state ────────────────────────────────────────────────────────────────
  let _catalogos = [];       // cache de catálogos cargados
  let _allResults = [];      // todos los resultados de la búsqueda actual
  let _curPage   = 1;
  let _perPage   = 25;
  let _totalPages = 1;
  let _searching  = false;

  // ── DOM refs ─────────────────────────────────────────────────────────────
  const overlay      = document.getElementById('buscarModalOverlay');
  const modal        = document.getElementById('buscarModal');
  const closeBtn     = document.getElementById('buscarModalClose');
  const openBtn      = document.getElementById('btnBuscarHistorial');
  const buscarBtn    = document.getElementById('buscarBtn');
  const limpiarBtn   = document.getElementById('buscarLimpiarBtn');
  const statusEl     = document.getElementById('buscarStatus');
  const resultsEl    = document.getElementById('buscarResults');
  const selEmpresa   = document.getElementById('bSelEmpresa');
  const selMina      = document.getElementById('bSelMina');
  const selVariable  = document.getElementById('bSelVariable');
  const iniFecha     = document.getElementById('bFechaInicio');
  const finFecha     = document.getElementById('bFechaFin');
  const selLimit     = document.getElementById('bSelLimit');

  // ── Load catalogos for dropdowns ─────────────────────────────────────────
  async function loadCatalogos(){
    if(_catalogos.length > 0) return;
    try{
      _catalogos = await getJSON('/api/analysis/catalogos');
      // Populate empresa dropdown (unique)
      const empresas = [];
      const seen = new Set();
      _catalogos.forEach(c => {
        if(!seen.has(c.empresa_id)){
          seen.add(c.empresa_id);
          empresas.push({ id: c.empresa_id, nombre: c.empresa_nombre });
        }
      });
      empresas.sort((a,b) => a.nombre.localeCompare(b.nombre));
      empresas.forEach(e => {
        const opt = document.createElement('option');
        opt.value = e.id;
        opt.textContent = e.nombre;
        selEmpresa.appendChild(opt);
      });
      // Populate variable dropdown (unique)
      const variables = [];
      const seenV = new Set();
      _catalogos.forEach(c => {
        if(!seenV.has(c.variable_id)){
          seenV.add(c.variable_id);
          variables.push({ id: c.variable_id, nombre: c.variable_nombre, unidad: c.unidad });
        }
      });
      variables.forEach(v => {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = v.nombre + (v.unidad ? ' [' + v.unidad + ']' : '');
        selVariable.appendChild(opt);
      });
      // Initial mina population (all)
      populateMinas('');
    }catch(e){
      console.error('Error cargando catalogos para búsqueda:', e);
    }
  }

  function populateMinas(empresaId){
    // Save current selection
    const prev = selMina.value;
    selMina.innerHTML = '<option value="">— Todas las minas —</option>';
    const minas = _catalogos.filter(c => !empresaId || String(c.empresa_id) === String(empresaId));
    const seenM = new Set();
    minas.forEach(c => {
      if(!seenM.has(c.mina_id)){
        seenM.add(c.mina_id);
        const opt = document.createElement('option');
        opt.value = c.mina_id;
        opt.textContent = c.mina_nombre + ' (' + c.zona_tipo + ')';
        selMina.appendChild(opt);
      }
    });
    if(prev) selMina.value = prev;
  }

  selEmpresa.addEventListener('change', () => populateMinas(selEmpresa.value));

  // ── Open / close modal ────────────────────────────────────────────────────
  openBtn.addEventListener('click', async () => {
    overlay.classList.add('open');
    await loadCatalogos();
  });

  function closeModal(){
    overlay.classList.remove('open');
  }

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if(e.target === overlay) closeModal(); });

  // ── Limpiar filtros ────────────────────────────────────────────────────────
  limpiarBtn.addEventListener('click', () => {
    selEmpresa.value  = '';
    populateMinas('');
    selMina.value     = '';
    selVariable.value = '';
    iniFecha.value    = '';
    finFecha.value    = '';
    selLimit.value    = '25';
    statusEl.textContent = '';
    resultsEl.innerHTML = '<div id="buscarEmpty">Use los filtros y presione Buscar para ver el historial guardado.</div>';
    _allResults = [];
    _curPage = 1;
  });

  // ── Build query URL ────────────────────────────────────────────────────────
  function buildUrl(page){
    const limit  = parseInt(selLimit.value) || 25;
    let url = '/api/analysis/sesiones?limit=' + limit + '&page=' + page;
    if(selEmpresa.value)  url += '&empresa_id='  + encodeURIComponent(selEmpresa.value);
    if(selMina.value)     url += '&mina_id='     + encodeURIComponent(selMina.value);
    if(selVariable.value) url += '&variable_id=' + encodeURIComponent(selVariable.value);
    if(iniFecha.value)    url += '&fecha_inicio=' + encodeURIComponent(iniFecha.value + ':00');
    if(finFecha.value)    url += '&fecha_fin='    + encodeURIComponent(finFecha.value + ':00');
    return url;
  }

  // ── Execute search ─────────────────────────────────────────────────────────
  async function doSearch(page){
    if(_searching) return;
    _searching = true;
    buscarBtn.disabled = true;
    buscarBtn.textContent = '⏳ Buscando...';
    statusEl.textContent = 'Consultando...';

    try{
      const data = await getJSON(buildUrl(page));
      _allResults  = data.sesiones || [];
      _curPage     = data.page     || 1;
      _perPage     = data.per_page || 25;
      _totalPages  = data.total_pages || 1;
      const total  = data.total || 0;

      statusEl.textContent = total > 0
        ? total + ' registro(s) encontrados — página ' + _curPage + ' de ' + _totalPages
        : 'No se encontraron registros con los filtros aplicados.';

      renderResults();
    }catch(e){
      console.error('Error en búsqueda:', e);
      statusEl.textContent = '❌ Error: ' + e.message;
      resultsEl.innerHTML = '<div id="buscarEmpty" style="color:#e74c3c;">Error al buscar: ' + escapeHtml(e.message) + '</div>';
    }finally{
      _searching = false;
      buscarBtn.disabled = false;
      buscarBtn.textContent = '🔍 Buscar';
    }
  }

  buscarBtn.addEventListener('click', () => doSearch(1));

  // ── Render results table ───────────────────────────────────────────────────
  function renderResults(){
    if(_allResults.length === 0){
      resultsEl.innerHTML = '<div id="buscarEmpty">No se encontraron registros con los filtros aplicados.</div>';
      return;
    }

    const rows = _allResults.map(r => {
      const accionChip = r.accion === 'CREO' ? '<span class="chip-acc">CREÓ</span>' :
                         r.accion === 'MODIFICO' ? '<span class="chip-acc">MODIFICÓ</span>' :
                         '<span class="chip-acc">' + escapeHtml(r.accion || '—') + '</span>';
      const siPct = r.total_lecturas > 0 ? ((r.total_si / r.total_lecturas) * 100).toFixed(1) : '0.0';
      const gps = (r.gps_lat && r.gps_lon) ? r.gps_lat.toFixed(4) + ', ' + r.gps_lon.toFixed(4) : '—';
      const lugar = r.gps_lugar || '—';
      return `<tr class="bRow" data-id="${r.id}" data-usuario="${escapeHtml(r.usuario_nombre || '')}" title="Doble clic para cargar este diagrama en el editor">
        <td style="font-weight:700;color:#7c3aed;">#${r.id}</td>
        <td>${escapeHtml(r.usuario_nombre || '—')}</td>
        <td>${accionChip}</td>
        <td>${escapeHtml(r.empresa_nombre || '—')}</td>
        <td>${escapeHtml(r.mina_nombre || '—')}</td>
        <td>${escapeHtml(r.variable_nombre || '—')}</td>
        <td>${escapeHtml(r.fecha_inicio || '—')}</td>
        <td>${escapeHtml(r.fecha_fin || '—')}</td>
        <td style="text-align:right;">${r.total_lecturas.toLocaleString()}</td>
        <td style="text-align:right;"><span class="chip-si">${r.total_si.toLocaleString()}</span></td>
        <td style="text-align:right;"><span class="chip-no">${r.total_no.toLocaleString()}</span></td>
        <td style="text-align:right;font-weight:700;color:#e8921e;">${Number(r.pct_alertas || 0).toFixed(2)}%</td>
        <td>${escapeHtml(lugar)}</td>
        <td style="font-size:11px;color:#7f8c8d;">${escapeHtml(r.created_at || '—')}</td>
      </tr>`;
    }).join('');

    const pagination = renderPagination();

    resultsEl.innerHTML = `
      <div class="bTableWrap">
        <table class="bTable">
          <thead>
            <tr>
              <th>#ID</th>
              <th>Usuario</th>
              <th>Acción</th>
              <th>Empresa</th>
              <th>Mina</th>
              <th>Variable</th>
              <th>F. Inicio</th>
              <th>F. Fin</th>
              <th>Lecturas</th>
              <th>Alertas (SI)</th>
              <th>Normal (NO)</th>
              <th>% Alertas</th>
              <th>Ubicación GPS</th>
              <th>Guardado</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${pagination}`;

    // Wire pagination buttons
    resultsEl.querySelectorAll('.pg-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pg = parseInt(btn.getAttribute('data-page'));
        if(!isNaN(pg)) doSearch(pg);
      });
    });

    // Wire double-click on rows to load session into editor
    resultsEl.querySelectorAll('tr.bRow').forEach(tr => {
      tr.addEventListener('dblclick', () => handleRowDblClick(tr));
    });
  }

  async function handleRowDblClick(tr){
    const sessId   = tr.getAttribute('data-id');
    const usuario  = tr.getAttribute('data-usuario');
    const msg = '¿Cargar la sesión #' + sessId + ' (' + usuario + ') en el editor de diagramas?\n\n' +
                'Esto reemplazará el diagrama actual con el snapshot guardado en esa sesión.';
    if(!confirm(msg)) return;

    // Show loading overlay on the modal
    const loadDiv = document.createElement('div');
    loadDiv.id = 'bRestoreLoading';
    loadDiv.style.cssText = 'position:absolute;inset:0;background:rgba(255,255,255,.82);' +
      'display:flex;align-items:center;justify-content:center;z-index:10;border-radius:12px;' +
      'font-size:15px;font-weight:600;color:#7c3aed;gap:10px;';
    loadDiv.innerHTML = '<span style="font-size:22px;">⏳</span> Cargando sesión #' + sessId + '…';
    modal.style.position = 'relative';
    modal.appendChild(loadDiv);

    try{
      const resp = await fetch(apiBase + '/api/analysis/sesiones/' + sessId + '/restaurar', { method: 'POST' });
      const data = await resp.json();
      if(!resp.ok || !data.ok) throw new Error(data.error || 'Error al restaurar');

      // Restaurar escribe en diagram_id emp{e}_mina{m}; quitar variante de lienzo vacío para ver el diagrama
      try{
        const ctx = JSON.parse(localStorage.getItem('formula_ctx') || '{}');
        const base = diagramContextKey(ctx);
        if(base){
          const map = JSON.parse(localStorage.getItem(FORMULA_DIAGRAM_VARIANTS) || '{}');
          if(map[base]){ delete map[base]; localStorage.setItem(FORMULA_DIAGRAM_VARIANTS, JSON.stringify(map)); }
        }
      }catch(_){ /* ignore */ }

      // Close modal and refresh the canvas editor
      closeModal();
      await refreshState();

      // Show success toast
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%);' +
        'background:#1a7f4b;color:#fff;padding:12px 28px;border-radius:24px;font-size:14px;' +
        'font-weight:600;z-index:99999;box-shadow:0 4px 20px rgba(0,0,0,.3);transition:opacity .4s;' +
        'display:flex;align-items:center;gap:8px;';
      toast.innerHTML = '<span style="font-size:18px;">✅</span> Sesión #' + sessId +
        ' cargada en el editor — listo para editar';
      document.body.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 450); }, 3500);

    }catch(e){
      console.error('Error restaurando sesión:', e);
      alert('❌ Error al cargar la sesión: ' + e.message);
    }finally{
      const ld = document.getElementById('bRestoreLoading');
      if(ld) ld.remove();
    }
  }

  function renderPagination(){
    if(_totalPages <= 1) return '';
    const maxVisible = 7;
    let pages = [];
    if(_totalPages <= maxVisible){
      for(let i = 1; i <= _totalPages; i++) pages.push(i);
    } else {
      pages = [1];
      const start = Math.max(2, _curPage - 2);
      const end   = Math.min(_totalPages - 1, _curPage + 2);
      if(start > 2) pages.push('...');
      for(let i = start; i <= end; i++) pages.push(i);
      if(end < _totalPages - 1) pages.push('...');
      pages.push(_totalPages);
    }

    const btns = pages.map(p => {
      if(p === '...') return '<span class="pg-btn" disabled style="cursor:default;">…</span>';
      const active = p === _curPage ? ' active' : '';
      return `<button class="pg-btn${active}" data-page="${p}">${p}</button>`;
    }).join('');

    const prevDisabled = _curPage <= 1 ? ' disabled' : '';
    const nextDisabled = _curPage >= _totalPages ? ' disabled' : '';

    return `<div id="buscarPagination">
      <button class="pg-btn"${prevDisabled} data-page="${_curPage - 1}">‹ Ant</button>
      ${btns}
      <button class="pg-btn"${nextDisabled} data-page="${_curPage + 1}">Sig ›</button>
      <span id="buscarPgInfo">Página ${_curPage} de ${_totalPages}</span>
    </div>`;
  }

})(); // end IIFE Búsqueda Avanzada
