import { useState, useEffect } from 'react';
import type { Camera, VendorPreset } from '../types/cctv';
import { buildPresetRtspUrls, registerStream } from '../services/go2rtc';
import { X, CheckCircle, AlertCircle, RefreshCw, Video } from 'lucide-react';

interface CameraModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (camera: Camera) => void;
  cameraToEdit?: Camera | null;
  existingGroups: string[];
}

export const CameraModal: React.FC<CameraModalProps> = ({
  isOpen,
  onClose,
  onSave,
  cameraToEdit,
  existingGroups,
}) => {
  const [name, setName] = useState('');
  const [group, setGroup] = useState('');
  const [newGroupInput, setNewGroupInput] = useState('');
  const [vendorPreset, setVendorPreset] = useState<VendorPreset>('hikvision');
  const [ip, setIp] = useState('192.168.1.100');
  const [port, setPort] = useState(554);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [channel, setChannel] = useState(1);
  const [mainStreamUrl, setMainStreamUrl] = useState('');
  const [subStreamUrl, setSubStreamUrl] = useState('');
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [isManualUrl, setIsManualUrl] = useState(false);

  const [testState, setTestState] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testMsg, setTestMsg] = useState('');

  // Populate data when editing or opening
  useEffect(() => {
    if (cameraToEdit) {
      setName(cameraToEdit.name);
      setGroup(cameraToEdit.group);
      setVendorPreset(cameraToEdit.vendorPreset);
      setIp(cameraToEdit.ip || '192.168.1.100');
      setPort(cameraToEdit.port || 554);
      setUsername(cameraToEdit.username || 'admin');
      setPassword(cameraToEdit.password || '');
      setChannel(cameraToEdit.channel || 1);
      setMainStreamUrl(cameraToEdit.mainStreamUrl);
      setSubStreamUrl(cameraToEdit.subStreamUrl);
      setAudioEnabled(cameraToEdit.audioEnabled ?? true);
      setIsManualUrl(cameraToEdit.vendorPreset === 'custom');
    } else {
      setName('Nueva Cámara');
      setGroup(existingGroups[0] || 'DVR Principal');
      setVendorPreset('hikvision');
      setIp('192.168.1.100');
      setPort(554);
      setUsername('admin');
      setPassword('');
      setChannel(1);
      setAudioEnabled(true);
      setIsManualUrl(false);
      updatePresetUrls('hikvision', '192.168.1.100', 554, 'admin', '', 1);
    }
    setTestState('idle');
    setTestMsg('');
  }, [cameraToEdit, isOpen]);

  // Recalculate URLs when preset parameters change
  const updatePresetUrls = (
    preset: VendorPreset,
    ipVal: string,
    portVal: number,
    userVal: string,
    passVal: string,
    chVal: number
  ) => {
    if (preset === 'custom') {
      setIsManualUrl(true);
      return;
    }
    const generated = buildPresetRtspUrls(preset, ipVal, portVal, userVal, passVal, chVal);
    setMainStreamUrl(generated.main);
    setSubStreamUrl(generated.sub);
  };

  const handleParamChange = (field: string, val: any) => {
    let p = vendorPreset;
    let i = ip;
    let pt = port;
    let u = username;
    let pw = password;
    let c = channel;

    if (field === 'preset') {
      p = val;
      setVendorPreset(val);
      if (val === 'custom') {
        setIsManualUrl(true);
        return;
      } else {
        setIsManualUrl(false);
      }
    }
    if (field === 'ip') { i = val; setIp(val); }
    if (field === 'port') { pt = Number(val); setPort(Number(val)); }
    if (field === 'username') { u = val; setUsername(val); }
    if (field === 'password') { pw = val; setPassword(val); }
    if (field === 'channel') { c = Number(val); setChannel(Number(val)); }

    if (!isManualUrl && p !== 'custom') {
      updatePresetUrls(p, i, pt, u, pw, c);
    }
  };

  // Test stream in go2rtc by requesting a real video frame
  const handleTestConnection = async () => {
    setTestState('testing');
    setTestMsg('Probando autenticación y flujo de video con la cámara...');
    try {
      await registerStream('test_probe', mainStreamUrl);
      const res = await fetch(`http://127.0.0.1:1984/api/frame.mp4?src=test_probe`, {
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) {
        setTestState('success');
        setTestMsg('¡Conexión exitosa! La cámara respondió 200 OK y está transmitiendo video.');
      } else {
        setTestState('error');
        setTestMsg('La cámara rechazó la conexión. Verifique la marca (Dahua vs Hikvision), usuario o contraseña.');
      }
    } catch {
      setTestState('error');
      setTestMsg('Sin respuesta de video. Verifique si la marca correcta es Dahua o Hikvision.');
    }
  };

  // Auto-detect vendor preset
  const handleAutoDetect = async () => {
    setTestState('testing');
    setTestMsg('Escaneando protocolos (Dahua, Hikvision, Uniview)...');

    const presetsToTry: VendorPreset[] = ['dahua', 'hikvision', 'uniview'];

    for (const p of presetsToTry) {
      setTestMsg(`Probando protocolo ${p.toUpperCase()}...`);
      const urls = buildPresetRtspUrls(p, ip, port, username, password, channel);
      try {
        await registerStream('auto_probe', urls.main);
        const res = await fetch(`http://127.0.0.1:1984/api/frame.mp4?src=auto_probe`, {
          signal: AbortSignal.timeout(3500),
        });
        if (res.ok) {
          setVendorPreset(p);
          setIsManualUrl(false);
          setMainStreamUrl(urls.main);
          setSubStreamUrl(urls.sub);
          setTestState('success');
          setTestMsg(`¡Marca detectada con éxito: ${p.toUpperCase()}! URLs configuradas automáticamente.`);
          return;
        }
      } catch {
        // Try next
      }
    }

    setTestState('error');
    setTestMsg('No se detectó respuesta automática. Verifique la IP, usuario y contraseña.');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalGroup = group === '__new__' ? newGroupInput.trim() || 'General' : group;

    const cameraData: Camera = {
      id: cameraToEdit ? cameraToEdit.id : `cam-${Date.now()}`,
      name: name.trim() || 'Cámara sin nombre',
      group: finalGroup,
      vendorPreset,
      ip: ip.trim(),
      port,
      username,
      password,
      channel,
      mainStreamUrl: mainStreamUrl.trim(),
      subStreamUrl: subStreamUrl.trim() || mainStreamUrl.trim(),
      audioEnabled,
      aspectRatio: '16:9',
      enabled: true,
    };

    onSave(cameraData);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center space-x-2">
            <Video className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-bold text-white">
              {cameraToEdit ? 'Editar Cámara / DVR' : 'Añadir Nueva Cámara / DVR'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs text-slate-300">
          {/* Name & Group */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold mb-1 text-slate-400">Nombre de la Cámara</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Cámara 01 - Entrada"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block font-semibold mb-1 text-slate-400">Grupo / DVR / NVR</label>
              <select
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              >
                {existingGroups.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
                <option value="__new__">+ Crear Nuevo Grupo...</option>
              </select>

              {group === '__new__' && (
                <input
                  type="text"
                  placeholder="Nombre del nuevo grupo"
                  value={newGroupInput}
                  onChange={(e) => setNewGroupInput(e.target.value)}
                  className="mt-2 w-full bg-slate-950 border border-blue-600 rounded-lg px-3 py-1.5 text-white placeholder-slate-500 text-xs focus:outline-none"
                  autoFocus
                />
              )}
            </div>
          </div>

          {/* Preset Selector */}
          <div>
            <label className="block font-semibold mb-1 text-slate-400">Fabricante / Plantilla RTSP</label>
            <div className="grid grid-cols-4 gap-2">
              {[
                { id: 'hikvision', label: 'Hikvision / Hilook' },
                { id: 'dahua', label: 'Dahua / Amcrest' },
                { id: 'uniview', label: 'Uniview (UNV)' },
                { id: 'custom', label: 'RTSP Manual' },
              ].map((p) => (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => handleParamChange('preset', p.id)}
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

          {/* Connection Parameters */}
          {vendorPreset !== 'custom' && (
            <div className="p-3 bg-slate-950/80 border border-slate-800 rounded-lg space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">IP o Host del DVR</label>
                  <input
                    type="text"
                    value={ip}
                    onChange={(e) => handleParamChange('ip', e.target.value)}
                    placeholder="192.168.1.100"
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Puerto RTSP</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => handleParamChange('port', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Usuario</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => handleParamChange('username', e.target.value)}
                    placeholder="admin"
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Contraseña</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => handleParamChange('password', e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-400 mb-0.5">Canal DVR</label>
                  <input
                    type="number"
                    min="1"
                    max="64"
                    value={channel}
                    onChange={(e) => handleParamChange('channel', e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Generated or Manual URLs */}
          <div className="space-y-2">
            <div>
              <div className="flex justify-between items-center mb-0.5">
                <label className="text-[11px] font-semibold text-slate-400">
                  URL Flujo Principal (Main-stream 1080p/4K)
                </label>
                <span className="text-[10px] text-emerald-400 font-mono">Usado al maximizar</span>
              </div>
              <input
                type="text"
                required
                value={mainStreamUrl}
                onChange={(e) => {
                  setMainStreamUrl(e.target.value);
                  setIsManualUrl(true);
                }}
                placeholder="rtsp://admin:pass@192.168.1.100:554/Streaming/Channels/101"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-0.5">
                <label className="text-[11px] font-semibold text-slate-400">
                  URL Flujo Secundario (Sub-stream 360p/720p)
                </label>
                <span className="text-[10px] text-blue-400 font-mono">Usado en cuadrícula</span>
              </div>
              <input
                type="text"
                value={subStreamUrl}
                onChange={(e) => {
                  setSubStreamUrl(e.target.value);
                  setIsManualUrl(true);
                }}
                placeholder="rtsp://admin:pass@192.168.1.100:554/Streaming/Channels/102"
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Audio toggle & Test Probe */}
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={audioEnabled}
                onChange={(e) => setAudioEnabled(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-blue-600 focus:ring-0"
              />
              <span className="text-xs text-slate-300">Habilitar canal de audio si está disponible</span>
            </label>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleAutoDetect}
                disabled={testState === 'testing' || !ip}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-950/80 hover:bg-blue-900 text-blue-300 border border-blue-700/60 rounded-lg text-xs font-semibold transition"
                title="Prueba automáticamente si la cámara es Dahua, Hikvision o Uniview"
              >
                <span>🔍 Auto-Detectar Marca</span>
              </button>

              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testState === 'testing' || !mainStreamUrl}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700 transition"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${testState === 'testing' ? 'animate-spin' : ''}`} />
                <span>Probar Flujo RTSP</span>
              </button>
            </div>
          </div>

          {/* Test Status Banner */}
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

          {/* Modal Actions */}
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
              Guardar Cámara
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
