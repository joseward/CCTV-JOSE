import React, { useState, useMemo } from 'react';
import { type Camera, type VendorPreset, DEFAULT_FOLDER } from '../types/cctv';
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
  Film,
  Folder,
  FolderTree,
  FolderPlus,
  FolderInput,
  Check,
  X,
  AlertTriangle
} from 'lucide-react';

interface SidebarProps {
  cameras: Camera[];
  slots: (string | null)[];
  selectedSlotIndex: number;
  onAssignCameraToSlot: (cameraId: string, slotIndex?: number) => void;
  onViewSingleCamera: (cameraId: string) => void;
  onPlayAllDvrCameras: (groupName: string) => void;
  onPlayAllFolderCameras?: (folderName: string) => void;
  onCloseDvrCameras: (groupName: string) => void;
  onEditDvr: (groupName: string) => void;
  onMoveDvrToFolder?: (groupName: string, targetFolder: string) => void;
  onRenameFolder?: (oldFolder: string, newFolder: string) => void;
  onOpenMaintenance?: (groupName: string) => void;
  onOpenPlayback?: (cameraId: string) => void;
  onClearGrid: () => void;
  onOpenAddDvrModal: () => void;
  isOpen: boolean;
}

interface DvrItem {
  groupName: string;
  folder: string;
  vendorPreset: VendorPreset;
  ip: string;
  cameras: Camera[];
}

interface FolderSection {
  folderName: string;
  dvrs: DvrItem[];
  totalChannels: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  cameras,
  slots,
  selectedSlotIndex,
  onAssignCameraToSlot,
  onViewSingleCamera,
  onPlayAllDvrCameras,
  onPlayAllFolderCameras,
  onCloseDvrCameras,
  onEditDvr,
  onMoveDvrToFolder,
  onRenameFolder,
  onOpenMaintenance,
  onOpenPlayback,
  onClearGrid,
  onOpenAddDvrModal,
  isOpen,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  
  // Folders are expanded by default (expandedFolders[folder] !== false)
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  
  // DVRs are collapsed by default on startup (expandedDvrs[dvr] === true)
  const [expandedDvrs, setExpandedDvrs] = useState<Record<string, boolean>>({});
  
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);

  // Custom folder state (persisted to localStorage)
  const [customFolders, setCustomFolders] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cctv_custom_folders');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  // Inline "Create New Group / Folder" UI state
  const [isAddingFolder, setIsAddingFolder] = useState<boolean>(false);
  const [newFolderNameInput, setNewFolderNameInput] = useState<string>('');

  // Inline "Rename Folder" UI state
  const [editingFolderName, setEditingFolderName] = useState<string | null>(null);
  const [renameFolderInput, setRenameFolderInput] = useState<string>('');

  // "Move DVR to Folder" Popover state
  const [movingDvrName, setMovingDvrName] = useState<string | null>(null);
  const [inlineNewGroupForMove, setInlineNewGroupForMove] = useState<string>('');
  const [isCreatingGroupInMove, setIsCreatingGroupInMove] = useState<boolean>(false);

  // Confirmation dialog for folder actions ("Ver Grupo" / "Eliminar Grupo")
  const [confirmFolderAction, setConfirmFolderAction] = useState<{
    type: 'play' | 'delete';
    folderName: string;
    totalChannels: number;
    dvrCount: number;
  } | null>(null);

  // Sync custom folders changes to localStorage
  const saveCustomFolders = (folders: string[]) => {
    setCustomFolders(folders);
    try {
      localStorage.setItem('cctv_custom_folders', JSON.stringify(folders));
    } catch {}
  };

  // Distinct list of all available folder names
  const allFolderNames = useMemo<string[]>(() => {
    const set = new Set<string>();
    set.add(DEFAULT_FOLDER);
    for (const c of cameras) {
      const f = (c.folder || DEFAULT_FOLDER).trim();
      if (f) set.add(f);
    }
    for (const f of customFolders) {
      if (f && f.trim()) set.add(f.trim());
    }
    return Array.from(set);
  }, [cameras, customFolders]);

  // Hierarchical structure: Folder -> DVR -> Cameras
  const folderSections = useMemo<FolderSection[]>(() => {
    // 1. Map: folderName -> dvrName -> Camera[]
    const map = new Map<string, Map<string, Camera[]>>();

    // Initialize all known folders
    for (const f of allFolderNames) {
      map.set(f, new Map<string, Camera[]>());
    }

    // Populate cameras into their folder and DVR
    for (const cam of cameras) {
      const f = (cam.folder || DEFAULT_FOLDER).trim();
      const dvr = (cam.group || 'DVR General').trim();

      if (!map.has(f)) {
        map.set(f, new Map<string, Camera[]>());
      }
      const folderMap = map.get(f)!;

      if (!folderMap.has(dvr)) {
        folderMap.set(dvr, []);
      }
      folderMap.get(dvr)!.push(cam);
    }

    // Convert map to FolderSection[]
    const sections: FolderSection[] = [];
    for (const [folderName, dvrMap] of map.entries()) {
      const dvrs: DvrItem[] = [];
      let totalChannels = 0;

      for (const [groupName, dvrCams] of dvrMap.entries()) {
        dvrCams.sort((a, b) => a.channel - b.channel);
        const sample = dvrCams[0];
        dvrs.push({
          groupName,
          folder: folderName,
          vendorPreset: sample?.vendorPreset || 'dahua',
          ip: sample?.ip || '',
          cameras: dvrCams,
        });
        totalChannels += dvrCams.length;
      }

      sections.push({
        folderName,
        dvrs,
        totalChannels,
      });
    }

    return sections;
  }, [cameras, allFolderNames]);

  // Filter sections when user searches
  const filteredSections = useMemo<FolderSection[]>(() => {
    if (!searchTerm.trim()) return folderSections;
    const term = searchTerm.toLowerCase();

    const result: FolderSection[] = [];

    for (const section of folderSections) {
      const matchFolder = section.folderName.toLowerCase().includes(term);

      const matchingDvrs = section.dvrs.map((dvr) => {
        const matchDvr = dvr.groupName.toLowerCase().includes(term) || dvr.ip.includes(term);
        const matchingCams = dvr.cameras.filter(
          (c) =>
            c.name.toLowerCase().includes(term) ||
            c.ip.includes(term) ||
            `canal ${c.channel}`.includes(term) ||
            `ch ${c.channel}`.includes(term)
        );

        if (matchFolder || matchDvr || matchingCams.length > 0) {
          return {
            ...dvr,
            cameras: matchDvr || matchFolder ? dvr.cameras : matchingCams,
          };
        }
        return null;
      }).filter(Boolean) as DvrItem[];

      if (matchFolder || matchingDvrs.length > 0) {
        result.push({
          ...section,
          dvrs: matchingDvrs,
          totalChannels: matchingDvrs.reduce((acc, d) => acc + d.cameras.length, 0),
        });
      }
    }

    return result;
  }, [folderSections, searchTerm]);

  // Active camera IDs in grid
  const activeCameraIds = useMemo(() => {
    const set = new Set<string>();
    for (const id of slots) {
      if (id) set.add(id);
    }
    return set;
  }, [slots]);

  // Toggle folder open/closed
  const toggleFolder = (folderName: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderName]: prev[folderName] === undefined ? false : !prev[folderName],
    }));
  };

  // Toggle DVR open/closed
  const toggleDvr = (dvrName: string) => {
    setExpandedDvrs((prev) => ({
      ...prev,
      [dvrName]: !prev[dvrName],
    }));
  };

  // Create new folder
  const handleCreateFolder = () => {
    const name = newFolderNameInput.trim();
    if (!name) return;
    if (!allFolderNames.includes(name)) {
      saveCustomFolders([...customFolders, name]);
      // Auto expand newly created folder
      setExpandedFolders((prev) => ({ ...prev, [name]: true }));
    }
    setNewFolderNameInput('');
    setIsAddingFolder(false);
  };

  // Rename folder
  const handleSaveRenameFolder = (oldName: string) => {
    const newName = renameFolderInput.trim();
    if (!newName || newName === oldName) {
      setEditingFolderName(null);
      return;
    }
    if (onRenameFolder) {
      onRenameFolder(oldName, newName);
    }
    // Update custom folders
    const next = customFolders.map((f) => (f === oldName ? newName : f));
    if (!next.includes(newName)) next.push(newName);
    saveCustomFolders(next);
    
    setEditingFolderName(null);
  };

  // Delete empty folder
  const handleDeleteEmptyFolder = (folderName: string) => {
    if (folderName === DEFAULT_FOLDER) return;
    saveCustomFolders(customFolders.filter((f) => f !== folderName));
  };

  // Move DVR to a target folder
  const handleExecuteMove = (targetFolder: string) => {
    if (!movingDvrName) return;
    const clean = targetFolder.trim() || DEFAULT_FOLDER;
    if (onMoveDvrToFolder) {
      onMoveDvrToFolder(movingDvrName, clean);
    }
    if (!allFolderNames.includes(clean)) {
      saveCustomFolders([...customFolders, clean]);
    }
    // Auto-expand destination folder
    setExpandedFolders((prev) => ({ ...prev, [clean]: true }));
    setMovingDvrName(null);
    setIsCreatingGroupInMove(false);
    setInlineNewGroupForMove('');
  };

  return (
    <aside 
      className={`h-full bg-slate-950/95 border-r border-slate-800/80 flex flex-col transition-all duration-300 z-20 select-none ${
        isOpen ? 'w-[350px]' : 'w-0 border-r-0'
      } overflow-hidden`}
    >
      {/* Header */}
      <div className="p-3 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center space-x-2">
          <Server className="w-4 h-4 text-sky-400" />
          <h2 className="text-xs font-bold text-slate-200 tracking-wider">GRABADORES (DVR / NVR)</h2>
        </div>
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => {
              setIsAddingFolder(!isAddingFolder);
              setNewFolderNameInput('');
            }}
            className="px-2 py-0.5 text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition text-[10px] font-medium flex items-center space-x-1"
            title="Crear un nuevo grupo organizador (carpeta)"
          >
            <FolderPlus className="w-3.5 h-3.5 text-sky-400" />
            <span>+ Grupo</span>
          </button>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 font-bold">
            {cameras.length}
          </span>
        </div>
      </div>

      {/* Inline Create New Group Box */}
      {isAddingFolder && (
        <div className="p-2.5 bg-slate-900/90 border-b border-slate-800 space-y-2 animate-in fade-in">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-200 flex items-center space-x-1.5">
              <FolderPlus className="w-3.5 h-3.5 text-sky-400" />
              <span>Nuevo Grupo / Carpeta</span>
            </span>
            <button
              onClick={() => setIsAddingFolder(false)}
              className="text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
          <div className="flex items-center space-x-1.5">
            <input
              type="text"
              placeholder="Ej. Planta Alta, Sucursal Norte..."
              value={newFolderNameInput}
              onChange={(e) => setNewFolderNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder();
                if (e.key === 'Escape') setIsAddingFolder(false);
              }}
              className="flex-1 bg-slate-950 border border-slate-700 rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-sky-500"
              autoFocus
            />
            <button
              onClick={handleCreateFolder}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded text-xs font-medium transition shadow-sm"
            >
              Crear
            </button>
          </div>
          <p className="text-[10px] text-slate-400">
            Podrás mover cualquier DVR/NVR a este grupo usando el botón de carpeta en su fila.
          </p>
        </div>
      )}

      {/* Search Input */}
      <div className="p-2.5 border-b border-slate-800/60 bg-slate-950/40">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Buscar grupo, grabador, canal o IP..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Device Tree View (Folders -> DVRs -> Cameras) */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {filteredSections.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500 space-y-2">
            <Server className="w-8 h-8 text-slate-700 mx-auto" />
            <p>No se encontraron grabadores o cámaras configuradas.</p>
          </div>
        ) : (
          filteredSections.map((section) => {
            // Folders open by default unless explicitly closed
            const isFolderOpen = expandedFolders[section.folderName] !== false;
            const isEditingThisFolder = editingFolderName === section.folderName;

            return (
              <div 
                key={section.folderName}
                className="border border-slate-800/90 rounded-xl overflow-hidden bg-slate-900/30 shadow-sm"
              >
                {/* 1. TOP LEVEL: FOLDER / GRUPO HEADER */}
                <div 
                  className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between cursor-pointer hover:bg-slate-800/60 transition"
                  onClick={() => toggleFolder(section.folderName)}
                >
                  <div className="flex items-center space-x-2 truncate flex-1 mr-1">
                    <button className="text-slate-400 hover:text-white flex-shrink-0">
                      {isFolderOpen ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                    <FolderTree className="w-4 h-4 text-sky-400 flex-shrink-0" />

                    {isEditingThisFolder ? (
                      <div className="flex items-center space-x-1 flex-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={renameFolderInput}
                          onChange={(e) => setRenameFolderInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRenameFolder(section.folderName);
                            if (e.key === 'Escape') setEditingFolderName(null);
                          }}
                          className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-xs text-white flex-1 focus:outline-none focus:border-sky-500"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveRenameFolder(section.folderName)}
                          className="p-1 text-sky-400 hover:text-white"
                          title="Guardar nuevo nombre"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingFolderName(null)}
                          className="p-1 text-slate-400 hover:text-white"
                          title="Cancelar"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1 mr-2">
                        <span className="text-xs font-semibold text-slate-100 truncate block leading-tight" title={section.folderName}>
                          {section.folderName}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono block truncate mt-0.5">
                          {section.dvrs.length} {section.dvrs.length === 1 ? 'grabador' : 'grabadores'} • {section.totalChannels} can.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Folder Actions */}
                  <div className="flex items-center space-x-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    {/* Rename Folder Button */}
                    {!isEditingThisFolder && (
                      <button
                        onClick={() => {
                          setEditingFolderName(section.folderName);
                          setRenameFolderInput(section.folderName);
                        }}
                        className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition"
                        title="Renombrar este grupo / carpeta"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                    )}

                    {/* Delete Folder */}
                    {section.folderName !== DEFAULT_FOLDER && (
                      <button
                        onClick={() => {
                          if (section.dvrs.length > 0) {
                            setConfirmFolderAction({
                              type: 'delete',
                              folderName: section.folderName,
                              dvrCount: section.dvrs.length,
                              totalChannels: section.totalChannels
                            });
                          } else {
                            handleDeleteEmptyFolder(section.folderName);
                          }
                        }}
                        className="p-1 text-slate-500 hover:text-red-400 hover:bg-slate-800 rounded transition"
                        title={section.dvrs.length > 0 ? `Eliminar grupo (${section.dvrs.length} grabadores volverán a Grupo predefinido)` : "Eliminar carpeta vacía"}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}

                    {/* Play Entire Folder in Grid (With confirmation protection against misclicks) */}
                    {onPlayAllFolderCameras && section.totalChannels > 0 && (
                      <button
                        onClick={() => {
                          setConfirmFolderAction({
                            type: 'play',
                            folderName: section.folderName,
                            dvrCount: section.dvrs.length,
                            totalChannels: section.totalChannels
                          });
                        }}
                        className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded text-[10px] font-medium transition flex items-center space-x-1"
                        title="Transmitir cámaras de todo este grupo"
                      >
                        <Tv className="w-2.5 h-2.5 text-sky-400" />
                        <span>Ver Grupo</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* 2. SECOND LEVEL: DVRS INSIDE THIS FOLDER */}
                {isFolderOpen && (
                  <div className="p-2 space-y-1.5 bg-black/20">
                    {section.dvrs.length === 0 ? (
                      <div className="py-3 px-2 text-center text-[11px] text-slate-500 italic bg-slate-950/40 rounded-lg border border-dashed border-slate-800">
                        Carpeta vacía. Usa el botón de carpeta en cualquier grabador para moverlo aquí.
                      </div>
                    ) : (
                      section.dvrs.map((dvr) => {
                        const isDvrExpanded = !!expandedDvrs[dvr.groupName] || (searchTerm.trim().length > 0);
                        const activeInDvr = dvr.cameras.filter((c) => activeCameraIds.has(c.id)).length;
                        const allActive = activeInDvr === dvr.cameras.length && dvr.cameras.length > 0;
                        const isMovingThis = movingDvrName === dvr.groupName;

                        return (
                          <div 
                            key={dvr.groupName}
                            className="border border-slate-800/80 rounded-lg overflow-hidden bg-slate-900/50 shadow-sm"
                          >
                            {/* DVR Card Row */}
                            <div 
                              className="px-2.5 py-2 bg-slate-900/70 border-b border-slate-800/50 flex items-center justify-between cursor-pointer hover:bg-slate-800/50 transition"
                              onClick={() => toggleDvr(dvr.groupName)}
                            >
                              <div className="flex items-center space-x-2 min-w-0 flex-1 mr-2">
                                <button className="text-slate-400 hover:text-white flex-shrink-0">
                                  {isDvrExpanded ? (
                                    <ChevronDown className="w-3.5 h-3.5" />
                                  ) : (
                                    <ChevronRight className="w-3.5 h-3.5" />
                                  )}
                                </button>
                                <Server className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <span 
                                    className="text-xs font-semibold text-slate-100 truncate block leading-tight" 
                                    title={dvr.groupName}
                                  >
                                    {dvr.groupName}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-mono block truncate mt-0.5">
                                    {dvr.ip} • {dvr.cameras.length} canales
                                  </span>
                                </div>
                              </div>

                              {/* DVR Action Buttons */}
                              <div className="flex items-center space-x-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                                {/* Move DVR to another Folder Button */}
                                <button
                                  onClick={() => {
                                    setMovingDvrName(isMovingThis ? null : dvr.groupName);
                                    setIsCreatingGroupInMove(false);
                                    setInlineNewGroupForMove('');
                                  }}
                                  className={`p-1 rounded transition ${
                                    isMovingThis 
                                      ? 'bg-slate-700 text-sky-300' 
                                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                                  }`}
                                  title="Mover este grabador a otro grupo o crear uno nuevo"
                                >
                                  <FolderInput className="w-3.5 h-3.5" />
                                </button>

                                {onOpenMaintenance && (
                                  <button
                                    onClick={() => onOpenMaintenance(dvr.groupName)}
                                    className="p-1 hover:text-slate-200 hover:bg-slate-800 rounded transition text-slate-400"
                                    title="Mantenimiento: Verificar Hora, Discos y Menú Web"
                                  >
                                    <Wrench className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                <button
                                  onClick={() => onEditDvr(dvr.groupName)}
                                  className="p-1 hover:text-slate-200 hover:bg-slate-800 rounded transition text-slate-400"
                                  title="Editar IP, credenciales o canales de este grabador"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>

                                {activeInDvr > 0 && (
                                  <button
                                    onClick={() => onCloseDvrCameras(dvr.groupName)}
                                    className="p-1 hover:text-red-400 hover:bg-slate-800 rounded transition text-slate-400"
                                    title="Cerrar cámaras activas de este grabador"
                                  >
                                    <Square className="w-3.5 h-3.5" />
                                  </button>
                                )}

                                <button
                                  onClick={() => onPlayAllDvrCameras(dvr.groupName)}
                                  className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-medium border transition ${
                                    allActive 
                                      ? 'bg-slate-800 text-emerald-400 border-emerald-800/60 hover:bg-slate-700' 
                                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                                  }`}
                                  title={`Transmitir todas las cámaras de ${dvr.groupName} (${dvr.cameras.length} canales)`}
                                >
                                  <Tv className="w-3 h-3 text-sky-400" />
                                  <span>{allActive ? 'Activo' : `Ver (${dvr.cameras.length})`}</span>
                                </button>
                              </div>
                            </div>

                            {/* POPUP / POPOVER: Quick Move DVR to Folder */}
                            {isMovingThis && (
                              <div className="p-2.5 bg-slate-950 border-b border-slate-800 space-y-2 animate-in fade-in">
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] font-medium text-slate-200 flex items-center space-x-1">
                                    <FolderInput className="w-3 h-3 text-sky-400" />
                                    <span>Mover "{dvr.groupName}" a:</span>
                                  </span>
                                  <button
                                    onClick={() => setMovingDvrName(null)}
                                    className="text-slate-400 hover:text-white text-xs"
                                  >
                                    ✕
                                  </button>
                                </div>

                                {/* List of existing folders to choose from */}
                                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                                  {allFolderNames.map((target) => {
                                    const isCurrent = target === dvr.folder;
                                    return (
                                      <button
                                        key={target}
                                        onClick={() => handleExecuteMove(target)}
                                        disabled={isCurrent}
                                        className={`w-full text-left px-2 py-1 rounded text-xs flex items-center justify-between transition ${
                                          isCurrent
                                            ? 'bg-slate-800 text-sky-300 font-medium border border-slate-700 cursor-default'
                                            : 'hover:bg-slate-800/70 text-slate-300 hover:text-white'
                                        }`}
                                      >
                                        <span className="truncate flex items-center space-x-1.5">
                                          <Folder className="w-3 h-3 text-sky-400 flex-shrink-0" />
                                          <span className="truncate">{target}</span>
                                        </span>
                                        {isCurrent && (
                                          <span className="text-[10px] text-slate-400 font-normal">(actual)</span>
                                        )}
                                      </button>
                                    );
                                  })}
                                </div>

                                {/* Option to create new group on the fly */}
                                {isCreatingGroupInMove ? (
                                  <div className="pt-1.5 border-t border-slate-800 flex items-center space-x-1.5">
                                    <input
                                      type="text"
                                      placeholder="Nombre de la nueva carpeta..."
                                      value={inlineNewGroupForMove}
                                      onChange={(e) => setInlineNewGroupForMove(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter' && inlineNewGroupForMove.trim()) {
                                          handleExecuteMove(inlineNewGroupForMove.trim());
                                        }
                                      }}
                                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-sky-500"
                                      autoFocus
                                    />
                                    <button
                                      onClick={() => {
                                        if (inlineNewGroupForMove.trim()) {
                                          handleExecuteMove(inlineNewGroupForMove.trim());
                                        }
                                      }}
                                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded text-xs font-medium"
                                    >
                                      Mover
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setIsCreatingGroupInMove(true)}
                                    className="w-full text-left text-[11px] text-slate-400 hover:text-slate-200 font-medium pt-1 border-t border-slate-800 flex items-center space-x-1"
                                  >
                                    <FolderPlus className="w-3 h-3 text-sky-400" />
                                    <span>+ Crear nuevo grupo y mover aquí...</span>
                                  </button>
                                )}
                              </div>
                            )}

                            {/* 3. THIRD LEVEL: CHANNELS UNDER DVR */}
                            {isDvrExpanded && (
                              <div className="divide-y divide-slate-800/40 bg-black/40">
                                {dvr.cameras.map((cam) => {
                                  const isLoaded = activeCameraIds.has(cam.id);
                                  const isSelected = selectedCameraId === cam.id;
                                  const loadedSlotNumber = slots.findIndex((id) => id === cam.id) + 1;

                                  return (
                                    <div
                                      key={cam.id}
                                      onClick={() => setSelectedCameraId(cam.id)}
                                      onDoubleClick={() => onAssignCameraToSlot(cam.id, selectedSlotIndex)}
                                      className={`px-3 py-1.5 flex items-center justify-between transition cursor-pointer ${
                                        isSelected 
                                          ? 'bg-slate-850 border-l-2 border-sky-500' 
                                          : isLoaded 
                                          ? 'bg-slate-900/50 border-l-2 border-slate-600' 
                                          : 'hover:bg-slate-800/30'
                                      }`}
                                    >
                                      <div className="flex items-center space-x-2 truncate">
                                        <span className="font-mono text-[10px] text-slate-500 w-5 text-right flex-shrink-0">
                                          {cam.channel.toString().padStart(2, '0')}
                                        </span>
                                        <Video className={`w-3.5 h-3.5 flex-shrink-0 ${isLoaded ? 'text-sky-400' : 'text-slate-600'}`} />
                                        <div className="truncate">
                                          <span className={`text-[11px] block truncate font-medium ${isLoaded ? 'text-slate-100' : 'text-slate-300'}`}>
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
                                            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition"
                                            title="Ver Grabaciones / Histórico de esta cámara"
                                          >
                                            <Film className="w-3.5 h-3.5" />
                                          </button>
                                        )}

                                        {/* Button: View Single Camera (1x1) */}
                                        <button
                                          onClick={() => onViewSingleCamera(cam.id)}
                                          className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                                          title="Ver SOLO esta cámara a pantalla completa (1x1)"
                                        >
                                          <Maximize2 className="w-3.5 h-3.5" />
                                        </button>

                                        {/* Button: Put into active grid slot */}
                                        <button
                                          onClick={() => onAssignCameraToSlot(cam.id, selectedSlotIndex)}
                                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition flex items-center space-x-1 border ${
                                            isLoaded
                                              ? 'bg-slate-800 text-sky-400 border-sky-600/50'
                                              : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/60'
                                          }`}
                                          title={`Cargar en Casilla ${selectedSlotIndex + 1}`}
                                        >
                                          {isLoaded ? (
                                            <>
                                              <CheckCircle2 className="w-3 h-3 text-sky-400" />
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
          className="w-full flex items-center justify-center space-x-1.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 rounded-lg text-xs font-semibold shadow-sm transition"
        >
          <Plus className="w-4 h-4 text-sky-400" />
          <span>+ Agregar Grabador Completo</span>
        </button>

        {activeCameraIds.size > 0 && (
          <button
            onClick={onClearGrid}
            className="w-full flex items-center justify-center space-x-1.5 py-1.5 bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 rounded-lg text-xs font-medium transition"
            title="Cierra todas las transmisiones activas para liberar red y procesador"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Limpiar Mosaico ({activeCameraIds.size} activos)</span>
          </button>
        )}
      </div>

      {/* Confirmation Modal for Folder Actions (Ver Grupo / Eliminar Grupo) */}
      {confirmFolderAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-4">
            {confirmFolderAction.type === 'play' ? (
              <>
                <div className="flex items-center space-x-3 text-sky-400">
                  <div className="p-2 bg-slate-800 border border-slate-700 rounded-xl">
                    <Tv className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100">¿Transmitir grupo completo?</h4>
                    <p className="text-[11px] text-slate-400 font-medium">Confirmación de acción masiva</p>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl space-y-2 text-xs text-slate-300">
                  <p>
                    El grupo <strong className="text-white">"{confirmFolderAction.folderName}"</strong> contiene{' '}
                    <strong className="text-sky-300 font-semibold">{confirmFolderAction.dvrCount} grabador(es)</strong> con un total de{' '}
                    <strong className="text-sky-300 font-semibold">{confirmFolderAction.totalChannels} canales</strong>.
                  </p>
                  <div className="p-2 bg-amber-950/30 border border-amber-800/40 rounded-lg text-[11px] text-amber-300 flex items-start space-x-2">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400 mt-0.5" />
                    <span>
                      Al continuar se cargarán sus cámaras en el mosaico y se reemplazarán las que están transmitiendo actualmente en pantalla.
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setConfirmFolderAction(null)}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onPlayAllFolderCameras) {
                        onPlayAllFolderCameras(confirmFolderAction.folderName);
                      }
                      setConfirmFolderAction(null);
                    }}
                    className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow transition flex items-center space-x-1.5"
                  >
                    <Tv className="w-3.5 h-3.5" />
                    <span>Sí, Transmitir Grupo</span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center space-x-3 text-amber-400">
                  <div className="p-2 bg-slate-800 border border-slate-700 rounded-xl">
                    <Trash2 className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-100">¿Eliminar este grupo?</h4>
                    <p className="text-[11px] text-slate-400 font-medium">Reubicación de equipos</p>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/80 border border-slate-800/80 rounded-xl space-y-2 text-xs text-slate-300">
                  <p>
                    El grupo <strong className="text-white">"{confirmFolderAction.folderName}"</strong> contiene{' '}
                    <strong className="text-white font-semibold">{confirmFolderAction.dvrCount} grabador(es)</strong>.
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Los grabadores <strong className="text-slate-200">no se eliminarán</strong>; se moverán automáticamente al grupo <strong className="text-sky-300">"{DEFAULT_FOLDER}"</strong>.
                  </p>
                </div>

                <div className="flex items-center justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setConfirmFolderAction(null)}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const section = folderSections.find((s) => s.folderName === confirmFolderAction.folderName);
                      if (section && onMoveDvrToFolder) {
                        section.dvrs.forEach((d) => onMoveDvrToFolder(d.groupName, DEFAULT_FOLDER));
                      }
                      handleDeleteEmptyFolder(confirmFolderAction.folderName);
                      setConfirmFolderAction(null);
                    }}
                    className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold shadow transition flex items-center space-x-1.5"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Eliminar Grupo</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
};
