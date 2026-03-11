const API_BASE = 'http://localhost:8081';
const TILE_BASE = 'http://localhost:8000';

const logsEl = document.getElementById('logs');
const jobInfoEl = document.getElementById('jobInfo');

let activeJobId = null;
let pollTimer = null;
let activeServiceName = null;

const DEFAULT_CENTER = [4.711, -74.0721]; // Leaflet is [lat, lng]
const DEFAULT_ZOOM = 6;

// Initialize Leaflet Map
const map = L.map('map', {
  maxZoom: 22,
  zoomControl: false // We will add it top-right
}).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

L.control.zoom({ position: 'topright' }).addTo(map);

// Google Satellite Base Layer
const baseLayer = L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
  maxZoom: 22,
  attribution: '© Google Satellite'
}).addTo(map);

let currentMbtilesLayer = null;

// Tab Handling
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));

    tab.classList.add('active');
    const targetId = `tab-${tab.dataset.tab}`;
    document.getElementById(targetId).classList.add('active');

    if (tab.dataset.tab === 'tilesets') {
      refreshTilesets();
    } else if (tab.dataset.tab === 'jobs') {
      refreshJobs();
    } else if (tab.dataset.tab === 'files') {
      refreshFiles();
    }
  });
});

// Capture Map Logic using leaflet-image (since we're restoring leaflet)
document.getElementById('btnCaptureMap').addEventListener('click', () => {
  const btn = document.getElementById('btnCaptureMap');
  btn.classList.add('capturing');

  if (typeof leafletImage !== 'undefined') {
    leafletImage(map, function (err, canvas) {
      if (err) {
        showToast('Error en captura: ' + err.message, 'error');
        btn.classList.remove('capturing');
        return;
      }
      const dataURL = canvas.toDataURL('image/png');

      const gallery = document.getElementById('captureList');
      if (gallery.querySelector('.empty')) {
        gallery.innerHTML = '';
      }

      const card = document.createElement('div');
      card.className = 'capture-card';
      const now = new Date();
      card.innerHTML = `
        <div class="capture-img-wrap">
          <img src="${dataURL}" alt="Map Capture">
          <div class="capture-overlay">
            <button class="btn-primary" onclick="window.open('${dataURL}', '_blank')">Ver Completa</button>
          </div>
        </div>
        <div class="capture-info">
          <span class="capture-date">${now.toLocaleString()}</span>
        </div>
      `;
      gallery.prepend(card);
      showToast('Captura guardada', 'success');
      document.querySelector('[data-tab="captures"]').click();
      btn.classList.remove('capturing');
    });
  } else {
    showToast('leaflet-image no está cargado', 'error');
    btn.classList.remove('capturing');
  }
});

document.getElementById('btnClearCaptures').addEventListener('click', () => {
  document.getElementById('captureList').innerHTML = '<p class="empty">No hay capturas aún. Usa el botón 📷 en el mapa.</p>';
});

// Toast
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 3000);
}

// Map utils for Leaflet: Leaflet uses [lat, lng] instead of [lng, lat]
function parseLeafletBounds(boundsArr) {
  // boundsArr is usually [west, south, east, north] from tileserver
  if (!Array.isArray(boundsArr) || boundsArr.length !== 4) return null;
  const numeric = boundsArr.map(Number);
  if (numeric.some(v => Number.isNaN(v) || !Number.isFinite(v))) return null;
  const [west, south, east, north] = numeric;
  if (west >= east || south >= north) return null;
  // Return Leaflet format: [[south, west], [north, east]]
  return [[south, west], [north, east]];
}

function padLeafletBounds(bounds, paddingFactor = 0.18) {
  const [[south, west], [north, east]] = bounds;
  const lngSpan = Math.max(east - west, 0.0005);
  const latSpan = Math.max(north - south, 0.0005);
  const lngPad = Math.min(lngSpan * paddingFactor, 5);
  const latPad = Math.min(latSpan * paddingFactor, 5);

  return [
    [Math.max(-85.051129, south - latPad), Math.max(-180, west - lngPad)],
    [Math.min(85.051129, north + latPad), Math.min(180, east + lngPad)]
  ];
}

// Polling and Jobs
async function pollJob() {
  if (!activeJobId) return;

  try {
    const res = await fetch(`${API_BASE}/api/jobs/${activeJobId}`);
    const data = await res.json();

    if (!res.ok) {
      jobInfoEl.textContent = `Error consultando job: ${data.error || 'desconocido'}`;
      stopPolling();
      return;
    }

    jobInfoEl.textContent = `Job ${data.job_id}: ${data.status}`;
    setLogs(data.logs || []);

    const progressFill = document.getElementById('progressFill');
    if (progressFill) {
      if (data.status === 'running') progressFill.classList.add('indeterminate');
      else {
        progressFill.classList.remove('indeterminate');
        progressFill.style.width = data.status === 'completed' ? '100%' : '0%';
      }
    }

    if (data.status === 'completed' || data.status === 'failed') {
      stopPolling();
      updateLocalJobHistory(data.job_id, data.status);
      refreshJobs();
      if (data.status === 'completed') showToast('Conversión completada', 'success');
      else showToast('Conversión fallida', 'error');
    }
  } catch (e) {
    stopPolling();
    jobInfoEl.textContent = 'Error de conexión';
  }
}

function startPolling() {
  stopPolling();
  const wrapper = document.getElementById('progressWrap');
  if (wrapper) wrapper.classList.remove('hidden');
  pollTimer = setInterval(pollJob, 1500);
  pollJob();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function setLogs(lines) {
  if (logsEl) {
    logsEl.textContent = lines.join('\n');
    logsEl.scrollTop = logsEl.scrollHeight;
  }
}

function updateLocalJobHistory(jobId, status) {
  let hist = JSON.parse(localStorage.getItem('mapas_jobs') || '[]');
  let ind = hist.findIndex(j => j.id === jobId);
  if (ind >= 0) {
    hist[ind].status = status;
    hist[ind].date = new Date().toISOString();
  } else {
    hist.push({ id: jobId, status, date: new Date().toISOString() });
  }
  localStorage.setItem('mapas_jobs', JSON.stringify(hist));
}

async function startConvert() {
  const payload = {
    input_path: document.getElementById('inputPath').value.trim(),
    output_name: document.getElementById('outputName').value.trim(),
    output_path: document.getElementById('outputPath').value.trim(),
    min_zoom: Number(document.getElementById('minZoom').value),
    max_zoom: Number(document.getElementById('maxZoom').value),
    compression: document.getElementById('compression').value,
    quality: Number(document.getElementById('quality').value),
    resampling: document.getElementById('resampling').value
  };

  try {
    const res = await fetch(`${API_BASE}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      jobInfoEl.textContent = `Error: ${data.error || 'desconocido'}`;
      showToast('Error al iniciar', 'error');
      return;
    }

    activeJobId = data.job_id;
    jobInfoEl.textContent = `Job ${activeJobId}: ${data.status}`;
    setLogs(['Job creado']);
    updateLocalJobHistory(activeJobId, data.status);
    startPolling();
    showToast('Conversión iniciada', 'info');
  } catch (e) {
    jobInfoEl.textContent = `Error de red: ${e.message}`;
    showToast('Error de red', 'error');
  }
}

document.getElementById('btnConvert').addEventListener('click', startConvert);

// Refresh data handlers
async function refreshJobs() {
  let hist = JSON.parse(localStorage.getItem('mapas_jobs') || '[]');
  const list = document.getElementById('jobList');
  if (hist.length === 0) {
    list.innerHTML = '<p class="empty">No hay jobs.</p>';
    return;
  }

  hist.sort((a, b) => new Date(b.date) - new Date(a.date));
  list.innerHTML = '';

  for (const j of hist) {
    const d = new Date(j.date);
    const div = document.createElement('div');
    div.className = 'item-row';
    div.innerHTML = `
      <div class="icon">⚙️</div>
      <div class="info">
        <div class="name">Job ${j.id.substring(0, 8)}</div>
        <div class="meta">${d.toLocaleString()}</div>
      </div>
      <div class="badge badge-${j.status}">${j.status}</div>
    `;
    div.addEventListener('click', () => {
      activeJobId = j.id;
      startPolling();
      document.querySelector('[data-tab="convert"]').click();
    });
    list.appendChild(div);
  }
}
document.getElementById('btnRefreshJobs').addEventListener('click', refreshJobs);

async function refreshTilesets() {
  const list = document.getElementById('tilesetList');
  list.innerHTML = '<p class="empty">Cargando...</p>';
  try {
    const res = await fetch(`${TILE_BASE}/services`);
    if (!res.ok) throw new Error('Network fail');

    let services = [];
    const data = await res.json();
    if (Array.isArray(data)) services = data;
    else if (Array.isArray(data?.value)) services = data.value;
    else if (data && typeof data === 'object') services = [data];

    list.innerHTML = '';
    if (services.length === 0) {
      list.innerHTML = '<p class="empty">No hay tilesets listos en tileserver.</p>';
      return;
    }

    services.forEach(svc => {
      const div = document.createElement('div');
      div.className = 'item-row';
      div.innerHTML = `
        <div class="icon">🗺️</div>
        <div class="info">
          <div class="name">${svc.name}</div>
          <div class="meta">Formato: ${svc.format || 'mbtiles'}</div>
        </div>
        <div class="badge badge-mbtiles">Tile</div>
      `;
      div.addEventListener('click', () => {
        loadTilesetDescriptor(svc);
      });
      list.appendChild(div);
    });
  } catch (e) {
    list.innerHTML = `<p class="empty">Error consultando Tileserver: ${e.message}</p>`;
  }
}
document.getElementById('btnRefreshTilesets').addEventListener('click', refreshTilesets);

function refreshFiles() {
  document.getElementById('fileList').innerHTML = '<p class="empty">Usa la pestaña de Conversión para definir datos de entrada.</p>';
}
document.getElementById('btnRefreshFiles').addEventListener('click', refreshFiles);

// Loading a Tileset into Leaflet
async function loadTilesetDescriptor(svc) {
  showToast(`Cargando ${svc.name}...`);

  try {
    const res = await fetch(`${TILE_BASE}/services/${svc.name}`);
    if (!res.ok) throw new Error('Error al leer el servicio de metadatos');

    const serviceDetail = await res.json();
    const imageType = (serviceDetail.format || svc.imageType || 'png').toLowerCase();

    if (currentMbtilesLayer) {
      map.removeLayer(currentMbtilesLayer);
    }

    const tileUrl = Array.isArray(serviceDetail.tiles) && serviceDetail.tiles.length > 0
      ? serviceDetail.tiles[0]
      : `${TILE_BASE}/services/${svc.name}/tiles/{z}/{x}/{y}.${imageType}`;

    const bounds = parseLeafletBounds(serviceDetail.bounds);

    const maxZoom = Number.isFinite(Number(serviceDetail.maxzoom)) ? Number(serviceDetail.maxzoom) : 22;
    const minZoom = Number.isFinite(Number(serviceDetail.minzoom)) ? Number(serviceDetail.minzoom) : 0;

    currentMbtilesLayer = L.tileLayer(tileUrl, {
      minZoom: minZoom,
      maxZoom: maxZoom,
      bounds: bounds || undefined,
      noWrap: true, // Prevents the tileset from wrapping around the world
      tms: serviceDetail.scheme === 'tms'
    }).addTo(map);

    // Initial restriction
    // Zoom precisely to the mine location
    if (bounds) {
      map.setMaxBounds(null); // Ensure free navigation is allowed
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 20 });
    } else {
      map.setMaxBounds(null); // Allow free navigation
    }

    const banner = document.getElementById('capBanner');
    banner.classList.remove('hidden');
    banner.className = 'cap-banner ok';
    banner.innerHTML = `✅ Tileset Activo: ${svc.name}`;

    document.getElementById('opacityControl').style.display = 'flex';
    document.getElementById('layerOpacity').value = 100;
    document.getElementById('opacityValue').textContent = '100%';

    showToast(`Tileset ${svc.name} cargado correctamente`, 'success');

  } catch (e) {
    showToast(`Error al cargar la capa: ${e.message}`, 'error');
  }
}

// Opacity Slider
document.getElementById('layerOpacity').addEventListener('input', (e) => {
  const val = e.target.value;
  document.getElementById('opacityValue').textContent = `${val}%`;
  const decimals = val / 100;
  if (currentMbtilesLayer) {
    currentMbtilesLayer.setOpacity(decimals);
  }
});

// Status Keepalive
async function checkBackends() {
  try {
    const bRes = await fetch(`${API_BASE}/health`);
    document.getElementById('dotBackend').className = bRes.ok ? 'dot ok' : 'dot error';
  } catch (e) { document.getElementById('dotBackend').className = 'dot error'; }

  try {
    const tRes = await fetch(`${TILE_BASE}/services`);
    document.getElementById('dotTileserver').className = tRes.ok ? 'dot ok' : 'dot error';
  } catch (e) { document.getElementById('dotTileserver').className = 'dot error'; }
}

setInterval(checkBackends, 6000);
checkBackends();
