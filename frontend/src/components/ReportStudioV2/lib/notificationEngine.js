/* ─────────────────────────────────────────────────────────────────────────────
   NOTIFICATION ENGINE — WhatsApp, Email, Push, In-App
   S09: WhatsApp Business API + sistema de notificaciones multi-canal
   ───────────────────────────────────────────────────────────────────────── */

const API_BASE = '/api';

/** Canal de notificación */
const CHANNELS = {
  WHATSAPP: 'whatsapp',
  EMAIL: 'email',
  PUSH: 'push',
  INAPP: 'inapp',
  SMS: 'sms',
};

/** Plantillas de mensaje predefinidas */
const TEMPLATES = {
  ALARM_CRITICAL: {
    id: 'alarm_critical',
    subject: '🚨 Alarma Crítica — {sensorType}',
    body: '⚠️ ALARMA CRÍTICA\n\nSensor: {sensorId}\nTipo: {sensorType}\nLectura: {reading} {unit}\nUmbral: {threshold} {unit}\nZona: {zone}\nFecha: {timestamp}\n\nAcción requerida inmediata.',
    channels: [CHANNELS.WHATSAPP, CHANNELS.PUSH, CHANNELS.INAPP],
  },
  ALARM_HIGH: {
    id: 'alarm_high',
    subject: '⚠️ Alarma Alta — {sensorType}',
    body: 'Alarma nivel ALTO\n\nSensor: {sensorId}\nLectura: {reading} {unit}\nZona: {zone}\nFecha: {timestamp}',
    channels: [CHANNELS.WHATSAPP, CHANNELS.INAPP],
  },
  WORKFLOW_TRANSITION: {
    id: 'workflow_transition',
    subject: '📋 Informe {reportTitle} — {newStatus}',
    body: 'El informe "{reportTitle}" cambió de estado:\n\n{oldStatus} → {newStatus}\n\nAutor: {author}\nFecha: {timestamp}\nComentario: {comment}',
    channels: [CHANNELS.WHATSAPP, CHANNELS.EMAIL, CHANNELS.INAPP],
  },
  REPORT_APPROVED: {
    id: 'report_approved',
    subject: '✅ Informe Aprobado — {reportTitle}',
    body: 'El informe "{reportTitle}" ha sido APROBADO.\n\nAprobado por: {approver}\nFecha: {timestamp}',
    channels: [CHANNELS.WHATSAPP, CHANNELS.EMAIL, CHANNELS.INAPP],
  },
  REPORT_SHARED: {
    id: 'report_shared',
    subject: '📤 Informe Compartido — {reportTitle}',
    body: '{sender} ha compartido el informe "{reportTitle}" contigo.\n\nAccede al sistema para revisar.',
    channels: [CHANNELS.EMAIL, CHANNELS.INAPP],
  },
  SYSTEM_ALERT: {
    id: 'system_alert',
    subject: '⚙️ Alerta de Sistema',
    body: '{message}\n\nFecha: {timestamp}',
    channels: [CHANNELS.INAPP],
  },
};

/** Rellena template con variables */
function fillTemplate(template, vars = {}) {
  let subject = template.subject;
  let body = template.body;
  Object.entries(vars).forEach(([key, val]) => {
    const re = new RegExp(`\\{${key}\\}`, 'g');
    subject = subject.replace(re, String(val ?? ''));
    body = body.replace(re, String(val ?? ''));
  });
  return { subject, body };
}

/** In-app notification store */
const inAppNotifications = [];
const subscribers = new Set();

function notifySubscribers() {
  subscribers.forEach(fn => fn([...inAppNotifications]));
}

export function subscribeNotifications(fn) {
  subscribers.add(fn);
  fn([...inAppNotifications]);
  return () => subscribers.delete(fn);
}

export function addInAppNotification(notification) {
  inAppNotifications.unshift({
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    read: false,
    ...notification,
  });
  if (inAppNotifications.length > 100) inAppNotifications.pop();
  notifySubscribers();
}

export function markNotificationRead(id) {
  const notif = inAppNotifications.find(n => n.id === id);
  if (notif) { notif.read = true; notifySubscribers(); }
}

export function markAllRead() {
  inAppNotifications.forEach(n => { n.read = true; });
  notifySubscribers();
}

export function getUnreadCount() {
  return inAppNotifications.filter(n => !n.read).length;
}

/** Envía notificación por WhatsApp Business API */
export async function sendWhatsApp(phone, message) {
  try {
    const response = await fetch(`${API_BASE}/notifications/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message }),
      credentials: 'include',
    });
    return { success: response.ok, channel: 'whatsapp' };
  } catch (err) {
    console.warn('[NOTIF] WhatsApp send failed:', err);
    return { success: false, error: err.message, channel: 'whatsapp' };
  }
}

/** Envía notificación por email */
export async function sendEmail(to, subject, body) {
  try {
    const response = await fetch(`${API_BASE}/notifications/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body }),
      credentials: 'include',
    });
    return { success: response.ok, channel: 'email' };
  } catch (err) {
    return { success: false, error: err.message, channel: 'email' };
  }
}

/** Envía push notification (via Service Worker) */
export async function sendPushNotification(title, body, icon = '/icon-192.png') {
  if (!('Notification' in window)) return { success: false, channel: 'push' };
  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { success: false, channel: 'push' };
  }
  new Notification(title, { body, icon, badge: icon });
  return { success: true, channel: 'push' };
}

/** Dispatcher: envía notificación por todos los canales configurados en la plantilla */
export async function dispatchNotification(templateId, vars = {}, recipientPhone = null, recipientEmail = null) {
  const template = TEMPLATES[templateId];
  if (!template) {
    console.warn(`[NOTIF] Template ${templateId} not found`);
    return [];
  }

  const { subject, body } = fillTemplate(template, {
    ...vars,
    timestamp: vars.timestamp || new Date().toLocaleString('es-PE'),
  });

  const results = [];

  for (const channel of template.channels) {
    if (channel === CHANNELS.INAPP) {
      addInAppNotification({ title: subject, body, templateId, severity: vars.severity || 'info' });
      results.push({ success: true, channel: 'inapp' });
    }
    if (channel === CHANNELS.WHATSAPP && recipientPhone) {
      results.push(await sendWhatsApp(recipientPhone, `${subject}\n\n${body}`));
    }
    if (channel === CHANNELS.EMAIL && recipientEmail) {
      results.push(await sendEmail(recipientEmail, subject, body));
    }
    if (channel === CHANNELS.PUSH) {
      results.push(await sendPushNotification(subject, body));
    }
  }

  return results;
}

export { CHANNELS, TEMPLATES, fillTemplate };
