/* ─────────────────────────────────────────────────────────────────────────────
   WEBRTC MEDIA CAPTURE — Captura multimedia para inserción en informes
   S08: WebRTC backend: captura multimedia navegador
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Captura una foto desde la cámara del dispositivo
 * @param {Object} options - { width, height, facingMode }
 * @returns {Promise<string>} Base64 data URL de la imagen
 */
export async function capturePhoto(options = {}) {
  const { width = 1280, height = 720, facingMode = 'environment' } = options;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: width }, height: { ideal: height }, facingMode },
  });

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;

  await new Promise(resolve => {
    video.onloadedmetadata = () => { video.play(); resolve(); };
  });

  // Wait for video to stabilize
  await new Promise(r => setTimeout(r, 500));

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);

  // Cleanup
  stream.getTracks().forEach(t => t.stop());

  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Graba un video corto desde la cámara
 * @param {number} durationMs - Duración en milisegundos
 * @param {Object} options - { width, height, facingMode }
 * @returns {Promise<Blob>} Video Blob
 */
export async function recordVideo(durationMs = 5000, options = {}) {
  const { width = 1280, height = 720, facingMode = 'environment' } = options;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: width }, height: { ideal: height }, facingMode },
    audio: true,
  });

  const recorder = new MediaRecorder(stream, {
    mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm',
  });

  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorder.onerror = (e) => {
      stream.getTracks().forEach(t => t.stop());
      reject(e);
    };
    recorder.start();
    setTimeout(() => recorder.stop(), durationMs);
  });
}

/**
 * Captura de pantalla
 * @returns {Promise<string>} Base64 data URL
 */
export async function captureScreen() {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });

  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;

  await new Promise(resolve => {
    video.onloadedmetadata = () => { video.play(); resolve(); };
  });

  await new Promise(r => setTimeout(r, 300));

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  stream.getTracks().forEach(t => t.stop());
  return canvas.toDataURL('image/png');
}

/**
 * Graba audio para dictado
 * @param {number} durationMs - Duración máxima
 * @returns {Promise<Blob>} Audio Blob
 */
export async function recordAudio(durationMs = 30000) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const recorder = new MediaRecorder(stream, {
    mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm',
  });

  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  return new Promise((resolve, reject) => {
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorder.onerror = reject;
    recorder.start();
    setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, durationMs);

    // Return a control object for manual stop
    resolve.__recorder = recorder;
  });
}

/**
 * Checks available media devices
 * @returns {Promise<Object>} Device capabilities
 */
export async function getMediaCapabilities() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return {
    hasCamera: devices.some(d => d.kind === 'videoinput'),
    hasMicrophone: devices.some(d => d.kind === 'audioinput'),
    hasSpeaker: devices.some(d => d.kind === 'audiooutput'),
    cameras: devices.filter(d => d.kind === 'videoinput').map(d => ({ id: d.deviceId, label: d.label })),
    microphones: devices.filter(d => d.kind === 'audioinput').map(d => ({ id: d.deviceId, label: d.label })),
  };
}
