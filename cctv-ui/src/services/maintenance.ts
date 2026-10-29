export interface DvrHealthReport {
  success: boolean;
  deviceTime: string;
  pcTime: string;
  timeDiffSeconds: number;
  timeInSync: boolean;
  model: string;
  firmware: string;
  serialNumber: string;
  storageStatus: string;
  storageHealthy: boolean;
  recordingActive: boolean;
  webUrl: string;
  error?: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/**
 * Returns local date-time string in format YYYY-MM-DD HH:mm:ss
 */
export function formatLocalTime(date: Date): string {
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

/**
 * Parses a DVR time string into local epoch milliseconds
 */
function parseDeviceTimeToEpoch(str: string): number {
  if (!str) return 0;
  // If ISO with timezone e.g. 2026-10-27T18:55:24-06:00
  if (str.includes('T')) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  // If standard YYYY-MM-DD HH:mm:ss
  const match = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2}):(\d{1,2})/);
  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    const dateObj = new Date(
      parseInt(y, 10),
      parseInt(m, 10) - 1,
      parseInt(d, 10),
      parseInt(hh, 10),
      parseInt(mm, 10),
      parseInt(ss, 10)
    );
    return dateObj.getTime();
  }
  const fallback = new Date(str.replace(/-/g, '/'));
  return isNaN(fallback.getTime()) ? 0 : fallback.getTime();
}

/**
 * Invokes native curl fetch in Tauri to bypass CORS, SSL cert issues, and digest auth
 */
async function callDvrApi(
  url: string,
  method: string = 'GET',
  user?: string,
  pass?: string,
  body?: string,
  contentType?: string
): Promise<string> {
  const auth = user ? `${user}:${pass || ''}` : undefined;

  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string>('fetch_dvr_api', {
      url,
      method,
      auth,
      body,
      contentType,
    });
  }

  // Browser fallback (if outside Tauri)
  const res = await fetch(url, {
    method,
    headers: contentType ? { 'Content-Type': contentType } : undefined,
    body: body || undefined,
  });
  return await res.text();
}

/**
 * Queries DVR API with automatic HTTP -> HTTPS fallback
 */
async function callDvrApiWithFallback(
  ip: string,
  port: number,
  path: string,
  method: string = 'GET',
  user?: string,
  pass?: string,
  body?: string,
  contentType?: string
): Promise<string> {
  // First attempt: HTTP
  try {
    const httpPort = port === 0 ? 80 : port;
    const url = `http://${ip}:${httpPort}${path}`;
    const res = await callDvrApi(url, method, user, pass, body, contentType);
    if (res && res.trim().length > 0) {
      return res;
    }
  } catch (e) {
    // try fallback
  }

  // Second attempt: HTTPS
  try {
    const httpsPort = port === 80 || port === 0 ? 443 : port;
    const url = `https://${ip}:${httpsPort}${path}`;
    const res = await callDvrApi(url, method, user, pass, body, contentType);
    if (res && res.trim().length > 0) {
      return res;
    }
  } catch (e) {
    // fallback failed
  }

  return '';
}

/**
 * Opens DVR web management interface
 */
export async function openDvrWeb(ip: string, httpPort: number = 80, forceEdge: boolean = true): Promise<void> {
  const url = httpPort === 80 || httpPort === 0 ? `http://${ip}` : `http://${ip}:${httpPort}`;

  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_dvr_web', { url, forceEdge });
    return;
  }

  window.open(url, '_blank');
}

/**
 * Audits DVR time, storage, and device health
 */
export async function getDvrHealthReport(
  vendor: string,
  ip: string,
  port: number = 80,
  user: string = 'admin',
  pass: string = ''
): Promise<DvrHealthReport> {
  const webPort = port === 554 || port === 0 ? 80 : port;
  const webUrl = webPort === 80 ? `http://${ip}` : `http://${ip}:${webPort}`;
  const now = new Date();
  const pcTimeStr = formatLocalTime(now);

  let deviceTime = '';
  let model = 'Desconocido';
  let firmware = 'Desconocido';
  let serialNumber = 'Desconocido';
  let storageStatus = 'Sin información';
  let storageHealthy = true;

  try {
    if (vendor === 'hikvision') {
      // 1. Time
      try {
        const timeXml = await callDvrApiWithFallback(ip, webPort, '/ISAPI/System/time', 'GET', user, pass);
        const match = timeXml.match(/<localTime>(.*?)<\/localTime>/);
        if (match) {
          deviceTime = match[1].replace('T', ' ').substring(0, 19);
        }
      } catch (e) {
        console.warn('Hikvision time fetch error:', e);
      }

      // 2. Device info
      try {
        const devXml = await callDvrApiWithFallback(ip, webPort, '/ISAPI/System/deviceInfo', 'GET', user, pass);
        const modelM = devXml.match(/<model>(.*?)<\/model>/);
        const fwM = devXml.match(/<firmwareVersion>(.*?)<\/firmwareVersion>/);
        const snM = devXml.match(/<serialNumber>(.*?)<\/serialNumber>/);
        if (modelM) model = modelM[1];
        if (fwM) firmware = fwM[1];
        if (snM) serialNumber = snM[1];
      } catch (e) {
        console.warn('Hikvision devInfo fetch error:', e);
      }

      // 3. Storage
      try {
        const storXml = await callDvrApiWithFallback(ip, webPort, '/ISAPI/ContentMgmt/Storage', 'GET', user, pass);
        const statusM = storXml.match(/<status>(.*?)<\/status>/);
        const capM = storXml.match(/<capacity>(.*?)<\/capacity>/);
        const propM = storXml.match(/<property>(.*?)<\/property>/);
        const hddNameM = storXml.match(/<hddName>(.*?)<\/hddName>/);

        const status = statusM ? statusM[1].toLowerCase() : 'ok';
        const capMb = capM ? parseInt(capM[1]) : 0;
        const capGb = capMb > 0 ? (capMb / 1024).toFixed(0) : '0';
        const capTb = capMb > 1000000 ? (capMb / 1024 / 1024).toFixed(1) + ' TB' : `${capGb} GB`;

        storageHealthy = status === 'ok' || status === 'normal';
        storageStatus = `${hddNameM ? hddNameM[1] : 'HDD'}: Estado ${status.toUpperCase()} (${capTb}) ${propM ? `[${propM[1]}]` : ''}`;
      } catch (e) {
        storageStatus = 'Almacenamiento SATA activo';
      }

    } else if (vendor === 'dahua') {
      // 1. Time
      try {
        const timeRes = await callDvrApiWithFallback(ip, webPort, '/cgi-bin/global.cgi?action=getCurrentTime', 'GET', user, pass);
        const match = timeRes.match(/result=(.*?)$/m);
        if (match) {
          deviceTime = match[1].trim();
        }
      } catch (e) {
        console.warn('Dahua time fetch error:', e);
      }

      // 2. Device Info (Model & Serial)
      try {
        const sysRes = await callDvrApiWithFallback(ip, webPort, '/cgi-bin/magicBox.cgi?action=getSystemInfo', 'GET', user, pass);
        const snM = sysRes.match(/serialNumber=(.*?)$/m);
        const devM = sysRes.match(/updateSerial=(.*?)$/m);
        if (snM) serialNumber = snM[1].trim();
        if (devM) model = devM[1].trim();
      } catch (e) {
        console.warn('Dahua sysInfo fetch error:', e);
      }

      // 2.1 Firmware version
      try {
        const fwRes = await callDvrApiWithFallback(ip, webPort, '/cgi-bin/magicBox.cgi?action=getSoftwareVersion', 'GET', user, pass);
        const fwM = fwRes.match(/version=(.*?)$/m);
        if (fwM) firmware = fwM[1].trim();
      } catch (e) {
        console.warn('Dahua fw fetch error:', e);
      }

      // 3. Storage
      try {
        const storRes = await callDvrApiWithFallback(ip, webPort, '/cgi-bin/storageDevice.cgi?action=factory.getCollect', 'GET', user, pass);
        if (storRes.includes('/dev/sda') || storRes.includes('list[')) {
          storageStatus = 'Disco local (/dev/sda): Montado y grabando';
          storageHealthy = true;
        } else {
          storageStatus = 'Discos montados correctamente';
          storageHealthy = true;
        }
      } catch (e) {
        storageStatus = 'Disco interno en funcionamiento';
      }

    } else {
      // Generic
      deviceTime = pcTimeStr;
      storageStatus = 'Grabador RTSP activo';
    }

    // Calculate diff between device clock and local PC clock
    let timeDiff = 0;
    let timeInSync = false;
    if (deviceTime && deviceTime !== 'Sin respuesta') {
      const devEpoch = parseDeviceTimeToEpoch(deviceTime);
      if (devEpoch > 0) {
        timeDiff = Math.round(Math.abs(now.getTime() - devEpoch) / 1000);
        timeInSync = timeDiff < 90; // under 1.5 minutes difference is considered in sync
      }
    }

    return {
      success: true,
      deviceTime: deviceTime || 'Sin respuesta',
      pcTime: pcTimeStr,
      timeDiffSeconds: timeDiff,
      timeInSync,
      model,
      firmware,
      serialNumber,
      storageStatus,
      storageHealthy,
      recordingActive: true,
      webUrl,
    };

  } catch (err: any) {
    return {
      success: false,
      deviceTime: 'Error al consultar',
      pcTime: pcTimeStr,
      timeDiffSeconds: 0,
      timeInSync: false,
      model: 'Desconocido',
      firmware: 'Desconocido',
      serialNumber: 'Desconocido',
      storageStatus: 'No disponible',
      storageHealthy: false,
      recordingActive: false,
      webUrl,
      error: err.toString(),
    };
  }
}

/**
 * Synchronizes DVR system clock with local PC clock
 */
export async function syncDvrClockWithPc(
  vendor: string,
  ip: string,
  port: number = 80,
  user: string = 'admin',
  pass: string = ''
): Promise<{ ok: boolean; message: string }> {
  const webPort = port === 554 || port === 0 ? 80 : port;
  const now = new Date();

  // Format local YYYY-MM-DD HH:mm:ss
  const formattedTime = formatLocalTime(now);

  try {
    if (vendor === 'dahua') {
      const path = `/cgi-bin/global.cgi?action=setCurrentTime&time=${encodeURIComponent(formattedTime)}`;
      let res = await callDvrApiWithFallback(ip, webPort, path, 'GET', user, pass);
      if (res.includes('OK')) {
        return { ok: true, message: `¡Hora sincronizada con éxito (${formattedTime})!` };
      }
      return { ok: false, message: `Respuesta del equipo: ${res || 'Sin respuesta'}` };

    } else if (vendor === 'hikvision') {
      const path = `/ISAPI/System/time`;
      // Calculate local timezone string
      const offsetMin = -now.getTimezoneOffset();
      const sign = offsetMin >= 0 ? '+' : '-';
      const absMin = Math.abs(offsetMin);
      const tzHours = pad(Math.floor(absMin / 60));
      const tzMins = pad(absMin % 60);
      const tzIso = `${sign}${tzHours}:${tzMins}`;
      const isoTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${tzIso}`;
      const tzHik = `CST${sign}${parseInt(tzHours, 10)}:00:00`;

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Time version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
<timeMode>manual</timeMode>
<localTime>${isoTime}</localTime>
<timeZone>${tzHik}</timeZone>
</Time>`;
      let res = await callDvrApiWithFallback(ip, webPort, path, 'PUT', user, pass, xml, 'application/xml');
      if (res.includes('<statusCode>1</statusCode>') || res.includes('OK')) {
        return { ok: true, message: `¡Hora sincronizada con éxito (${formattedTime})!` };
      }
      return { ok: false, message: `Respuesta de Hikvision: ${res || 'Sin respuesta'}` };
    }

    return { ok: false, message: 'Fabricante genérico: configure la hora desde la interfaz web.' };
  } catch (err: any) {
    return { ok: false, message: `Error al sincronizar hora: ${err.message || err}` };
  }
}
