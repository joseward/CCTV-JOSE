import React, { useState } from 'react';
import type { Camera, VendorPreset } from '../types/cctv';
import { buildPresetRtspUrls, registerStream } from '../services/go2rtc';
import { X, Server, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';

interface AddDvrModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveDvr: (cameras: Camera[]) => void;
}

export const AddDvrModal: React.FC<AddDvrModalProps> = ({
  isOpen,
  onClose,
  onSaveDvr,
}) => {
  const [dvrName, setDvrName] = useState('Nuevo Grabador');
  const [vendorPreset, setVendorPreset] = useState<VendorPreset>('dahua');
  const [ip, setIp] = useState('192.168.1.100');
  const [port, setPort] = useState(554);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [channelCount, setChannelCount] = useState<number>(8);

  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');

  if (!isOpen) return null;

  // Auto-detect brand live by probing Dahua, Hikvision, Uniview
  const handleAutoDetect = async () => {
    setTestState('testing');
    setTestMsg('Escaneando protocolos de grabador en red...');

    const presetsToTry: VendorPreset[] = ['dahua', 'hikvision', 'uniview'];

    for (const p of presetsToTry) {
      setTestMsg(`Probando protocolo ${p.toUpperCase()}...`);
      const urls = buildPresetRtspUrls(p, ip, port, username, password, 1);
      try {
        await registerStream('auto_probe_dvr', urls.main);
        const res = await fetch(`http://127.0.0.1:1984/api/frame.mp4?src=auto_probe_dvr`, {
          signal: AbortSignal.timeout(3500),
        });
        if (res.ok) {
          setVendorPreset(p);
          setTestState('success');
          setTestMsg(`¡Grabador detectado con éxito: ${p.toUpperCase()}! Canales listos.`);
          return;
        }
      } catch {
        // Continue
      }
    }

    setTestState('error');
    setTestMsg('No se detectó respuesta automática. Verifique la IP, usuario y contraseña.');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const generatedCameras: Camera[] = [];

    for (let ch = 1; ch <= channelCount; ch++) {
      const urls = buildPresetRtspUrls(vendorPreset, ip, port, username, password, ch);
      generatedCameras.push({
        id: `cam-${Date.now()}-ch${ch}`,
        name: `Cámara ${ch.toString().padStart(2, '0')}`,
        group: dvrName.trim() || 'DVR Principal',
        vendorPreset,
        ip: ip.trim(),
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

    onSaveDvr(generatedCameras);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center space-x-2">
            <Server className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-bold text-white">Agregar Grabador DVR / NVR Completo</h3>
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
          <div>
            <label className="block font-semibold mb-1 text-slate-400">Nombre del Grabador / DVR / NVR</label>
            <input
              type="text"
              required
              value={dvrName}
              onChange={(e) => setDvrName(e.target.value)}
              placeholder="Ej. DVR Principal Sótano"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Preset Buttons */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-semibold text-slate-400">Marca / Protocolo RTSP</label>
              <button
                type="button"
                onClick={handleAutoDetect}
                disabled={testState === 'testing' || !ip}
                className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex items-center space-x-1"
              >
                <span>🔍 Auto-Detectar Marca</span>
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { id: 'dahua', label: 'Dahua / Amcrest' },
                { id: 'hikvision', label: 'Hikvision / Hilook' },
                { id: 'uniview', label: 'Uniview (UNV)' },
                { id: 'juan', label: 'Juan / EseeCloud' },
              ].map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => {
                    setVendorPreset(p.id as VendorPreset);
                    if (p.id === 'juan' && port === 554) setPort(80);
                    if (p.id !== 'juan' && port === 80) setPort(554);
                  }}
                  className={`py-2 px-2 rounded-lg font-medium border text-center transition ${
                    vendorPreset === p.id
                      ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Connection Params */}
          <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">IP o Host del DVR</label>
                <input
                  type="text"
                  required
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  placeholder="192.168.1.100"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                />
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
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Channel Count Selector */}
          <div>
            <label className="block font-semibold mb-1 text-slate-400">Cantidad de Canales</label>
            <div className="grid grid-cols-5 gap-1.5">
              {[4, 8, 10, 16, 32].map((num) => (
                <button
                  type="button"
                  key={num}
                  onClick={() => setChannelCount(num)}
                  className={`py-2 rounded-lg font-mono font-bold border transition text-center text-xs ${
                    channelCount === num
                      ? 'bg-blue-600 border-blue-500 text-white shadow'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {num} Ch
                </button>
              ))}
            </div>
          </div>

          {/* Status Probe Banner */}
          {testState !== 'idle' && (
            <div className={`p-2.5 rounded-lg text-xs flex items-center space-x-2 ${
              testState === 'testing' ? 'bg-blue-950/60 border border-blue-800 text-blue-300' :
              testState === 'success' ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300' :
              'bg-red-950/60 border border-red-800 text-red-300'
            }`}>
              {testState === 'testing' && <RefreshCw className="w-4 h-4 animate-spin text-blue-400 flex-shrink-0" />}
              {testState === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
              {testState === 'error' && <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />}
              <span className="truncate">{testMsg}</span>
            </div>
          )}

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
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow-lg transition"
            >
              Crear {channelCount} Canales
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
