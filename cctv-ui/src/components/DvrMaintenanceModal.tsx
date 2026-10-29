import React, { useState, useEffect } from 'react';
import type { VendorPreset } from '../types/cctv';
import { 
  getDvrHealthReport, 
  syncDvrClockWithPc, 
  openDvrWeb, 
  type DvrHealthReport 
} from '../services/maintenance';
import { 
  X, 
  Wrench, 
  Clock, 
  HardDrive, 
  Cpu, 
  Globe, 
  RefreshCw, 
  CheckCircle, 
  AlertTriangle, 
  Copy, 
  Check, 
  ExternalLink,
  ShieldAlert
} from 'lucide-react';

interface DvrMaintenanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  dvr: {
    groupName: string;
    ip: string;
    port?: number;
    vendorPreset: VendorPreset;
    username: string;
    password?: string;
  } | null;
}

export const DvrMaintenanceModal: React.FC<DvrMaintenanceModalProps> = ({
  isOpen,
  onClose,
  dvr,
}) => {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<DvrHealthReport | null>(null);
  const [syncingTime, setSyncingTime] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [copiedUser, setCopiedUser] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  // Load audit on open
  useEffect(() => {
    if (isOpen && dvr) {
      setLoading(true);
      setSyncMessage(null);
      getDvrHealthReport(dvr.vendorPreset, dvr.ip, dvr.port || 80, dvr.username, dvr.password || '')
        .then((rep) => {
          setReport(rep);
          setLoading(false);
        })
        .catch(() => {
          setLoading(false);
        });
    }
  }, [isOpen, dvr]);

  if (!isOpen || !dvr) return null;

  // Handle sync time
  const handleSyncTime = async () => {
    setSyncingTime(true);
    setSyncMessage(null);
    const res = await syncDvrClockWithPc(
      dvr.vendorPreset,
      dvr.ip,
      dvr.port || 80,
      dvr.username,
      dvr.password || ''
    );
    setSyncingTime(false);
    setSyncMessage({ ok: res.ok, text: res.message });

    if (res.ok) {
      // Refresh report
      const updated = await getDvrHealthReport(
        dvr.vendorPreset,
        dvr.ip,
        dvr.port || 80,
        dvr.username,
        dvr.password || ''
      );
      setReport(updated);
    }
  };

  const handleCopy = (text: string, isUser: boolean) => {
    navigator.clipboard.writeText(text);
    if (isUser) {
      setCopiedUser(true);
      setTimeout(() => setCopiedUser(false), 2000);
    } else {
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center space-x-2">
                <span>Mantenimiento y Estado: {dvr.groupName}</span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-950 border border-blue-800 text-blue-400 uppercase">
                  {dvr.vendorPreset}
                </span>
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                IP: {dvr.ip} • Usuario: {dvr.username}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center space-y-3 text-slate-400">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin" />
              <p className="text-sm font-semibold">Consultando estado directo del grabador en red...</p>
              <p className="text-xs text-slate-500 font-mono">Verificando reloj interno, disco duro y modelo</p>
            </div>
          ) : report ? (
            <>
              {/* CARD 1: RELOJ Y HORA DEL SISTEMA */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-slate-200 font-bold text-xs">
                    <Clock className="w-4 h-4 text-cyan-400" />
                    <span>Auditoría de Fecha y Hora del Grabador</span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    !report.deviceTime || report.deviceTime === 'Sin respuesta' || report.deviceTime === 'Error al consultar'
                      ? 'bg-red-950 text-red-400 border border-red-800'
                      : report.timeInSync 
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' 
                        : 'bg-amber-950 text-amber-400 border border-amber-800'
                  }`}>
                    {!report.deviceTime || report.deviceTime === 'Sin respuesta' || report.deviceTime === 'Error al consultar'
                      ? '❌ Sin Respuesta del Reloj'
                      : report.timeInSync 
                        ? '✓ En Sincronía' 
                        : `⚠️ Desfasado (${report.timeDiffSeconds}s)`}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300 font-mono text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 block">Hora en el Grabador</span>
                    <strong className="text-sm text-white">{report.deviceTime || 'Sin respuesta'}</strong>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 block">Hora en tu Computadora</span>
                    <strong className="text-sm text-cyan-300">{report.pcTime}</strong>
                  </div>
                </div>

                {/* Sync Action */}
                <div className="flex items-center justify-between pt-1">
                  <p className="text-[11px] text-slate-400">
                    Si el grabador sufrió un apagón o atraso, puedes sincronizarlo con 1 clic:
                  </p>
                  <button
                    onClick={handleSyncTime}
                    disabled={syncingTime}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-bold text-xs shadow transition flex-shrink-0 ml-2"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingTime ? 'animate-spin' : ''}`} />
                    <span>{syncingTime ? 'Sincronizando...' : 'Sincronizar Hora Ahora'}</span>
                  </button>
                </div>

                {syncMessage && (
                  <div className={`p-2 rounded text-xs flex items-center space-x-1.5 ${
                    syncMessage.ok ? 'bg-emerald-950/70 text-emerald-300' : 'bg-red-950/70 text-red-300'
                  }`}>
                    {syncMessage.ok ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />}
                    <span>{syncMessage.text}</span>
                  </div>
                )}
              </div>

              {/* CARD 2: ESTADO DEL DISCO DURO Y GRABACIÓN */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-slate-200 font-bold text-xs">
                    <HardDrive className="w-4 h-4 text-emerald-400" />
                    <span>Salud del Disco Duro y Grabación</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                    {report.storageHealthy ? '✓ Disco Saludable' : '⚠️ Revisar Disco'}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800/80 flex items-center justify-between">
                  <div className="space-y-0.5">
                    <span className="text-xs font-mono font-bold text-white block">
                      {report.storageStatus}
                    </span>
                    <span className="text-[11px] text-slate-400 block">
                      Grabación continua activa y espacio asignado
                    </span>
                  </div>
                  <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                </div>
              </div>

              {/* CARD 3: INFORMACIÓN DEL MODELO Y ESTABILIDAD */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-2.5">
                <div className="flex items-center space-x-2 text-slate-200 font-bold text-xs">
                  <Cpu className="w-4 h-4 text-purple-400" />
                  <span>Información del Hardware y Firmware</span>
                </div>

                <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Modelo</span>
                    <strong className="text-slate-200 block truncate" title={report.model}>{report.model}</strong>
                  </div>
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Firmware</span>
                    <strong className="text-slate-200 block truncate" title={report.firmware}>{report.firmware}</strong>
                  </div>
                  <div className="p-2.5 rounded bg-slate-900 border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">Número de Serie</span>
                    <strong className="text-slate-200 block truncate" title={report.serialNumber}>{report.serialNumber}</strong>
                  </div>
                </div>
              </div>

              {/* CARD 4: ACCESO WEB DIRECTO AL MENÚ DEL PROVEEDOR */}
              <div className="p-4 rounded-xl border border-blue-900/60 bg-blue-950/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-white font-bold text-xs">
                    <Globe className="w-4 h-4 text-blue-400" />
                    <span>Menú Web de Configuración del Proveedor</span>
                  </div>
                  <span className="text-[10px] font-mono text-blue-300 bg-blue-950 px-2 py-0.5 rounded border border-blue-800">
                    {report.webUrl}
                  </span>
                </div>

                <p className="text-[11px] text-slate-400">
                  Abre la interfaz completa de fábrica del grabador sin tener que escribir la IP ni batallar con extensiones como IE Tab:
                </p>

                {/* Quick copy credentials */}
                <div className="flex items-center space-x-2 bg-slate-950/80 p-2 rounded-lg border border-slate-800 text-xs">
                  <span className="text-slate-400">Credenciales para inicio de sesión:</span>
                  <div className="flex items-center space-x-1 bg-slate-900 px-2 py-1 rounded border border-slate-800 font-mono">
                    <span className="text-slate-400 text-[10px]">Usuario:</span>
                    <strong className="text-white">{dvr.username}</strong>
                    <button
                      onClick={() => handleCopy(dvr.username, true)}
                      className="ml-1 text-slate-500 hover:text-white"
                      title="Copiar usuario"
                    >
                      {copiedUser ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </button>
                  </div>

                  {dvr.password && (
                    <div className="flex items-center space-x-1 bg-slate-900 px-2 py-1 rounded border border-slate-800 font-mono">
                      <span className="text-slate-400 text-[10px]">Clave:</span>
                      <strong className="text-white">••••••••</strong>
                      <button
                        onClick={() => handleCopy(dvr.password || '', false)}
                        className="ml-1 text-slate-500 hover:text-white"
                        title="Copiar contraseña"
                      >
                        {copiedPass ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      </button>
                    </div>
                  )}
                </div>

                {/* Open in Edge / Default buttons */}
                <div className="flex items-center space-x-2 pt-1">
                  <button
                    onClick={() => openDvrWeb(dvr.ip, 80, true)}
                    className="flex-1 flex items-center justify-center space-x-1.5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold text-xs shadow-lg transition"
                    title="Abre en Microsoft Edge con compatibilidad de plugins de cámaras"
                  >
                    <ExternalLink className="w-4 h-4" />
                    <span>Abrir en Microsoft Edge (IE Mode Compatible)</span>
                  </button>

                  <button
                    onClick={() => openDvrWeb(dvr.ip, 80, false)}
                    className="flex items-center space-x-1 px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg font-semibold text-xs border border-slate-700 transition"
                    title="Abrir en tu navegador predeterminado"
                  >
                    <span>Abrir Normal</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-slate-500 space-y-2">
              <ShieldAlert className="w-8 h-8 text-red-500 mx-auto" />
              <p>No se pudo establecer conexión con el grabador en {dvr.ip}.</p>
              <button
                onClick={() => openDvrWeb(dvr.ip, 80, true)}
                className="px-3 py-1.5 bg-blue-600 text-white rounded font-bold text-xs"
              >
                Probar abrir panel web directamente
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-slate-400 text-xs">
          <span>Grabador: <strong>{dvr.groupName}</strong> ({dvr.ip})</span>
          <button
            onClick={onClose}
            className="px-5 py-1.5 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};