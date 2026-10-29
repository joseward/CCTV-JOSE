import React, { useState, useMemo } from 'react';
import type { Camera } from '../types/cctv';
import { 
  Server, 
  Video, 
  ChevronRight, 
  ChevronDown, 
  Play, 
  Search, 
  Plus, 
  Trash2,
  Maximize2,
  Tv,
  CheckCircle2,
  Square,
  Edit3,
  Wrench,
  Film
} from 'lucide-react';

interface SidebarProps {
  cameras: Camera[];
  slots: (string | null)[];
  selectedSlotIndex: number;
  onAssignCameraToSlot: (cameraId: string, slotIndex?: number) => void;
  onViewSingleCamera: (cameraId: string) => void;
  onPlayAllDvrCameras: (groupName: string) => void;
  onCloseDvrCameras: (groupName: string) => void;
  onEditDvr: (groupName: string) => void;
  onOpenMaintenance?: (groupName: string) => void;
  onOpenPlayback?: (cameraId: string) => void;
  onClearGrid: () => void;
  onOpenAddDvrModal: () => void;
  isOpen: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  cameras,
  slots,
  selectedSlotIndex,
  onAssignCameraToSlot,
  onViewSingleCamera,
  onPlayAllDvrCameras,
  onCloseDvrCameras,
  onEditDvr,
  onOpenMaintenance,
  onOpenPlayback,
  onClearGrid,
  onOpenAddDvrModal,
  isOpen,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  // All DVRs collapsed by default on startup
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  // Group cameras by DVR
  const dvrGroups = useMemo(() => {
    const map: Record<string, Camera[]> = {};
    for (const cam of cameras) {
      const grp = cam.group || 'DVR General';
      if (!map[grp]) map[grp] = [];
      map[grp].push(cam);
    }
    for (const grp in map) {
      map[grp].sort((a, b) => a.channel - b.channel);
    }
    return map;
  }, [cameras]);

  const toggleGroup = (grp: string) => {
    setExpandedGroups((prev) => ({ ...prev, [grp]: !prev[grp] }));
  };

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return dvrGroups;
    const term = searchTerm.toLowerCase();
    const result: Record<string, Camera[]> = {};

    for (const [grp, cams] of Object.entries(dvrGroups)) {
      const matchGrp = grp.toLowerCase().includes(term);
      const matchingCams = cams.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.ip.includes(term) ||
          `canal ${c.channel}`.includes(term) ||
          `ch ${c.channel}`.includes(term)
      );

      if (matchGrp || matchingCams.length > 0) {
        result[grp] = matchGrp ? cams : matchingCams;
      }
    }
    return result;
  }, [dvrGroups, searchTerm]);

  const activeCameraIds = useMemo(() => {
    const set = new Set<string>();
    for (const id of slots) {
      if (id) set.add(id);
    }
    return set;
  }, [slots]);

  return (
    <aside 
      className={`h-full bg-slate-950/95 border-r border-slate-800/80 flex flex-col transition-all duration-300 z-20 select-none ${
        isOpen ? 'w-80' : 'w-0 border-r-0'
      } overflow-hidden`}
    >
      {/* Header */}
      <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center space-x-2">
          <Server className="w-4 h-4 text-blue-400" />
          <h2 className="text-xs font-bold text-white tracking-wider">GRABADORES (DVR / NVR)</h2>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-blue-950 text-blue-400 border border-blue-800/60 font-bold">
          {cameras.length} Canales
        </span>
      </div>

      {/* Search Input */}
      <div className="p-2.5 border-b border-slate-800/60 bg-slate-950/40">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Buscar grabador, canal o IP..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Device Tree View */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2.5">
        {Object.keys(filteredGroups).length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 space-y-2">
            <Server className="w-8 h-8 text-slate-700 mx-auto" />
            <p>No se encontraron grabadores o cámaras configuradas.</p>
          </div>
        ) : (
          Object.entries(filteredGroups).map(([groupName, groupCams]) => {
            const isExpanded = !!expandedGroups[groupName];
            const sampleCam = groupCams[0];
            const activeInGroup = groupCams.filter((c) => activeCameraIds.has(c.id)).length;
            const allActive = activeInGroup === groupCams.length && groupCams.length > 0;

            return (
              <div 
                key={groupName}
                className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/40 shadow-sm"
              >
                {/* DVR Card Header */}
                <div 
                  className="px-3 py-2.5 bg-slate-900/80 border-b border-slate-800/60 flex items-center justify-between cursor-pointer hover:bg-slate-800/60 transition"
                  onClick={() => toggleGroup(groupName)}
                >
                  <div className="flex items-center space-x-2 truncate">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    )}
                    <Server className="w-4 h-4 text-blue-400 flex-shrink-0" />
                    <div className="truncate">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-xs font-bold text-slate-100 truncate" title={groupName}>
                          {groupName}
                        </span>
                        <span className="text-[9px] font-mono font-bold px-1 rounded bg-blue-950 text-blue-400 border border-blue-800/50 uppercase">
                          {sampleCam ? sampleCam.vendorPreset : 'DVR'}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono block">
                        {sampleCam ? sampleCam.ip : ''} • {groupCams.length} cámaras
                      </span>
                    </div>
                  </div>

                  {/* DVR Action Buttons */}
                  <div className="flex items-center space-x-1 flex-shrink-0 ml-1" onClick={(e) => e.stopPropagation()}>
                    {onOpenMaintenance && (
                      <button
                        onClick={() => onOpenMaintenance(groupName)}
                        className="p-1 hover:text-amber-400 hover:bg-slate-800 rounded transition text-slate-400"
                        title="Mantenimiento: Verificar Hora, Discos, Apagones y Menú Web del Proveedor"
                      >
                        <Wrench className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={() => onEditDvr(groupName)}
                      className="p-1 hover:text-blue-400 hover:bg-slate-800 rounded transition text-slate-400"
                      title="Editar este grabador (IP, usuario, contraseña, canales)"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    {activeInGroup > 0 && (
                      <button
                        onClick={() => onCloseDvrCameras(groupName)}
                        className="p-1 hover:text-red-400 hover:bg-slate-800 rounded transition text-slate-400"
                        title="Detener y cerrar todas las cámaras de este grabador"
                      >
                        <Square className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={() => onPlayAllDvrCameras(groupName)}
                      className={`flex items-center space-x-1 px-2 py-1 text-white rounded text-[10px] font-bold shadow transition ${
                        allActive ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-blue-600 hover:bg-blue-500'
                      }`}
                      title="Abrir y reproducir TODAS las cámaras de este grabador en la cuadrícula"
                    >
                      <Tv className="w-3 h-3" />
                      <span>{allActive ? `Activo (${groupCams.length})` : `Ver Todo (${groupCams.length})`}</span>
                    </button>
                  </div>
                </div>

                {/* List of Channels under this DVR (Only when expanded) */}
                {isExpanded && (
                  <div className="divide-y divide-slate-800/40 bg-black/40">
                    {groupCams.map((cam) => {
                      const isLoaded = activeCameraIds.has(cam.id);
                      const isSelected = selectedCameraId === cam.id;
                      const loadedSlotNumber = slots.findIndex((id) => id === cam.id) + 1;

                      return (
                        <div
                          key={cam.id}
                          onClick={() => setSelectedCameraId(cam.id)}
                          onDoubleClick={() => onAssignCameraToSlot(cam.id, selectedSlotIndex)}
                          className={`px-3 py-2 flex items-center justify-between transition cursor-pointer ${
                            isSelected 
                              ? 'bg-blue-950/60 border-l-2 border-blue-500' 
                              : isLoaded 
                              ? 'bg-slate-900/50 border-l-2 border-emerald-500' 
                              : 'hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <span className="font-mono text-[10px] text-slate-500 w-5 text-right flex-shrink-0">
                              {cam.channel.toString().padStart(2, '0')}
                            </span>
                            <Video className={`w-3.5 h-3.5 flex-shrink-0 ${isLoaded ? 'text-emerald-400' : 'text-slate-600'}`} />
                            <div className="truncate">
                              <span className={`text-[11px] block truncate font-medium ${isLoaded ? 'text-white' : 'text-slate-300'}`}>
                                {cam.name}
                              </span>
                              <span className="text-[9px] font-mono text-slate-500 block">
                                {isLoaded ? `Transmitiendo en Casilla ${loadedSlotNumber}` : 'Inactiva (0% consumo)'}
                              </span>
                            </div>
                          </div>

                          {/* Action Buttons for this specific camera */}
                          <div className="flex items-center space-x-1 flex-shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                            {/* Button: Playback Recordings */}
                            {onOpenPlayback && (
                              <button
                                onClick={() => onOpenPlayback(cam.id)}
                                className="p-1 text-purple-400 hover:text-purple-300 hover:bg-purple-950/60 rounded transition"
                                title="Ver Grabaciones / Histórico de esta cámara"
                              >
                                <Film className="w-3.5 h-3.5" />
                              </button>
                            )}

                            {/* Button: View Single Camera (1x1) */}
                            <button
                              onClick={() => onViewSingleCamera(cam.id)}
                              className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                              title="Ver SOLO esta cámara a pantalla completa (1x1 Alta Resolución)"
                            >
                              <Maximize2 className="w-3.5 h-3.5" />
                            </button>

                            {/* Button: Put into active grid slot */}
                            <button
                              onClick={() => onAssignCameraToSlot(cam.id, selectedSlotIndex)}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold transition flex items-center space-x-1 ${
                                isLoaded
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-700/60'
                                  : 'bg-slate-800 hover:bg-blue-600 text-slate-300 hover:text-white'
                              }`}
                              title={`Cargar en la casilla actual (Casilla ${selectedSlotIndex + 1})`}
                            >
                              {isLoaded ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                                  <span>C{loadedSlotNumber}</span>
                                </>
                              ) : (
                                <>
                                  <Play className="w-2.5 h-2.5" />
                                  <span>Ver</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Tools */}
      <div className="p-3 border-t border-slate-800/80 bg-slate-950/90 space-y-2">
        <button
          onClick={onOpenAddDvrModal}
          className="w-full flex items-center justify-center space-x-1.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold shadow-md transition"
        >
          <Plus className="w-4 h-4" />
          <span>+ Agregar Grabador Completo</span>
        </button>

        {activeCameraIds.size > 0 && (
          <button
            onClick={onClearGrid}
            className="w-full flex items-center justify-center space-x-1.5 py-1.5 bg-slate-900 hover:bg-red-950/80 text-slate-400 hover:text-red-300 border border-slate-800 rounded-lg text-xs font-semibold transition"
            title="Cierra todas las transmisiones activas para liberar red y procesador"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Limpiar Mosaico ({activeCameraIds.size} activos)</span>
          </button>
        )}
      </div>
    </aside>
  );
};
