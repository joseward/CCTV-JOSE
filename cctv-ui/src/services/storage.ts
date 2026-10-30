import type { Camera } from '../types/cctv';

const STORAGE_KEY = 'cctv_viewer_cameras_v1';

export const INITIAL_CAMERAS: Camera[] = [];

export async function loadSavedCameras(): Promise<Camera[]> {
  try {
    // Check if running in Tauri
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      const jsonStr: string = await invoke('load_cameras');
      if (jsonStr && jsonStr.trim() !== '[]' && jsonStr.trim() !== '') {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.debug('[storage] Tauri invoke error (fallback to local):', err);
  }

  // Fallback to localStorage
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('[storage] localStorage parse error:', e);
  }

  // Initial default
  return INITIAL_CAMERAS;
}

export async function saveCamerasToStorage(cameras: Camera[]): Promise<boolean> {
  const jsonStr = JSON.stringify(cameras, null, 2);
  
  // Save to localStorage
  try {
    localStorage.setItem(STORAGE_KEY, jsonStr);
  } catch (e) {
    console.warn('[storage] localStorage save error:', e);
  }

  // Save to Tauri backend file
  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_cameras', { camerasJson: jsonStr });
      return true;
    }
  } catch (err) {
    console.debug('[storage] Tauri save_cameras error:', err);
  }

  return true;
}
