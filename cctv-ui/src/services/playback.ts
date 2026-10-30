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
}

/**
 * Streams MP4 from go2rtc and writes it to the designated file path with real-time progress callbacks
 */
export async function downloadClipWithProgress(
  camera: Camera,
  startTime: Date,
  durationSeconds: number,
  destinationFilePath: string,
  onProgress: (p: DownloadProgress) => void,
  abortSignal?: AbortSignal
): Promise<string> {
  const downloadId = `dl_${Date.now()}`;
  const fileName = destinationFilePath.split(/[\\/]/).pop() || 'evidencia.mp4';
  const endTime = new Date(startTime.getTime() + durationSeconds * 1000);

  // 1. Create a dedicated on-demand go2rtc stream for downloading
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

  // Estimated size based on ~2.5 Mbps average bitrate for H.264
  const estimatedBytes = Math.round((2.5 * 1024 * 1024 / 8) * durationSeconds);

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

  try {
    const downloadUrl = `${GO2RTC_URL}/api/stream.mp4?src=${encodeURIComponent(dlStreamName)}&duration=${durationSeconds}`;
    const res = await fetch(downloadUrl, { signal: abortSignal });

    if (!res.ok) {
      throw new Error(`Error en el servidor de video: ${res.status} ${res.statusText}`);
    }

    if (!res.body) {
      throw new Error('El flujo de video no envió contenido.');
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;
    const startTs = Date.now();
    let lastProgressUpdate = Date.now();

    currentProgress = {
      ...currentProgress,
      status: 'downloading',
    };
    onProgress(currentProgress);

    while (true) {
      if (abortSignal?.aborted) {
        throw new Error('Descarga cancelada por el usuario.');
      }

      const { done, value } = await reader.read();
      if (done) break;

      if (value) {
        chunks.push(value);
        receivedBytes += value.length;

        const now = Date.now();
        // Throttle UI progress updates to ~150ms
        if (now - lastProgressUpdate > 150) {
          lastProgressUpdate = now;
          const elapsedSec = (now - startTs) / 1000;
          const speedBps = elapsedSec > 0 ? receivedBytes / elapsedSec : 0;
          // Progress based on elapsed vs duration or estimated size
          const timeProgress = Math.min(99, Math.round((elapsedSec / durationSeconds) * 100));
          const sizeProgress = Math.min(99, Math.round((receivedBytes / estimatedBytes) * 100));
          const percent = Math.max(timeProgress, sizeProgress);

          currentProgress = {
            ...currentProgress,
            bytesDownloaded: receivedBytes,
            percentage: percent,
            speedBps,
          };
          onProgress(currentProgress);
        }
      }
    }

    // Combine chunks
    const fullBuffer = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      fullBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    if (receivedBytes === 0) {
      throw new Error('El archivo descargado está vacío. Verifique que haya grabación en ese horario.');
    }

    // Save to disk
    await saveBinaryFile(destinationFilePath, fullBuffer);

    currentProgress = {
      ...currentProgress,
      status: 'completed',
      bytesDownloaded: receivedBytes,
      percentage: 100,
      speedBps: 0,
    };
    onProgress(currentProgress);

    return destinationFilePath;
  } catch (err: any) {
    currentProgress = {
      ...currentProgress,
      status: abortSignal?.aborted ? 'cancelled' : 'error',
      error: err.message || 'Error durante la descarga.',
    };
    onProgress(currentProgress);
    throw err;
  } finally {
    // Cleanup temporary export stream
    deleteStream(dlStreamName).catch(() => {});
  }
}
