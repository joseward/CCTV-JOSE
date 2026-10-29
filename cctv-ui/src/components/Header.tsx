import { useEffect, useState } from 'react';
import type { GridMode } from '../types/cctv';
import { 
  Settings, 
  ShieldCheck, 
  Cpu, 
  Maximize,
  PanelLeftClose,
  PanelLeft,
  Trash2,
  Film
} from 'lucide-react';

interface HeaderProps {
  gridMode: GridMode;
  onSelectGridMode: (mode: GridMode) => void;
  onOpenSettingsModal: () => void;
  onOpenPlaybackModal: () => void;
  onToggleFullscreen: () => void;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  activeStreamsCount: number;
  onClearGrid: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  gridMode,
  onSelectGridMode,
  onOpenSettingsModal,
  onOpenPlaybackModal,
  onToggleFullscreen,
  isSidebarOpen,
  onToggleSidebar,
  activeStreamsCount,
  onClearGrid,
}) => {
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString('es-MX', { hour12: false }));
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="h-14 px-3 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-slate-200 select-none backdrop-blur-md z-30">
      {/* Brand & Sidebar Toggle */}
      <div className="flex items-center space-x-3">
        {/* Sidebar Toggle Button */}
        <button
          onClick={onToggleSidebar}
          className={`p-2 rounded-lg border transition flex items-center justify-center ${
            isSidebarOpen 
              ? 'bg-blue-600/20 text-blue-400 border-blue-500/50' 
              : 'bg-slate-950 text-slate-400 hover:text-white border-slate-800'
          }`}
          title={isSidebarOpen ? 'Ocultar panel de DVRs (ganar espacio)' : 'Mostrar panel de DVRs y cámaras'}
        >
          {isSidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
        </button>

        <div className="flex items-center space-x-2 text-blue-400 font-bold tracking-wider">
          <div className="p-1.5 bg-blue-950/80 border border-blue-600/40 rounded-lg shadow-[0_0_12px_rgba(59,130,246,0.3)]">
            <ShieldCheck className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <span className="text-sm font-extrabold text-white tracking-wider">CCTV UNIFIED</span>
            <span className="text-[10px] text-blue-400 block font-mono font-medium -mt-0.5">MONITOR PRO</span>
          </div>
        </div>

        {/* HW Acceleration & Status Pill */}
        <div className="hidden lg:flex items-center space-x-1.5 bg-slate-950/80 border border-slate-800 px-2.5 py-1 rounded-full text-[11px] font-mono">
          <Cpu className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400 font-semibold">WebRTC / MSE D3D11</span>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">{activeStreamsCount} Transmitiendo</span>
        </div>
      </div>

      {/* Center: Grid Controls & Clear */}
      <div className="flex items-center space-x-2">
        {/* Grid Mode Selector */}
        <div className="flex items-center bg-slate-950/80 border border-slate-800 p-0.5 rounded-lg text-xs">
          {(['1x1', '2x2', '3x3', '4x4'] as GridMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => onSelectGridMode(mode)}
              className={`px-3 py-1 rounded-md font-mono font-bold transition flex items-center space-x-1 ${
                gridMode === mode
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={`Cuadrícula ${mode}`}
            >
              <span>{mode}</span>
            </button>
          ))}
        </div>

        {/* Clear Grid Button */}
        {activeStreamsCount > 0 && (
          <button
            onClick={onClearGrid}
            className="flex items-center space-x-1 px-2.5 py-1 bg-slate-950 hover:bg-red-950/70 border border-slate-800 hover:border-red-700/60 text-slate-400 hover:text-red-300 rounded-lg text-xs font-semibold transition"
            title="Cerrar todos los canales activos del mosaico (detiene transmisión)"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Limpiar Mosaico</span>
          </button>
        )}
      </div>

      {/* Right Controls: Clock, Actions & Settings */}
      <div className="flex items-center space-x-2">
        {/* Live Digital Clock */}
        <div className="hidden sm:flex items-center px-2.5 py-1 bg-slate-950/80 border border-slate-800 rounded-lg text-xs font-mono font-bold text-emerald-400 tracking-wider">
          <span className="w-2 h-2 rounded-full bg-emerald-500 mr-2 animate-ping" />
          {currentTime}
        </div>

        {/* Fullscreen Toggle */}
        <button
          onClick={onToggleFullscreen}
          className="p-2 text-slate-400 hover:text-white bg-slate-950/80 border border-slate-800 rounded-lg hover:border-slate-700 transition"
          title="Pantalla Completa (F11)"
        >
          <Maximize className="w-4 h-4" />
        </button>

        {/* Playback Studio Button */}
        <button
          onClick={onOpenPlaybackModal}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 rounded-lg text-xs font-bold shadow transition"
          title="Consultar y reproducir grabaciones históricas de discos duros"
        >
          <Film className="w-4 h-4 text-purple-400" />
          <span className="hidden md:inline">Grabaciones / Playback</span>
        </button>

        {/* Settings / DVR Manager */}
        <button
          onClick={onOpenSettingsModal}
          className="p-2 text-slate-400 hover:text-white bg-slate-950/80 border border-slate-800 rounded-lg hover:border-slate-700 transition"
          title="Gestor de Cámaras y DVRs"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
