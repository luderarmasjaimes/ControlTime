(function () {
  const outEl = document.getElementById('output');
  const listEl = document.getElementById('script-list');
  const statusEl = document.getElementById('status');
  const btnClear = document.getElementById('btn-clear');

  function setStatus(msg, ok) {
    statusEl.textContent = msg || '';
    statusEl.className = 'status' + (ok === true ? ' ok' : ok === false ? ' err' : '');
  }

  function appendOutput(text) {
    outEl.textContent += text;
    outEl.scrollTop = outEl.scrollHeight;
  }

  btnClear.addEventListener('click', () => {
    outEl.textContent = '';
    setStatus('');
  });

  async function loadScripts() {
    setStatus('Cargando manifiesto…');
    const r = await fetch('/api/scripts');
    if (!r.ok) throw new Error('No se pudo cargar /api/scripts');
    const data = await r.json();
    const byCat = {};
    for (const s of data.scripts || []) {
      const c = s.category || 'Otros';
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(s);
    }
    listEl.innerHTML = '';
    const order = Object.keys(byCat).sort();
    for (const cat of order) {
      const h = document.createElement('h2');
      h.className = 'cat';
      h.textContent = cat;
      listEl.appendChild(h);
      for (const s of byCat[cat]) {
        const card = document.createElement('div');
        card.className = 'card' + (s.warn ? ' card--warn' : '');
        card.innerHTML = `
          <div class="card-head">
            <span class="card-title">${escapeHtml(s.title)}</span>
            ${s.warn ? '<span class="pill">Atención</span>' : ''}
          </div>
          <p class="card-desc">${escapeHtml(s.description || '')}</p>
          <div class="card-meta">${escapeHtml(s.file)}</div>
          <button type="button" class="btn-run" data-id="${escapeHtml(s.id)}">Ejecutar</button>
        `;
        listEl.appendChild(card);
      }
    }
    listEl.querySelectorAll('.btn-run').forEach((btn) => {
      btn.addEventListener('click', () => runScript(btn.dataset.id, btn));
    });
    setStatus('Listo. Solo localhost; scripts permitidos por manifiesto.', true);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function runScript(id, btn) {
    if (!id) return;
    const row = btn.closest('.card');
    if (row && row.classList.contains('card--warn')) {
      const ok = window.confirm(
        'Este script puede ser destructivo o alterar datos. ¿Ejecutar de todas formas?'
      );
      if (!ok) return;
    }
    btn.disabled = true;
    setStatus('Ejecutando…', null);
    outEl.textContent = '';
    appendOutput(`=== ${id} ===\n`);
    try {
      const r = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptId: id }),
      });
      const text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        setStatus('Respuesta no JSON del servidor', false);
        appendOutput(text + '\n');
        return;
      }
      if (!r.ok) {
        setStatus(data.error || 'Error', false);
        appendOutput((data.output || '') + '\n');
        return;
      }
      appendOutput((data.output || '(sin salida)') + '\n');
      appendOutput(`\n--- Código salida: ${data.exitCode} ---\n`);
      setStatus(data.exitCode === 0 ? 'Terminó correctamente' : 'Terminó con código ≠ 0', data.exitCode === 0);
    } catch (e) {
      setStatus(String(e.message || e), false);
      appendOutput(String(e) + '\n');
    } finally {
      btn.disabled = false;
    }
  }

  loadScripts().catch((e) => {
    setStatus(String(e.message || e), false);
    listEl.innerHTML = '<p class="err">No se pudo cargar la lista. ¿Está activo MaintenanceServer.ps1?</p>';
  });
})();
