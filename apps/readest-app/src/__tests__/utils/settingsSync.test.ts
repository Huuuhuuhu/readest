import { describe, expect, test, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({ label: 'main' })),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: vi.fn(() => true),
}));

import { mergeSyncedGlobalSettings } from '@/utils/settingsSync';

const local = {
  webdav: { enabled: false, password: 'secret' },
  googleDrive: { enabled: false },
  readestCloud: { enabled: true },
  globalViewSettings: {},
  globalReadSettings: {},
} as unknown as SystemSettings;

const globals = {
  globalViewSettings: {} as SystemSettings['globalViewSettings'],
  globalReadSettings: {} as SystemSettings['globalReadSettings'],
};

describe('mergeSyncedGlobalSettings: icloud', () => {
  test('applies broadcast icloud provider flags', () => {
    const merged = mergeSyncedGlobalSettings(local, {
      ...globals,
      cloudSyncProviders: {
        webdav: { enabled: false },
        googleDrive: { enabled: false },
        icloud: { enabled: true, providerSelectedAt: 123 },
      },
    });
    expect(merged.icloud?.enabled).toBe(true);
    expect(merged.icloud?.providerSelectedAt).toBe(123);
  });

  test('a payload without icloud leaves the local value untouched', () => {
    const withICloud = { ...local, icloud: { enabled: true } } as SystemSettings;
    const merged = mergeSyncedGlobalSettings(withICloud, {
      ...globals,
      cloudSyncProviders: {
        webdav: { enabled: false },
        googleDrive: { enabled: false },
      },
    });
    expect(merged.icloud?.enabled).toBe(true);
  });
});

// Real SystemSettings fixture built from the app's own default-settings
// factories (the same ones `loadSettings` uses), so this exercises the real
// `broadcastGlobalSettings` end to end instead of mocking the whole module.
