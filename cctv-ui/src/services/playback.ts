import type { Camera } from '../types/cctv';
import { GO2RTC_URL, buildPresetPlaybackRtspUrl, registerStream, deleteStream } from './go2rtc';

/**
 * Opens the native Windows "Guardar como..." file picker dialog
 */
export async function promptSaveFileDialog(
  defaultName: string,
  filter: string = 'Todos los archivos (*.*)|*.*'
): Promise<string | null> {
  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await invoke<string | null>('prompt_save_file', {
        defaultName,
        filter,
      });
      return path || null;
    }
  } catch (err) {
    console.warn('[playback] prompt_save_file error:', err);
  }
  return null;
}

/**
 * Saves binary bytes directly to a file on disk
 */
export async function saveBinaryFile(filePath: string, bytes: Uint8Array): Promise<boolean> {
  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_binary_file', {
        filePath,
        bytes: Array.from(bytes),
      });
      return true;
    }
  } catch (err) {
    console.error('[playback] save_binary_file error:', err);
    throw err;
  }
  return false;
}

/**
 * Opens Windows Explorer and selects / highlights the target file
 */
export async function openFolderAndSelect(filePath: string): Promise<void> {
  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('open_folder_and_select', { filePath });
    }
  } catch (err) {
    console.warn('[playback] open_folder_and_select error:', err);
  }
}

// In-memory cache for recorded days to guarantee instant (0ms) response on re-opening or navigating
const recordedDaysCache = new Map<string, { days: number[]; timestamp: number }>();

export function clearRecordedDaysCache(cameraId?: string) {
  if (cameraId) {
    for (const key of recordedDaysCache.keys()) {
      if (key.startsWith(`${cameraId}_`)) {
        recordedDaysCache.delete(key);
      }
    }
  } else {
    recordedDaysCache.clear();
  }
}

/**
 * Queries the DVR / NVR hard drive to check which days of a given month have recordings
 */
export async function queryRecordedDays(
  camera: Camera,
  year: number,
  month: number,
  forceRefresh: boolean = false
): Promise<number[]> {
  const cacheKey = `${camera.id}_${camera.ip}_${camera.channel || 1}_${year}_${month}`;

  if (!forceRefresh) {
    const cached = recordedDaysCache.get(cacheKey);
    // Cache valid for 5 minutes
    if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
      return cached.days;
    }
  }

  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      const days = await invoke<number[]>('query_recorded_days', {
        vendor: camera.vendorPreset || 'dahua',
        ip: camera.ip,
        port: camera.port || 554,
        user: camera.username || 'admin',
        pass: camera.password || '',
        channel: camera.channel || 1,
        year,
        month,
      });
      if (Array.isArray(days)) {
        recordedDaysCache.set(cacheKey, { days, timestamp: Date.now() });
        return days;
      }
    }
  } catch (err) {
    console.warn('[playback] query_recorded_days error:', err);
  }
  return [];
}

export interface DownloadProgress {
  id: string;
  fileName: string;
  filePath: string;
  status: 'starting' | 'downloading' | 'completed' | 'error' | 'cancelled';
  bytesDownloaded: number;
  totalBytesEstimate: number;
  percentage: number;
  speedBps: number;
  error?: string;
  isAccelerated?: boolean;
}

/**
 * Downloads recording clip with direct-to-disk streaming via native Rust backend
 * (zero JavaScript memory allocation) and native ISAPI hardware acceleration for Hikvision (10-25 MB/s).
 */
export async function downloadClipWithProgress(
  camera: Camera,
  startTime: Date,
  durationSeconds: number,
  destinationFilePath: string,
  onProgress: (p: DownloadProgress) => void,
  abortSignal?: AbortSignal,
  quality: 'main' | 'sub' = 'main'
): Promise<string> {
  const downloadId = `dl_${Date.now()}`;
  const fileName = destinationFilePath.split(/[\\/]/).pop() || 'evidencia.mp4';
  const endTime = new Date(startTime.getTime() + durationSeconds * 1000);
  const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__;

  // Estimated size based on ~2.5 Mbps average bitrate for H.264 Main, ~0.6 Mbps for Sub
  const bitrateMbps = quality === 'sub' ? 0.6 : 2.5;
  const estimatedBytes = Math.round((bitrateMbps * 1024 * 1024 / 8) * durationSeconds);

  let currentProgress: DownloadProgress = {
    id: downloadId,
    fileName,
    filePath: destinationFilePath,
    status: 'starting',
    bytesDownloaded: 0,
    totalBytesEstimate: estimatedBytes,
    percentage: 0,
    speedBps: 0,
  };
  onProgress(currentProgress);

  // 1. HIGH-SPEED NATIVE ISAPI DOWNLOAD (HIKVISION DVR / NVR)
  const isHikvision = camera.vendorPreset?.toLowerCase() === 'hikvision';
  if (isHikvision && isTauri) {
    try {
      const pad = (n: number) => n.toString().padStart(2, '0');
      const uY = startTime.getUTCFullYear();
      const uM = pad(startTime.getUTCMonth() + 1);
      const uD = pad(startTime.getUTCDate());
      const uH = pad(startTime.getUTCHours());
      const um = pad(startTime.getUTCMinutes());
      const us = pad(startTime.getUTCSeconds());

      const ueY = endTime.getUTCFullYear();
      const ueM = pad(endTime.getUTCMonth() + 1);
      const ueD = pad(endTime.getUTCDate());
      const ueH = pad(endTime.getUTCHours());
      const uem = pad(endTime.getUTCMinutes());
      const ues = pad(endTime.getUTCSeconds());

      const startIso = `${uY}-${uM}-${uD}T${uH}:${um}:${us}Z`;
      const endIso = `${ueY}-${ueM}-${ueD}T${ueH}:${uem}:${ues}Z`;

      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      let cleanListener: (() => void) | null = null;
      cleanListener = await listen<any>('download-progress', (event) => {
        if (event.payload.id === downloadId) {
          const payload = event.payload;
          currentProgress = {
            id: downloadId,
            fileName,
            filePath: destinationFilePath,
            status: payload.status,
            bytesDownloaded: payload.bytes_downloaded,
            totalBytesEstimate: estimatedBytes,
            percentage: payload.percentage,
            speedBps: payload.speed_bps,
            error: payload.error,
            isAccelerated: true,
          };
          onProgress(currentProgress);
        }
      });

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          invoke('cancel_video_download', { downloadId }).catch(() => {});
        });
      }

      const savedPath = await invoke<string>('start_hikvision_direct_download', {
        downloadId,
        ip: camera.ip,
        port: camera.port === 554 ? 80 : (camera.port || 80),
        user: camera.username || 'admin',
        pass: camera.password || '',
        channel: camera.channel || 1,
        startTimeIso: startIso,
        endTimeIso: endIso,
        destinationFilePath,
        durationSeconds,
      });

      if (cleanListener) cleanListener();
      return savedPath;
    } catch (err: any) {
      console.warn('[playback] Descarga ISAPI Turbo Hikvision falló, usando go2rtc stream...', err);
      // Fallback to go2rtc below
    }
  }

  // 2. HIGH-SPEED NATIVE NETSDK DOWNLOAD (DAHUA DVR / NVR TCP 37777)
  const isDahua = camera.vendorPreset?.toLowerCase() === 'dahua';
  if (isDahua && isTauri) {
    try {
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

      const startLocalStr = `${sY}-${sM}-${sD} ${sH}:${sm}:${ss}`;
      const endLocalStr = `${eY}-${eM}-${eD} ${eH}:${em}:${es}`;

      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      let cleanListener: (() => void) | null = null;
      cleanListener = await listen<any>('download-progress', (event) => {
        if (event.payload.id === downloadId) {
          const payload = event.payload;
          currentProgress = {
            id: downloadId,
            fileName,
            filePath: destinationFilePath,
            status: payload.status,
            bytesDownloaded: payload.bytes_downloaded,
            totalBytesEstimate: estimatedBytes,
            percentage: payload.percentage,
            speedBps: payload.speed_bps,
            error: payload.error,
            isAccelerated: true,
          };
          onProgress(currentProgress);
        }
      });

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          invoke('cancel_video_download', { downloadId }).catch(() => {});
        });
      }

      const savedPath = await invoke<string>('start_dahua_direct_download', {
        downloadId,
        ip: camera.ip,
        port: 37777,
        user: camera.username || 'admin',
        pass: camera.password || '',
        channel: camera.channel || 1,
        startTime: startLocalStr,
        endTime: endLocalStr,
        destinationFilePath,
        durationSeconds,
      });

      if (cleanListener) cleanListener();
      return savedPath;
    } catch (err: any) {
      console.warn('[playback] Descarga Directa NetSDK Dahua falló, usando go2rtc stream...', err);
      // Fallback to go2rtc below
    }
  }

  // 3. UNIVERSAL DIRECT-TO-DISK DOWNLOAD (JUAN, UNIVIEW, GO2RTC)
  const dlStreamName = `export_${camera.id}_${Date.now()}`;
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

  const regOk = await registerStream(dlStreamName, rtspUrl);
  if (!regOk) {
    throw new Error('No se pudo inicializar la conexión con el grabador para la descarga.');
  }

  try {
    const downloadUrl = `${GO2RTC_URL}/api/stream.mp4?src=${encodeURIComponent(dlStreamName)}&duration=${durationSeconds}`;

    if (isTauri) {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      let cleanListener: (() => void) | null = null;
      cleanListener = await listen<any>('download-progress', (event) => {
        if (event.payload.id === downloadId) {
          const payload = event.payload;
          currentProgress = {
            id: downloadId,
            fileName,
            filePath: destinationFilePath,
            status: payload.status,
            bytesDownloaded: payload.bytes_downloaded,
            totalBytesEstimate: estimatedBytes,
            percentage: payload.percentage,
            speedBps: payload.speed_bps,
            error: payload.error,
            isAccelerated: false,
          };
          onProgress(currentProgress);
        }
      });

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          invoke('cancel_video_download', { downloadId }).catch(() => {});
        });
      }

      const savedPath = await invoke<string>('start_video_download', {
        downloadId,
        url: downloadUrl,
        destinationFilePath,
        auth: undefined,
        durationSeconds,
      });

      if (cleanListener) cleanListener();
      return savedPath;
    } else {
      // Browser fallback (outside Tauri)
      const res = await fetch(downloadUrl, { signal: abortSignal });
      if (!res.ok) throw new Error(`Error en servidor: ${res.status}`);
      if (!res.body) throw new Error('Flujo vacío');

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;
      const startTs = Date.now();

      while (true) {
        if (abortSignal?.aborted) throw new Error('Descarga cancelada.');
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          receivedBytes += value.length;
          const elapsedSec = (Date.now() - startTs) / 1000;
          currentProgress = {
            ...currentProgress,
            status: 'downloading',
            bytesDownloaded: receivedBytes,
            percentage: Math.min(99, Math.round((receivedBytes / estimatedBytes) * 100)),
            speedBps: elapsedSec > 0 ? receivedBytes / elapsedSec : 0,
          };
          onProgress(currentProgress);
        }
      }

      const fullBuffer = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        fullBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      await saveBinaryFile(destinationFilePath, fullBuffer);
      return destinationFilePath;
    }
  } catch (err: any) {
    currentProgress = {
      ...currentProgress,
      status: abortSignal?.aborted ? 'cancelled' : 'error',
      error: err.message || 'Error durante la descarga.',
    };
    onProgress(currentProgress);
    throw err;
  } finally {
    deleteStream(dlStreamName).catch(() => {});
  }
}
