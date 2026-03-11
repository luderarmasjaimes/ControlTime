'use strict';

/* ===== CONSTANTS ===== */
const USER_COLORS = [
  '#e53935', '#1e88e5', '#43a047', '#fb8c00',
  '#8e24aa', '#00acc1', '#f4511e', '#3949ab',
  '#00897b', '#6d4c41'
];

/* ===== STATE ===== */
const state = {
  socket: null,
  map: null,
  myId: null,
  myName: null,
  tracking: false,
  watchId: null,
  markers: {},     // socketId -> L.marker
  colorMap: {},    // socketId -> color index
  colorCounter: 0
};

/* ===== MAP INIT ===== */
function initMap() {
  state.map = L.map('map').setView([4.7110, -74.0721], 5); // Colombia center

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(state.map);
}

/* ===== SOCKET INIT ===== */
function initSocket() {
  state.socket = io();

  state.socket.on('connect', () => {
    setConnectionStatus('connected');
  });

  state.socket.on('disconnect', () => {
    setConnectionStatus('disconnected');
  });

  state.socket.on('registered', (user) => {
    state.myId = user.id;
    startGeolocationTracking();
  });

  state.socket.on('initial_locations', (users) => {
    users.forEach(addOrUpdateMarker);
    updateUsersList();
  });

  state.socket.on('user_joined', (user) => {
    addOrUpdateMarker(user);
    updateUsersList();
  });

  state.socket.on('location_changed', (user) => {
    addOrUpdateMarker(user);
    updateUsersList();
  });

  state.socket.on('user_left', (data) => {
    removeMarker(data.id);
    updateUsersList();
  });

  state.socket.on('locations_update', (users) => {
    // Remove stale markers
    const activeIds = new Set(users.map(u => u.id));
    Object.keys(state.markers).forEach(id => {
      if (!activeIds.has(id)) removeMarker(id);
    });
    users.forEach(addOrUpdateMarker);
    updateUsersList();
  });
}

/* ===== MARKER HELPERS ===== */
function getColor(id) {
  if (!(id in state.colorMap)) {
    state.colorMap[id] = state.colorCounter % USER_COLORS.length;
    state.colorCounter++;
  }
  return USER_COLORS[state.colorMap[id]];
}

function buildIcon(color, isMe) {
  const size = isMe ? 16 : 13;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36">
    <path d="M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24C24 5.37 18.63 0 12 0z"
      fill="${color}" stroke="#fff" stroke-width="2"/>
    <circle cx="12" cy="12" r="5" fill="#fff"/>
  </svg>`;
  return L.divIcon({
    className: '',
    html: `<div style="width:${size * 1.5}px;height:${size * 2.25}px;">${svg}</div>`,
    iconSize: [size * 1.5, size * 2.25],
    iconAnchor: [size * 0.75, size * 2.25],
    popupAnchor: [0, -(size * 2.25)]
  });
}

function formatTime(iso) {
  if (!iso) return 'Sin datos aún';
  const d = new Date(iso);
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function addOrUpdateMarker(user) {
  // Always keep cache in sync
  upsertUserCache(user);

  if (!user.lat || !user.lng) return;

  const isMe = user.id === state.myId;
  const color = getColor(user.id);
  const latlng = [user.lat, user.lng];

  if (state.markers[user.id]) {
    state.markers[user.id].setLatLng(latlng);
    state.markers[user.id].setIcon(buildIcon(color, isMe));
  } else {
    const marker = L.marker(latlng, { icon: buildIcon(color, isMe) })
      .addTo(state.map);
    state.markers[user.id] = marker;
  }

  const popupContent = `
    <div class="map-popup-name">${escapeHtml(user.name)}${isMe ? ' <em>(Tú)</em>' : ''}</div>
    <div class="map-popup-coords">Lat: ${user.lat.toFixed(5)}, Lng: ${user.lng.toFixed(5)}</div>
    <div class="map-popup-time">Última actualización: ${formatTime(user.lastUpdate)}</div>`;

  state.markers[user.id].bindPopup(popupContent);

  // Pan map to own location on first fix
  if (isMe && user.lat && !state._panDone) {
    state.map.setView(latlng, 15);
    state._panDone = true;
  }
}

function removeMarker(id) {
  removeUserCache(id);
  if (state.markers[id]) {
    state.markers[id].remove();
    delete state.markers[id];
    delete state.colorMap[id];
  }
}

/* ===== USERS LIST ===== */
function updateUsersList() {
  const list = document.getElementById('users-list');
  const countEl = document.getElementById('user-count');
  const users = Object.values(getAllUsers());

  countEl.textContent = users.length;

  if (users.length === 0) {
    list.innerHTML = '<li class="no-users">No hay usuarios activos</li>';
    return;
  }

  list.innerHTML = users.map(u => {
    const isMe = u.id === state.myId;
    const color = getColor(u.id);
    const hasPos = u.lat && u.lng;
    return `<li class="user-item" ${hasPos ? `data-id="${escapeHtml(u.id)}"` : ''}>
      <div class="user-dot user-dot-active" style="background:${color};box-shadow:0 0 0 3px ${color}33;"></div>
      <div class="user-details">
        <div class="user-name">${escapeHtml(u.name)}${isMe ? ' <span class="user-me-tag">Tú</span>' : ''}</div>
        <div class="user-time">${hasPos ? formatTime(u.lastUpdate) : 'Esperando GPS…'}</div>
      </div>
    </li>`;
  }).join('');

  list.querySelectorAll('[data-id]').forEach(el => {
    el.addEventListener('click', () => {
      const marker = state.markers[el.dataset.id];
      if (marker) {
        state.map.panTo(marker.getLatLng());
        marker.openPopup();
      }
    });
  });
}

// Shared in-memory reference for UI (keyed by socket id)
const _usersCache = {};
function getAllUsers() { return _usersCache; }

function upsertUserCache(user) { _usersCache[user.id] = user; }
function removeUserCache(id) { delete _usersCache[id]; }

/* ===== GEOLOCATION ===== */
function startGeolocationTracking() {
  if (!navigator.geolocation) {
    document.getElementById('my-location-info').textContent =
      '⚠️ Tu navegador no soporta geolocalización.';
    return;
  }

  const options = { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 };

  state.watchId = navigator.geolocation.watchPosition(
    (position) => {
      const { latitude: lat, longitude: lng } = position.coords;
      document.getElementById('my-location-info').textContent =
        `📍 Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
      state.socket.emit('update_location', { lat, lng });

      // Update local cache
      if (state.myId && _usersCache[state.myId]) {
        _usersCache[state.myId].lat = lat;
        _usersCache[state.myId].lng = lng;
        _usersCache[state.myId].lastUpdate = new Date().toISOString();
        updateUsersList();
      }
    },
    (err) => {
      document.getElementById('my-location-info').textContent =
        `⚠️ Error GPS: ${err.message}`;
    },
    options
  );
}

function stopGeolocationTracking() {
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
}

/* ===== CONNECTION STATUS ===== */
function setConnectionStatus(status) {
  const el = document.getElementById('connection-status');
  el.className = 'status-badge';
  if (status === 'connected') {
    el.classList.add('status-connected');
    el.textContent = 'Conectado';
  } else if (status === 'tracking') {
    el.classList.add('status-tracking');
    el.textContent = 'Rastreando';
  } else {
    el.classList.add('status-disconnected');
    el.textContent = 'Desconectado';
  }
}

/* ===== SECURITY HELPER ===== */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ===== FORM HANDLING ===== */
function setupForm() {
  const form = document.getElementById('register-form');
  const btnStop = document.getElementById('btn-stop');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('user-name').value.trim();
    if (!name) return;

    state.myName = name;
    state.tracking = true;

    // Register with server
    state.socket.emit('register_user', { name });

    // UI switch
    form.style.display = 'none';
    btnStop.style.display = 'block';
    setConnectionStatus('tracking');

    // Seed cache entry for this user
    upsertUserCache({ id: state.socket.id, name, lat: null, lng: null, lastUpdate: null });
    updateUsersList();
  });

  btnStop.addEventListener('click', () => {
    state.tracking = false;
    stopGeolocationTracking();

    if (state.myId) {
      removeMarker(state.myId);
      removeUserCache(state.myId);
    }

    state.myId = null;
    state.myName = null;
    state._panDone = false;

    document.getElementById('my-location-info').textContent = '';
    document.getElementById('user-name').value = '';
    form.style.display = 'block';
    btnStop.style.display = 'none';
    setConnectionStatus('connected');
    updateUsersList();

    // Reconnect so server issues a new socket id
    state.socket.disconnect();
    state.socket.connect();
  });
}

/* ===== BOOTSTRAP ===== */
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initSocket();
  setupForm();
});
