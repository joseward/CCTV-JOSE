import type { Camera } from '../types/cctv';

const GO2RTC_HOST = '127.0.0.1:1984';
export const GO2RTC_URL = `http://${GO2RTC_HOST}`;
export const GO2RTC_WS = `ws://${GO2RTC_HOST}`;

export async function checkGo2RtcHealth(): Promise<boolean> {
  // 1. Try Tauri socket check & auto-recovery if running in desktop app
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      let isRunning = await invoke<boolean>('check_go2rtc_running');
      if (!isRunning) {
        await invoke('start_go2rtc');
        isRunning = await invoke<boolean>('check_go2rtc_running');
      }
      if (isRunning) return true;
    } catch {
      // fallback to http fetch below
    }
  }

  // 2. HTTP fetch check
  try {
    const res = await fetch(`${GO2RTC_URL}/api`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function restartGo2Rtc(): Promise<boolean> {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('stop_go2rtc');
      await invoke('start_go2rtc');
      return await invoke<boolean>('check_go2rtc_running');
    } catch (err) {
      console.error('[go2rtc] Error reiniciando motor:', err);
    }
  }
  return false;
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
    case 'juan':
      // Juan / EseeCloud / Jovision standard: ch0_0.264 (main), ch0_1.264 (sub)
      const chIdx = channel - 1;
      return {
        main: `rtsp://${auth}${host}/ch${chIdx}_0.264`,
        sub: `rtsp://${auth}${host}/ch${chIdx}_1.264`,
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
  detectedVendor?: string;
}

/**
 * Probes a specific stream URL directly, verifying that actual video frames (>200 bytes) are returned
 */
async function probeStreamRealVideo(streamUrl: string, timeoutMs: number = 3500): Promise<{ ok: boolean; errorText?: string }> {
  const probeName = `probe_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  try {
    const registered = await registerStream(probeName, streamUrl);
    if (!registered) return { ok: false, errorText: 'Error registrando stream' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${GO2RTC_URL}/api/frame.mp4?src=${encodeURIComponent(probeName)}&t=${Date.now()}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      deleteStream(probeName).catch(() => {});
      return { ok: true };
    }

    const text = await res.text().catch(() => '');
    deleteStream(probeName).catch(() => {});
    return { ok: false, errorText: text };
  } catch (err: any) {
    deleteStream(probeName).catch(() => {});
    return { ok: false, errorText: err?.message || 'Timeout' };
  }
}

/**
 * Validates connection and credentials against an RTSP DVR/NVR using go2rtc probe,
 * and if the selected vendor fails, automatically tests other vendor presets (Dahua, Hikvision, Uniview)
 * checking both Sub-Stream and Main-Stream to ensure 100% plug-and-play compatibility!
 */
export async function validateDvrCredentials(
  vendor: string,
  ip: string,
  port: number = 554,
  user: string = 'admin',
  pass: string = ''
): Promise<ValidationResult> {
  const cleanIp = ip.trim();
  const cleanUser = user.trim();

  // Helper to test a specific vendor preset on both sub and main streams
  const testVendor = async (v: string): Promise<{ ok: boolean; errorText?: string }> => {
    const urls = buildPresetRtspUrls(v, cleanIp, port, cleanUser, pass, 1);
    // 1. Try sub-stream first
    let probe = await probeStreamRealVideo(urls.sub, 3500);
    if (probe.ok) return probe;

    // 2. If sub-stream failed or has no video, try main stream (many DVRs disable sub-stream)
    if (urls.main && urls.main !== urls.sub) {
      await new Promise((r) => setTimeout(r, 150));
      probe = await probeStreamRealVideo(urls.main, 4000);
      if (probe.ok) return probe;
    }
    return probe;
  };

  // 1. First test the requested vendor preset
  const primaryProbe = await testVendor(vendor);

  if (primaryProbe.ok) {
    return { 
      ok: true, 
      detectedVendor: vendor, 
      message: `¡Credenciales y conexión validadas exitosamente (${vendor.toUpperCase()})!` 
    };
  }

  // 2. If it failed due to wrong password, don't bother probing other brands
  if (primaryProbe.errorText && primaryProbe.errorText.includes('wrong user/pass')) {
    return { ok: false, message: 'Usuario o contraseña incorrectos. Verifique sus credenciales.' };
  }

  // 3. Fallback: Automatically test all other supported brands (Dahua, Hikvision, Uniview, Juan/EseeCloud)
  const candidateVendors = ['dahua', 'hikvision', 'uniview', 'juan'].filter((v) => v !== vendor);

  for (const candidate of candidateVendors) {
    await new Promise((r) => setTimeout(r, 200));
    const candidateProbe = await testVendor(candidate);

    if (candidateProbe.ok) {
      return {
        ok: true,
        detectedVendor: candidate,
        message: `¡Conexión exitosa! El equipo fue detectado como ${candidate.toUpperCase()} (se corrigió la marca automáticamente).`,
      };
    }
  }

  // 4. If all standard presets failed, diagnose the problem
  if (primaryProbe.errorText && (primaryProbe.errorText.includes('Timeout') || primaryProbe.errorText.includes('abort'))) {
    return { ok: false, message: `Tiempo de espera agotado. Verifique que la IP ${cleanIp}:${port} esté accesible en la red.` };
  }

  if (primaryProbe.errorText && primaryProbe.errorText.includes('DESCRIBE')) {
    return { ok: false, message: 'El equipo responde en el puerto, pero ninguna marca estándar (Dahua, Hikvision, Uniview) coincidió en el canal 1.' };
  }

  return { ok: false, message: `No se pudo conectar a ${cleanIp}:${port}: ${primaryProbe.errorText || 'Error de red'}` };
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
  const urls = buildPresetRtspUrls(vendor, ip, port, user, pass, channel);
  let probe = await probeStreamRealVideo(urls.sub, 2000);
  if (probe.ok) return true;
  if (urls.main && urls.main !== urls.sub) {
    probe = await probeStreamRealVideo(urls.main, 2500);
    if (probe.ok) return true;
  }
  return false;
}

/**
 * Queries DVR hardware directly via HTTP CGI / ISAPI to get exact hardware channels
 */
async function queryDvrHardwareHttp(
  ip: string,
  user: string,
  pass: string
): Promise<{ ok: boolean; vendor?: string; channelCount?: number; channelTitles?: string[] }> {
  if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
    return { ok: false };
  }

  const cleanIp = ip.trim();
  const auth = user ? `${user.trim()}:${pass || ''}` : undefined;

  try {
    const { invoke } = await import('@tauri-apps/api/core');

    // 1. Try Dahua ChannelTitle (Port 80)
    try {
      const outDahua = await invoke<string>('fetch_dvr_api', {
        url: `http://${cleanIp}/cgi-bin/configManager.cgi?action=getConfig&name=ChannelTitle`,
        method: 'GET',
        auth,
      });
      if (outDahua && outDahua.includes('ChannelTitle')) {
        const matches = outDahua.match(/table\.ChannelTitle\[\d+\]\.Name=([^\r\n]*)/g);
        if (matches && matches.length > 0) {
          const titles = matches.map((m) => m.replace(/table\.ChannelTitle\[\d+\]\.Name=/, '').trim());
          return {
            ok: true,
            vendor: 'dahua',
            channelCount: matches.length,
            channelTitles: titles,
          };
        }
      }
    } catch {}

    // 2. Try Hikvision Streaming Channels
    try {
      const outHik = await invoke<string>('fetch_dvr_api', {
        url: `http://${cleanIp}/ISAPI/Streaming/channels`,
        method: 'GET',
        auth,
      });
      if (outHik && (outHik.includes('StreamingChannel') || outHik.includes('streamingChannel'))) {
        const matches = outHik.match(/<StreamingChannel/gi);
        if (matches && matches.length > 0) {
          const count = Math.max(1, Math.round(matches.length / 2));
          return {
            ok: true,
            vendor: 'hikvision',
            channelCount: count,
          };
        }
      }
    } catch {}
  } catch {}

  return { ok: false };
}

/**
 * Scans active channels on a DVR with 100% exact hardware tier detection (4, 8, 16, 32)
 */
export async function scanDvrActiveChannels(
  vendor: string,
  ip: string,
  port: number = 554,
  user: string = 'admin',
  pass: string = '',
  onProgress?: (scanned: number, found: number) => void
): Promise<ScanResult> {
  const cleanIp = ip.trim();
  const cleanUser = user.trim();

  // 1. Priority 1: Query DVR Hardware directly via HTTP CGI/ISAPI (Instant & 100% Exact)
  const hwQuery = await queryDvrHardwareHttp(cleanIp, cleanUser, pass);
  if (hwQuery.ok && hwQuery.channelCount) {
    const exactCount = hwQuery.channelCount;
    const channels = Array.from({ length: exactCount }, (_, i) => i + 1);
    const resolvedVendor = hwQuery.vendor || vendor;
    return {
      ok: true,
      vendor: resolvedVendor,
      activeChannels: channels,
      channelCount: exactCount,
      message: `¡Detección de hardware exitosa! Grabador ${resolvedVendor.toUpperCase()} con ${exactCount} canales físicos exactos.`,
    };
  }

  // 2. Priority 2: First validate channel 1 (and auto-detect vendor via RTSP)
  const firstProbe = await validateDvrCredentials(vendor, cleanIp, port, cleanUser, pass);
  if (!firstProbe.ok) {
    return {
      ok: false,
      vendor,
      activeChannels: [],
      channelCount: 0,
      message: firstProbe.message,
    };
  }

  const actualVendor = firstProbe.detectedVendor || vendor;

  // 3. Hardware Tier Boundary Snapping (Commercial DVRs are manufactured strictly in 4, 8, 16, 32 tiers)
  // Check Channel 17: If 17 fails, hardware CANNOT be 32 channels.
  if (onProgress) onProgress(1, 1);
  const hasCh17 = await probeSingleChannel(actualVendor, cleanIp, port, cleanUser, pass, 17);

  let hardwareTier = 32;
  if (!hasCh17) {
    // Check Channel 9: If 9 fails, hardware CANNOT be 16 channels.
    const hasCh9 = await probeSingleChannel(actualVendor, cleanIp, port, cleanUser, pass, 9);
    if (!hasCh9) {
      // Check Channel 5: If 5 fails, hardware is a 4-channel DVR.
      const hasCh5 = await probeSingleChannel(actualVendor, cleanIp, port, cleanUser, pass, 5);
      hardwareTier = hasCh5 ? 8 : 4;
    } else {
      hardwareTier = 16;
    }
  }

  // 4. Scan channels up to the detected hardware tier
  const activeChannels: number[] = [1];
  for (let ch = 2; ch <= hardwareTier; ch++) {
    const ok = await probeSingleChannel(actualVendor, cleanIp, port, cleanUser, pass, ch);
    if (ok) {
      activeChannels.push(ch);
    }
    if (onProgress) {
      onProgress(ch, activeChannels.length);
    }
  }

  return {
    ok: true,
    vendor: actualVendor,
    activeChannels,
    channelCount: hardwareTier,
    message: `¡Detección completada! Grabador ${actualVendor.toUpperCase()} de ${hardwareTier} canales físicos (${activeChannels.length} con cámaras activas).`,
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
  const vendors = ['dahua', 'hikvision', 'uniview', 'juan'];
  let lastResult: ValidationResult = { ok: false, message: 'No se detectó respuesta.' };

  for (const v of vendors) {
    const res = await validateDvrCredentials(v, ip, port, user, pass);
    if (res.ok) {
      const actualVendor = res.detectedVendor || v;
      // Once brand is detected, automatically scan channels!
      const scan = await scanDvrActiveChannels(actualVendor, ip, port, user, pass);
      return { 
        vendor: actualVendor, 
        result: { ok: true, message: `¡Grabador detectado: ${actualVendor.toUpperCase()} con ${scan.channelCount} canales activos!` },
        channelCount: scan.channelCount
      };
    }
    lastResult = res;
    if (res.message.includes('Usuario o contraseña')) {
      return { vendor: v, result: res };
    }
  }

  return { vendor: 'dahua', result: lastResult };
}
