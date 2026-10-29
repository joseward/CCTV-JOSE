import type { Camera } from '../types/cctv';

const STORAGE_KEY = 'cctv_viewer_cameras_v1';

export const INITIAL_CAMERAS: Camera[] = [
  {
    id: 'cam-01',
    name: 'Cámara 01 - Entrada Principal',
    group: 'DVR Principal',
    vendorPreset: 'hikvision',
    ip: '192.168.1.100',
    port: 554,
    username: 'admin',
    password: '',
    channel: 1,
    mainStreamUrl: 'rtsp://192.168.1.100:554/Streaming/Channels/101',
    subStreamUrl: 'rtsp://192.168.1.100:554/Streaming/Channels/102',
    aspectRatio: '16:9',
    audioEnabled: true,
    enabled: true,
  },
  {
    id: 'cam-02',
    name: 'Cámara 02 - Estacionamiento Norte',
    group: 'DVR Principal',
    vendorPreset: 'hikvision',
    ip: '192.168.1.100',
    port: 554,
    username: 'admin',
    password: '',
    channel: 2,
    mainStreamUrl: 'rtsp://192.168.1.100:554/Streaming/Channels/201',
    subStreamUrl: 'rtsp://192.168.1.100:554/Streaming/Channels/202',
    aspectRatio: '16:9',
    audioEnabled: false,
    enabled: true,
  },
  {
    id: 'cam-03',
    name: 'Cámara 03 - Pasillo y Recepción',
    group: 'DVR Principal',
    vendorPreset: 'dahua',
    ip: '192.168.1.101',
    port: 554,
    username: 'admin',
    password: '',
    channel: 1,
    mainStreamUrl: 'rtsp://192.168.1.101:554/cam/realmonitor?channel=1&subtype=0',
    subStreamUrl: 'rtsp://192.168.1.101:554/cam/realmonitor?channel=1&subtype=1',
    aspectRatio: '16:9',
    audioEnabled: true,
    enabled: true,
  },
  {
    id: 'cam-04',
    name: 'Cámara 04 - Almacén Central',
    group: 'NVR Almacén',
    vendorPreset: 'dahua',
    ip: '192.168.1.101',
    port: 554,
    username: 'admin',
    password: '',
    channel: 2,
    mainStreamUrl: 'rtsp://192.168.1.101:554/cam/realmonitor?channel=2&subtype=0',
    subStreamUrl: 'rtsp://192.168.1.101:554/cam/realmonitor?channel=2&subtype=1',
    aspectRatio: '16:9',
    audioEnabled: false,
    enabled: true,
  },
  {
    id: 'cam-05',
    name: 'Cámara 05 - Perímetro Trasero',
    group: 'NVR Almacén',
    vendorPreset: 'uniview',
    ip: '192.168.1.102',
    port: 554,
    username: 'admin',
    password: '',
    channel: 1,
    mainStreamUrl: 'rtsp://192.168.1.102:554/unicast/c1/s0/live',
    subStreamUrl: 'rtsp://192.168.1.102:554/unicast/c1/s1/live',
    aspectRatio: '16:9',
    audioEnabled: false,
    enabled: true,
  },
  {
    id: 'cam-06',
    name: 'Cámara 06 - Sala de Servidores',
    group: 'DVR Seguridad',
    vendorPreset: 'custom',
    ip: '192.168.1.105',
    port: 554,
    username: 'admin',
    password: '',
    channel: 1,
    mainStreamUrl: 'rtsp://192.168.1.105:554/live/server_main',
    subStreamUrl: 'rtsp://192.168.1.105:554/live/server_sub',
    aspectRatio: '16:9',
    audioEnabled: true,
    enabled: true,
  },
  {
    id: 'cam-07',
    name: 'Cámara 07 - Área de Carga',
    group: 'NVR Almacén',
    vendorPreset: 'hikvision',
    ip: '192.168.1.100',
    port: 554,
    username: 'admin',
    password: '',
    channel: 3,
    mainStreamUrl: 'rtsp://192.168.1.100:554/Streaming/Channels/301',
    subStreamUrl: 'rtsp://192.168.1.100:554/Streaming/Channels/302',
    aspectRatio: '16:9',
    audioEnabled: false,
    enabled: true,
  },
  {
    id: 'cam-08',
    name: 'Cámara 08 - Azotea y Domos',
    group: 'DVR Seguridad',
    vendorPreset: 'hikvision',
    ip: '192.168.1.100',
    port: 554,
    username: 'admin',
    password: '',
    channel: 4,
    mainStreamUrl: 'rtsp://192.168.1.100:554/Streaming/Channels/401',
    subStreamUrl: 'rtsp://192.168.1.100:554/Streaming/Channels/402',
    aspectRatio: '16:9',
    audioEnabled: false,
    enabled: true,
  },
];

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
