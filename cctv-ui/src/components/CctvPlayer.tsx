import { useEffect, useRef, useState, useCallback } from 'react';
import type { Camera, StreamStatus } from '../types/cctv';
import { GO2RTC_WS } from '../services/go2rtc';
import { VideoRTC } from '../lib/video-rtc.js';
import { 
  Maximize2, 
  Minimize2, 
  Volume2, 
  VolumeX, 
  Camera as SnapshotIcon, 
  RefreshCw, 
  AlertTriangle,
  Layers,
  X,
  Film
} from 'lucide-react';

if (typeof window !== 'undefined' && !customElements.get('video-rtc')) {
  customElements.define('video-rtc', VideoRTC);
}

interface CctvPlayerProps {
  camera: Camera;
  isMaximized: boolean;
  onToggleMaximize: () => void;
  index: number;
  isSelected?: boolean;
  onSelectSlot?: () => void;
  onCloseSlot?: () => void;
  onOpenPlayback?: () => void;
}

export const CctvPlayer: React.FC<CctvPlayerProps> = ({
  camera,
  isMaximized,
  onToggleMaximize,
  index,
  isSelected,
  onSelectSlot,
  onCloseSlot,
  onOpenPlayback,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const retryTimerRef = useRef<any>(null);
  const countdownIntervalRef = useRef<any>(null);
  const connectTimeoutRef = useRef<any>(null);
  const playbackIntervalRef = useRef<any>(null);

  const [status, setStatus] = useState<StreamStatus>('connecting');
  const [retryAttempt, setRetryAttempt] = useState<number>(0);
  const [countdownSec, setCountdownSec] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(true);
  const [aspectMode, setAspectMode] = useState<'contain' | 'cover'>('contain');
  const [liveStats, setLiveStats] = useState<{ fps: number; resolution: string; mode: string }>({
    fps: 0,
    resolution: '',
    mode: 'WebRTC / MSE (GPU)',
  });
  const [snapshotToast, setSnapshotToast] = useState<string | null>(null);
  const [fallbackToSub, setFallbackToSub] = useState<boolean>(false);

  // Reset fallback when camera or maximized state changes
  useEffect(() => {
    setFallbackToSub(false);
  }, [camera.id, isMaximized]);

  // Determine active stream: main if maximized and not falling back, else sub
  const activeStreamType = (isMaximized && !fallbackToSub) ? 'main' : 'sub';
  const activeStreamName = `cam_${camera.id}_${activeStreamType}`;

  // Cleanup active connections
  const cleanupConnections = useCallback(() => {
    if (playbackIntervalRef.current) {
      clearInterval(playbackIntervalRef.current);
      playbackIntervalRef.current = null;
    }
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (playerRef.current) {
      try {
        if (typeof playerRef.current.ondisconnect === 'function') {
          playerRef.current.ondisconnect();
        }
        playerRef.current.remove();
      } catch (e) {
        console.debug('Error cleaning player:', e);
      }
      playerRef.current = null;
    }
  }, []);

  // Exponential backoff scheduler
  const scheduleReconnect = useCallback(() => {
    cleanupConnections();
    setStatus('reconnecting');

    const nextAttempt = retryAttempt + 1;
    setRetryAttempt(nextAttempt);

    // Formula: min(1500 * 2^(attempt-1), 30000) +/- jitter
    const baseDelay = Math.min(1500 * Math.pow(2, Math.min(nextAttempt - 1, 5)), 30000);
    const jitter = Math.floor(Math.random() * 400) - 200;
    const finalDelay = Math.max(1200, baseDelay + jitter);

    let remainingSec = Math.ceil(finalDelay / 1000);
    setCountdownSec(remainingSec);

    countdownIntervalRef.current = setInterval(() => {
      remainingSec -= 1;
      setCountdownSec(Math.max(0, remainingSec));
      if (remainingSec <= 0 && countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
      }
    }, 1000);

    retryTimerRef.current = setTimeout(() => {
      connectStream();
    }, finalDelay);
  }, [retryAttempt, cleanupConnections]);

  // Connect stream using VideoRTC (WebRTC with automatic MSE/HLS fallback)
  const connectStream = useCallback(() => {
    cleanupConnections();
    setStatus('connecting');

    if (!containerRef.current) return;

    try {
      const player = document.createElement('video-rtc') as any;
      playerRef.current = player;

      // Enable MSE first for D3D11 hardware decoding of H.264 & H.265 (HEVC), with WebRTC & MJPEG fallback
      player.mode = 'mse,webrtc,mjpeg';
      player.media = camera.audioEnabled ? 'video,audio' : 'video';
      player.background = true;
      player.style.width = '100%';
      player.style.height = '100%';
      player.style.display = 'flex';
      player.style.alignItems = 'center';
      player.style.justifyContent = 'center';

      // Intercept errors from go2rtc
      player.onmessage = player.onmessage || {};
      player.onmessage['cctv'] = (msg: any) => {
        if (msg && msg.type === 'error') {
          console.warn(`[CCTV ${camera.name}] Stream error from go2rtc:`, msg.value);
          scheduleReconnect();
        }
      };

      // Connect via WebSocket to go2rtc
      const wsUrl = `${GO2RTC_WS}/api/ws?src=${encodeURIComponent(activeStreamName)}`;
      player.src = wsUrl;

      // Append to DOM FIRST so connectedCallback runs and creates player.video
      containerRef.current.appendChild(player);

      // Function to mark stream as successfully playing & hide overlay
      const markConnected = () => {
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
        if (playbackIntervalRef.current) {
          clearInterval(playbackIntervalRef.current);
          playbackIntervalRef.current = null;
        }
        setStatus('connected');
        setRetryAttempt(0);
        const vid = playerRef.current?.video;
        if (vid && vid.videoWidth && vid.videoHeight) {
          setLiveStats((prev) => ({
            ...prev,
            resolution: `${vid.videoWidth}x${vid.videoHeight}`,
            fps: 25,
          }));
        }
      };

      // Style and listen to internal video element
      if (player.video) {
        player.video.controls = false;
        player.video.style.width = '100%';
        player.video.style.height = '100%';
        player.video.style.objectFit = aspectMode === 'cover' ? 'cover' : 'contain';
        player.video.muted = isMuted;
        player.video.playsInline = true;
        player.video.autoplay = true;

        player.video.addEventListener('playing', markConnected);
        player.video.addEventListener('loadeddata', markConnected);
        player.video.addEventListener('canplay', markConnected);
        player.video.addEventListener('timeupdate', markConnected);
      }

      // Continuous playback poller fallback
      playbackIntervalRef.current = setInterval(() => {
        if (!playerRef.current) return;
        const v = playerRef.current.video;
        if (v && (v.currentTime > 0 || v.readyState >= 2 || v.videoWidth > 0)) {
          markConnected();
        }
      }, 250);

      // Connection timeout: If maximized and main stream doesn't connect within 4.5s, auto-fallback to sub-stream
      connectTimeoutRef.current = setTimeout(() => {
        if (isMaximized && !fallbackToSub && camera.subStreamUrl) {
          console.warn(`[CCTV ${camera.name}] Flujo Main HD sin respuesta tras 4.5s, activando fallback a Sub-Stream...`);
          setFallbackToSub(true);
          return;
        }
        console.warn(`[CCTV ${camera.name}] Sin señal tras 12s, reintentando con backoff...`);
        scheduleReconnect();
      }, (isMaximized && !fallbackToSub) ? 4500 : 12000);

    } catch (err: any) {
      console.warn(`[CCTV ${camera.name}] Error creando reproductor:`, err);
      scheduleReconnect();
    }
  }, [activeStreamName, camera, isMuted, aspectMode, cleanupConnections, scheduleReconnect]);

  // Re-connect when camera or stream type (sub/main) changes
  useEffect(() => {
    connectStream();
    return () => {
      cleanupConnections();
    };
  }, [connectStream, cleanupConnections]);

  // Update mute state on video
  useEffect(() => {
    if (playerRef.current && playerRef.current.video) {
      playerRef.current.video.muted = isMuted;
    }
  }, [isMuted]);

  // Update aspect mode
  useEffect(() => {
    if (playerRef.current && playerRef.current.video) {
      playerRef.current.video.style.objectFit = aspectMode === 'cover' ? 'cover' : 'contain';
    }
  }, [aspectMode]);

  // Capture instant snapshot
  const handleCaptureSnapshot = () => {
    if (!playerRef.current || !playerRef.current.video) return;
    try {
      const video = playerRef.current.video;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const now = new Date();
        const timestamp = now.toISOString().replace('T', ' ').substring(0, 19);
        const osdText = `CAM: ${camera.name.toUpperCase()} | ${timestamp} | [${activeStreamType.toUpperCase()}]`;

        ctx.font = 'bold 20px monospace';
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(16, canvas.height - 48, ctx.measureText(osdText).width + 24, 34);

        ctx.fillStyle = '#00ff66';
        ctx.fillText(osdText, 28, canvas.height - 24);

        const dataUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        const filenameSafe = camera.name.replace(/[^a-zA-Z0-9]/g, '_');
        a.href = dataUrl;
        a.download = `CCTV_${filenameSafe}_${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        setSnapshotToast('Captura guardada');
        setTimeout(() => setSnapshotToast(null), 2500);
      }
    } catch (e) {
      console.error('Error al capturar snapshot:', e);
    }
  };

  const handleManualReconnect = () => {
    setRetryAttempt(0);
    connectStream();
  };

  return (
    <div 
      className={`group relative flex flex-col bg-slate-950 border transition-all duration-200 overflow-hidden select-none cursor-pointer ${
        isMaximized 
          ? 'w-full h-full border-blue-500/80 shadow-2xl z-20 rounded-lg' 
          : isSelected 
          ? 'border-blue-500 ring-2 ring-blue-500/40 rounded-md shadow-lg' 
          : 'border-slate-800 hover:border-slate-600 rounded-md shadow-md'
      }`}
      onClick={onSelectSlot}
      onDoubleClick={onToggleMaximize}
    >
      {/* Top Header Overlay */}
      <div className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-1.5 bg-gradient-to-b from-black/85 via-black/45 to-transparent backdrop-blur-[2px] opacity-90 group-hover:opacity-100 transition-opacity pointer-events-none">
        <div className="flex items-center space-x-2 truncate">
          <span 
            className={`w-2.5 h-2.5 rounded-full flex-shrink-0 animate-pulse ${
              status === 'connected' 
                ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' 
                : status === 'connecting' 
                ? 'bg-amber-400 shadow-[0_0_8px_#f59e0b]' 
                : 'bg-red-500 shadow-[0_0_8px_#ef4444]'
            }`} 
          />
          <span className="text-xs font-semibold text-slate-100 tracking-wider truncate">
            {camera.name}
          </span>
          <span className="text-[10px] text-slate-400 px-1.5 py-0.2 rounded bg-slate-800/80 border border-slate-700/60 hidden sm:inline">
            {camera.group}
          </span>
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          <span 
            className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded tracking-wide ${
              activeStreamType === 'main'
                ? 'bg-emerald-950 text-emerald-400 border border-emerald-600/60 shadow-[0_0_6px_rgba(16,185,129,0.2)]'
                : 'bg-blue-950 text-blue-400 border border-blue-600/60'
            }`}
          >
            {activeStreamType.toUpperCase()}
          </span>

          <span className="text-[9px] font-mono text-cyan-400 bg-cyan-950/70 border border-cyan-800/50 px-1.5 py-0.5 rounded hidden md:inline">
            D3D11 HW
          </span>

          {onCloseSlot && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseSlot();
              }}
              className="p-1 text-slate-400 hover:text-red-400 hover:bg-slate-800/90 rounded pointer-events-auto transition"
              title="Cerrar este canal del mosaico (detiene la transmisión)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Video Surface Container */}
      <div className="relative flex-1 w-full h-full bg-black flex items-center justify-center overflow-hidden">
        <div 
          ref={containerRef} 
          className="w-full h-full flex items-center justify-center bg-black"
        />

        {/* Offline / Reconnecting / Error Overlay */}
        {status !== 'connected' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/95 text-slate-300 p-4">
            <div className="relative z-10 flex flex-col items-center max-w-xs text-center space-y-3">
              {status === 'connecting' && (
                <>
                  <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
                  <p className="text-xs font-mono text-blue-400 font-semibold tracking-wide">
                    Sincronizando flujo RTSP...
                  </p>
                  <p className="text-[10px] font-mono text-slate-500 truncate max-w-[240px]">
                    {activeStreamType === 'main' ? camera.mainStreamUrl : camera.subStreamUrl || camera.mainStreamUrl}
                  </p>
                </>
              )}

              {status === 'reconnecting' && (
                <>
                  <div className="relative">
                    <RefreshCw className="w-8 h-8 text-amber-400 animate-spin" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-amber-400 tracking-wider font-mono">
                      SEÑAL PERDIDA O RUTA INVÁLIDA
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Intento <span className="text-white font-mono font-bold">#{retryAttempt}</span> (Backoff exponencial)
                    </p>
                    <p className="text-xs font-mono text-amber-300 font-bold mt-1">
                      Reintentando en: {countdownSec}s
                    </p>
                  </div>
                  <button
                    onClick={handleManualReconnect}
                    className="mt-2 px-3 py-1 bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold rounded shadow transition flex items-center space-x-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Reintentar Ahora</span>
                  </button>
                </>
              )}

              {status === 'failed' && (
                <>
                  <AlertTriangle className="w-8 h-8 text-red-500" />
                  <p className="text-xs font-bold text-red-400 font-mono">
                    ERROR AL CONECTAR AL FLUJO
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Verifique que la IP, puerto, canal o marca sean correctos.
                  </p>
                  <button
                    onClick={handleManualReconnect}
                    className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded shadow transition"
                  >
                    Reconectar
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Snapshot Notification Pill */}
        {snapshotToast && (
          <div className="absolute top-10 left-1/2 -translate-x-1/2 z-30 px-3 py-1 bg-emerald-600/90 text-white text-xs font-semibold rounded-full shadow-lg backdrop-blur flex items-center space-x-1 animate-bounce">
            <SnapshotIcon className="w-3.5 h-3.5" />
            <span>{snapshotToast}</span>
          </div>
        )}
      </div>

      {/* Bottom Control Bar Overlay */}
      <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-between px-3 py-1.5 bg-gradient-to-t from-black/85 via-black/40 to-transparent backdrop-blur-[1px] opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="flex items-center space-x-2 text-[10px] font-mono text-slate-400">
          <span className="text-slate-300 font-bold">{index + 1}</span>
          <span>•</span>
          <span>{liveStats.resolution || (activeStreamType === 'main' ? '1080p' : '360p')}</span>
          <span>•</span>
          <span className="text-emerald-400 font-bold">{liveStats.fps || 25} FPS</span>
        </div>

        <div className="flex items-center space-x-1 text-slate-300">
          <button
            onClick={() => setAspectMode((prev) => (prev === 'contain' ? 'cover' : 'contain'))}
            className="p-1 hover:text-white hover:bg-slate-800/80 rounded transition"
            title={aspectMode === 'contain' ? 'Modo: Mantener Proporción (16:9)' : 'Modo: Rellenar Cuadrícula'}
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setIsMuted(!isMuted)}
            className={`p-1 rounded transition ${isMuted ? 'text-slate-400 hover:text-white' : 'text-emerald-400 bg-emerald-950/60'}`}
            title={isMuted ? 'Activar Audio' : 'Silenciar Audio'}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>

          <button
            onClick={handleCaptureSnapshot}
            className="p-1 hover:text-emerald-400 hover:bg-slate-800/80 rounded transition"
            title="Capturar Foto Instantánea"
          >
            <SnapshotIcon className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleManualReconnect}
            className="p-1 hover:text-amber-400 hover:bg-slate-800/80 rounded transition"
            title="Refrescar Flujo RTSP"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {onOpenPlayback && (
            <button
              onClick={onOpenPlayback}
              className="p-1 text-purple-400 hover:text-purple-300 hover:bg-purple-950/60 rounded transition"
              title="Ver Grabaciones / Playback de este canal"
            >
              <Film className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={onToggleMaximize}
            className="p-1 hover:text-blue-400 hover:bg-slate-800/80 rounded transition"
            title={isMaximized ? 'Restaurar Cuadrícula' : 'Maximizar Canal (Cambia a Main Stream)'}
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};
