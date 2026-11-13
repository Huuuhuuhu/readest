import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { useSidebarStore } from '@/store/sidebarStore';
import useSidebar from '@/app/reader/hooks/useSidebar';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({ settings: { globalReadSettings: {} } }),
}));
vi.mock('@/helpers/settings', () => ({ saveSysSettings: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  useSidebarStore.setState({ isSideBarVisible: false, isSideBarPinned: false });
});

describe('sidebar on opening a book', () => {
  it('starts a TV in the book even when a desktop sidebar preference is pinned', () => {
    vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'true');
    renderHook(() => useSidebar('15%', true));
    expect(useSidebarStore.getState().isSideBarVisible).toBe(false);
  });

  it('keeps the pinned desktop sidebar visible', () => {
    vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'false');
    renderHook(() => useSidebar('15%', true));
    expect(useSidebarStore.getState().isSideBarVisible).toBe(true);
  });
});
