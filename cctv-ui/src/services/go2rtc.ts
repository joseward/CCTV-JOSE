import type { Camera } from '../types/cctv';

const GO2RTC_HOST = '127.0.0.1:1984';
export const GO2RTC_URL = `http://${GO2RTC_HOST}`;
export const GO2RTC_WS = `ws://${GO2RTC_HOST}`;

export async function checkGo2RtcHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${GO2RTC_URL}/api`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function registerStream(name: string, src: string): Promise<boolean> {
  if (!src || !src.trim()) return false;
  try {
    const params = new URLSearchParams({ name, src });
    const res = await fetch(`${GO2RTC_URL}/api/streams?${params.toString()}`, {
      method: 'PUT',
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch (err) {
    console.warn(`[go2rtc] Error registering stream ${name}:`, err);
    return false;
  }
}

export async function deleteStream(name: string): Promise<boolean> {
  try {
    const params = new URLSearchParams({ src: name });
    const res = await fetch(`${GO2RTC_URL}/api/streams?${params.toString()}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getActiveStreams(): Promise<Record<string, any>> {
  try {
    const res = await fetch(`${GO2RTC_URL}/api/streams`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

export async function syncCameraStreams(cameras: Camera[]): Promise<void> {
  for (const cam of cameras) {
    if (!cam.enabled) continue;
    
    // Register Main Stream
    if (cam.mainStreamUrl) {
      await registerStream(`cam_${cam.id}_main`, cam.mainStreamUrl);
    }
    
    // Register Sub Stream (fallback to main if sub not specified)
    const subUrl = cam.subStreamUrl || cam.mainStreamUrl;
    if (subUrl) {
      await registerStream(`cam_${cam.id}_sub`, subUrl);
    }
  }
}

/**
 * Generates RTSP URLs from preset parameters
 */
export function buildPresetRtspUrls(
  preset: string,
  ip: string,
  port: number = 554,
  user?: string,
  pass?: string,
  channel: number = 1
): { main: string; sub: string } {
  const auth = user ? (pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : `${encodeURIComponent(user)}@`) : '';
  const host = `${ip}:${port}`;

  switch (preset) {
    case 'hikvision':
      // Hikvision standard: 101/201 (main), 102/202 (sub)
      return {
        main: `rtsp://${auth}${host}/Streaming/Channels/${channel}01`,
        sub: `rtsp://${auth}${host}/Streaming/Channels/${channel}02`,
      };
    case 'dahua':
      // Dahua / Amcrest standard: subtype=0 (main), subtype=1 (sub)
      return {
        main: `rtsp://${auth}${host}/cam/realmonitor?channel=${channel}&subtype=0`,
        sub: `rtsp://${auth}${host}/cam/realmonitor?channel=${channel}&subtype=1`,
      };
    case 'uniview':
      // Uniview standard: s0 (main), s1 (sub)
      return {
        main: `rtsp://${auth}${host}/unicast/c${channel}/s0/live`,
        sub: `rtsp://${auth}${host}/unicast/c${channel}/s1/live`,
      };
    default:
      return {
        main: `rtsp://${auth}${host}/live/ch${channel}`,
        sub: `rtsp://${auth}${host}/live/ch${channel}_sub`,
      };
  }
}

/**
 * Builds standard RTSP Playback URL for DVR/NVR based on brand, channel, and time range
 */
export function buildPresetPlaybackRtspUrl(
  preset: string,
  ip: string,
  port: number = 554,
  user?: string,
  pass?: string,
  channel: number = 1,
  startTime: Date = new Date(),
  endTime: Date = new Date(Date.now() + 3600 * 1000)
): string {
  const auth = user ? (pass ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : `${encodeURIComponent(user)}@`) : '';
  const host = `${ip}:${port}`;

  const pad = (n: number) => n.toString().padStart(2, '0');

  const sY = startTime.getFullYear();
  const sM = pad(startTime.getMonth() + 1);
  const sD = pad(startTime.getDate());
  const sH = pad(startTime.getHours());
  const sm = pad(startTime.getMinutes());
  const ss = pad(startTime.getSeconds());

  const eY = endTime.getFullYear();
  const eM = pad(endTime.getMonth() + 1);
  const eD = pad(endTime.getDate());
  const eH = pad(endTime.getHours());
  const em = pad(endTime.getMinutes());
  const es = pad(endTime.getSeconds());

  switch (preset.toLowerCase()) {
    case 'dahua':
      // Dahua format: /cam/playback?channel=1&starttime=YYYY_MM_DD_HH_MM_SS&endtime=YYYY_MM_DD_HH_MM_SS
      const dStart = `${sY}_${sM}_${sD}_${sH}_${sm}_${ss}`;
      const dEnd = `${eY}_${eM}_${eD}_${eH}_${em}_${es}`;
      return `rtsp://${auth}${host}/cam/playback?channel=${channel}&starttime=${dStart}&endtime=${dEnd}`;

    case 'hikvision':
      // Hikvision format: /Streaming/tracks/101?starttime=YYYYMMDDTHHMMSSZ&endtime=YYYYMMDDTHHMMSSZ
      const hTrack = `${channel}01`;
      const hStart = `${sY}${sM}${sD}T${sH}${sm}${ss}Z`;
      const hEnd = `${eY}${eM}${eD}T${eH}${em}${es}Z`;
      return `rtsp://${auth}${host}/Streaming/tracks/${hTrack}?starttime=${hStart}&endtime=${hEnd}`;

    case 'uniview':
      return `rtsp://${auth}${host}/unicast/c${channel}/s0/playback?starttime=${sY}${sM}${sD}T${sH}${sm}${ss}Z&endtime=${eY}${eM}${eD}T${eH}${em}${es}Z`;

    default:
      return `rtsp://${auth}${host}/cam/playback?channel=${channel}&starttime=${sY}_${sM}_${sD}_${sH}_${sm}_${ss}&endtime=${eY}_${eM}_${eD}_${eH}_${em}_${es}`;
  }
}

/**
 * Creates and registers an on-demand playback stream in go2rtc
 */
export async function startPlaybackSession(
  camera: Camera,
  startTime: Date,
  endTime: Date
): Promise<{ streamName: string; rtspUrl: string } | null> {
  const streamName = `playback_${camera.id}_${Date.now()}`;
  const rtspUrl = buildPresetPlaybackRtspUrl(
    camera.vendorPreset || 'dahua',
    camera.ip,
    camera.port || 554,
    camera.username,
    camera.password,
    camera.channel,
    startTime,
    endTime
  );

  const ok = await registerStream(streamName, rtspUrl);
  if (ok) {
    return { streamName, rtspUrl };
  }
  return null;
}

export interface ValidationResult {
  ok: boolean;
  message: string;
}

/**
 * Validates connection and credentials against an RTSP DVR/NVR using go2rtc probe
 */
export async function validateDvrCredentials(
  vendor: string,
  ip: string,
  port: number = 554,
  user: string = 'admin',
  pass: string = ''
): Promise<ValidationResult> {
  const probeName = `probe_${Date.now()}`;
  const urls = buildPresetRtspUrls(vendor, ip, port, user, pass, 1);
  const streamUrl = urls.sub || urls.main;

  try {
    await registerStream(probeName, streamUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(`${GO2RTC_URL}/api/frame.mp4?src=${encodeURIComponent(probeName)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    deleteStream(probeName).catch(() => {});

    if (res.ok) {
      return { ok: true, message: '¡Credenciales y conexión validadas exitosamente!' };
    }

    const text = await res.text();
    if (text.includes('wrong user/pass')) {
      return { ok: false, message: 'Usuario o contraseña incorrectos. Verifique sus credenciales.' };
    } else if (text.includes('DESCRIBE') || res.status === 404) {
      return { ok: false, message: 'Equipo responde, pero la marca/protocolo RTSP no coincide.' };
    } else {
      return { ok: false, message: `Error del grabador: ${text || res.statusText}` };
    }
  } catch (err: any) {
    deleteStream(probeName).catch(() => {});
    if (err.name === 'AbortError') {
      return { ok: false, message: 'Tiempo de espera agotado. El grabador no respondió en la IP/puerto.' };
    }
    return { ok: false, message: `No se pudo conectar a ${ip}:${port}. Compruebe la red y la IP.` };
  }
}

export interface ScanResult {
  ok: boolean;
  vendor: string;
  activeChannels: number[];
  channelCount: number;
  message: string;
}

/**
 * Probes a specific channel on a DVR
 */
export async function probeSingleChannel(
  vendor: string,
  ip: string,
  port: number,
  user: string,
  pass: string,
  channel: number
): Promise<boolean> {
  const probeName = `probe_ch_${Date.now()}_${channel}`;
  const urls = buildPresetRtspUrls(vendor, ip, port, user, pass, channel);
  const streamUrl = urls.sub || urls.main;

  try {
    await registerStream(probeName, streamUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(`${GO2RTC_URL}/api/frame.mp4?src=${encodeURIComponent(probeName)}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    deleteStream(probeName).catch(() => {});
    return res.ok;
  } catch {
    deleteStream(probeName).catch(() => {});
    return false;
  }
}

/**
 * Scans active channels on a DVR (up to 32)
 */
export async function scanDvrActiveChannels(
  vendor: string,
  ip: string,
  port: number = 554,
  user: string = 'admin',
  pass: string = '',
  onProgress?: (scanned: number, found: number) => void
): Promise<ScanResult> {
  // First validate channel 1
  const firstProbe = await validateDvrCredentials(vendor, ip, port, user, pass);
  if (!firstProbe.ok) {
    return {
      ok: false,
      vendor,
      activeChannels: [],
      channelCount: 0,
      message: firstProbe.message,
    };
  }

  const activeChannels: number[] = [1];
  let consecutiveFails = 0;
  const maxChannelsToScan = 32;

  // Scan in batches of 4 for speed
  for (let startCh = 2; startCh <= maxChannelsToScan; startCh += 4) {
    const batch = [startCh, startCh + 1, startCh + 2, startCh + 3].filter(c => c <= maxChannelsToScan);
    const batchResults = await Promise.all(
      batch.map(async (ch) => {
        const ok = await probeSingleChannel(vendor, ip, port, user, pass, ch);
        return { ch, ok };
      })
    );

    for (const res of batchResults) {
      if (res.ok) {
        activeChannels.push(res.ch);
        consecutiveFails = 0;
      } else {
        consecutiveFails++;
      }
    }

    if (onProgress) {
      onProgress(Math.min(startCh + 3, maxChannelsToScan), activeChannels.length);
    }

    // If 4 consecutive channels fail after finding some, stop scanning
    if (consecutiveFails >= 4) {
      break;
    }
  }

  const maxActive = activeChannels.length > 0 ? Math.max(...activeChannels) : 8;
  return {
    ok: true,
    vendor,
    activeChannels,
    channelCount: maxActive,
    message: `¡Escaneo completo! Se detectaron ${activeChannels.length} canales activos (hasta Canal ${maxActive}).`,
  };
}

/**
 * Automatically detects DVR brand by testing Dahua, Hikvision, Uniview
 */
export async function autoDetectDvrVendor(
  ip: string,
  port: number = 554,
  user: string = 'admin',
  pass: string = ''
): Promise<{ vendor: string; result: ValidationResult; channelCount?: number }> {
  const vendors = ['hikvision', 'dahua', 'uniview'];
  let lastResult: ValidationResult = { ok: false, message: 'No se detectó respuesta.' };

  for (const v of vendors) {
    const res = await validateDvrCredentials(v, ip, port, user, pass);
    if (res.ok) {
      // Once brand is detected, automatically scan channels!
      const scan = await scanDvrActiveChannels(v, ip, port, user, pass);
      return { 
        vendor: v, 
        result: { ok: true, message: `¡Grabador detectado: ${v.toUpperCase()} con ${scan.channelCount} canales activos!` },
        channelCount: scan.channelCount
      };
    }
    lastResult = res;
    if (res.message.includes('Usuario o contraseña')) {
      return { vendor: v, result: res };
    }
  }

  return { vendor: 'hikvision', result: lastResult };
}
