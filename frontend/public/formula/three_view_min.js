// Minimal Three.js viewer for blocks (connects to /api/state)
(function(){
  const container = document.getElementById('threeContainer');
  let scene, camera, renderer, controls;
  let boxes = new Map();

  function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf8f8f8);

    const width = container.clientWidth;
    const height = container.clientHeight;
    camera = new THREE.PerspectiveCamera(45, width / height, 1, 10000);
    camera.position.set(0, 400, 800);

    renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0,0,0);
    controls.update();

    const ambient = new THREE.AmbientLight(0x909090);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(300,400,200);
    dir.castShadow = true;
    scene.add(dir);

    // grid
    const grid = new THREE.GridHelper(2000, 40, 0xcccccc, 0xeeeeee);
    grid.position.y = -1;
    scene.add(grid);

    window.addEventListener('resize', onWindowResize);
    animate();
  }

  function onWindowResize(){
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w,h);
  }

  function animate(){
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }

  function clearBoxes(){
    for(const m of boxes.values()){
      scene.remove(m.mesh);
    }
    boxes.clear();
  }

  function updateFromState(state){
    // state: {blocks:[], connections:[]}
    if(!state || !state.blocks) return;
    // keep existing where possible
    const seen = new Set();
    for(const b of state.blocks){
      seen.add(b.id);
      if(boxes.has(b.id)){
        const entry = boxes.get(b.id);
        entry.mesh.position.set(b.x, b.h/2, -b.y);
        entry.mesh.scale.set(b.w, b.h, Math.max(20, b.w));
      } else {
        const geom = new THREE.BoxGeometry(b.w, b.h, Math.max(20,b.w));
        const col = b.color || '#66ccff';
        const mat = new THREE.MeshStandardMaterial({color: new THREE.Color(col), metalness:0.2, roughness:0.6});
        const mesh = new THREE.Mesh(geom, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(b.x, b.h/2, -b.y);
        scene.add(mesh);
        boxes.set(b.id, {mesh, info:b});
      }
    }
    // remove missing
    for(const id of Array.from(boxes.keys())){
      if(!seen.has(id)){
        const e = boxes.get(id);
        scene.remove(e.mesh);
        boxes.delete(id);
      }
    }
  }

  async function fetchState(){
    try{
      const proto = location.protocol === 'https:' ? 'https:' : 'http:';
      var prefix = (typeof window !== 'undefined' && window.FORMULA_API_PREFIX) ? window.FORMULA_API_PREFIX : '';
      const url = `${proto}//${location.host}${prefix}/api/state`;
      const res = await fetch(url);
      if(!res.ok) throw new Error('HTTP '+res.status);
      const data = await res.json();
      updateFromState(data);
    }catch(err){
      console.error('fetchState error', err);
    }
  }

  // basic WS: receive event payloads and refresh state
  let ws;
  function connectWS(){
    const token = localStorage.getItem('ws_token') || '';
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    var prefix = (typeof window !== 'undefined' && window.FORMULA_API_PREFIX) ? window.FORMULA_API_PREFIX : '';
    const url = `${proto}${location.host}${prefix}/ws` + (token ? ('?token=' + encodeURIComponent(token)) : '');
    try{
      ws = new WebSocket(url);
    }catch(e){
      console.error('WS connect error', e); return;
    }
    ws.onopen = ()=>{ document.getElementById('wsStatus').innerText='WS: conectado'; console.info('ws open'); };
    ws.onmessage = (ev)=>{
      try{
        const m = JSON.parse(ev.data);
        if(m.type === 'state' || m.type === 'changed') fetchState();
        if(m.type === 'ping') ws.send(JSON.stringify({type:'pong'}));
      }catch(e){ console.warn('ws msg parse', e); }
    };
    ws.onclose = ()=>{ document.getElementById('wsStatus').innerText='WS: desconectado'; console.info('ws closed'); };
    ws.onerror = (e)=>{ console.warn('ws error', e); };
  }

  // wire buttons
  document.getElementById('btnRefresh').addEventListener('click', ()=>fetchState());
  document.getElementById('btnConnect').addEventListener('click', ()=>{ connectWS(); });

  // init
  init();
  fetchState();

})();
