export interface AppSettings {
  branchName: string;
  whatsappEnabled: boolean;
  whatsappProvider: 'gateway' | 'callmebot' | 'webhook';
  gatewayUrl: string;
  targetPhone: string;
  targetPhone2?: string;
  apiKey: string;
  instanceName?: string;
  autoMonitorEnabled: boolean;
  checkIntervalMinutes: number;
  alertOnOffline: boolean;
  alertOnHddFail: boolean;
  alertOnTimeDrift: boolean;
  alertOnRecovery: boolean;
  autostartWindows: boolean;
  minimizeToTrayOnClose: boolean;
  streamQualityPreference?: 'auto' | 'sub' | 'main';
}

export const DEFAULT_SETTINGS: AppSettings = {
  branchName: 'Sucursal Principal',
  whatsappEnabled: true,
  whatsappProvider: 'gateway',
  gatewayUrl: 'http://127.0.0.1:8120/message/sendText',
  targetPhone: '',
  targetPhone2: '',
  apiKey: '',
  instanceName: 'cctv-bot',
  autoMonitorEnabled: true,
  checkIntervalMinutes: 3,
  alertOnOffline: true,
  alertOnHddFail: true,
  alertOnTimeDrift: false,
  alertOnRecovery: true,
  autostartWindows: true,
  minimizeToTrayOnClose: true,
  streamQualityPreference: 'auto',
};

export interface PhoneValidation {
  isValid: boolean;
  cleanPhone: string;
  formatted: string;
  errorMessage?: string;
  isNational: boolean;
}

/**
 * Validates and normalizes Mexican and international destination phone numbers.
 * Accepts both 10 national digits (e.g. 984 252 9252) and formats with +52.
 */
export function validateDestinationPhone(input: string): PhoneValidation {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return {
      isValid: false,
      cleanPhone: '',
      formatted: '',
      errorMessage: 'Ingresa el número de WhatsApp destino.',
      isNational: false,
    };
  }

  const digits = trimmed.replace(/[^0-9]/g, '');

  if (digits.length < 10) {
    return {
      isValid: false,
      cleanPhone: digits,
      formatted: trimmed,
      errorMessage: `Número incompleto (${digits.length}/10 dígitos). Ingrese los 10 dígitos locales o con +52.`,
      isNational: false,
    };
  }

  // Case 1: 10 digits (Standard Mexican national format: e.g. 984 252 9252)
  if (digits.length === 10) {
    const formatted = `+52 ${digits.substring(0, 3)} ${digits.substring(3, 6)} ${digits.substring(6)}`;
    return {
      isValid: true,
      cleanPhone: `+52${digits}`,
      formatted,
      isNational: true,
    };
  }

  // Case 2: 12 digits starting with 52 (e.g. +52 984 252 9252 or 529842529252)
  if (digits.startsWith('52') && digits.length === 12) {
    const local = digits.substring(2);
    const formatted = `+52 ${local.substring(0, 3)} ${local.substring(3, 6)} ${local.substring(6)}`;
    return {
      isValid: true,
      cleanPhone: `+52${local}`,
      formatted,
      isNational: true,
    };
  }

  // Case 3: 13 digits starting with 521 (e.g. 5219842529252)
  if (digits.startsWith('521') && digits.length === 13) {
    const local = digits.substring(3);
    const formatted = `+52 ${local.substring(0, 3)} ${local.substring(3, 6)} ${local.substring(6)}`;
    return {
      isValid: true,
      cleanPhone: `+52${local}`,
      formatted,
      isNational: true,
    };
  }

  // Case 4: Other International numbers (11 to 15 digits)
  if (digits.length >= 11 && digits.length <= 15) {
    return {
      isValid: true,
      cleanPhone: `+${digits}`,
      formatted: `+${digits}`,
      isNational: false,
    };
  }

  return {
    isValid: false,
    cleanPhone: digits,
    formatted: trimmed,
    errorMessage: `Longitud no válida (${digits.length} dígitos). Se esperan 10 dígitos para México.`,
    isNational: false,
  };
}

export interface WhatsAppGatewayStatus {
  connected: boolean;
  user: string | null;
  hasQr: boolean;
  qr?: string | null;
}

/**
 * Checks connection status of the local WhatsApp Gateway
 */
export async function getLocalWhatsAppStatus(): Promise<WhatsAppGatewayStatus> {
  try {
    const res = await fetch('http://127.0.0.1:8120/status', { cache: 'no-store' });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {}
  return { connected: false, user: null, hasQr: false };
}

/**
 * Retrieves the current pairing QR code as base64 Data URL
 */
export async function getLocalWhatsAppQr(): Promise<WhatsAppGatewayStatus> {
  try {
    const res = await fetch('http://127.0.0.1:8120/qr', { cache: 'no-store' });
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {}
  return { connected: false, user: null, hasQr: false, qr: null };
}

/**
 * Unlinks WhatsApp session from this branch
 */
export async function logoutLocalWhatsApp(): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch('http://127.0.0.1:8120/logout', { method: 'POST' });
    const data = await res.json();
    return { ok: res.ok, message: data.message || 'Desvinculado con éxito' };
  } catch (e: any) {
    return { ok: false, message: e.message || 'Error al desvincular' };
  }
}

/**
 * Loads persisted settings from disk via Tauri, fallback to localStorage
 */
export async function loadAppSettings(): Promise<AppSettings> {
  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      const jsonStr = await invoke<string>('load_settings');
      if (jsonStr && jsonStr.trim().length > 2) {
        const parsed = JSON.parse(jsonStr);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    }
  } catch (e) {
    console.warn('Error loading settings from Tauri:', e);
  }

  // Fallback to localStorage
  try {
    const local = localStorage.getItem('cctv_app_settings');
    if (local) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(local) };
    }
  } catch (e) {}

  return DEFAULT_SETTINGS;
}

/**
 * Saves settings to disk via Tauri and localStorage
 */
export async function saveAppSettings(settings: AppSettings): Promise<void> {
  const jsonStr = JSON.stringify(settings, null, 2);

  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('save_settings', { settingsJson: jsonStr });
      // Also sync autostart if changed
      try {
        await invoke('set_autostart', { enable: settings.autostartWindows });
      } catch (err) {}
    }
  } catch (e) {
    console.warn('Error saving settings to Tauri:', e);
  }

  try {
    localStorage.setItem('cctv_app_settings', jsonStr);
  } catch (e) {}
}

/**
 * Sends WhatsApp notification via configured gateway (Opción B) or CallMeBot
 */
/**
 * Sends a message to a single destination phone number
 */
async function sendSingleWhatsApp(
  rawPhone: string,
  settings: AppSettings,
  message: string
): Promise<{ ok: boolean; phone: string; message: string }> {
  const validation = validateDestinationPhone(rawPhone);
  if (!validation.isValid) {
    return { ok: false, phone: rawPhone, message: validation.errorMessage || 'Número inválido' };
  }

  const cleanPhone = validation.cleanPhone.replace(/[^0-9]/g, '');

  try {
    if (settings.whatsappProvider === 'callmebot') {
      if (!settings.apiKey) {
        return { ok: false, phone: validation.formatted, message: 'CallMeBot requiere una API Key.' };
      }
      const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodeURIComponent(message)}&apikey=${settings.apiKey}`;
      
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke<string>('fetch_dvr_api', { url, method: 'GET' });
        if (res.toLowerCase().includes('success') || res.toLowerCase().includes('message sent')) {
          return { ok: true, phone: validation.formatted, message: '¡Mensaje enviado con éxito por CallMeBot!' };
        }
        return { ok: true, phone: validation.formatted, message: `Respuesta de CallMeBot: ${res.substring(0, 80)}` };
      }

      const res = await fetch(url);
      const text = await res.text();
      return { ok: true, phone: validation.formatted, message: `Respuesta: ${text.substring(0, 80)}` };

    } else if (settings.whatsappProvider === 'webhook') {
      let url = settings.gatewayUrl;
      url = url.replace('{{phone}}', cleanPhone).replace('{{message}}', encodeURIComponent(message));
      
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('fetch_dvr_api', { url, method: 'GET' });
        return { ok: true, phone: validation.formatted, message: '¡Webhook ejecutado con éxito!' };
      }

      await fetch(url);
      return { ok: true, phone: validation.formatted, message: '¡Webhook ejecutado con éxito!' };

    } else {
      // Opción A/B: Gateway WhatsApp (Baileys / Evolution API)
      if (!settings.gatewayUrl) {
        return { ok: false, phone: validation.formatted, message: 'Debe especificar la URL del gateway de WhatsApp.' };
      }

      let targetUrl = settings.gatewayUrl.trim();
      if (settings.instanceName && targetUrl.includes('{instance}')) {
        targetUrl = targetUrl.replace('{instance}', settings.instanceName);
      }

      const payload = JSON.stringify({
        number: cleanPhone,
        phone: cleanPhone,
        text: message,
        message: message,
      });

      // Try direct browser fetch first
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (settings.apiKey) {
          headers['apikey'] = settings.apiKey;
          headers['Authorization'] = `Bearer ${settings.apiKey}`;
        }
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers,
          body: payload,
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) {
          return { ok: true, phone: validation.formatted, message: 'Enviado con éxito' };
        }
        if (data?.error) {
          return { ok: false, phone: validation.formatted, message: data.error };
        }
      } catch (directErr) {
        // Fallback to Tauri fetch_dvr_api if direct fetch failed
      }

      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const { invoke } = await import('@tauri-apps/api/core');
        const res = await invoke<string>('fetch_dvr_api', {
          url: targetUrl,
          method: 'POST',
          auth: settings.apiKey ? `Bearer ${settings.apiKey}` : undefined,
          body: payload,
          contentType: 'application/json',
        });
        if (res && (res.includes('error') || res.includes('Unauthorized') || res.includes('401') || res.includes('false'))) {
          return { ok: false, phone: validation.formatted, message: `Respuesta del servidor: ${res.substring(0, 100)}` };
        }
        return { ok: true, phone: validation.formatted, message: 'Alerta enviada' };
      }

      return { ok: false, phone: validation.formatted, message: 'No se pudo conectar al servidor de WhatsApp.' };
    }
  } catch (err: any) {
    return { ok: false, phone: validation.formatted, message: err.message || 'Error al enviar' };
  }
}

/**
 * Sends WhatsApp notification to all configured destination numbers (up to 2)
 */
export async function sendWhatsAppNotification(
  settings: AppSettings,
  message: string
): Promise<{ ok: boolean; message: string }> {
  if (!settings.whatsappEnabled) {
    return { ok: false, message: 'Las notificaciones de WhatsApp están desactivadas.' };
  }

  // Collect configured phone numbers (max 2)
  const numbersToSend: string[] = [];
  if (settings.targetPhone && settings.targetPhone.trim().length > 0) {
    numbersToSend.push(settings.targetPhone.trim());
  }
  if (settings.targetPhone2 && settings.targetPhone2.trim().length > 0) {
    numbersToSend.push(settings.targetPhone2.trim());
  }

  if (numbersToSend.length === 0) {
    return { ok: false, message: 'Debe configurar al menos un número de teléfono destino.' };
  }

  const results = await Promise.all(
    numbersToSend.map((num) => sendSingleWhatsApp(num, settings, message))
  );

  const successful = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  if (successful.length === numbersToSend.length) {
    const phonesStr = successful.map((s) => s.phone).join(' y ');
    return {
      ok: true,
      message: numbersToSend.length === 1
        ? `¡Alerta enviada exitosamente a ${phonesStr}!`
        : `¡Alerta enviada exitosamente a los 2 números (${phonesStr})!`,
    };
  }

  if (successful.length > 0) {
    const okPhones = successful.map((s) => s.phone).join(', ');
    const failMsgs = failed.map((f) => `${f.phone}: ${f.message}`).join(', ');
    return {
      ok: true,
      message: `Enviado a ${okPhones}. Hubo problema en: ${failMsgs}`,
    };
  }

  return {
    ok: false,
    message: `No se pudo enviar la alerta: ${failed.map((f) => `${f.phone}: ${f.message}`).join(' | ')}`,
  };
}

/**
 * Triggers a full and clean termination of all desktop processes
 */
export async function closeAppCleanly(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('close_app_completely');
    return;
  }
  window.close();
}
