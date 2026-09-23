(function () {
  'use strict';

  var G = 9.80665;                 // m/s² por g, para reportar en la misma unidad que 'accelerograph' (g)
  var SEND_INTERVAL_MS = 2500;     // cadencia de envío de telemetría
  var COMMAND_POLL_MS = 6000;      // cadencia de sondeo de comandos pendientes
  var LS_KEY_APIKEY = 'beemetry_phone_sensor_api_key';
  var LS_KEY_APIBASE = 'beemetry_phone_sensor_api_base';
  var LS_KEY_BASELINE = 'beemetry_phone_sensor_baseline'; // {x,y,z} restado tras "recalibrate"

  var els = {
    apiKey: document.getElementById('apiKey'),
    apiBase: document.getElementById('apiBase'),
    btnStart: document.getElementById('btnStart'),
    btnStop: document.getElementById('btnStop'),
    dotMotion: document.getElementById('dotMotion'),
    dotGeo: document.getElementById('dotGeo'),
    dotNet: document.getElementById('dotNet'),
    vAccel: document.getElementById('vAccel'),
    vPga: document.getElementById('vPga'),
    vGeo: document.getElementById('vGeo'),
    vLastSend: document.getElementById('vLastSend'),
    log: document.getElementById('log'),
  };

  var state = {
    running: false,
    accel: null,          // {x,y,z} en g, ya con baseline restado
    geo: null,             // {lat,lng}
    baseline: loadJson(LS_KEY_BASELINE) || { x: 0, y: 0, z: 0 },
    sendTimer: null,
    pollTimer: null,
    geoWatchId: null,
  };

  function loadJson(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (_) { return null; }
  }
  function saveJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }

  function logLine(text, cls) {
    var div = document.createElement('div');
    if (cls) div.className = cls;
    var t = new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    div.textContent = '[' + t + '] ' + text;
    els.log.insertBefore(div, els.log.firstChild);
    while (els.log.children.length > 40) els.log.removeChild(els.log.lastChild);
  }

  function setDot(el, cls) {
    el.className = 'status-dot status-' + cls;
  }

  function apiBase() {
    var v = els.apiBase.value.trim();
    return v ? v.replace(/\/$/, '') : '';
  }
  function apiKey() { return els.apiKey.value.trim(); }

  // Restaurar valores guardados (conveniencia por-dispositivo, nunca se
  // manda a Claude ni a otro visor -- ver guía de la plataforma sobre
  // localStorage).
  (function restore() {
    var k = localStorage.getItem(LS_KEY_APIKEY);
    var b = localStorage.getItem(LS_KEY_APIBASE);
    if (k) els.apiKey.value = k;
    if (b) els.apiBase.value = b;
  })();

  async function apiFetch(path, options) {
    options = options || {};
    // El merge de headers va AL FINAL (sobre `options`), no al revés -- un
    // Object.assign({headers: mergedHeaders}, options) queda pisado por
    // options.headers cuando options TRAE su propio headers (p.ej.
    // sendTelemetry/handleCommand mandan {'Content-Type': 'application/json'})
    // porque Object.assign no fusiona profundo, solo reemplaza la clave
    // completa -- bug real encontrado 2026-09-18 probando con un teléfono
    // real: pollCommands (sin headers propio) SÍ mandaba X-Device-Key y
    // funcionaba (200), sendTelemetry y el ack (con headers propio) la
    // perdían en silencio y volvían 401 invalid_device_key.
    var headers = Object.assign({ 'X-Device-Key': apiKey() }, options.headers || {});
    var fetchOptions = Object.assign({}, options, { credentials: 'omit', headers: headers });
    // credentials:'omit' a propósito -- esta página nunca debe llevar la
    // cookie de sesión de un admin logueado en el mismo navegador (gotcha
    // real ya documentado en la plataforma: cookie de sesión viajando junto
    // a X-Device-Key dispara un 403 CSRF falso).
    return fetch(apiBase() + path, fetchOptions);
  }

  function currentAccelG() {
    if (!state.accel) return null;
    return {
      x: state.accel.x - state.baseline.x,
      y: state.accel.y - state.baseline.y,
      z: state.accel.z - state.baseline.z,
    };
  }

  function onDeviceMotion(e) {
    var a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    state.accel = { x: a.x / G, y: a.y / G, z: a.z / G };
    setDot(els.dotMotion, 'ok');
    var c = currentAccelG();
    els.vAccel.textContent = c.x.toFixed(3) + ' / ' + c.y.toFixed(3) + ' / ' + c.z.toFixed(3);
    var pga = Math.sqrt(c.x * c.x + c.y * c.y + c.z * c.z);
    els.vPga.textContent = pga.toFixed(3) + ' g';
  }

  function onGeoUpdate(pos) {
    state.geo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setDot(els.dotGeo, 'ok');
    els.vGeo.textContent = state.geo.lat.toFixed(5) + ', ' + state.geo.lng.toFixed(5);
  }
  function onGeoError(err) {
    setDot(els.dotGeo, 'err');
    logLine('GPS: ' + err.message, 'err');
  }

  async function startMotionPermission() {
    // iOS Safari exige un gesto del usuario + permiso explícito; Android
    // Chrome normalmente no (pero sí exige contexto seguro, ver comentario
    // arriba del archivo).
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        var res = await DeviceMotionEvent.requestPermission();
        if (res !== 'granted') {
          logLine('Permiso de movimiento denegado', 'err');
          return false;
        }
      } catch (e) {
        logLine('Error pidiendo permiso de movimiento: ' + e.message, 'err');
        return false;
      }
    }
    window.addEventListener('devicemotion', onDeviceMotion);
    return true;
  }

  function startGeo() {
    if (!('geolocation' in navigator)) {
      logLine('Geolocalización no disponible en este navegador', 'err');
      return;
    }
    state.geoWatchId = navigator.geolocation.watchPosition(onGeoUpdate, onGeoError, {
      enableHighAccuracy: true, maximumAge: 5000, timeout: 15000,
    });
  }

  async function sendTelemetry() {
    var channels = {};
    var c = currentAccelG();
    if (c) {
      channels.accel_x = c.x; channels.accel_y = c.y; channels.accel_z = c.z;
    }
    if (state.geo) {
      channels.gps_lat = state.geo.lat; channels.gps_lng = state.geo.lng;
    }
    if (Object.keys(channels).length === 0) return;
    try {
      var res = await apiFetch('/api/mining/telemetry/multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: channels }),
      });
      if (res.ok) {
        setDot(els.dotNet, 'ok');
        els.vLastSend.textContent = new Date().toLocaleTimeString('es-PE');
      } else {
        setDot(els.dotNet, 'err');
        var body = await res.text();
        logLine('Envío falló (' + res.status + '): ' + body, 'err');
      }
    } catch (e) {
      setDot(els.dotNet, 'err');
      logLine('Error de red enviando telemetría: ' + e.message, 'err');
    }
  }

  async function pollCommands() {
    try {
      var res = await apiFetch('/api/mining/telemetry/commands', { method: 'GET' });
      if (!res.ok) return;
      var data = await res.json();
      var commands = (data && data.commands) || [];
      for (var i = 0; i < commands.length; i++) {
        await handleCommand(commands[i]);
      }
    } catch (e) {
      logLine('Error consultando comandos pendientes: ' + e.message, 'err');
    }
  }

  async function handleCommand(cmd) {
    logLine('Comando recibido: ' + cmd.command_type + ' (#' + cmd.command_id + ')', 'cmd');
    var ok = true;
    var result = '';
    try {
      if (cmd.command_type === 'recalibrate') {
        // Re-cero: la lectura ACTUAL (con gravedad incluida) pasa a ser la
        // nueva línea base -- de ahí en adelante los canales reportan el
        // delta respecto a esta postura del teléfono, igual que "tarar" una
        // balanza. Puramente client-side, no hay firmware real que tocar.
        if (state.accel) {
          state.baseline = { x: state.accel.x, y: state.accel.y, z: state.accel.z };
          saveJson(LS_KEY_BASELINE, state.baseline);
          result = 'baseline actualizado a la orientación actual';
        } else {
          ok = false; result = 'sin lectura de acelerómetro todavía, reintenta';
        }
      } else if (cmd.command_type === 'reset_factory') {
        state.baseline = { x: 0, y: 0, z: 0 };
        saveJson(LS_KEY_BASELINE, state.baseline);
        result = 'baseline restablecido a cero (valor de fábrica)';
      } else if (cmd.command_type === 'reconfigure') {
        var payload = cmd.payload || {};
        if (payload.send_interval_ms && payload.send_interval_ms >= 500) {
          SEND_INTERVAL_MS = payload.send_interval_ms;
          restartSendTimer();
          result = 'intervalo de envío actualizado a ' + SEND_INTERVAL_MS + 'ms';
        } else {
          result = 'sin cambios aplicables en el payload';
        }
      } else {
        ok = false; result = 'tipo de comando no soportado en esta página';
      }
    } catch (e) {
      ok = false; result = e.message;
    }
    logLine((ok ? 'OK: ' : 'FALLÓ: ') + result, ok ? 'cmd' : 'err');
    try {
      await apiFetch('/api/mining/telemetry/commands/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command_id: cmd.command_id, status: ok ? 'completed' : 'failed', result: result }),
      });
    } catch (e) {
      logLine('No se pudo confirmar el comando al servidor: ' + e.message, 'err');
    }
  }

  function restartSendTimer() {
    if (state.sendTimer) clearInterval(state.sendTimer);
    state.sendTimer = setInterval(sendTelemetry, SEND_INTERVAL_MS);
  }

  async function start() {
    if (!apiKey()) { logLine('Falta el Device API Key', 'err'); return; }
    // `restore()` (arriba) lee estas dos claves con `getItem` CRUDO, sin
    // `JSON.parse` -- son texto plano (key/URL), no un objeto como
    // LS_KEY_BASELINE. Guardarlas con `saveJson` (que hace
    // `JSON.stringify`) las envolvía en comillas literales ("dev_..." en
    // vez de dev_...): funcionaba en ESTA sesión (el campo vivo del DOM
    // nunca se toca) pero corrompía el valor para la PRÓXIMA carga de
    // página, que sí restaura desde localStorage -- bug real encontrado en
    // vivo 2026-09-18: tras recargar, el Device API Key traía comillas de
    // sobra (hash distinto -> 401 invalid_device_key) y el API Base vacío
    // se restauraba como el string `""` (dos comillas), que building la URL
    // de la API con eso llevaba /phone-sensor/%22%22/api/... -- 405.
    try { localStorage.setItem(LS_KEY_APIKEY, apiKey()); } catch (_) {}
    try { localStorage.setItem(LS_KEY_APIBASE, apiBase()); } catch (_) {}
    var motionOk = await startMotionPermission();
    if (!motionOk) return;
    startGeo();
    restartSendTimer();
    state.pollTimer = setInterval(pollCommands, COMMAND_POLL_MS);
    pollCommands();
    state.running = true;
    els.btnStart.disabled = true;
    els.btnStop.disabled = false;
    logLine('Sensor iniciado');
  }

  function stop() {
    window.removeEventListener('devicemotion', onDeviceMotion);
    if (state.geoWatchId != null) navigator.geolocation.clearWatch(state.geoWatchId);
    if (state.sendTimer) clearInterval(state.sendTimer);
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.running = false;
    setDot(els.dotMotion, 'off'); setDot(els.dotGeo, 'off'); setDot(els.dotNet, 'off');
    els.btnStart.disabled = false;
    els.btnStop.disabled = true;
    logLine('Sensor detenido');
  }

  els.btnStart.addEventListener('click', function () { start().catch(function (e) { logLine('Error: ' + e.message, 'err'); }); });
  els.btnStop.addEventListener('click', stop);

  if (!window.isSecureContext) {
    logLine('Este navegador no está en un contexto seguro (HTTPS/localhost) -- el acelerómetro y el GPS probablemente NO pedirán permiso. Ver comentario al inicio del archivo.', 'err');
  }
})();
