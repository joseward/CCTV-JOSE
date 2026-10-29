export interface UpdateStatus {
  checked: boolean;
  checking: boolean;
  available: boolean;
  version?: string;
  currentVersion?: string;
  body?: string;
  error?: string;
}

export async function checkAppUpdate(): Promise<UpdateStatus> {
  try {
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      const { invoke } = await import('@tauri-apps/api/core');
      const res = await invoke<{
        available: boolean;
        version?: string;
        current_version: string;
        body?: string;
      }>('check_update');

      return {
        checked: true,
        checking: false,
        available: res.available,
        version: res.version,
        currentVersion: res.current_version,
        body: res.body,
      };
    }
  } catch (err: any) {
    return {
      checked: true,
      checking: false,
      available: false,
      error: err?.message || String(err),
    };
  }

  return {
    checked: true,
    checking: false,
    available: false,
  };
}

export async function installAppUpdate(): Promise<void> {
  if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('install_update');
  }
}
