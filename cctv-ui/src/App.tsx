import { useState, useEffect, useMemo, useCallback, Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-white text-center z-50">
          <div className="p-5 rounded-2xl bg-red-950/80 border border-red-700/80 max-w-lg space-y-3 shadow-2xl">
            <h2 className="text-sm font-bold text-red-300">Ocurrió un error en el módulo</h2>
            <p className="text-xs text-slate-300 font-mono break-all bg-black/40 p-2 rounded">{this.state.error?.message}</p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-bold text-white transition"
            >
              Cerrar y Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import type { Camera, GridMode } from './types/cctv';
import { loadSavedCameras, saveCamerasToStorage } from './services/storage';
import { syncCameraStreams, checkGo2RtcHealth, buildPresetRtspUrls } from './services/go2rtc';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { CctvPlayer } from './components/CctvPlayer';
import { DvrModal, type DvrFormData } from './components/DvrModal';
import { DvrMaintenanceModal } from './components/DvrMaintenanceModal';
import { CameraModal } from './components/CameraModal';
import { SettingsModal } from './components/SettingsModal';
import { PlaybackModal } from './components/PlaybackModal';
import { 
  type AppSettings, 
  DEFAULT_SETTINGS, 
  loadAppSettings, 
  saveAppSettings 
} from './services/notifications';
import { auditAllDvrsAndNotify } from './services/watchdog';
import { Plus, AlertCircle } from 'lucide-react';

export function App() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [gridMode, setGridMode] = useState<GridMode>('2x2');
  const [maximizedCameraId, setMaximizedCameraId] = useState<string | null>(null);
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number>(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);

  // Slots array holding camera ID or null for each grid cell
  const [slots, setSlots] = useState<(string | null)[]>([null, null, null, null]);

  // Modals
  const [isDvrModalOpen, setIsDvrModalOpen] = useState<boolean>(false);
  const [dvrToEdit, setDvrToEdit] = useState<DvrFormData | null>(null);
  const [isMaintenanceModalOpen, setIsMaintenanceModalOpen] = useState<boolean>(false);
  const [dvrForMaintenance, setDvrForMaintenance] = useState<{
    groupName: string;
    ip: string;
    port?: number;
    vendorPreset: any;
    username: string;
    password?: string;
  } | null>(null);
  const [isCameraModalOpen, setIsCameraModalOpen] = useState<boolean>(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState<boolean>(false);
  const [isPlaybackModalOpen, setIsPlaybackModalOpen] = useState<boolean>(false);
  const [playbackCameraId, setPlaybackCameraId] = useState<string | null>(null);
  const [cameraToEdit, setCameraToEdit] = useState<Camera | null>(null);

  // go2rtc engine health
  const [go2rtcReady, setGo2RtcReady] = useState<boolean>(true);

  // Settings & Background 24/7 Watchdog
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    loadAppSettings().then((s) => {
      setAppSettings(s);
    });
  }, []);

  const handleUpdateSettings = useCallback((newSettings: AppSettings) => {
    setAppSettings(newSettings);
    saveAppSettings(newSettings);
  }, []);

  // Background Watchdog loop for Offline & HDD failure alerts
  useEffect(() => {
    if (!appSettings.autoMonitorEnabled || cameras.length === 0) return;

    // Run first check 12 seconds after startup
    const timer = setTimeout(() => {
      auditAllDvrsAndNotify(cameras, appSettings);
    }, 12000);

    const intervalMinutes = Math.max(1, appSettings.checkIntervalMinutes || 3);
    const interval = setInterval(() => {
      auditAllDvrsAndNotify(cameras, appSettings);
    }, intervalMinutes * 60 * 1000);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [cameras, appSettings]);

  // Load cameras on mount and initialize initial slots
  useEffect(() => {
    loadSavedCameras().then((loaded) => {
      setCameras(loaded);
      syncCameraStreams(loaded);

      // Loaded cameras are synced to go2rtc; slots start clean so user selects what to watch
    });

    checkGo2RtcHealth().then(setGo2RtcReady);
    const healthInterval = setInterval(() => {
      checkGo2RtcHealth().then(setGo2RtcReady);
    }, 5000);

    return () => clearInterval(healthInterval);
  }, []);

  // Update cameras list & persist
  const handleUpdateCameras = useCallback((updated: Camera[]) => {
    setCameras(updated);
    saveCamerasToStorage(updated);
    syncCameraStreams(updated);
  }, []);

  // Open modal to add a brand new DVR
  const handleOpenAddDvr = useCallback(() => {
    setDvrToEdit(null);
    setIsDvrModalOpen(true);
  }, []);

  // Open modal to edit an existing DVR
  const handleEditDvr = useCallback((groupName: string) => {
    const dvrCams = cameras.filter((c) => c.group === groupName);
    if (dvrCams.length === 0) return;
    const sample = dvrCams[0];
    setDvrToEdit({
      originalGroupName: groupName,
      name: groupName,
      vendorPreset: sample.vendorPreset || 'dahua',
      ip: sample.ip,
      port: sample.port || 554,
      username: sample.username || 'admin',
      password: sample.password || '',
      channelCount: dvrCams.length,
    });
    setIsDvrModalOpen(true);
  }, [cameras]);

  // Open Maintenance & Health Hub modal for a DVR
  const handleOpenMaintenance = useCallback((groupName: string) => {
    const dvrCams = cameras.filter((c) => c.group === groupName);
    if (dvrCams.length === 0) return;
    const sample = dvrCams[0];
    setDvrForMaintenance({
      groupName,
      ip: sample.ip,
      port: sample.port,
      vendorPreset: sample.vendorPreset || 'dahua',
      username: sample.username || 'admin',
      password: sample.password || '',
    });
    setIsMaintenanceModalOpen(true);
  }, [cameras]);

  // Delete whole DVR and all its channels
  const handleDeleteDvr = useCallback((groupName: string) => {
    setCameras((prev) => {
      const remaining = prev.filter((c) => c.group !== groupName);
      saveCamerasToStorage(remaining);
      syncCameraStreams(remaining);
      return remaining;
    });
    setSlots((prev) =>
      prev.map((id) => {
        if (!id) return null;
        const cam = cameras.find((c) => c.id === id);
        return cam?.group === groupName ? null : id;
      })
    );
  }, [cameras]);

  // Save DVR (handles both Create and Edit)
  const handleSaveDvr = useCallback((formData: DvrFormData) => {
    const { originalGroupName, name, vendorPreset, ip, port, username, password, channelCount } = formData;

    const cleanIp = ip.trim().toLowerCase();
    const cleanName = name.trim().toLowerCase();

    // Prevent duplicate equipment (by IP or by Name)
    const isDuplicate = cameras.some((c) => {
      if (originalGroupName && c.group?.toLowerCase() === originalGroupName.toLowerCase()) {
        return false;
      }
      const cIp = (c.ip || '').trim().toLowerCase();
      const cGroup = (c.group || '').trim().toLowerCase();
      return (cleanIp && cIp === cleanIp) || (cleanName && cGroup === cleanName);
    });

    if (isDuplicate) {
      alert(`No se puede guardar: Ya existe un equipo registrado con la IP "${ip}" o el nombre "${name}".`);
      return;
    }

    setCameras((prev) => {
      let updated: Camera[];

      if (originalGroupName) {
        // EDIT EXISTING DVR: update all channels at once
        const existingDvrCams = prev.filter((c) => c.group === originalGroupName);
        const otherCams = prev.filter((c) => c.group !== originalGroupName);

        const newDvrCams: Camera[] = [];
        for (let ch = 1; ch <= channelCount; ch++) {
          const urls = buildPresetRtspUrls(vendorPreset, ip, port, username, password, ch);
          const existingCam = existingDvrCams.find((c) => c.channel === ch);

          if (existingCam) {
            newDvrCams.push({
              ...existingCam,
              group: name,
              vendorPreset,
              ip,
              port,
              username,
              password,
              mainStreamUrl: urls.main,
              subStreamUrl: urls.sub,
            });
          } else {
            newDvrCams.push({
              id: `cam-${Date.now()}-ch${ch}`,
              name: `Cámara ${ch.toString().padStart(2, '0')}`,
              group: name,
              vendorPreset,
              ip,
              port,
              username,
              password,
              channel: ch,
              mainStreamUrl: urls.main,
              subStreamUrl: urls.sub,
              audioEnabled: true,
              aspectRatio: '16:9',
              enabled: true,
            });
          }
        }
        updated = [...otherCams, ...newDvrCams];
      } else {
        // CREATE NEW DVR
        const newCams: Camera[] = [];
        for (let ch = 1; ch <= channelCount; ch++) {
          const urls = buildPresetRtspUrls(vendorPreset, ip, port, username, password, ch);
          newCams.push({
            id: `cam-${Date.now()}-ch${ch}`,
            name: `Cámara ${ch.toString().padStart(2, '0')}`,
            group: name,
            vendorPreset,
            ip,
            port,
            username,
            password,
            channel: ch,
            mainStreamUrl: urls.main,
            subStreamUrl: urls.sub,
            audioEnabled: true,
            aspectRatio: '16:9',
            enabled: true,
          });
        }
        updated = [...prev, ...newCams];
      }

      saveCamerasToStorage(updated);
      syncCameraStreams(updated);
      return updated;
    });
  }, []);

  // Save single camera
  const handleSaveCamera = useCallback((camera: Camera) => {
    setCameras((prev) => {
      const exists = prev.some((c) => c.id === camera.id);
      let updated: Camera[];
      if (exists) {
        updated = prev.map((c) => (c.id === camera.id ? camera : c));
      } else {
        updated = [...prev, camera];
      }
      saveCamerasToStorage(updated);
      syncCameraStreams(updated);
      return updated;
    });
  }, []);

  // Number of slots for the current grid mode
  const currentSlotCount = useMemo(() => {
    switch (gridMode) {
      case '1x1': return 1;
      case '2x2': return 4;
      case '3x3': return 9;
      case '4x4': return 16;
    }
  }, [gridMode]);

  // Ensure slots array matches the grid mode capacity
  useEffect(() => {
    setSlots((prev) => {
      if (prev.length === currentSlotCount) return prev;
      if (prev.length < currentSlotCount) {
        const extra = Array(currentSlotCount - prev.length).fill(null);
        return [...prev, ...extra];
      }
      return prev.slice(0, currentSlotCount);
    });
    if (selectedSlotIndex >= currentSlotCount) {
      setSelectedSlotIndex(0);
    }
  }, [currentSlotCount, selectedSlotIndex]);

  // Assign camera to a slot (called from sidebar tree)
  const handleAssignCameraToSlot = useCallback((cameraId: string, targetSlotIndex?: number) => {
    setSlots((prev) => {
      const next = [...prev];
      let destIndex = targetSlotIndex !== undefined ? targetSlotIndex : selectedSlotIndex;

      // If target not specified, look for first empty slot
      if (targetSlotIndex === undefined) {
        const firstEmpty = next.findIndex((id) => id === null);
        if (firstEmpty !== -1) {
          destIndex = firstEmpty;
        }
      }

      if (destIndex >= 0 && destIndex < next.length) {
        next[destIndex] = cameraId;
        setSelectedSlotIndex((destIndex + 1) % next.length);
      }
      return next;
    });
  }, [selectedSlotIndex]);

  // Open all cameras of a specific DVR / group in the grid
  const handlePlayAllDvrCameras = useCallback((groupName: string) => {
    const dvrCams = cameras.filter((c) => c.group === groupName && c.enabled);
    if (dvrCams.length === 0) return;

    // Adjust grid size to fit this DVR
    let targetMode: GridMode = '2x2';
    if (dvrCams.length === 1) targetMode = '1x1';
    else if (dvrCams.length <= 4) targetMode = '2x2';
    else if (dvrCams.length <= 9) targetMode = '3x3';
    else targetMode = '4x4';

    const count = targetMode === '1x1' ? 1 : targetMode === '2x2' ? 4 : targetMode === '3x3' ? 9 : 16;
    setGridMode(targetMode);

    const newSlots = Array(count).fill(null);
    dvrCams.slice(0, count).forEach((cam, idx) => {
      newSlots[idx] = cam.id;
    });
    setSlots(newSlots);
    setMaximizedCameraId(null);
  }, [cameras]);

  // View ONLY a single camera in 1x1 full view
  const handleViewSingleCamera = useCallback((cameraId: string) => {
    setGridMode('1x1');
    setSlots([cameraId]);
    setMaximizedCameraId(null);
  }, []);

  // Close all cameras belonging to a DVR / group
  const handleCloseDvrCameras = useCallback((groupName: string) => {
    setSlots((prev) =>
      prev.map((id) => {
        if (!id) return null;
        const cam = cameras.find((c) => c.id === id);
        return cam?.group === groupName ? null : id;
      })
    );
  }, [cameras]);

  // Close slot (unloads camera, stops stream)
  const handleCloseSlot = useCallback((slotIdx: number) => {
    setSlots((prev) => {
      const next = [...prev];
      next[slotIdx] = null;
      return next;
    });
  }, []);

  // Clear all slots
  const handleClearGrid = useCallback(() => {
    setSlots(Array(currentSlotCount).fill(null));
    setMaximizedCameraId(null);
  }, [currentSlotCount]);

  // Count active streaming cameras
  const activeStreamsCount = useMemo(() => {
    return slots.filter((id) => id !== null).length;
  }, [slots]);

  // Fullscreen helper
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Escape') {
        if (maximizedCameraId) setMaximizedCameraId(null);
        else if (isMaintenanceModalOpen) setIsMaintenanceModalOpen(false);
        else if (isDvrModalOpen) setIsDvrModalOpen(false);
        else if (isCameraModalOpen) setIsCameraModalOpen(false);
        else if (isSettingsModalOpen) setIsSettingsModalOpen(false);
      } else if (e.key === '1') {
        setGridMode('1x1');
      } else if (e.key === '2') {
        setGridMode('2x2');
      } else if (e.key === '3') {
        setGridMode('3x3');
      } else if (e.key === '4') {
        setGridMode('4x4');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [maximizedCameraId, isMaintenanceModalOpen, isDvrModalOpen, isCameraModalOpen, isSettingsModalOpen]);

  // CSS Grid class
  const gridLayoutClass = useMemo(() => {
    switch (gridMode) {
      case '1x1': return 'grid-cols-1 grid-rows-1';
      case '2x2': return 'grid-cols-1 sm:grid-cols-2 grid-rows-2';
      case '3x3': return 'grid-cols-2 md:grid-cols-3 grid-rows-3';
      case '4x4': return 'grid-cols-2 md:grid-cols-4 grid-rows-4';
    }
  }, [gridMode]);

  const maximizedCamera = useMemo(() => {
    if (!maximizedCameraId) return null;
    return cameras.find((c) => c.id === maximizedCameraId) || null;
  }, [maximizedCameraId, cameras]);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#070b12] text-slate-100 overflow-hidden select-none">
      {/* Top Header */}
      <Header
        gridMode={gridMode}
        onSelectGridMode={(mode) => {
          setMaximizedCameraId(null);
          setGridMode(mode);
        }}
        onOpenSettingsModal={() => setIsSettingsModalOpen(true)}
        onOpenPlaybackModal={() => {
          const currentCam = maximizedCameraId || (selectedSlotIndex !== null ? slots[selectedSlotIndex] : null);
          setPlaybackCameraId(currentCam);
          setIsPlaybackModalOpen(true);
        }}
        onToggleFullscreen={handleToggleFullscreen}
        isSidebarOpen={isSidebarOpen}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        activeStreamsCount={activeStreamsCount}
        onClearGrid={handleClearGrid}
      />

      {/* Engine Alert Banner if go2rtc is offline */}
      {!go2rtcReady && (
        <div className="bg-amber-950/90 border-b border-amber-700/60 text-amber-300 px-4 py-1.5 text-xs flex items-center justify-between z-20">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-amber-400" />
            <span>
              <strong>Aviso:</strong> Conectando con el motor de streaming go2rtc (puerto 1984)...
            </span>
          </div>
          <span className="font-mono text-[11px] text-amber-400/80">Iniciando subproceso</span>
        </div>
      )}

      {/* Main Body: Sidebar + Grid Viewport */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Devices Sidebar */}
        <Sidebar
          cameras={cameras}
          slots={slots}
          selectedSlotIndex={selectedSlotIndex}
          onAssignCameraToSlot={handleAssignCameraToSlot}
          onViewSingleCamera={handleViewSingleCamera}
          onPlayAllDvrCameras={handlePlayAllDvrCameras}
          onCloseDvrCameras={handleCloseDvrCameras}
          onEditDvr={handleEditDvr}
          onOpenMaintenance={handleOpenMaintenance}
          onOpenPlayback={(camId) => {
            setPlaybackCameraId(camId);
            setIsPlaybackModalOpen(true);
          }}
          onClearGrid={handleClearGrid}
          onOpenAddDvrModal={handleOpenAddDvr}
          isOpen={isSidebarOpen}
        />

        {/* Center Grid Viewport */}
        <main className="flex-1 p-2 overflow-hidden relative bg-[#070b12]">
          {maximizedCamera ? (
            /* Maximized View (Full HD Main Stream) */
            <div className="w-full h-full animate-in fade-in zoom-in-95 duration-200">
              <CctvPlayer
                camera={maximizedCamera}
                isMaximized={true}
                onToggleMaximize={() => setMaximizedCameraId(null)}
                index={0}
                onOpenPlayback={() => {
                  setPlaybackCameraId(maximizedCamera.id);
                  setIsPlaybackModalOpen(true);
                }}
              />
            </div>
          ) : (
            /* Grid View (Uses Sub-Stream, only active slots stream) */
            <div className={`grid gap-2 w-full h-full ${gridLayoutClass}`}>
              {slots.slice(0, currentSlotCount).map((camId, slotIdx) => {
                const assignedCamera = camId ? cameras.find((c) => c.id === camId) : null;
                const isSelected = selectedSlotIndex === slotIdx;

                if (assignedCamera) {
                  return (
                    <CctvPlayer
                      key={`${assignedCamera.id}-slot-${slotIdx}`}
                      camera={assignedCamera}
                      isMaximized={false}
                      onToggleMaximize={() => setMaximizedCameraId(assignedCamera.id)}
                      index={slotIdx}
                      isSelected={isSelected}
                      onSelectSlot={() => setSelectedSlotIndex(slotIdx)}
                      onCloseSlot={() => handleCloseSlot(slotIdx)}
                      onOpenPlayback={() => {
                        setPlaybackCameraId(assignedCamera.id);
                        setIsPlaybackModalOpen(true);
                      }}
                    />
                  );
                }

                {/* Empty Slot Placeholder */}
                return (
                  <div
                    key={`empty-slot-${slotIdx}`}
                    onClick={() => setSelectedSlotIndex(slotIdx)}
                    className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg transition cursor-pointer p-4 group ${
                      isSelected
                        ? 'border-blue-500 bg-blue-950/20 shadow-lg'
                        : 'border-slate-800/80 bg-slate-950/40 hover:border-slate-700'
                    }`}
                  >
                    <div className="p-3 rounded-full bg-slate-900 border border-slate-800 group-hover:scale-110 group-hover:border-slate-600 transition">
                      <Plus className="w-5 h-5 text-slate-500 group-hover:text-blue-400" />
                    </div>
                    <span className="text-xs font-mono font-bold mt-2 text-slate-400 tracking-wider">
                      SLOT {(slotIdx + 1).toString().padStart(2, '0')}
                    </span>
                    <span className="text-[10px] text-slate-500 group-hover:text-slate-300 mt-0.5 text-center max-w-[180px]">
                      Haz clic en una cámara del panel izquierdo para cargar
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* Modal: Add or Edit DVR / NVR */}
      <DvrModal
        isOpen={isDvrModalOpen}
        onClose={() => {
          setIsDvrModalOpen(false);
          setDvrToEdit(null);
        }}
        dvrToEdit={dvrToEdit}
        onSaveDvr={handleSaveDvr}
        existingCameras={cameras}
      />

      {/* Modal: Edit Single Camera */}
      <CameraModal
        isOpen={isCameraModalOpen}
        onClose={() => {
          setIsCameraModalOpen(false);
          setCameraToEdit(null);
        }}
        onSave={handleSaveCamera}
        cameraToEdit={cameraToEdit}
        existingGroups={Array.from(new Set(cameras.map((c) => c.group)))}
      />

      {/* Modal: Settings & DVR Manager */}
      <ErrorBoundary>
        <SettingsModal
          isOpen={isSettingsModalOpen}
          onClose={() => setIsSettingsModalOpen(false)}
          cameras={cameras}
          onUpdateCameras={handleUpdateCameras}
          onEditDvr={handleEditDvr}
          onDeleteDvr={handleDeleteDvr}
          onOpenAddDvr={handleOpenAddDvr}
          onOpenMaintenance={handleOpenMaintenance}
          onEditCamera={(cam) => {
            setCameraToEdit(cam);
            setIsCameraModalOpen(true);
          }}
          appSettings={appSettings}
          onUpdateSettings={handleUpdateSettings}
        />
      </ErrorBoundary>

      {/* Modal: DVR Maintenance, Health & Web Hub */}
      <DvrMaintenanceModal
        isOpen={isMaintenanceModalOpen}
        onClose={() => {
          setIsMaintenanceModalOpen(false);
          setDvrForMaintenance(null);
        }}
        dvr={dvrForMaintenance}
      />

      {/* Modal: Playback Studio & Local DVR Recordings */}
      <ErrorBoundary>
        <PlaybackModal
          isOpen={isPlaybackModalOpen}
          onClose={() => setIsPlaybackModalOpen(false)}
          cameras={cameras}
          initialCameraId={playbackCameraId}
        />
      </ErrorBoundary>
    </div>
  );
}

export default App;
