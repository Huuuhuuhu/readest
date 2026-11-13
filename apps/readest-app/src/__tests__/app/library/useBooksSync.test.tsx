import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
const { run, active, env } = vi.hoisted(() => ({ run: vi.fn(), active: vi.fn(), env: {} }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: env }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {} }) },
}));
vi.mock('@/services/sync/cloudSyncProvider', () => ({ getActiveFileSyncBackends: active }));
vi.mock('@/services/sync/file/runLibrarySync', () => ({ runFileLibrarySyncPass: run }));
import { useBooksSync } from '@/app/library/hooks/useBooksSync';
beforeEach(() => {
  vi.clearAllMocks();
  active.mockReturnValue(['webdav']);
  run.mockResolvedValue(null);
});
describe('independent manual library sync', () => {
  it('does nothing when no backend was configured', async () => {
    active.mockReturnValue([]);
    await renderHook(useBooksSync).result.current.pullLibrary();
    expect(run).not.toHaveBeenCalled();
  });
  it('forwards full refresh and coalesces concurrent requests', async () => {
    let finish!: () => void;
    run.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const { result } = renderHook(useBooksSync);
    const first = result.current.pullLibrary(true);
    const second = result.current.pushLibrary();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(env, expect.any(Function), true);
    finish();
    await Promise.all([first, second]);
  });
  it('releases the request guard after failure so retry is possible', async () => {
    const { result } = renderHook(useBooksSync);
    run.mockRejectedValueOnce(new Error('offline'));
    await expect(result.current.pullLibrary()).rejects.toThrow('offline');
    await result.current.pullLibrary();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
