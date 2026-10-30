import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import type { Camera } from '../types/cctv';
import { 
  startPlaybackSession, 
  deleteStream, 
  GO2RTC_WS 
} from '../services/go2rtc';
import { 
  promptSaveFileDialog, 
  saveBinaryFile, 
  openFolderAndSelect, 
  downloadClipWithProgress, 
  type DownloadProgress 
} from '../services/playback';
import { PlaybackCalendar } from './PlaybackCalendar';
import { Time24Input } from './Time24Input';
import { VideoRTC } from '../lib/video-rtc.js';
import { 
  X, 
  Play, 
  Pause, 
  Camera as SnapshotIcon, 
  Maximize2, 
  Minimize2, 
  Volume2, 
  VolumeX, 
  Download, 
  Clock, 
  Film, 
  AlertCircle, 
  RefreshCw, 
  Video, 
  FolderOpen, 
  CheckCircle2, 
  AlertTriangle,
  StopCircle,
  FileVideo
} from 'lucide-react';

if (typeof window !== 'undefined' && !customElements.get('video-rtc')) {
  customElements.define('video-rtc', VideoRTC);
}

interface PlaybackModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameras: Camera[];
  initialCameraId?: string | null;
}

export const PlaybackModal: React.FC<PlaybackModalProps> = ({
  isOpen,
  onClose,
  cameras,
  initialCameraId,
}) => {
  // 1. Selection State
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedTime, setSelectedTime] = useState<string>('12:00:00');

  // 2. Playback Session State
  const [activeStreamName, setActiveStreamName] = useState<string | null>(null);
  const [activeRtspUrl, setActiveRtspUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  // 3. Evidence Feedback Toast (Snapshot)
  const [snapshotToast, setSnapshotToast] = useState<{ message: string; path?: string } | null>(null);

  // 4. Video Download State & Form
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState<boolean>(false);
  const [downloadCameraId, setDownloadCameraId] = useState<string>('');
  const [downloadDate, setDownloadDate] = useState<string>('');
  const [downloadRangeMode, setDownloadRangeMode] = useState<'range' | 'duration'>('range');
  const [downloadStartTime, setDownloadStartTime] = useState<string>('08:00:00');
  const [downloadEndTime, setDownloadEndTime] = useState<string>('08:15:00');
  const [downloadDurationSeconds, setDownloadDurationSeconds] = useState<number>(300); // 5 mins default
  const [activeDownload, setActiveDownload] = useState<DownloadProgress | null>(null);
  const downloadAbortRef = useRef<AbortController | null>(null);

  // Time tracker (seconds since start of day: 0 to 86399)
  const [currentSecondsOfDay, setCurrentSecondsOfDay] = useState<number>(12 * 3600);

  // References
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const clockIntervalRef = useRef<any>(null);

  // Group cameras by DVR
  const cameraGroups = useMemo(() => {
    const map: Record<string, Camera[]> = {};
    for (const c of cameras) {
      const grp = c.group || 'DVR General';
      if (!map[grp]) map[grp] = [];
      map[grp].push(c);
    }
    return map;
  }, [cameras]);

  // Selected camera object
  const activeCamera = useMemo(() => {
    return cameras.find((c) => c.id === selectedCameraId) || cameras[0] || null;
  }, [cameras, selectedCameraId]);

  // Target camera for MP4 download modal
  const targetDownloadCam = useMemo(() => {
    return cameras.find((c) => c.id === downloadCameraId) || activeCamera;
  }, [cameras, downloadCameraId, activeCamera]);

  // Initialize date & camera on open
  useEffect(() => {
    if (isOpen) {
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      setSelectedDate(todayStr);

      // Default to 1 hour ago
      const oneHourAgo = new Date(now.getTime() - 3600 * 1000);
      const timeStr = `${pad(oneHourAgo.getHours())}:${pad(oneHourAgo.getMinutes())}:00`;
      setSelectedTime(timeStr);
      setCurrentSecondsOfDay(oneHourAgo.getHours() * 3600 + oneHourAgo.getMinutes() * 60);

      if (initialCameraId && cameras.some((c) => c.id === initialCameraId)) {
        setSelectedCameraId(initialCameraId);
      } else if (cameras.length > 0 && !selectedCameraId) {
        setSelectedCameraId(cameras[0].id);
      }
    }
  }, [isOpen, initialCameraId, cameras]);

  // Clean up stream on close
  const cleanupCurrentStream = useCallback(async () => {
    if (clockIntervalRef.current) {
      clearInterval(clockIntervalRef.current);
      clockIntervalRef.current = null;
    }
    if (playerRef.current) {
      try {
        if (typeof playerRef.current.ondisconnect === 'function') {
          playerRef.current.ondisconnect();
        }
        playerRef.current.remove();
      } catch (e) {}
      playerRef.current = null;
    }
    if (activeStreamName) {
      await deleteStream(activeStreamName);
    }
  }, [activeStreamName]);

  useEffect(() => {
    if (!isOpen) {
      cleanupCurrentStream();
      setActiveStreamName(null);
      setIsPlaying(false);
      setIsLoading(false);
      setPlaybackError(null);
      setIsDownloadModalOpen(false);
    }
  }, [isOpen, cleanupCurrentStream]);

  // Launch Playback from specific seconds of the day
  const launchPlaybackAt = useCallback(
    async (secOfDay: number) => {
      if (!activeCamera) return;

      setIsLoading(true);
      setPlaybackError(null);

      // Stop old player and old stream
      if (clockIntervalRef.current) {
        clearInterval(clockIntervalRef.current);
        clockIntervalRef.current = null;
      }
      if (playerRef.current) {
        try {
          playerRef.current.remove();
        } catch (e) {}
        playerRef.current = null;
      }
      if (activeStreamName) {
        await deleteStream(activeStreamName);
      }

      // Compute dates
      const [year, month, day] = (selectedDate || '').split('-').map(Number);
      const hours = Math.floor(secOfDay / 3600);
      const mins = Math.floor((secOfDay % 3600) / 60);
      const secs = Math.floor(secOfDay % 60);

      const startDate = new Date(year, month - 1, day, hours, mins, secs);
      // Play window of 2 hours forward
      const endDate = new Date(startDate.getTime() + 2 * 3600 * 1000);

      setCurrentSecondsOfDay(secOfDay);
      const pad = (n: number) => n.toString().padStart(2, '0');
      setSelectedTime(`${pad(hours)}:${pad(mins)}:${pad(secs)}`);

      try {
        const session = await startPlaybackSession(activeCamera, startDate, endDate);
        if (!session) {
          setPlaybackError('No se pudo iniciar la sesión de reproducción en go2rtc.');
          setIsLoading(false);
          return;
        }

        setActiveStreamName(session.streamName);
        setActiveRtspUrl(session.rtspUrl);

        // Mount video-rtc
        if (containerRef.current) {
          const player = document.createElement('video-rtc') as any;
          playerRef.current = player;
          player.mode = 'mse,webrtc,mjpeg';
          player.media = activeCamera.audioEnabled ? 'video,audio' : 'video';
          player.background = true;
          player.style.width = '100%';
          player.style.height = '100%';
          player.style.display = 'flex';

          player.src = `${GO2RTC_WS}/api/ws?src=${encodeURIComponent(session.streamName)}`;
          containerRef.current.innerHTML = '';
          containerRef.current.appendChild(player);

          setIsPlaying(true);
          setIsLoading(false);

          // Advance virtual clock while playing
          clockIntervalRef.current = setInterval(() => {
            setCurrentSecondsOfDay((prev) => {
              const next = prev + 1;
              return next < 86400 ? next : 0;
            });
          }, 1000);
        }
      } catch (err: any) {
        setPlaybackError(err.message || 'Error al conectar con la grabación.');
        setIsLoading(false);
      }
    },
    [activeCamera, selectedDate, activeStreamName]
  );

  // Play / Pause toggle
  const togglePlayPause = () => {
    if (!playerRef.current) {
      launchPlaybackAt(currentSecondsOfDay);
      return;
    }

    const videoEl = playerRef.current.querySelector('video') || playerRef.current.video;
    if (isPlaying) {
      if (videoEl) videoEl.pause();
      if (clockIntervalRef.current) {
        clearInterval(clockIntervalRef.current);
        clockIntervalRef.current = null;
      }
      setIsPlaying(false);
    } else {
      if (videoEl) videoEl.play().catch(() => {});
      clockIntervalRef.current = setInterval(() => {
        setCurrentSecondsOfDay((prev) => (prev + 1 < 86400 ? prev + 1 : 0));
      }, 1000);
      setIsPlaying(true);
    }
  };

  // Jump relative seconds
  const jumpSeconds = (deltaSeconds: number) => {
    const target = Math.max(0, Math.min(86399, currentSecondsOfDay + deltaSeconds));
    launchPlaybackAt(target);
  };

  // Handle timeline click / seek
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    const targetSec = Math.floor(percent * 86400);
    launchPlaybackAt(targetSec);
  };

  // Quick Date presets
  const setQuickDate = (offsetDays: number) => {
    const target = new Date();
    target.setDate(target.getDate() - offsetDays);
    const pad = (n: number) => n.toString().padStart(2, '0');
    setSelectedDate(`${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`);
  };

  // 1. Take Snapshot evidence with native Windows Save As dialog
  const handleTakeSnapshot = async () => {
    if (!playerRef.current) return;
    const videoEl = playerRef.current.querySelector('video') || playerRef.current.video;
    if (!videoEl || videoEl.videoWidth === 0) return;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      // Add high-contrast evidence watermark
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(15, canvas.height - 45, 520, 32);
      ctx.fillStyle = '#10b981';
      ctx.font = 'bold 15px monospace';
      ctx.fillText('EVIDENCIA CCTV:', 25, canvas.height - 23);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(
        `${activeCamera?.name || 'Cámara'} - ${selectedDate} ${formatSecondsToTime(currentSecondsOfDay)}`,
        165,
        canvas.height - 23
      );

      const cleanCam = (activeCamera?.name || 'cam').replace(/[^a-zA-Z0-9]/g, '_');
      const cleanTime = formatSecondsToTime(currentSecondsOfDay).replace(/:/g, '-');
      const defaultFilename = `EVIDENCIA_${cleanCam}_${selectedDate}_${cleanTime}.png`;

      // Open native Save File Dialog
      const destinationPath = await promptSaveFileDialog(
        defaultFilename,
        'Imágenes PNG (*.png)|*.png|Todos los archivos (*.*)|*.*'
      );

      if (!destinationPath) {
        // User cancelled dialog
        return;
      }

      // Convert canvas to blob bytes
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return;
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      await saveBinaryFile(destinationPath, bytes);

      setSnapshotToast({
        message: '¡Captura de evidencia guardada exitosamente!',
        path: destinationPath,
      });
      setTimeout(() => setSnapshotToast(null), 8000);
    } catch (e: any) {
      console.warn('Error saving snapshot:', e);
    }
  };

  // Open Download Modal with prefilled values
  const handleOpenDownloadModal = () => {
    if (activeCamera) {
      setDownloadCameraId(activeCamera.id);
    }
    setDownloadDate(selectedDate);
    const timeStr = formatSecondsToTime(currentSecondsOfDay);
    setDownloadStartTime(timeStr);
    // Default end time: +15 minutes
    const endSec = Math.min(86399, currentSecondsOfDay + 900);
    setDownloadEndTime(formatSecondsToTime(endSec));
    setIsDownloadModalOpen(true);
  };

  // 2. Start Video Clip Download with native Save Dialog and live progress
  const handleStartDownloadClip = async () => {
    const targetCam = targetDownloadCam;
    if (!targetCam) return;

    const [year, month, day] = (downloadDate || selectedDate).split('-').map(Number);
    const [startH, startM, startS] = downloadStartTime.split(':').map(Number);
    const startDate = new Date(year, month - 1, day, startH || 0, startM || 0, startS || 0);

    let effectiveDurationSec = downloadDurationSeconds;
    if (downloadRangeMode === 'range') {
      const [endH, endM, endS] = downloadEndTime.split(':').map(Number);
      const startTotalSec = (startH || 0) * 3600 + (startM || 0) * 60 + (startS || 0);
      const endTotalSec = (endH || 0) * 3600 + (endM || 0) * 60 + (endS || 0);
      const diffSec = endTotalSec - startTotalSec;
      if (diffSec <= 0) {
        alert('La hora de fin debe ser posterior a la hora de inicio para poder descargar.');
        return;
      }
      effectiveDurationSec = Math.max(10, diffSec);
    }

    const cleanCam = targetCam.name.replace(/[^a-zA-Z0-9]/g, '_');
    const cleanStart = downloadStartTime.replace(/:/g, '-');
    const cleanEnd = downloadRangeMode === 'range'
      ? downloadEndTime.replace(/:/g, '-')
      : formatSecondsToTime(((startH || 0) * 3600 + (startM || 0) * 60 + (startS || 0) + effectiveDurationSec) % 86400).replace(/:/g, '-');
    const defaultFilename = `VIDEO_${cleanCam}_${downloadDate || selectedDate}_${cleanStart}_a_${cleanEnd}.mp4`;

    const destinationPath = await promptSaveFileDialog(
      defaultFilename,
      'Archivos de Video (*.mp4)|*.mp4|Todos los archivos (*.*)|*.*'
    );

    if (!destinationPath) return;

    setIsDownloadModalOpen(false);
    const abortCtrl = new AbortController();
    downloadAbortRef.current = abortCtrl;

    try {
      await downloadClipWithProgress(
        targetCam,
        startDate,
        effectiveDurationSec,
        destinationPath,
        (progress) => {
          setActiveDownload(progress);
        },
        abortCtrl.signal
      );
    } catch (err: any) {
      console.error('Download error:', err);
    } finally {
      downloadAbortRef.current = null;
    }
  };

  // Cancel active download
  const handleCancelDownload = () => {
    if (downloadAbortRef.current) {
      downloadAbortRef.current.abort();
    }
  };

  // Format seconds of day into HH:mm:ss
  function formatSecondsToTime(totalSec: number): string {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = Math.floor(totalSec % 60);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${mb.toFixed(1)} MB`;
  }

  // Timeline progress percent (0 to 100%)
  const timelinePercent = (currentSecondsOfDay / 86400) * 100;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-5 overflow-y-auto">
      <div className={`bg-slate-900 border border-slate-800 rounded-2xl w-full shadow-2xl overflow-hidden flex flex-col transition-all duration-200 ${
        isMaximized ? 'h-[98vh] max-w-[98vw]' : 'max-w-6xl max-h-[92vh]'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 bg-slate-950/90 select-none">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white tracking-wide">
                  Reproductor de Grabaciones Locales (DVR / NVR)
                </h3>
                <span className="px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono text-[10px] font-bold border border-purple-500/40">
                  PLAYBACK STUDIO
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Consulta histórica, detección de grabaciones por calendario y exportación de evidencia en disco local
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              title={isMaximized ? 'Restaurar tamaño' : 'Maximizar'}
            >
              {isMaximized ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              title="Cerrar reproductor"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Top Controls: Camera, Date with Custom Calendar, Time Selection */}
        <div className="p-3 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          {/* Camera Picker */}
          <div className="flex items-center space-x-2 flex-1 min-w-[260px]">
            <Video className="w-4 h-4 text-blue-400 flex-shrink-0" />
            <span className="font-semibold text-slate-300">Cámara:</span>
            <select
              value={selectedCameraId}
              onChange={(e) => setSelectedCameraId(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-semibold text-xs focus:outline-none focus:border-purple-500"
            >
              {Object.entries(cameraGroups).map(([grp, cams]) => (
                <optgroup key={grp} label={grp} className="bg-slate-950 text-slate-400 font-bold">
                  {cams.map((c) => (
                    <option key={c.id} value={c.id} className="text-white">
                      CH {c.channel.toString().padStart(2, '0')} - {c.name} ({c.vendorPreset?.toUpperCase()})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Custom Calendar with Recorded Days Highlighting */}
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-300">Fecha:</span>
            <PlaybackCalendar
              selectedDate={selectedDate}
              onSelectDate={(newDate) => setSelectedDate(newDate)}
              activeCamera={activeCamera}
            />

            {/* Quick Date Presets */}
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => setQuickDate(0)}
                className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded text-[11px] font-semibold transition"
              >
                Hoy
              </button>
              <button
                type="button"
                onClick={() => setQuickDate(1)}
                className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded text-[11px] font-semibold transition"
              >
                Ayer
              </button>
              <button
                type="button"
                onClick={() => setQuickDate(2)}
                className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded text-[11px] font-semibold transition"
              >
                Antier
              </button>
            </div>
          </div>

          {/* Time Picker & Load Button */}
          <div className="flex items-center space-x-2">
            <Clock className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="font-semibold text-slate-300">Hora:</span>
            <input
              type="time"
              step="1"
              value={selectedTime}
              onChange={(e) => {
                setSelectedTime(e.target.value);
                const [h, m, s] = e.target.value.split(':').map(Number);
                setCurrentSecondsOfDay((h || 0) * 3600 + (m || 0) * 60 + (s || 0));
              }}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
            />

            {/* Quick 1-hour step buttons */}
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => {
                  const nextSec = Math.max(0, currentSecondsOfDay - 3600);
                  setCurrentSecondsOfDay(nextSec);
                  setSelectedTime(formatSecondsToTime(nextSec));
                }}
                className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded text-[11px] font-mono transition"
                title="Retroceder 1 hora"
              >
                -1h
              </button>
              <button
                type="button"
                onClick={() => {
                  const nextSec = Math.min(86399, currentSecondsOfDay + 3600);
                  setCurrentSecondsOfDay(nextSec);
                  setSelectedTime(formatSecondsToTime(nextSec));
                }}
                className="px-2 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded text-[11px] font-mono transition"
                title="Avanzar 1 hora"
              >
                +1h
              </button>
            </div>

            <button
              type="button"
              onClick={() => launchPlaybackAt(currentSecondsOfDay)}
              disabled={isLoading}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold shadow-md transition"
            >
              <Play className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>{isLoading ? 'Cargando...' : 'Cargar Grabación'}</span>
            </button>
          </div>
        </div>

        {/* Video Canvas Viewport */}
        <div className="flex-1 bg-black relative flex items-center justify-center overflow-hidden min-h-[360px]">
          {/* Video Container Mount */}
          <div
            ref={containerRef}
            className="w-full h-full flex items-center justify-center"
          />

          {/* Idle / Loading / Error Overlay */}
          {!activeStreamName && !isLoading && !playbackError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 p-6 text-center space-y-3 pointer-events-none">
              <Film className="w-12 h-12 text-slate-600 animate-pulse" />
              <div>
                <p className="text-sm font-bold text-slate-200">
                  Selecciona la cámara, fecha resaltada en el calendario y hora que deseas consultar
                </p>
                <p className="text-xs text-slate-500 mt-1 max-w-md">
                  Los días con grabaciones en el disco duro aparecen resaltados en color verde en el calendario.
                </p>
              </div>
            </div>
          )}

          {isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 z-20 space-y-2 pointer-events-none">
              <RefreshCw className="w-8 h-8 text-purple-400 animate-spin" />
              <span className="text-xs font-bold text-white tracking-wide">
                Conectando con el grabador {activeCamera?.group} ({activeCamera?.ip})...
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                Extrayendo evidencia de {selectedDate} {formatSecondsToTime(currentSecondsOfDay)}
              </span>
            </div>
          )}

          {playbackError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 z-20 p-6 text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <span className="text-sm font-bold text-red-300">No se pudo reproducir la grabación</span>
              <span className="text-xs text-slate-400 max-w-md">{playbackError}</span>
              <button
                type="button"
                onClick={() => launchPlaybackAt(currentSecondsOfDay)}
                className="px-3 py-1.5 bg-red-950/60 hover:bg-red-900 border border-red-800 text-red-200 rounded-lg text-xs font-semibold mt-2"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Active Overlay Watermark */}
          {activeStreamName && isPlaying && (
            <div className="absolute top-3 left-3 bg-slate-950/85 backdrop-blur-md border border-slate-800 px-3 py-1.5 rounded-lg text-white font-mono text-xs flex items-center space-x-2 z-10 pointer-events-none shadow-lg">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-500 animate-pulse" />
              <span className="font-bold text-purple-300">PLAYBACK:</span>
              <span>{activeCamera?.name}</span>
              <span className="text-slate-500">|</span>
              <span className="text-emerald-400 font-bold">{selectedDate} {formatSecondsToTime(currentSecondsOfDay)}</span>
            </div>
          )}

          {/* Snapshot feedback toast with "Abrir Carpeta" */}
          {snapshotToast && (
            <div className="absolute top-3 right-3 bg-emerald-950/95 border border-emerald-500/80 text-white px-4 py-2.5 rounded-xl text-xs font-semibold shadow-2xl z-30 flex items-center space-x-3 animate-in fade-in slide-in-from-top-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="font-bold text-emerald-300">{snapshotToast.message}</p>
                {snapshotToast.path && (
                  <p className="text-[10px] text-slate-300 font-mono truncate max-w-xs">{snapshotToast.path}</p>
                )}
              </div>
              {snapshotToast.path && (
                <button
                  type="button"
                  onClick={() => openFolderAndSelect(snapshotToast.path!)}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold flex items-center space-x-1 transition shadow"
                  title="Abrir ubicación en el explorador de Windows"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Abrir Carpeta</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Active Download Progress Drawer (When downloading MP4) */}
        {activeDownload && (
          <div className="bg-slate-950 border-t border-slate-800 px-5 py-2.5 select-none transition-all">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <div className="flex items-center space-x-2">
                <FileVideo className="w-4 h-4 text-purple-400" />
                <span className="font-bold text-white">{activeDownload.fileName}</span>
                <span className="text-[10px] text-slate-400 font-mono">
                  ({formatBytes(activeDownload.bytesDownloaded)}
                  {activeDownload.status === 'downloading' && activeDownload.speedBps > 0 && (
                    <span> • {(activeDownload.speedBps / (1024 * 1024)).toFixed(1)} MB/s</span>
                  )})
                </span>
              </div>

              <div className="flex items-center space-x-3">
                {activeDownload.status === 'downloading' && (
                  <>
                    <span className="font-mono font-bold text-purple-400">{activeDownload.percentage}%</span>
                    <button
                      type="button"
                      onClick={handleCancelDownload}
                      className="flex items-center space-x-1 px-2 py-0.5 bg-red-950/70 hover:bg-red-900 border border-red-800/80 text-red-300 rounded text-[11px] font-semibold transition"
                    >
                      <StopCircle className="w-3 h-3" />
                      <span>Cancelar</span>
                    </button>
                  </>
                )}

                {activeDownload.status === 'completed' && (
                  <div className="flex items-center space-x-2">
                    <span className="text-emerald-400 font-bold flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Descarga Completada</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => openFolderAndSelect(activeDownload.filePath)}
                      className="flex items-center space-x-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-bold shadow transition"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Abrir Carpeta</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveDownload(null)}
                      className="p-1 text-slate-400 hover:text-white"
                      title="Cerrar notificación"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {activeDownload.status === 'error' && (
                  <div className="flex items-center space-x-2 text-red-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{activeDownload.error || 'Error en la descarga'}</span>
                    <button
                      type="button"
                      onClick={() => setActiveDownload(null)}
                      className="p-1 text-slate-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Progress Bar Track */}
            <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-200 ${
                  activeDownload.status === 'completed'
                    ? 'bg-emerald-500'
                    : activeDownload.status === 'error'
                    ? 'bg-red-500'
                    : 'bg-purple-600 animate-pulse'
                }`}
                style={{ width: `${activeDownload.percentage}%` }}
              />
            </div>
          </div>
        )}

        {/* 24-Hour Timeline Bar */}
        <div className="bg-slate-950 px-5 py-2.5 border-t border-slate-800/90 select-none">
          <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono mb-1.5">
            <div className="flex items-center space-x-2">
              <Clock className="w-3.5 h-3.5 text-purple-400" />
              <span>Línea de Tiempo (24 Horas):</span>
              <strong className="text-white bg-purple-950/60 border border-purple-800 px-1.5 py-0.5 rounded">
                {formatSecondsToTime(currentSecondsOfDay)}
              </strong>
            </div>
            <span className="text-slate-500">Haz clic en cualquier punto para saltar en el tiempo</span>
          </div>

          {/* Clickable Track */}
          <div
            ref={timelineRef}
            onClick={handleTimelineClick}
            className="h-8 bg-slate-900 border border-slate-800 rounded-lg relative cursor-pointer group overflow-hidden shadow-inner flex items-center"
          >
            {/* Background Hour Markers Grid */}
            <div className="absolute inset-0 flex justify-between pointer-events-none px-2 text-[9px] font-mono text-slate-600 items-center">
              {[0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24].map((hr) => (
                <div key={hr} className="flex flex-col items-center h-full justify-between py-1">
                  <div className="w-[1px] h-2 bg-slate-700" />
                  <span>{hr.toString().padStart(2, '0')}:00</span>
                </div>
              ))}
            </div>

            {/* Simulated Active Recorded Ribbon */}
            <div className="absolute inset-y-1.5 left-0 right-0 bg-purple-500/10 border-y border-purple-500/20 pointer-events-none" />

            {/* Progress Played Fill */}
            <div
              className="absolute top-0 bottom-0 left-0 bg-purple-600/30 border-r-2 border-purple-400 pointer-events-none transition-all duration-100"
              style={{ width: `${timelinePercent}%` }}
            />

            {/* Current Scrubber Needle */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-red-500 z-10 pointer-events-none shadow-[0_0_8px_rgba(239,68,68,0.8)]"
              style={{ left: `${timelinePercent}%` }}
            >
              <div className="w-2.5 h-2.5 bg-red-500 rounded-full -ml-[4px] -mt-0.5 shadow" />
            </div>
          </div>
        </div>

        {/* Playback Bottom Deck Controls */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs select-none">
          {/* Jump / Rewind Controls */}
          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={() => jumpSeconds(-300)}
              className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg font-mono font-semibold text-[11px] transition"
              title="Retroceder 5 minutos"
            >
              -5m
            </button>
            <button
              type="button"
              onClick={() => jumpSeconds(-60)}
              className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg font-mono font-semibold text-[11px] transition"
              title="Retroceder 1 minuto"
            >
              -1m
            </button>
            <button
              type="button"
              onClick={() => jumpSeconds(-10)}
              className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg font-mono font-semibold text-[11px] transition"
              title="Retroceder 10 segundos"
            >
              -10s
            </button>

            {/* Main Play / Pause Button */}
            <button
              type="button"
              onClick={togglePlayPause}
              className={`p-2.5 rounded-full shadow-lg transition flex items-center justify-center ${
                isPlaying 
                  ? 'bg-amber-600 hover:bg-amber-500 text-white' 
                  : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/30'
              }`}
              title={isPlaying ? 'Pausar video' : 'Reproducir video'}
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={() => jumpSeconds(10)}
              className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg font-mono font-semibold text-[11px] transition"
              title="Avanzar 10 segundos"
            >
              +10s
            </button>
            <button
              type="button"
              onClick={() => jumpSeconds(60)}
              className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg font-mono font-semibold text-[11px] transition"
              title="Avanzar 1 minuto"
            >
              +1m
            </button>
            <button
              type="button"
              onClick={() => jumpSeconds(300)}
              className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 rounded-lg font-mono font-semibold text-[11px] transition"
              title="Avanzar 5 minutos"
            >
              +5m
            </button>
          </div>

          {/* Speed Selector */}
          <div className="flex items-center space-x-1.5 bg-slate-900 border border-slate-800 p-1 rounded-lg">
            <span className="text-[10px] text-slate-500 font-semibold px-1">Velocidad:</span>
            {[0.5, 1, 2, 4].map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => {
                  setPlaybackSpeed(spd);
                  if (playerRef.current) {
                    const v = playerRef.current.querySelector('video') || playerRef.current.video;
                    if (v) v.playbackRate = spd;
                  }
                }}
                className={`px-2 py-0.5 rounded font-mono font-bold text-[11px] transition ${
                  playbackSpeed === spd
                    ? 'bg-purple-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>

          {/* Tools: Audio, Snapshot, Export Clip */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => {
                const nextMuted = !isMuted;
                setIsMuted(nextMuted);
                if (playerRef.current) {
                  const v = playerRef.current.querySelector('video') || playerRef.current.video;
                  if (v) v.muted = nextMuted;
                }
              }}
              className="p-2 text-slate-400 hover:text-white bg-slate-900 border border-slate-800 rounded-lg transition"
              title={isMuted ? 'Activar audio' : 'Silenciar audio'}
            >
              {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
            </button>

            {/* Snapshot Evidence Button (Opens Windows File Picker) */}
            <button
              type="button"
              onClick={handleTakeSnapshot}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-cyan-950/60 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-700/80 rounded-lg font-semibold transition shadow"
              title="Guardar foto de evidencia eligiendo carpeta de destino"
            >
              <SnapshotIcon className="w-4 h-4 text-cyan-400" />
              <span>Guardar Foto</span>
            </button>

            {/* Export Clip Button (Opens Advanced Download Modal) */}
            <button
              type="button"
              onClick={handleOpenDownloadModal}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold transition shadow"
              title="Descargar clip de video eligiendo cámara, rango de horario o minutos"
            >
              <Download className="w-4 h-4" />
              <span>Descargar Video MP4</span>
            </button>
          </div>
        </div>

        {/* RTSP Debug Stream Pill */}
        {activeRtspUrl && (
          <div className="px-4 py-1 bg-slate-950/95 border-t border-slate-800/60 text-[10px] font-mono text-slate-500 truncate flex items-center justify-between">
            <span className="truncate">RTSP Playback: <span className="text-slate-400 select-all">{activeRtspUrl}</span></span>
            <span className="text-purple-400/80 font-bold ml-2 flex-shrink-0">D3D11 / WebSockets</span>
          </div>
        )}
      </div>

      {/* Advanced Download Modal: Camera, Date, Time Range or Duration */}
      {isDownloadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 max-w-lg w-full shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center space-x-2 text-purple-400">
                <FileVideo className="w-5 h-5" />
                <h4 className="text-sm font-bold text-white tracking-wide">Descargar Grabación en Video MP4</h4>
              </div>
              <button
                onClick={() => setIsDownloadModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs text-slate-300">
              {/* Camera Selector */}
              <div>
                <label className="block text-slate-400 font-semibold mb-1">
                  1. ¿De qué cámara deseas descargar el video?
                </label>
                <select
                  value={downloadCameraId}
                  onChange={(e) => setDownloadCameraId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-semibold text-xs focus:outline-none focus:border-purple-500"
                >
                  {Object.entries(cameraGroups).map(([grp, cams]) => (
                    <optgroup key={grp} label={grp} className="bg-slate-950 text-slate-400 font-bold">
                      {cams.map((c) => (
                        <option key={c.id} value={c.id} className="text-white">
                          CH {c.channel.toString().padStart(2, '0')} - {c.name} ({c.vendorPreset?.toUpperCase()})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Date Selector with PlaybackCalendar */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-slate-400 font-semibold">
                    2. Fecha de la grabación:
                  </label>
                  <span className="text-[10px] text-emerald-400 font-semibold flex items-center space-x-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Días verdes = Con grabaciones detectadas</span>
                  </span>
                </div>
                <PlaybackCalendar
                  selectedDate={downloadDate || selectedDate}
                  onSelectDate={(newDate) => setDownloadDate(newDate)}
                  activeCamera={targetDownloadCam}
                  fullWidth={true}
                  buttonClassName="w-full bg-slate-950 border-slate-700 py-2.5 px-3"
                />
              </div>

              {/* Download Mode Switcher (Range vs Duration) */}
              <div>
                <label className="block text-slate-400 font-semibold mb-1.5">
                  3. ¿Cómo deseas seleccionar el horario de grabación?
                </label>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 border border-slate-800 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setDownloadRangeMode('range')}
                    className={`py-1.5 px-3 rounded-lg font-bold text-xs transition ${
                      downloadRangeMode === 'range'
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    ⏰ De tal hora a tal hora (Rango 24h)
                  </button>
                  <button
                    type="button"
                    onClick={() => setDownloadRangeMode('duration')}
                    className={`py-1.5 px-3 rounded-lg font-bold text-xs transition ${
                      downloadRangeMode === 'duration'
                        ? 'bg-purple-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    ⚡ Por Minutos (Duración Rápida)
                  </button>
                </div>
              </div>

              {/* Mode A: Exact Time Range (Pure 24 Hours) */}
              {downloadRangeMode === 'range' && (
                <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Start Time 24h */}
                    <Time24Input
                      label="Hora Inicio"
                      value={downloadStartTime}
                      onChange={setDownloadStartTime}
                      onCopyPlayerTime={() => {
                        setDownloadStartTime(formatSecondsToTime(currentSecondsOfDay));
                      }}
                      quickOffsets={[
                        { label: '-15m', sec: -900 },
                        { label: '-5m', sec: -300 },
                        { label: '+5m', sec: 300 },
                        { label: '+15m', sec: 900 },
                      ]}
                    />

                    {/* End Time 24h */}
                    <Time24Input
                      label="Hora Fin"
                      value={downloadEndTime}
                      onChange={setDownloadEndTime}
                      quickOffsets={[
                        { label: '-5m', sec: -300 },
                        { label: '+5m', sec: 300 },
                        { label: '+15m', sec: 900 },
                        { label: '+30m', sec: 1800 },
                      ]}
                      onSetFromStart={(offsetSec) => {
                        const [sH, sM, sS] = downloadStartTime.split(':').map(Number);
                        const sSec = (sH || 0) * 3600 + (sM || 0) * 60 + (sS || 0);
                        const newEnd = Math.min(86399, sSec + offsetSec);
                        setDownloadEndTime(formatSecondsToTime(newEnd));
                      }}
                    />
                  </div>

                  {/* Calculated duration & weight or warning */}
                  <div className="flex flex-wrap items-center justify-between pt-1 border-t border-slate-800/80 text-[11px] gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const cur = formatSecondsToTime(currentSecondsOfDay);
                        setDownloadStartTime(cur);
                        const endSec = Math.min(86399, currentSecondsOfDay + 900);
                        setDownloadEndTime(formatSecondsToTime(endSec));
                      }}
                      className="text-purple-400 hover:text-purple-300 font-semibold underline flex items-center space-x-1"
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Copiar hora del reproductor a Inicio (+15m a Fin)</span>
                    </button>

                    {(() => {
                      const [sH, sM, sS] = downloadStartTime.split(':').map(Number);
                      const [eH, eM, eS] = downloadEndTime.split(':').map(Number);
                      const sSec = (sH || 0) * 3600 + (sM || 0) * 60 + (sS || 0);
                      const eSec = (eH || 0) * 3600 + (eM || 0) * 60 + (eS || 0);
                      const diffSec = eSec - sSec;
                      if (diffSec <= 0) {
                        return (
                          <div className="flex items-center space-x-2">
                            <span className="text-amber-400 font-bold flex items-center space-x-1">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              <span>Fin debe ser mayor a Inicio</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                const newEnd = Math.min(86399, sSec + 900);
                                setDownloadEndTime(formatSecondsToTime(newEnd));
                              }}
                              className="px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded text-[10px] font-bold transition"
                            >
                              Ajustar +15 min
                            </button>
                          </div>
                        );
                      }
                      const mins = Math.floor(diffSec / 60);
                      const secs = diffSec % 60;
                      const estMb = ((diffSec * 2.5) / 8).toFixed(1);
                      return (
                        <div className="flex items-center space-x-1.5 text-emerald-400 font-mono font-bold">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Duración: {mins > 0 ? `${mins}m ` : ''}{secs}s • Peso: ~{estMb} MB</span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {/* Mode B: Quick Duration Minutes */}
              {downloadRangeMode === 'duration' && (
                <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
                  <div>
                    <Time24Input
                      label="Hora Inicio de la descarga"
                      value={downloadStartTime}
                      onChange={setDownloadStartTime}
                      onCopyPlayerTime={() => {
                        setDownloadStartTime(formatSecondsToTime(currentSecondsOfDay));
                      }}
                      quickOffsets={[
                        { label: '-15m', sec: -900 },
                        { label: '-5m', sec: -300 },
                        { label: '+5m', sec: 300 },
                        { label: '+15m', sec: 900 },
                      ]}
                    />
                  </div>

                  <div>
                    <span className="block text-slate-400 text-[11px] font-semibold mb-1.5">
                      Duración del fragmento:
                    </span>
                    <div className="grid grid-cols-4 gap-1.5 font-mono text-[11px]">
                      {[
                        { sec: 60, label: '1 Min' },
                        { sec: 180, label: '3 Min' },
                        { sec: 300, label: '5 Min' },
                        { sec: 600, label: '10 Min' },
                        { sec: 900, label: '15 Min' },
                        { sec: 1800, label: '30 Min' },
                        { sec: 3600, label: '1 Hora' },
                        { sec: 7200, label: '2 Horas' },
                      ].map((opt) => (
                        <button
                          key={opt.sec}
                          type="button"
                          onClick={() => setDownloadDurationSeconds(opt.sec)}
                          className={`py-1.5 px-2 rounded-lg font-bold border transition ${
                            downloadDurationSeconds === opt.sec
                              ? 'bg-purple-600 text-white border-purple-400 shadow'
                              : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="text-right text-[11px] font-mono text-emerald-400 font-bold pt-1">
                    Duración: {Math.round(downloadDurationSeconds / 60)} min • Peso estimado: ~{((downloadDurationSeconds * 2.5) / 8).toFixed(1)} MB
                  </div>
                </div>
              )}

              <p className="text-[11px] text-slate-400 italic">
                💡 Al hacer clic en Descargar, se abrirá la ventana de Windows para que elijas en qué carpeta y con qué nombre guardar el archivo MP4.
              </p>
            </div>

            {/* Modal Footer Actions */}
            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setIsDownloadModalOpen(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-semibold transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleStartDownloadClip}
                className="flex items-center space-x-1.5 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold shadow-lg transition"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Elegir Ubicación y Descargar</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
