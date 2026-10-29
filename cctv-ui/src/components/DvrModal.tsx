import React, { useState, useEffect, useMemo } from 'react';
import type { Camera, VendorPreset } from '../types/cctv';
import { validateDvrCredentials, autoDetectDvrVendor, scanDvrActiveChannels } from '../services/go2rtc';
import { 
  X, 
  Server, 
  CheckCircle, 
  AlertCircle, 
  AlertTriangle,
  RefreshCw, 
  ShieldCheck, 
  Eye, 
  EyeOff,
  Sparkles,
  Search
} from 'lucide-react';

export interface DvrFormData {
  originalGroupName?: string;
  name: string;
  vendorPreset: VendorPreset;
  ip: string;
  port: number;
  username: string;
  password?: string;
  channelCount: number;
}

interface ExistingDvrSummary {
  groupName: string;
  ip: string;
  port: number;
  channelCount: number;
  vendorPreset?: VendorPreset;
}

interface DvrModalProps {
  isOpen: boolean;
  onClose: () => void;
  dvrToEdit?: DvrFormData | null;
  onSaveDvr: (data: DvrFormData) => void;
  existingCameras?: Camera[];
}

export const DvrModal: React.FC<DvrModalProps> = ({
  isOpen,
  onClose,
  dvrToEdit,
  onSaveDvr,
  existingCameras = [],
}) => {
  const isEditing = !!dvrToEdit?.originalGroupName;

  const [name, setName] = useState('');
  const [vendorPreset, setVendorPreset] = useState<VendorPreset>('dahua');
  const [ip, setIp] = useState('');
  const [port, setPort] = useState(554);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [channelCount, setChannelCount] = useState<number>(8);

  const [valState, setValState] = useState<'idle' | 'validating' | 'success' | 'error'>('idle');
  const [valMsg, setValMsg] = useState('');

  // Extract distinct registered DVRs from existing cameras
  const registeredDvrs = useMemo<ExistingDvrSummary[]>(() => {
    if (!existingCameras || existingCameras.length === 0) return [];
    const map = new Map<string, ExistingDvrSummary>();
    for (const c of existingCameras) {
      const grp = (c.group || 'Sin Nombre').trim();
      if (!map.has(grp)) {
        map.set(grp, {
          groupName: grp,
          ip: (c.ip || '').trim(),
          port: c.port || 554,
          channelCount: 0,
          vendorPreset: c.vendorPreset,
        });
      }
      const item = map.get(grp)!;
      item.channelCount++;
      if (!item.ip && c.ip) item.ip = c.ip.trim();
    }
    return Array.from(map.values());
  }, [existingCameras]);

  // Pre-fill fields when modal opens or dvrToEdit changes
  useEffect(() => {
    if (isOpen) {
      if (dvrToEdit) {
        setName(dvrToEdit.name);
        setVendorPreset(dvrToEdit.vendorPreset || 'dahua');
        setIp(dvrToEdit.ip || '');
        setPort(dvrToEdit.port || 554);
        setUsername(dvrToEdit.username || 'admin');
        setPassword(dvrToEdit.password || '');
        setChannelCount(dvrToEdit.channelCount || 8);
      } else {
        // Suggest unique default name
        let defaultIdx = registeredDvrs.length + 1;
        let suggestedName = `Grabador ${defaultIdx}`;
        while (registeredDvrs.some((d) => d.groupName.toLowerCase() === suggestedName.toLowerCase())) {
          defaultIdx++;
          suggestedName = `Grabador ${defaultIdx}`;
        }
        setName(suggestedName);
        setVendorPreset('dahua');
        setIp('');
        setPort(554);
        setUsername('admin');
        setPassword('');
        setChannelCount(8);
      }
      setValState('idle');
      setValMsg('');
      setShowPassword(false);
    }
  }, [isOpen, dvrToEdit, registeredDvrs]);

  // Real-time duplicate conflict detector
  const duplicateConflict = useMemo<{
    type: 'ip' | 'name' | 'both';
    message: string;
    existingDvr: ExistingDvrSummary;
  } | null>(() => {
    const cleanName = name.trim().toLowerCase();
    const cleanIp = ip.trim().toLowerCase();
    const currentPort = Number(port) || 554;
    const editingOriginal = dvrToEdit?.originalGroupName?.trim().toLowerCase();

    // Ignore the current DVR if editing
    const otherDvrs = registeredDvrs.filter(
      (d) => !editingOriginal || d.groupName.trim().toLowerCase() !== editingOriginal
    );

    // 1. Check IP conflict (same IP on local network)
    const ipMatch = cleanIp
      ? otherDvrs.find((d) => {
          if (!d.ip) return false;
          return d.ip.trim().toLowerCase() === cleanIp;
        })
      : null;

    // 2. Check Name conflict (same group/DVR name)
    const nameMatch = cleanName
      ? otherDvrs.find((d) => d.groupName.trim().toLowerCase() === cleanName)
      : null;

    if (ipMatch && nameMatch) {
      return {
        type: 'both',
        message: `El grabador "${name}" con la IP ${ip} ya está registrado en el sistema con ${ipMatch.channelCount} cámaras. No es posible agregarlo de nuevo.`,
        existingDvr: ipMatch,
      };
    }

    if (ipMatch) {
      const samePort = (Number(ipMatch.port) || 554) === currentPort;
      return {
        type: 'ip',
        message: samePort
          ? `La dirección IP ${ip}:${currentPort} ya está en uso por el grabador "${ipMatch.groupName}" (${ipMatch.channelCount} canales). No se puede duplicar el mismo equipo físico.`
          : `La dirección IP ${ip} ya está registrada en el grabador "${ipMatch.groupName}" (puerto ${ipMatch.port}). En la misma red no pueden existir dos grabadores con la misma IP.`,
        existingDvr: ipMatch,
      };
    }

    if (nameMatch) {
      return {
        type: 'name',
        message: `El nombre "${name}" ya está asignado a otro equipo registrado (IP: ${nameMatch.ip || 'N/A'}, ${nameMatch.channelCount} canales). Por favor elija un nombre diferente para evitar mezclar los grupos de cámaras.`,
        existingDvr: nameMatch,
      };
    }

    return null;
  }, [name, ip, port, registeredDvrs, dvrToEdit]);

  if (!isOpen) return null;

  // Validate credentials & IP
  const handleValidateCredentials = async () => {
    if (!ip.trim()) {
      setValState('error');
      setValMsg('Por favor ingrese la dirección IP del grabador.');
      return;
    }

    if (duplicateConflict && (duplicateConflict.type === 'ip' || duplicateConflict.type === 'both')) {
      setValState('error');
      setValMsg(`Aviso: ${duplicateConflict.message}`);
      return;
    }

    setValState('validating');
    setValMsg(`Verificando credenciales en ${ip}:${port} (${vendorPreset.toUpperCase()})...`);

    const res = await validateDvrCredentials(vendorPreset, ip.trim(), port, username.trim(), password);
    if (res.ok) {
      setValState('success');
      setValMsg(res.message);
    } else {
      setValState('error');
      setValMsg(res.message);
    }
  };

  // Auto-detect brand & test connection & scan channels
  const handleAutoDetect = async () => {
    if (!ip.trim()) {
      setValState('error');
      setValMsg('Por favor ingrese la dirección IP del grabador.');
      return;
    }

    if (duplicateConflict && (duplicateConflict.type === 'ip' || duplicateConflict.type === 'both')) {
      setValState('error');
      setValMsg(`Aviso: ${duplicateConflict.message}`);
      return;
    }

    setValState('validating');
    setValMsg(`Escaneando protocolos RTSP en ${ip}:${port}...`);

    const { vendor, result, channelCount: detectedCount } = await autoDetectDvrVendor(ip.trim(), port, username.trim(), password);
    setVendorPreset(vendor as VendorPreset);

    if (detectedCount) {
      setChannelCount(detectedCount);
    }

    if (result.ok) {
      setValState('success');
      setValMsg(result.message);
    } else {
      setValState('error');
      setValMsg(result.message);
    }
  };

  // Dedicated channel scanner
  const handleScanChannels = async () => {
    if (!ip.trim()) {
      setValState('error');
      setValMsg('Por favor ingrese la dirección IP del grabador.');
      return;
    }

    if (duplicateConflict && (duplicateConflict.type === 'ip' || duplicateConflict.type === 'both')) {
      setValState('error');
      setValMsg(`Aviso: ${duplicateConflict.message}`);
      return;
    }

    setValState('validating');
    setValMsg(`Escaneando canales activos en ${ip}:${port} (${vendorPreset.toUpperCase()})...`);

    const scan = await scanDvrActiveChannels(
      vendorPreset,
      ip.trim(),
      port,
      username.trim(),
      password,
      (scanned, found) => {
        setValMsg(`Escaneando canal ${scanned}/32 (${found} canales activos detectados)...`);
      }
    );

    if (scan.ok) {
      setChannelCount(scan.channelCount);
      setValState('success');
      setValMsg(`¡Detección completada! ${scan.activeChannels.length} canales activos encontrados (1 al ${scan.channelCount}).`);
    } else {
      setValState('error');
      setValMsg(scan.message);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (duplicateConflict) {
      setValState('error');
      setValMsg(duplicateConflict.message);
      return;
    }

    if (!ip.trim()) {
      setValState('error');
      setValMsg('Debe especificar la IP del equipo.');
      return;
    }

    onSaveDvr({
      originalGroupName: dvrToEdit?.originalGroupName,
      name: name.trim() || 'DVR Principal',
      vendorPreset,
      ip: ip.trim(),
      port: Number(port) || 554,
      username: username.trim(),
      password,
      channelCount: Math.max(1, channelCount),
    });
    onClose();
  };

  const isNameConflicted = duplicateConflict?.type === 'name' || duplicateConflict?.type === 'both';
  const isIpConflicted = duplicateConflict?.type === 'ip' || duplicateConflict?.type === 'both';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center space-x-2">
            <Server className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-bold text-white">
              {isEditing ? `Editar Grabador: ${dvrToEdit.originalGroupName}` : 'Agregar Grabador DVR / NVR'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs text-slate-300">
          {/* DVR Name */}
          <div>
            <label className="block font-semibold mb-1 text-slate-400">Nombre del Grabador (DVR / NVR)</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. DVR Zona Sótano"
              className={`w-full bg-slate-950 border rounded-lg px-3 py-2 text-white text-xs focus:outline-none transition ${
                isNameConflicted 
                  ? 'border-amber-500 focus:border-amber-400 bg-amber-950/20 text-amber-200' 
                  : 'border-slate-700 focus:border-blue-500'
              }`}
            />
            {isNameConflicted && (
              <p className="mt-1 text-[11px] text-amber-400 font-medium flex items-center space-x-1 animate-in fade-in">
                <span>⚠️ Ya existe un grabador registrado con este nombre.</span>
              </p>
            )}
          </div>

          {/* Vendor Preset Selection */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-semibold text-slate-400">Marca / Protocolo RTSP</label>
              <button
                type="button"
                onClick={handleAutoDetect}
                disabled={valState === 'validating'}
                className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex items-center space-x-1"
                title="Detecta automáticamente si el grabador es Dahua, Hikvision o Uniview"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Auto-Detectar Marca</span>
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'dahua', label: 'Dahua / Amcrest' },
                { id: 'hikvision', label: 'Hikvision / Hilook' },
                { id: 'uniview', label: 'Uniview (UNV)' },
              ].map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setVendorPreset(p.id as VendorPreset)}
                  className={`py-2 px-2 rounded-lg font-medium border text-center transition ${
                    vendorPreset === p.id
                      ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-bold shadow-sm'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Connection Parameters */}
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">IP o Dominio del Grabador</label>
                <input
                  type="text"
                  required
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="Ej. 192.168.1.100"
                  className={`w-full bg-slate-900 border rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none transition ${
                    isIpConflicted 
                      ? 'border-amber-500 focus:border-amber-400 bg-amber-950/30 text-amber-200' 
                      : 'border-slate-700 focus:border-blue-500'
                  }`}
                />
                {isIpConflicted && duplicateConflict && (
                  <p className="mt-1 text-[10px] text-amber-400 font-medium flex items-center space-x-1 animate-in fade-in">
                    <span>⚠️ IP registrada en: "{duplicateConflict.existingDvr.groupName}"</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Puerto RTSP</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Usuario</label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Contraseña</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 pr-8 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Validate Button inside parameters */}
            <div className="pt-1">
              <button
                type="button"
                onClick={handleValidateCredentials}
                disabled={valState === 'validating'}
                className="w-full flex items-center justify-center space-x-1.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-blue-400 hover:text-blue-300 border border-blue-900/60 rounded font-semibold text-xs transition"
              >
                {valState === 'validating' ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Validando credenciales en vivo...</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                    <span>Validar Conexión y Credenciales</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Duplicate Conflict Warning Card */}
          {duplicateConflict && (
            <div className="p-3.5 rounded-xl bg-amber-950/70 border border-amber-500/50 text-amber-200 text-xs flex items-start space-x-3 shadow-lg animate-in fade-in">
              <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <strong className="font-bold text-amber-300 text-xs">
                    Equipo Duplicado Detectado
                  </strong>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/90 border border-amber-600 text-amber-200 uppercase font-mono font-bold">
                    Bloqueado
                  </span>
                </div>
                <p className="text-slate-200 leading-relaxed text-[11px]">
                  {duplicateConflict.message}
                </p>
                <p className="text-slate-400 text-[10px]">
                  💡 Para cambiar la configuración de este grabador o modificar sus cámaras, selecciónelo en la lista de equipos y use la opción <strong>Editar</strong> en lugar de registrarlo de nuevo.
                </p>
              </div>
            </div>
          )}

          {/* Validation Feedback Banner */}
          {valState !== 'idle' && (
            <div className={`p-2.5 rounded-lg text-xs flex items-center space-x-2 ${
              valState === 'validating' ? 'bg-blue-950/60 border border-blue-800 text-blue-300' :
              valState === 'success' ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300' :
              'bg-red-950/60 border border-red-800 text-red-300'
            }`}>
              {valState === 'validating' && <RefreshCw className="w-4 h-4 animate-spin text-blue-400 flex-shrink-0" />}
              {valState === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
              {valState === 'error' && <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
              <span className="truncate">{valMsg}</span>
            </div>
          )}

          {/* Channel Count Selector & Scanner */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="font-semibold text-slate-400">Cantidad de Canales</label>
              <button
                type="button"
                onClick={handleScanChannels}
                disabled={valState === 'validating'}
                className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 flex items-center space-x-1"
                title="Sondea y detecta cuántos canales reales tiene activos este grabador"
              >
                <Search className="w-3.5 h-3.5" />
                <span>🔍 Detectar Canales Automáticamente</span>
              </button>
            </div>
            <div className="flex items-center space-x-2">
              <div className="grid grid-cols-4 gap-2 flex-1">
                {[4, 8, 16, 32].map((num) => (
                  <button
                    type="button"
                    key={num}
                    onClick={() => setChannelCount(num)}
                    className={`py-1.5 rounded-lg font-mono font-bold border transition ${
                      channelCount === num
                        ? 'bg-blue-600 border-blue-500 text-white shadow'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {num} Ch
                  </button>
                ))}
              </div>
              <div className="w-20">
                <input
                  type="number"
                  min="1"
                  max="64"
                  value={channelCount}
                  onChange={(e) => setChannelCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-center text-white font-mono font-bold text-xs focus:outline-none focus:border-blue-500"
                  title="Cantidad exacta de canales (editable manualmente o por auto-detección)"
                />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!!duplicateConflict || valState === 'validating'}
              className={`px-5 py-2 rounded-lg font-bold shadow-lg transition flex items-center space-x-2 ${
                duplicateConflict || valState === 'validating'
                  ? 'bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed opacity-60'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
              title={duplicateConflict ? duplicateConflict.message : undefined}
            >
              <span>{isEditing ? 'Guardar Cambios del Grabador' : `Crear Grabador (${channelCount} Canales)`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
