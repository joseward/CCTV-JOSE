export type VendorPreset = 'hikvision' | 'dahua' | 'uniview' | 'custom' | 'demo';

export type AspectRatio = '16:9' | '4:3' | 'fill' | 'contain';

export interface DvrDevice {
  id: string;
  name: string;
  vendorPreset: VendorPreset;
  ip: string;
  port: number;
  username: string;
  password?: string;
  channelCount: number;
}

export interface Camera {
  id: string;
  dvrId?: string;
  name: string;
  group: string; // DVR / NVR name or location
  vendorPreset: VendorPreset;
  ip: string;
  port: number;
  username?: string;
  password?: string;
  channel: number;
  mainStreamUrl: string; // High res (1080p/4K)
  subStreamUrl: string;  // Low res (360p/720p)
  aspectRatio?: AspectRatio;
  audioEnabled?: boolean;
  enabled: boolean;
}

export type GridMode = '1x1' | '2x2' | '3x3' | '4x4';

export type StreamStatus = 
  | 'idle' 
  | 'connecting' 
  | 'connected' 
  | 'reconnecting' 
  | 'failed' 
  | 'offline';

export interface GridSlot {
  slotIndex: number;
  cameraId: string | null;
}
