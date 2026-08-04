(function(){
  // Simple Three.js view that fetches /api/state and renders blocks as 3D boxes.
  const API = (path)=>{
    const proto = location.protocol;
    const prefix = (typeof window !== 'undefined' && window.FORMULA_API_PREFIX) ? window.FORMULA_API_PREFIX : '';
    return `${proto}//${location.host}${prefix}${path}`;
  };

  let scene, camera, renderer, controls, grid, light;
  const objects = new Map();
  let ws;

  function init(){
    const container = document.getElementById('threeContainer') || document.getElementById('canvas-wrap') || document.body;
    renderer = new THREE.WebGLRenderer({antialias:true});
    renderer.setSize(container.clientWidth || window.innerWidth, container.clientHeight || window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf2f6fb);

    camera = new THREE.PerspectiveCamera(50, (container.clientWidth||window.innerWidth)/(container.clientHeight||window.innerHeight), 1, 4000);
    camera.position.set(0, 300, 700);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0,0,0);
    controls.update();

    // lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemi.position.set(0,200,0);
    scene.add(hemi);

    light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(300,400,200);
    light.castShadow = true;
    light.shadow.mapSize.width = 1024;
    light.shadow.mapSize.height = 1024;
    light.shadow.camera.left = -500;
    light.shadow.camera.right = 500;
    light.shadow.camera.top = 500;
    light.shadow.camera.bottom = -500;
    scene.add(light);

    // ground
    const groundGeo = new THREE.PlaneGeometry(2000,2000);
    const groundMat = new THREE.MeshLambertMaterial({color:0xffffff});
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = - Math.PI/2;
    ground.receiveShadow = true;
    scene.add(ground);

    grid = new THREE.GridHelper(2000, 40, 0xdddddd, 0xeeeeee);
    grid.position.y = 1;
    scene.add(grid);

    window.addEventListener('resize', onWindowResize, false);
    animate();
  }

  function onWindowResize(){
    const container = document.getElementById('threeContainer') || document.getElementById('canvas-wrap') || document.body;
    camera.aspect = (container.clientWidth||window.innerWidth)/(container.clientHeight||window.innerHeight);
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth||window.innerWidth, container.clientHeight||window.innerHeight);
  }

  function animate(){
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }

  function clearObjects(){
    for(const o of objects.values()){
      scene.remove(o.mesh);
      if(o.mesh.geometry) o.mesh.geometry.dispose();
      if(o.mesh.material) o.mesh.material.dispose();
    }
    objects.clear();
  }

  function updateFromState(state){
    // state.blocks: [{id,x,y,w,h,label,color}]
    const blocks = state.blocks || [];
    const existing = new Set(objects.keys());
    // compute canvas/scene mapping using main canvas if present
    const canvasEl = document.getElementById('canvas');
    const cw = (canvasEl && canvasEl.width) ? canvasEl.width : 1200;
    const ch = (canvasEl && canvasEl.height) ? canvasEl.height : 800;
    for(const b of blocks){
      existing.delete(b.id);
      const centerX = (b.x + b.w/2) - cw/2;
      const centerY = -((b.y + b.h/2) - ch/2);
      const depth = Math.max(20, b.h/10);
      if(objects.has(b.id)){
        const o = objects.get(b.id);
        o.mesh.position.set(centerX, depth/2, centerY);
        o.mesh.scale.set(Math.max(1,b.w/40), Math.max(1,b.h/40), depth/40);
        // update label texture if needed
      } else {
        const geom = new THREE.BoxGeometry(Math.max(1,b.w/40), Math.max(1,b.h/40), Math.max(1,depth/40));
        const mat = new THREE.MeshStandardMaterial({color: b.color || 0x9999ff, metalness:0.1, roughness:0.5});
        const mesh = new THREE.Mesh(geom, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(centerX, depth/2, centerY);
        // label canvas
        const canvas = document.createElement('canvas'); canvas.width=256; canvas.height=64; const ctx = canvas.getContext('2d'); ctx.fillStyle='rgba(255,255,255,0.95)'; ctx.fillRect(0,0,256,64); ctx.fillStyle='#000'; ctx.font='20px Arial'; ctx.textAlign='center'; ctx.fillText(b.label||b.id,128,36);
        const tex = new THREE.CanvasTexture(canvas); const labelMat = new THREE.SpriteMaterial({map:tex}); const sprite = new THREE.Sprite(labelMat); sprite.scale.set(160,40,1); sprite.position.set(0, (Math.max(1,b.h/40)) + 1, 0); mesh.add(sprite);
        scene.add(mesh); objects.set(b.id, {mesh:mesh, labelElement:canvas});
      }
    }
    // remove existing not present
    for(const id of existing){
      const o = objects.get(id);
      scene.remove(o.mesh);
      objects.delete(id);
    }
  }

  async function fetchState(){
    try{
      const res = await fetch(API('/api/state'));
      const data = await res.json();
      updateFromState(data);
    }catch(e){
      console.error('failed fetch state',e);
    }
  }

  function connectWS(){
    const status = document.getElementById('status');
    const url = (location.protocol === 'https:') ? 'wss://' : 'ws://';
    const prefix = (typeof window !== 'undefined' && window.FORMULA_API_PREFIX) ? window.FORMULA_API_PREFIX : '';
    const token = localStorage.getItem('AUTH_TOKEN') || '';
    const wsUrl = url + location.host + prefix + '/ws' + (token ? ('?token=' + encodeURIComponent(token)) : '');
    ws = new WebSocket(wsUrl);
    ws.addEventListener('open', ()=>{ status.innerText = 'WS: conectado'; console.log('ws open'); });
    ws.addEventListener('message', (ev)=>{
      try{
        const msg = JSON.parse(ev.data);
        if(msg.type === 'state' && msg.state) updateFromState(msg.state);
        else if(msg.type === 'notify' && msg.payload) fetchState();
      }catch(err){ console.warn('ws msg err',err); }
    });
    ws.addEventListener('close', ()=>{ status.innerText = 'WS: desconectado'; console.log('ws close'); setTimeout(()=>connectWS(),1000); });
    ws.addEventListener('error', (e)=>{ console.warn('ws error',e); ws.close(); });
  }

  // wire UI
  window.addEventListener('DOMContentLoaded', ()=>{
    init();
    fetchState();
    document.getElementById('btnRefresh').addEventListener('click', fetchState);
    document.getElementById('btnConnectWS').addEventListener('click', ()=>{ if(!ws || ws.readyState!==WebSocket.OPEN) connectWS(); });
    document.getElementById('btnToggleGrid').addEventListener('click', ()=>{ grid.visible = !grid.visible; });
  });

})();