import { log } from '../../../lib/logger';
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
} as const;

interface NotificationTemplate {
  id: string;
  subject: string;
  body: string;
  channels: string[];
}

/** Plantillas de mensaje predefinidas */
const TEMPLATES: Record<string, NotificationTemplate> = {
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
function fillTemplate(template: NotificationTemplate, vars: Record<string, unknown> = {}): { subject: string; body: string } {
  let subject = template.subject;
  let body = template.body;
  Object.entries(vars).forEach(([key, val]) => {
    const re = new RegExp(`\\{${key}\\}`, 'g');
    subject = subject.replace(re, String(val ?? ''));
    body = body.replace(re, String(val ?? ''));
  });
  return { subject, body };
}

export interface InAppNotification {
  id: string;
  timestamp: string;
  read: boolean;
  title?: string;
  body?: string;
  templateId?: string;
  severity?: string;
  [key: string]: unknown;
}

export interface NotificationSendResult {
  success: boolean;
  channel: string;
  error?: string;
}

/** In-app notification store */
const inAppNotifications: InAppNotification[] = [];
const subscribers = new Set<(notifications: InAppNotification[]) => void>();

function notifySubscribers(): void {
  subscribers.forEach(fn => fn([...inAppNotifications]));
}

export function subscribeNotifications(fn: (notifications: InAppNotification[]) => void): () => void {
  subscribers.add(fn);
  fn([...inAppNotifications]);
  return () => subscribers.delete(fn);
}

export function addInAppNotification(notification: Partial<InAppNotification>): void {
  inAppNotifications.unshift({
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    read: false,
    ...notification,
  });
  if (inAppNotifications.length > 100) inAppNotifications.pop();
  notifySubscribers();
}

export function markNotificationRead(id: string): void {
  const notif = inAppNotifications.find(n => n.id === id);
  if (notif) { notif.read = true; notifySubscribers(); }
}

export function markAllRead(): void {
  inAppNotifications.forEach(n => { n.read = true; });
  notifySubscribers();
}

export function getUnreadCount(): number {
  return inAppNotifications.filter(n => !n.read).length;
}

/** Envía notificación por WhatsApp Business API */
export async function sendWhatsApp(phone: string, message: string): Promise<NotificationSendResult> {
  try {
    const response = await fetch(`${API_BASE}/notifications/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, message }),
      credentials: 'include',
    });
    return { success: response.ok, channel: 'whatsapp' };
  } catch (err) {
    log.warn('[NOTIF] WhatsApp send failed:', err);
    return { success: false, error: (err as Error).message, channel: 'whatsapp' };
  }
}

/** Envía notificación por email */
export async function sendEmail(to: string, subject: string, body: string): Promise<NotificationSendResult> {
  try {
    const response = await fetch(`${API_BASE}/notifications/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body }),
      credentials: 'include',
    });
    return { success: response.ok, channel: 'email' };
  } catch (err) {
    return { success: false, error: (err as Error).message, channel: 'email' };
  }
}

/** Envía push notification (via Service Worker) */
export async function sendPushNotification(title: string, body: string, icon = '/icon-192.png'): Promise<NotificationSendResult> {
  if (!('Notification' in window)) return { success: false, channel: 'push' };
  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return { success: false, channel: 'push' };
  }
  new Notification(title, { body, icon, badge: icon });
  return { success: true, channel: 'push' };
}

/** Dispatcher: envía notificación por todos los canales configurados en la plantilla */
export async function dispatchNotification(
  templateId: string,
  vars: Record<string, unknown> = {},
  recipientPhone: string | null = null,
  recipientEmail: string | null = null,
): Promise<NotificationSendResult[]> {
  const template = TEMPLATES[templateId];
  if (!template) {
    log.warn(`[NOTIF] Template ${templateId} not found`);
    return [];
  }

  const { subject, body } = fillTemplate(template, {
    ...vars,
    timestamp: vars.timestamp || new Date().toLocaleString('es-PE'),
  });

  const results: NotificationSendResult[] = [];

  for (const channel of template.channels) {
    if (channel === CHANNELS.INAPP) {
      addInAppNotification({ title: subject, body, templateId, severity: (vars.severity as string) || 'info' });
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
