import React, { useState, useEffect, useMemo } from 'react';
import type { Camera, VendorPreset } from '../types/cctv';
import { INITIAL_CAMERAS } from '../services/storage';
import { getActiveStreams, checkGo2RtcHealth, validateDvrCredentials, buildPresetRtspUrls, restartGo2Rtc } from '../services/go2rtc';
import { 
  type AppSettings, 
  sendWhatsAppNotification, 
  closeAppCleanly,
  getLocalWhatsAppQr,
  logoutLocalWhatsApp,
  validateDestinationPhone,
  type PhoneValidation,
  type WhatsAppGatewayStatus
} from '../services/notifications';
import { checkAppUpdate, installAppUpdate, type UpdateStatus } from '../services/updater';
import { 
  X, 
  Trash2, 
  Edit3, 
  Download, 
  Upload, 
  RotateCcw, 
  Cpu, 
  Radio, 
  Plus,
  ShieldCheck,
  Server,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Video,
  ChevronDown,
  ChevronRight,
  Wrench,
  Bell,
  Send,
  Power,
  Smartphone,
  Check,
  QrCode,
  MessageSquare
} from 'lucide-react';

export interface DvrSummary {
  groupName: string;
  ip: string;
  port: number;
  vendorPreset: VendorPreset;
  username: string;
  password?: string;
  channelCount: number;
  cameras: Camera[];
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameras: Camera[];
  onUpdateCameras: (newCameras: Camera[]) => void;
  onEditDvr: (groupName: string) => void;
  onDeleteDvr: (groupName: string) => void;
  onOpenAddDvr: () => void;
  onOpenMaintenance?: (groupName: string) => void;
  onEditCamera?: (camera: Camera) => void;
  appSettings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
  initialTab?: 'dvrs' | 'channels' | 'notifications' | 'updates';
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  cameras,
  onUpdateCameras,
  onEditDvr,
  onDeleteDvr,
  onOpenAddDvr,
  onOpenMaintenance,
  appSettings,
  onUpdateSettings,
  initialTab = 'dvrs',
}) => {
  const [viewTab, setViewTab] = useState<'dvrs' | 'channels' | 'notifications' | 'updates'>(initialTab);

  useEffect(() => {
    if (isOpen && initialTab) {
      setViewTab(initialTab);
    }
  }, [isOpen, initialTab]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState<boolean>(false);
  const [installingUpdate, setInstallingUpdate] = useState<boolean>(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [filterGroup, setFilterGroup] = useState<string>('all');
  const [_configFilePath, setConfigFilePath] = useState<string>('cameras.json');
  const [go2rtcOnline, setGo2RtcOnline] = useState<boolean>(true);
  const [activeStreamsCount, setActiveStreamsCount] = useState<number>(0);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const [testingDvr, setTestingDvr] = useState<string | null>(null);
  const [dvrStatusMap, setDvrStatusMap] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [expandedDvrs, setExpandedDvrs] = useState<Record<string, boolean>>({});

  // Local settings copy for edits
  const [localSettings, setLocalSettings] = useState<AppSettings>(appSettings);
  const [testWaStatus, setTestWaStatus] = useState<{ testing: boolean; ok?: boolean; msg?: string } | null>(null);
  const [settingsSavedBadge, setSettingsSavedBadge] = useState<boolean>(false);

  // WhatsApp Gateway Local State
  const [waStatus, setWaStatus] = useState<WhatsAppGatewayStatus>({ connected: false, user: null, hasQr: false });
  const [waQrDataUrl, setWaQrDataUrl] = useState<string | null>(null);
  const [waUnlinking, setWaUnlinking] = useState<boolean>(false);

  // Poll WhatsApp Gateway status and QR when in notifications tab
  useEffect(() => {
    if (!isOpen || viewTab !== 'notifications') return;

    let isMounted = true;
    const fetchWa = async () => {
      const res = await getLocalWhatsAppQr();
      if (isMounted) {
        setWaStatus({
          connected: res.connected,
          user: res.user,
          hasQr: res.hasQr,
        });
        if (res.qr) {
          setWaQrDataUrl(res.qr);
        } else if (res.connected) {
          setWaQrDataUrl(null);
        }
      }
    };

    fetchWa();
    const interval = setInterval(fetchWa, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isOpen, viewTab]);

  const handleUnlinkWhatsApp = async () => {
    if (!window.confirm('¿Deseas desvincular la cuenta de WhatsApp de esta sucursal? Tendrás que volver a escanear un código QR.')) {
      return;
    }
    setWaUnlinking(true);
    await logoutLocalWhatsApp();
    setWaStatus({ connected: false, user: null, hasQr: false });
    setWaQrDataUrl(null);
    setWaUnlinking(false);
  };

  // Load diagnostics & sync settings on open
  useEffect(() => {
    if (isOpen) {
      setLocalSettings(appSettings);
      checkGo2RtcHealth().then(setGo2RtcOnline);
      getActiveStreams().then((streams) => {
        setActiveStreamsCount(Object.keys(streams).length);
      });

      // Query config file path if in Tauri
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke<string>('get_config_file_path').then((p: string) => {
            if (p) setConfigFilePath(p);
          }).catch(() => {});
        });
      }
    }
  }, [isOpen, appSettings]);

  // Summarize DVRs
  const dvrSummaries = useMemo<DvrSummary[]>(() => {
    const map: Record<string, Camera[]> = {};
    for (const c of cameras) {
      const grp = c.group || 'DVR General';
      if (!map[grp]) map[grp] = [];
      map[grp].push(c);
    }

    return Object.entries(map).map(([grp, cams]) => {
      cams.sort((a, b) => a.channel - b.channel);
      const sample = cams[0];
      return {
        groupName: grp,
        ip: sample.ip,
        port: sample.port || 554,
        vendorPreset: sample.vendorPreset || 'dahua',
        username: sample.username || 'admin',
        password: sample.password || '',
        channelCount: cams.length,
        cameras: cams,
      };
    });
  }, [cameras]);

  const groups = useMemo(() => Array.from(new Set(cameras.map((c) => c.group))), [cameras]);

  const filteredCameras = useMemo(() => {
    if (filterGroup === 'all') return cameras;
    return cameras.filter((c) => c.group === filterGroup);
  }, [cameras, filterGroup]);

  // Validate destination phone 1 (Primary / Required)
  const phoneValidation1 = useMemo<PhoneValidation>(
    () => validateDestinationPhone(localSettings.targetPhone),
    [localSettings.targetPhone]
  );

  // Validate destination phone 2 (Secondary / Optional)
  const phoneValidation2 = useMemo<PhoneValidation>(() => {
    if (!localSettings.targetPhone2 || localSettings.targetPhone2.trim().length === 0) {
      return { isValid: true, cleanPhone: '', formatted: '', isNational: false };
    }
    return validateDestinationPhone(localSettings.targetPhone2);
  }, [localSettings.targetPhone2]);

  const isPhoneConfigValid = phoneValidation1.isValid && phoneValidation2.isValid;

  const toggleExpandDvr = (groupName: string) => {
    setExpandedDvrs((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  // Test live connection of a DVR and auto-correct vendor preset if mismatch detected
  const handleTestDvr = async (dvr: DvrSummary) => {
    setTestingDvr(dvr.groupName);
    const res = await validateDvrCredentials(
      dvr.vendorPreset,
      dvr.ip,
      dvr.port,
      dvr.username,
      dvr.password || ''
    );

    if (res.ok && res.detectedVendor && res.detectedVendor !== dvr.vendorPreset) {
      const correctedPreset = res.detectedVendor as VendorPreset;
      const updated = cameras.map((c) => {
        if (c.group === dvr.groupName) {
          const urls = buildPresetRtspUrls(correctedPreset, c.ip, c.port, c.username, c.password, c.channel);
          return {
            ...c,
            vendorPreset: correctedPreset,
            mainStreamUrl: urls.main,
            subStreamUrl: urls.sub,
          };
        }
        return c;
      });
      onUpdateCameras(updated);
    }

    setDvrStatusMap((prev) => ({
      ...prev,
      [dvr.groupName]: { ok: res.ok, msg: res.message },
    }));
    setTestingDvr(null);
  };

  const handleToggleEnabled = (id: string) => {
    const updated = cameras.map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c));
    onUpdateCameras(updated);
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(cameras, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'cctv-cameras-config.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (Array.isArray(imported)) {
          onUpdateCameras(imported);
          setImportStatus(`✓ ${imported.length} cámaras importadas correctamente`);
          setTimeout(() => setImportStatus(null), 3000);
        } else {
          setImportStatus('❌ El archivo no tiene el formato de lista válido');
        }
      } catch {
        setImportStatus('❌ Error al procesar el archivo JSON');
      }
    };
    reader.readAsText(file);
  };

  const handleResetDefaults = () => {
    if (window.confirm('¿Restablecer cámaras a la configuración de prueba inicial?')) {
      onUpdateCameras(INITIAL_CAMERAS);
    }
  };

  // Settings Save
  const handleSaveLocalSettings = () => {
    if (localSettings.whatsappEnabled && !phoneValidation1.isValid) {
      alert(`⚠️ El Teléfono Destino 1 no es válido:\n\n${phoneValidation1.errorMessage || 'Debe contener 10 dígitos o formato +52.'}`);
      return;
    }

    if (localSettings.whatsappEnabled && localSettings.targetPhone2 && localSettings.targetPhone2.trim().length > 0 && !phoneValidation2.isValid) {
      alert(`⚠️ El Teléfono Destino 2 no es válido:\n\n${phoneValidation2.errorMessage}`);
      return;
    }

    const settingsToSave: AppSettings = {
      ...localSettings,
      targetPhone: phoneValidation1.isValid ? phoneValidation1.cleanPhone : localSettings.targetPhone,
      targetPhone2: phoneValidation2.isValid && phoneValidation2.cleanPhone ? phoneValidation2.cleanPhone : '',
    };
    setLocalSettings(settingsToSave);
    onUpdateSettings(settingsToSave);
    setSettingsSavedBadge(true);
    setTimeout(() => setSettingsSavedBadge(false), 2500);
  };

  // Test WhatsApp
  const handleTestWhatsApp = async () => {
    if (!phoneValidation1.isValid) {
      setTestWaStatus({
        testing: false,
        ok: false,
        msg: phoneValidation1.errorMessage || 'Ingresa un número válido en Teléfono Destino 1.',
      });
      return;
    }

    if (localSettings.targetPhone2 && localSettings.targetPhone2.trim().length > 0 && !phoneValidation2.isValid) {
      setTestWaStatus({
        testing: false,
        ok: false,
        msg: phoneValidation2.errorMessage || 'El Teléfono Destino 2 no es válido.',
      });
      return;
    }

    setTestWaStatus({ testing: true });
    const testMsg = `🔔 *Prueba de Alerta CCTV*\n━━━━━━━━━━━━━━━━━━\n📍 *Sede:* ${localSettings.branchName}\n✅ ¡Notificaciones de WhatsApp activas y funcionando correctamente en este equipo!`;
    const res = await sendWhatsAppNotification(
      {
        ...localSettings,
        targetPhone: phoneValidation1.cleanPhone,
        targetPhone2: phoneValidation2.cleanPhone || '',
      },
      testMsg
    );
    setTestWaStatus({ testing: false, ok: res.ok, msg: res.message });
  };

  // Full clean exit
  const handleCloseProcessesAndExit = () => {
    if (window.confirm('¿Deseas cerrar el programa y detener todos los procesos de fondo (go2rtc, monitoreo y bandeja)?')) {
      closeAppCleanly();
    }
  };

  // Check and install updates via GitHub
  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateMsg(null);
    try {
      const res = await checkAppUpdate();
      setUpdateStatus(res);
      if (!res.available) {
        setUpdateMsg('✓ Tu aplicación ya cuenta con la última versión disponible.');
      }
    } catch (err: any) {
      setUpdateMsg(`No se pudo verificar: ${err?.message || err}`);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    setInstallingUpdate(true);
    try {
      await installAppUpdate();
    } catch (err: any) {
      alert(`Error al descargar o instalar la actualización: ${err?.message || err}`);
      setInstallingUpdate(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 text-blue-400">
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Panel de Control y Ajustes del Sistema</h3>
              <p className="text-xs text-slate-400">
                Administración de grabadores, auditoría de video y notificaciones
              </p>
            </div>
          </div>

          {/* Minimalist Top Action Buttons */}
          <div className="flex items-center space-x-2">
            {/* WhatsApp Alerts Icon Button */}
            <button
              type="button"
              onClick={() => setViewTab(viewTab === 'notifications' ? 'dvrs' : 'notifications')}
              className={`p-2 rounded-lg border transition relative flex items-center justify-center ${
                viewTab === 'notifications'
                  ? 'bg-emerald-600/30 text-emerald-400 border-emerald-500/60 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
                  : 'bg-slate-900 text-slate-400 hover:text-white border-slate-800 hover:border-slate-700'
              }`}
              title="Vincular WhatsApp y Alertas"
            >
              <MessageSquare className="w-4 h-4" />
              {waStatus.connected && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-slate-950" />
              )}
            </button>

            {/* Updates Center Icon Button */}
            <button
              type="button"
              onClick={() => setViewTab(viewTab === 'updates' ? 'dvrs' : 'updates')}
              className={`p-2 rounded-lg border transition relative flex items-center justify-center ${
                viewTab === 'updates'
                  ? 'bg-purple-600/30 text-purple-400 border-purple-500/60 shadow-[0_0_12px_rgba(168,85,247,0.25)]'
                  : 'bg-slate-900 text-slate-400 hover:text-white border-slate-800 hover:border-slate-700'
              }`}
              title="Centro de Actualizaciones"
            >
              <RefreshCw className={`w-4 h-4 ${checkingUpdate ? 'animate-spin text-purple-400' : ''}`} />
              {updateStatus?.available && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-purple-400 ring-2 ring-slate-950 animate-pulse" />
              )}
            </button>

            <div className="h-5 w-[1px] bg-slate-800 mx-1" />

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              title="Cerrar ajustes"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Diagnostic Bar */}
        <div className="px-6 py-2 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1.5">
              <Cpu className="w-3.5 h-3.5 text-slate-400" />
              <span>Motor go2rtc:</span>
              <span className={`font-semibold flex items-center space-x-1 ${go2rtcOnline ? 'text-emerald-400' : 'text-red-400'}`}>
                <span className={`w-2 h-2 rounded-full ${go2rtcOnline ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
                <span>{go2rtcOnline ? 'En Línea (1984)' : 'Detenido'}</span>
              </span>
              {!go2rtcOnline && (
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await restartGo2Rtc();
                    setGo2RtcOnline(ok);
                  }}
                  className="ml-2 px-2 py-0.5 bg-red-600 hover:bg-red-500 text-[10px] text-white font-bold rounded shadow transition cursor-pointer"
                >
                  Iniciar Motor
                </button>
              )}
            </div>

            <div className="flex items-center space-x-1.5">
              <Radio className="w-3.5 h-3.5 text-blue-400" />
              <span>Flujos Activos:</span>
              <strong className="text-white">{activeStreamsCount}</strong>
            </div>
          </div>

          {importStatus && (
            <span className="font-semibold text-xs text-cyan-400 animate-in fade-in">
              {importStatus}
            </span>
          )}
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1 text-xs">
          {/* Main Action Tabs */}
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewTab('dvrs')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-bold transition ${
                  viewTab === 'dvrs'
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <span>Grabadores DVR / NVR ({dvrSummaries.length})</span>
              </button>

              <button
                onClick={() => setViewTab('channels')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg font-bold transition ${
                  viewTab === 'channels'
                    ? 'bg-blue-600 text-white shadow'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                <Video className="w-3.5 h-3.5" />
                <span>Todos los Canales ({cameras.length})</span>
              </button>
            </div>

            {/* Backup & Add Buttons */}
            {viewTab !== 'notifications' && viewTab !== 'updates' && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    onClose();
                    onOpenAddDvr();
                  }}
                  className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-bold shadow transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>+ Agregar Grabador</span>
                </button>

                <button
                  onClick={handleExportJson}
                  className="flex items-center space-x-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg font-semibold transition"
                  title="Exportar archivo de configuración JSON"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Exportar</span>
                </button>

                <label className="flex items-center space-x-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg font-semibold cursor-pointer transition">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Importar</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportJson}
                    className="hidden"
                  />
                </label>

                <button
                  onClick={handleResetDefaults}
                  className="p-1.5 bg-slate-800 hover:bg-red-950 text-slate-400 hover:text-red-300 border border-slate-700 rounded-lg font-semibold transition"
                  title="Restablecer configuración de fábrica"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* TAB 1: DVR EQUIPMENT VIEW (Primary) */}
          {viewTab === 'dvrs' && (
            <div className="space-y-3">
              {dvrSummaries.length === 0 ? (
                <div className="p-8 text-center text-slate-500 bg-slate-950/60 rounded-xl border border-slate-800 space-y-2">
                  <Server className="w-8 h-8 text-slate-600 mx-auto" />
                  <p>No hay grabadores configurados.</p>
                  <button
                    onClick={() => {
                      onClose();
                      onOpenAddDvr();
                    }}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded font-bold"
                  >
                    Agregar el Primer Grabador
                  </button>
                </div>
              ) : (
                dvrSummaries.map((dvr) => {
                  const isExpanded = !!expandedDvrs[dvr.groupName];
                  const isTestingThis = testingDvr === dvr.groupName;
                  const testStatus = dvrStatusMap[dvr.groupName];

                  return (
                    <div
                      key={dvr.groupName}
                      className="border border-slate-800 rounded-xl bg-slate-950/60 overflow-hidden transition"
                    >
                      {/* DVR Card Header */}
                      <div className="p-3.5 flex items-center justify-between bg-slate-900/50 hover:bg-slate-900 transition">
                        <div
                          className="flex items-center space-x-3 cursor-pointer flex-1"
                          onClick={() => toggleExpandDvr(dvr.groupName)}
                        >
                          <button className="text-slate-500 hover:text-white">
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                          <div>
                            <div className="flex items-center space-x-2">
                              <h4 className="font-bold text-white text-sm tracking-wide">{dvr.groupName}</h4>
                              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-blue-950 border border-blue-800 text-blue-400 uppercase">
                                {dvr.vendorPreset}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono flex items-center space-x-3 mt-0.5">
                              <span>IP: <strong className="text-slate-200">{dvr.ip}:{dvr.port}</strong></span>
                              <span>Usuario: <strong className="text-slate-200">{dvr.username}</strong></span>
                              <span><strong className="text-emerald-400">{dvr.channelCount}</strong> canales</span>
                            </div>
                          </div>
                        </div>

                        {/* DVR Action Buttons */}
                        <div className="flex items-center space-x-2">
                          {/* Maintenance Hub Button */}
                          {onOpenMaintenance && (
                            <button
                              onClick={() => {
                                onClose();
                                onOpenMaintenance(dvr.groupName);
                              }}
                              className="flex items-center space-x-1 px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg font-bold text-xs transition"
                              title="Auditoría de hora, disco duro y acceso web"
                            >
                              <Wrench className="w-3.5 h-3.5" />
                              <span>🛠️ Mantenimiento</span>
                            </button>
                          )}

                          {/* Live Connection Test Button */}
                          <button
                            onClick={() => handleTestDvr(dvr)}
                            disabled={isTestingThis}
                            className="flex items-center space-x-1 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-blue-400 border border-blue-900/60 rounded-lg font-semibold text-xs transition"
                            title="Probar credenciales y conectividad en vivo"
                          >
                            <RefreshCw className={`w-3 h-3 ${isTestingThis ? 'animate-spin' : ''}`} />
                            <span>{isTestingThis ? 'Probando...' : 'Probar'}</span>
                          </button>

                          {/* Edit Whole DVR Button */}
                          <button
                            onClick={() => {
                              onClose();
                              onEditDvr(dvr.groupName);
                            }}
                            className="flex items-center space-x-1 px-2.5 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 rounded-lg font-semibold text-xs transition"
                            title="Modificar IP, usuario, contraseña o marca de todas las cámaras de este grabador"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Editar</span>
                          </button>

                          {/* Delete Whole DVR Button */}
                          <button
                            onClick={() => {
                              if (window.confirm(`¿Deseas eliminar el grabador "${dvr.groupName}" y sus ${dvr.channelCount} cámaras asociadas?`)) {
                                onDeleteDvr(dvr.groupName);
                              }
                            }}
                            className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition"
                            title="Eliminar este grabador y todas sus cámaras"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Connection Test Status feedback */}
                      {testStatus && (
                        <div className={`px-4 py-2 text-xs flex items-center space-x-2 border-t border-slate-800/80 ${
                          testStatus.ok ? 'bg-emerald-950/40 text-emerald-300' : 'bg-red-950/40 text-red-300'
                        }`}>
                          {testStatus.ok ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                          <span>{testStatus.msg}</span>
                        </div>
                      )}

                      {/* Expanded Channels List */}
                      {isExpanded && (
                        <div className="p-3 bg-slate-950/90 border-t border-slate-800 space-y-1">
                          <p className="text-[11px] text-slate-400 font-semibold mb-2">
                            Canales registrados en este grabador ({dvr.cameras.length}):
                          </p>
                          {dvr.cameras.map((cam) => (
                            <div
                              key={cam.id}
                              className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800 text-[11px]"
                            >
                              <div className="flex items-center space-x-2">
                                <span className="font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                                  CH {cam.channel.toString().padStart(2, '0')}
                                </span>
                                <span className={`font-semibold ${cam.enabled ? 'text-white' : 'text-slate-500 line-through'}`}>
                                  {cam.name}
                                </span>
                              </div>
                              <span className="font-mono text-slate-500 truncate max-w-sm" title={cam.mainStreamUrl}>
                                {cam.mainStreamUrl}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* TAB 2: ALL CHANNELS TABLE */}
          {viewTab === 'channels' && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <span className="font-semibold text-slate-300">Filtrar por Grabador:</span>
                <select
                  value={filterGroup}
                  onChange={(e) => setFilterGroup(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-white text-xs focus:outline-none"
                >
                  <option value="all">Todos los grabadores ({cameras.length})</option>
                  {groups.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>

              <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/70">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-slate-400 border-b border-slate-800 text-[11px]">
                      <th className="py-2.5 px-3">Estado</th>
                      <th className="py-2.5 px-3">Nombre</th>
                      <th className="py-2.5 px-3">Grabador / Sede</th>
                      <th className="py-2.5 px-3">Marca</th>
                      <th className="py-2.5 px-3">RTSP Stream</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredCameras.map((cam) => (
                      <tr key={cam.id} className="hover:bg-slate-900/40 transition">
                        <td className="py-2 px-3">
                          <input
                            type="checkbox"
                            checked={cam.enabled}
                            onChange={() => handleToggleEnabled(cam.id)}
                            className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0 cursor-pointer"
                          />
                        </td>
                        <td className="py-2 px-3 font-semibold text-white">{cam.name}</td>
                        <td className="py-2 px-3">
                          <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800/80 border border-slate-700 text-slate-300">
                            {cam.group}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-400 capitalize">{cam.vendorPreset}</td>
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-400 truncate max-w-xs" title={cam.mainStreamUrl}>
                          {cam.mainStreamUrl}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: NOTIFICATIONS & 24/7 BACKGROUND MONITORING */}
          {viewTab === 'notifications' && (
            <div className="space-y-4">
              {/* Card 1: Branch Identification */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
                <div className="flex items-center space-x-2 text-slate-200 font-bold text-xs">
                  <Smartphone className="w-4 h-4 text-cyan-400" />
                  <span>Identificación de la Sucursal / Instalación</span>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                    Nombre de la Sede / Sucursal (Aparecerá en los encabezados de WhatsApp):
                  </label>
                  <input
                    type="text"
                    value={localSettings.branchName}
                    onChange={(e) => setLocalSettings({ ...localSettings, branchName: e.target.value })}
                    placeholder="Ej. Sucursal Monterrey - Bodega 2"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white font-semibold text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Card 2: WhatsApp Gateway Configuration */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-slate-200 font-bold text-xs">
                    <Bell className="w-4 h-4 text-emerald-400" />
                    <span>Configuración de Alertas por WhatsApp</span>
                  </div>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSettings.whatsappEnabled}
                      onChange={(e) => setLocalSettings({ ...localSettings, whatsappEnabled: e.target.checked })}
                      className="rounded bg-slate-900 border-slate-700 text-emerald-500 focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                    <span className="font-bold text-emerald-400 text-xs">Activar WhatsApp</span>
                  </label>
                </div>

                {localSettings.whatsappEnabled && (
                  <div className="space-y-4 pt-2 border-t border-slate-800/80 animate-in fade-in">
                    {/* Gateway Local QR Section */}
                    <div className="space-y-3">
                        {waStatus.connected ? (
                          /* Connected State */
                          <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                                <CheckCircle className="w-5 h-5" />
                              </div>
                              <div>
                                <div className="flex items-center space-x-2">
                                  <span className="font-bold text-white text-xs">WhatsApp Vinculado con Éxito</span>
                                  <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-mono font-bold">
                                    En Línea
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-300">
                                  Emisor activo: <strong className="text-emerald-400 font-mono">{waStatus.user}</strong> (Las alertas saldrán desde esta cuenta)
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={handleUnlinkWhatsApp}
                              disabled={waUnlinking}
                              className="px-3 py-1.5 bg-red-950/50 hover:bg-red-900/70 text-red-300 border border-red-700/60 rounded-lg text-xs font-semibold transition"
                            >
                              {waUnlinking ? 'Desvinculando...' : 'Desvincular WhatsApp'}
                            </button>
                          </div>
                        ) : (
                          /* QR Code Pairing Box */
                          <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <QrCode className="w-4 h-4 text-emerald-400" />
                                <span className="font-bold text-white text-xs">Vincular WhatsApp de esta Sucursal</span>
                              </div>
                              <span className="text-[10px] text-amber-400 font-semibold bg-amber-950/40 border border-amber-800 px-2 py-0.5 rounded animate-pulse">
                                Esperando escaneo...
                              </span>
                            </div>

                            <div className="flex flex-col sm:flex-row items-center gap-5 bg-slate-950 p-4 rounded-xl border border-slate-800/80">
                              <div className="flex-shrink-0 flex flex-col items-center">
                                {waQrDataUrl ? (
                                  <img
                                    src={waQrDataUrl}
                                    alt="Código QR para vincular WhatsApp"
                                    className="w-44 h-44 rounded-lg bg-white p-2 shadow-lg border border-slate-700"
                                  />
                                ) : (
                                  <div className="w-44 h-44 rounded-lg bg-slate-900 border border-slate-800 flex flex-col items-center justify-center p-4 text-center">
                                    <RefreshCw className="w-6 h-6 text-emerald-500 animate-spin mb-2" />
                                    <span className="text-[11px] text-slate-400">Generando código QR...</span>
                                  </div>
                                )}
                                <span className="text-[10px] text-slate-500 mt-1.5 font-mono">
                                  Refresco automático en tiempo real
                                </span>
                              </div>

                              <div className="space-y-2 text-slate-300 text-xs flex-1">
                                <p className="font-bold text-white text-sm">
                                  📱 Instrucciones para vincular:
                                </p>
                                <ol className="list-decimal list-inside space-y-1.5 text-[11px] text-slate-300">
                                  <li>Abre WhatsApp en el celular que emitirá las alertas de esta empresa.</li>
                                  <li>Toca los tres puntos <strong className="text-white">(⋮)</strong> en Android o ve a <strong className="text-white">Configuración</strong> en iPhone.</li>
                                  <li>Selecciona <strong className="text-emerald-400">Dispositivos vinculados</strong>.</li>
                                  <li>Toca <strong className="text-white">Vincular un dispositivo</strong> y apunta tu cámara hacia este código QR.</li>
                                </ol>
                                <div className="p-2 rounded bg-slate-900/90 border border-slate-800 text-[10px] text-slate-400 mt-2">
                                  🔒 <strong>Privacidad y autonomía:</strong> Cada sucursal vincula su propio teléfono. Las credenciales se almacenan localmente y no dependen de servicios de terceros.
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                    {/* Inputs */}
                    <div className="space-y-3 pt-1">
                      {/* Destination Phones (Max 2) */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {/* Destination Phone 1 */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-[11px] text-slate-300 font-semibold">
                              Teléfono Destino 1 (Principal):
                            </label>
                            {phoneValidation1.isValid && (
                              <span className="text-[10px] text-emerald-400 font-bold flex items-center space-x-1">
                                <CheckCircle className="w-3 h-3" />
                                <span>Válido</span>
                              </span>
                            )}
                          </div>

                          <input
                            type="text"
                            value={localSettings.targetPhone}
                            onChange={(e) => setLocalSettings({ ...localSettings, targetPhone: e.target.value })}
                            placeholder="Ej. 984 252 9252 o +52 984 252 9252"
                            className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none transition ${
                              localSettings.targetPhone.trim().length === 0
                                ? 'border-slate-700 focus:border-emerald-500'
                                : phoneValidation1.isValid
                                ? 'border-emerald-500/80 bg-emerald-950/20'
                                : 'border-amber-500 bg-amber-950/20'
                            }`}
                          />

                          {/* Real-time Validation Feedback 1 */}
                          {localSettings.targetPhone.trim().length > 0 && (
                            <div className="mt-1">
                              {phoneValidation1.isValid ? (
                                <div className="flex items-center space-x-1.5 text-[11px] text-emerald-400">
                                  <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span>
                                    Normalizado: <strong className="font-mono text-white">{phoneValidation1.formatted}</strong>
                                    {phoneValidation1.isNational && <span className="ml-1 text-[10px] text-emerald-300/80">(México +52)</span>}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-1.5 text-[11px] text-amber-400">
                                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span>{phoneValidation1.errorMessage}</span>
                                </div>
                              )}
                            </div>
                          )}

                          <span className="text-[10px] text-slate-500 block mt-1">
                            Receptor principal (ej. Encargado de sucursal)
                          </span>
                        </div>

                        {/* Destination Phone 2 (Optional) */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <label className="block text-[11px] text-slate-300 font-semibold flex items-center space-x-1">
                              <span>Teléfono Destino 2:</span>
                              <span className="text-[10px] text-slate-500 font-normal">(Opcional / Secundario)</span>
                            </label>
                            {localSettings.targetPhone2 && localSettings.targetPhone2.trim().length > 0 && phoneValidation2.isValid && (
                              <span className="text-[10px] text-emerald-400 font-bold flex items-center space-x-1">
                                <CheckCircle className="w-3 h-3" />
                                <span>Válido</span>
                              </span>
                            )}
                          </div>

                          <div className="relative">
                            <input
                              type="text"
                              value={localSettings.targetPhone2 || ''}
                              onChange={(e) => setLocalSettings({ ...localSettings, targetPhone2: e.target.value })}
                              placeholder="Ej. 81 1234 5678 (Opcional)"
                              className={`w-full bg-slate-900 border rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none transition ${
                                !localSettings.targetPhone2 || localSettings.targetPhone2.trim().length === 0
                                  ? 'border-slate-700 focus:border-emerald-500'
                                  : phoneValidation2.isValid
                                  ? 'border-emerald-500/80 bg-emerald-950/20'
                                  : 'border-amber-500 bg-amber-950/20'
                              }`}
                            />
                            {localSettings.targetPhone2 && localSettings.targetPhone2.trim().length > 0 && (
                              <button
                                type="button"
                                onClick={() => setLocalSettings({ ...localSettings, targetPhone2: '' })}
                                className="absolute right-2 top-2 text-slate-500 hover:text-white text-xs px-1"
                                title="Borrar segundo teléfono"
                              >
                                ✕
                              </button>
                            )}
                          </div>

                          {/* Real-time Validation Feedback 2 */}
                          {localSettings.targetPhone2 && localSettings.targetPhone2.trim().length > 0 && (
                            <div className="mt-1">
                              {phoneValidation2.isValid ? (
                                <div className="flex items-center space-x-1.5 text-[11px] text-emerald-400">
                                  <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span>
                                    Normalizado: <strong className="font-mono text-white">{phoneValidation2.formatted}</strong>
                                    {phoneValidation2.isNational && <span className="ml-1 text-[10px] text-emerald-300/80">(México +52)</span>}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center space-x-1.5 text-[11px] text-amber-400">
                                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                                  <span>{phoneValidation2.errorMessage}</span>
                                </div>
                              )}
                            </div>
                          )}

                          <span className="text-[10px] text-slate-500 block mt-1">
                            Segundo receptor (ej. Dueño, Director o Técnico de soporte)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Test Button & Live Feedback */}
                    <div className="flex items-center space-x-3 pt-1">
                      <button
                        type="button"
                        onClick={handleTestWhatsApp}
                        disabled={testWaStatus?.testing}
                        className="flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shadow transition"
                      >
                        <Send className={`w-3.5 h-3.5 ${testWaStatus?.testing ? 'animate-spin' : ''}`} />
                        <span>{testWaStatus?.testing ? 'Enviando prueba...' : '📲 Enviar Alerta de Prueba a WhatsApp Ahora'}</span>
                      </button>

                      {testWaStatus && !testWaStatus.testing && (
                        <span className={`text-xs font-semibold flex items-center space-x-1 ${
                          testWaStatus.ok ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                          {testWaStatus.ok ? <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />}
                          <span>{testWaStatus.msg}</span>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Card 3: 24/7 Background Watchdog Engine */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-slate-200 font-bold text-xs">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    <span>Auditoría Silenciosa Continua (24/7 Watchdog)</span>
                  </div>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSettings.autoMonitorEnabled}
                      onChange={(e) => setLocalSettings({ ...localSettings, autoMonitorEnabled: e.target.checked })}
                      className="rounded bg-slate-900 border-slate-700 text-blue-500 focus:ring-0 w-4 h-4 cursor-pointer"
                    />
                    <span className="font-bold text-blue-400 text-xs">Monitoreo Activo</span>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[11px] text-slate-400 font-semibold mb-1">
                      Frecuencia de sondeo a grabadores:
                    </label>
                    <select
                      value={localSettings.checkIntervalMinutes}
                      onChange={(e) => setLocalSettings({ ...localSettings, checkIntervalMinutes: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none"
                    >
                      <option value={1}>Cada 1 minuto (Tiempo real)</option>
                      <option value={2}>Cada 2 minutos</option>
                      <option value={3}>Cada 3 minutos (Recomendado)</option>
                      <option value={5}>Cada 5 minutos</option>
                      <option value={10}>Cada 10 minutos</option>
                    </select>
                  </div>

                  <div className="space-y-1.5 pt-2">
                    <label className="flex items-center space-x-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={localSettings.alertOnOffline}
                        onChange={(e) => setLocalSettings({ ...localSettings, alertOnOffline: e.target.checked })}
                        className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0"
                      />
                      <span>🚨 Alertar inmediatamente si un grabador cae (Offline)</span>
                    </label>

                    <label className="flex items-center space-x-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={localSettings.alertOnHddFail}
                        onChange={(e) => setLocalSettings({ ...localSettings, alertOnHddFail: e.target.checked })}
                        className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0"
                      />
                      <span>💾 Alertar si el disco duro falla o deja de grabar</span>
                    </label>

                    <label className="flex items-center space-x-2 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={localSettings.alertOnRecovery}
                        onChange={(e) => setLocalSettings({ ...localSettings, alertOnRecovery: e.target.checked })}
                        className="rounded bg-slate-900 border-slate-700 text-blue-600 focus:ring-0"
                      />
                      <span>✅ Notificar cuando el equipo vuelva a estar en línea</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Card 4: Windows Lifecycle & Clean Termination */}
              <div className="p-4 rounded-xl border border-slate-800 bg-slate-950/60 space-y-3">
                <div className="flex items-center space-x-2 text-slate-200 font-bold text-xs">
                  <Power className="w-4 h-4 text-purple-400" />
                  <span>Comportamiento en Windows y Cierre de Procesos</span>
                </div>

                <div className="space-y-2 text-slate-300">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSettings.autostartWindows}
                      onChange={(e) => setLocalSettings({ ...localSettings, autostartWindows: e.target.checked })}
                      className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0"
                    />
                    <span>Iniciar automáticamente con Windows al encender la computadora</span>
                  </label>

                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={localSettings.minimizeToTrayOnClose}
                      onChange={(e) => setLocalSettings({ ...localSettings, minimizeToTrayOnClose: e.target.checked })}
                      className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0"
                    />
                    <span>Minimizar a la bandeja del sistema (junto al reloj) al cerrar con 'X' para no detener la vigilancia</span>
                  </label>
                </div>

                {/* Video Quality Preference */}
                <div className="pt-2 border-t border-slate-800/80 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-slate-200">Modo de calidad al agrandar cámaras:</p>
                      <p className="text-[11px] text-slate-400">
                        Recomendado 'Automático' o 'Siempre Fluido (SD)' para máxima compatibilidad con tarjetas de video antiguas.
                      </p>
                    </div>
                    <select
                      value={localSettings.streamQualityPreference || 'auto'}
                      onChange={(e) => setLocalSettings({ ...localSettings, streamQualityPreference: e.target.value as any })}
                      className="bg-slate-900 border border-slate-700 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-purple-500 font-medium cursor-pointer"
                    >
                      <option value="auto">Automático (HD con cambio a Fluido si no se ve)</option>
                      <option value="sub">Siempre Fluido (SD - 100% compatible sin pantalla negra)</option>
                      <option value="main">Forzar Alta Definición (HD)</option>
                    </select>
                  </div>
                </div>

                {/* Clean Termination Button */}
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500">
                    Si necesitas apagar el programa completamente y liberar todos los recursos de memoria y puertos:
                  </span>
                  <button
                    type="button"
                    onClick={handleCloseProcessesAndExit}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800/80 rounded-lg font-bold text-xs transition"
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>Cerrar Todos los Procesos y Salir</span>
                  </button>
                </div>
              </div>

              {/* Save Settings Bar */}
              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={handleSaveLocalSettings}
                    disabled={localSettings.whatsappEnabled && !isPhoneConfigValid}
                    className={`px-5 py-2 font-bold rounded-lg shadow-lg transition flex items-center space-x-2 ${
                      localSettings.whatsappEnabled && !isPhoneConfigValid
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    <span>Guardar Configuración de Sede y WhatsApp</span>
                  </button>

                  {localSettings.whatsappEnabled && !isPhoneConfigValid && (
                    <span className="text-amber-400 text-xs font-semibold flex items-center space-x-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Corrige los números de destino antes de guardar</span>
                    </span>
                  )}
                </div>

                {settingsSavedBadge && (
                  <span className="text-emerald-400 font-bold flex items-center space-x-1 animate-in fade-in">
                    <CheckCircle className="w-4 h-4" />
                    <span>¡Configuración guardada con éxito!</span>
                  </span>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: Software Updates */}
          {viewTab === 'updates' && (
            <div className="space-y-4 animate-in fade-in duration-150 max-w-xl mx-auto py-2">
              <div className="p-6 rounded-2xl border border-slate-800 bg-slate-950/70 text-center space-y-4 shadow-xl">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-purple-600/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-inner">
                  <RefreshCw className={`w-6 h-6 ${checkingUpdate ? 'animate-spin' : ''}`} />
                </div>

                <div>
                  <h3 className="text-base font-bold text-white">Actualización del Sistema</h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Versión instalada: <strong className="text-emerald-400 font-mono text-sm">{updateStatus?.currentVersion || 'v1.1.5'}</strong>
                  </p>
                </div>

                {/* Primary Action Button */}
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={handleCheckUpdate}
                    disabled={checkingUpdate || installingUpdate}
                    className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center justify-center space-x-2 mx-auto"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin' : ''}`} />
                    <span>{checkingUpdate ? 'Buscando actualizaciones...' : 'Buscar Actualizaciones'}</span>
                  </button>
                </div>

                {/* Status message */}
                {updateMsg && !updateStatus?.available && (
                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-semibold text-slate-300">
                    {updateMsg}
                  </div>
                )}

                {/* Update Available Card */}
                {updateStatus?.available && (
                  <div className="p-5 rounded-xl border border-emerald-500/50 bg-emerald-950/20 text-left space-y-3 animate-in zoom-in-95">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 text-emerald-400 font-bold">
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                        <span>¡Nueva versión disponible: v{updateStatus.version}!</span>
                      </div>
                      <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/40">
                        LISTA PARA INSTALAR
                      </span>
                    </div>

                    {updateStatus.body && (
                      <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3 text-slate-300 text-xs whitespace-pre-wrap">
                        {updateStatus.body}
                      </div>
                    )}

                    <div className="pt-2 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={handleInstallUpdate}
                        disabled={installingUpdate}
                        className="flex items-center space-x-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 text-white font-bold rounded-xl shadow-lg transition text-xs"
                      >
                        <Download className="w-4 h-4" />
                        <span>{installingUpdate ? 'Instalando y Reiniciando...' : 'Descargar e Instalar'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-slate-400 text-xs">
          <span>{dvrSummaries.length} grabadores • {cameras.length} canales totales</span>
          <button
            onClick={onClose}
            className="px-5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg shadow transition"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
