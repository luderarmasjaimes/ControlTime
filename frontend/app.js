(function(){
  const apiBase = () => document.getElementById('apiBase').value.replace(/\/$/, '');
  const wsUrlEl = () => document.getElementById('wsUrl').value;
  let ws = null;
  let token = '';

  function logWs(msg){ const p = document.getElementById('wsLog'); p.textContent += msg + '\n'; p.scrollTop = p.scrollHeight; }

  document.getElementById('connectWs').addEventListener('click', ()=>{
    if(ws){ ws.close(); ws=null; document.getElementById('connectWs').textContent='Conectar WS'; return; }
    const url = wsUrlEl();
    ws = new WebSocket(url);
    ws.onopen = ()=>{ logWs('WS open'); document.getElementById('connectWs').textContent='Desconectar WS'; };
    ws.onmessage = (e)=>{ logWs('RX: '+e.data); };
    ws.onclose = ()=>{ logWs('WS closed'); ws=null; document.getElementById('connectWs').textContent='Conectar WS'; };
    ws.onerror = (e)=>{ logWs('WS error'); };
  });

  document.getElementById('subscribeBtn').addEventListener('click', ()=>{
    const id = parseInt(document.getElementById('sensorId').value||'0');
    if(!ws || ws.readyState!==1){ alert('WebSocket no conectado'); return; }
    ws.send(JSON.stringify({type:'subscribe', sensor_ids:[id]}));
    logWs('Sent subscribe '+id);
  });

  document.getElementById('getToken').addEventListener('click', async ()=>{
    const user = document.getElementById('authUser').value;
    const pass = document.getElementById('authPass').value;
    const res = await fetch(apiBase() + '/auth/token', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({user, password:pass})});
    const j = await res.json();
    token = j.access_token || '';
    document.getElementById('tokenOut').textContent = JSON.stringify(j, null, 2);
  });

  document.getElementById('createTpl').addEventListener('click', async ()=>{
    const name = document.getElementById('tplName').value;
    const layout = document.getElementById('tplLayout').value;
    const res = await fetch(apiBase() + '/api/v1/templates', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name, layout})});
    const j = await res.json();
    document.getElementById('tplOut').textContent = JSON.stringify(j, null, 2);
    if(j.id) document.getElementById('instTplId').value = j.id;
  });

  document.getElementById('createInst').addEventListener('click', async ()=>{
    const template_id = document.getElementById('instTplId').value;
    let params = {};
    try { params = JSON.parse(document.getElementById('instParams').value); } catch(e){ alert('Params JSON inválido'); return; }
    const res = await fetch(apiBase() + '/api/v1/instances', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({template_id, params})});
    const j = await res.json();
    document.getElementById('instOut').textContent = JSON.stringify(j, null, 2);
    if(j.id) pollInstance(j.id);
  });

  async function pollInstance(id){
    const out = document.getElementById('instOut');
    out.textContent += '\nPolling instance '+id+'...\n';
    const interval = setInterval(async ()=>{
      const res = await fetch(apiBase() + '/api/v1/instances/' + id);
      if(res.status === 404){ out.textContent += 'Instance not found\n'; clearInterval(interval); return; }
      const j = await res.json();
      out.textContent = JSON.stringify(j, null, 2);
      if(j.status === 'ready' && j.result_url){
        clearInterval(interval);
        out.textContent += '\nReady. Attempting download...\n';
        await downloadWithAuth(j.result_url);
      }
    }, 2000);
  }

  async function downloadWithAuth(urlPath){
    if(!token){ alert('No token available. Get one from Auth section.'); return; }
    const full = apiBase() + urlPath;
    const res = await fetch(full, {headers:{'Authorization':'Bearer '+token}});
    if(!res.ok){ alert('Download failed: '+res.status); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = urlPath.split('/').pop();
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(href);
  }

})();
