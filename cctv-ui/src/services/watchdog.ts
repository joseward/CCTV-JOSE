import type { Camera } from '../types/cctv';
import { getDvrHealthReport, formatLocalTime } from './maintenance';
import { sendWhatsAppNotification, type AppSettings } from './notifications';

interface DvrStatusTracker {
  groupName: string;
  ip: string;
  lastState: 'online' | 'offline' | 'hdd_error' | 'unknown';
  lastAlertSent?: 'offline' | 'hdd_error' | 'recovery';
  lastCheckTime: number;
}

// In-memory state tracking to prevent alert spam
const statusMap: Map<string, DvrStatusTracker> = new Map();

/**
 * Runs a single silent audit cycle over all registered DVRs and sends WhatsApp alerts if state changes
 */
export async function auditAllDvrsAndNotify(
  cameras: Camera[],
  settings: AppSettings,
  onAuditProgress?: (msg: string) => void
): Promise<{ checked: number; alertsSent: number }> {
  if (!settings.autoMonitorEnabled && !settings.whatsappEnabled) {
    return { checked: 0, alertsSent: 0 };
  }

  // Extract distinct DVRs
  const dvrMap = new Map<string, { group: string; ip: string; port: number; vendorPreset: string; username: string; password?: string }>();
  for (const c of cameras) {
    const grp = (c.group || 'DVR General').trim();
    if (!dvrMap.has(grp)) {
      dvrMap.set(grp, {
        group: grp,
        ip: c.ip.trim(),
        port: c.port || 554,
        vendorPreset: c.vendorPreset || 'dahua',
        username: c.username || 'admin',
        password: c.password || '',
      });
    }
  }

  const dvrList = Array.from(dvrMap.values());
  let alertsSent = 0;

  for (const dvr of dvrList) {
    const key = `${dvr.group}_${dvr.ip}`;
    if (!statusMap.has(key)) {
      statusMap.set(key, {
        groupName: dvr.group,
        ip: dvr.ip,
        lastState: 'unknown',
        lastCheckTime: Date.now(),
      });
    }
    const tracker = statusMap.get(key)!;

    try {
      if (onAuditProgress) onAuditProgress(`Auditando ${dvr.group} (${dvr.ip})...`);
      const rep = await getDvrHealthReport(
        dvr.vendorPreset,
        dvr.ip,
        dvr.port,
        dvr.username,
        dvr.password || ''
      );

      const isOffline = !rep.success || rep.deviceTime === 'Error al consultar' || rep.deviceTime === 'Sin respuesta';
      const isHddBad = !rep.storageHealthy;
      const nowStr = formatLocalTime(new Date());

      if (isOffline) {
        // CASE 1: OFFLINE
        if (tracker.lastAlertSent !== 'offline') {
          tracker.lastState = 'offline';
          tracker.lastAlertSent = 'offline';

          if (settings.whatsappEnabled && settings.alertOnOffline) {
            const alertText = 
`🚨 *ALERTA CCTV - ${settings.branchName}*
━━━━━━━━━━━━━━━━━━
📡 *Grabador Desconectado (OFFLINE)*
• *Equipo:* ${dvr.group}
• *Dirección IP:* ${dvr.ip}
• *Problema:* El grabador ha perdido comunicación o se encuentra apagado.
• *Hora:* ${nowStr}
━━━━━━━━━━━━━━━━━━
⚠️ *Favor de verificar conexión de red y alimentación eléctrica.*`;

            await sendWhatsAppNotification(settings, alertText);
            alertsSent++;
          }
        }
      } else if (isHddBad) {
        // CASE 2: HDD ERROR
        if (tracker.lastAlertSent !== 'hdd_error') {
          tracker.lastState = 'hdd_error';
          tracker.lastAlertSent = 'hdd_error';

          if (settings.whatsappEnabled && settings.alertOnHddFail) {
            const alertText = 
`⚠️ *ALERTA CRÍTICA - ${settings.branchName}*
━━━━━━━━━━━━━━━━━━
💾 *Falla en Disco Duro de Grabación*
• *Equipo:* ${dvr.group} (${dvr.ip})
• *Estado Disco:* ${rep.storageStatus}
• *Hora:* ${nowStr}
━━━━━━━━━━━━━━━━━━
🚨 *Atención:* Las cámaras no están grabando evidencia en disco. Revise el estado del disco duro.`;

            await sendWhatsAppNotification(settings, alertText);
            alertsSent++;
          }
        }
      } else {
        // CASE 3: RECOVERY / HEALTHY
        if (tracker.lastAlertSent === 'offline' || tracker.lastAlertSent === 'hdd_error') {
          if (settings.whatsappEnabled && settings.alertOnRecovery) {
            const recovText = 
`✅ *SISTEMA RESTABLECIDO - ${settings.branchName}*
━━━━━━━━━━━━━━━━━━
🟢 *Grabador en Línea y Grabando*
• *Equipo:* ${dvr.group} (${dvr.ip})
• *Estado:* Conexión restablecida, disco activo y funcionando correctamente.
• *Hora:* ${nowStr}
━━━━━━━━━━━━━━━━━━`;

            await sendWhatsAppNotification(settings, recovText);
            alertsSent++;
          }
        }
        tracker.lastState = 'online';
        tracker.lastAlertSent = undefined; // clear alert state so future failures will alert again
      }

      tracker.lastCheckTime = Date.now();
    } catch (e) {
      console.warn(`Watchdog error on ${dvr.group}:`, e);
    }
  }

  return { checked: dvrList.length, alertsSent };
}
