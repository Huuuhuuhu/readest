import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import type { WordLensManifest, WordLensPack } from '@/services/wordlens/glossPacks';

const mocks = vi.hoisted(() => ({
  appService: {} as AppService,
  view: { wordLensEnabled: false, wordLensLevel: 3, wordLensHintLang: 'zh' },
  settings: { globalReadSettings: { wordLensAutoDownload: false } },
  fetchManifest: vi.fn(),
  getPackStatus: vi.fn(),
  ensurePack: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: mocks.appService, envConfig: {} }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getViewSettings: () => mocks.view, setViewSettings: vi.fn() }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ book: { primaryLanguage: 'en' } }) }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: mocks.settings,
    setSettings: vi.fn(),
    saveSettings: vi.fn(),
  }),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/services/wordlens/glossPacks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/wordlens/glossPacks')>()),
  fetchManifest: mocks.fetchManifest,
  getPackStatus: mocks.getPackStatus,
  ensurePack: mocks.ensurePack,
}));

import WordLensPanel from '@/components/settings/WordLensPanel';
import { installTVInput, registerTVScope } from '@/utils/tvInput';

const pack: WordLensPack = {
  pair: 'en-zh',
  source: 'en',
  target: 'zh',
  file: 'en-zh.json',
  bytes: 100,
  entries: 1,
  sha256: 'test-sha',
};
const manifest: WordLensManifest = { schemaVersion: 1, packs: [pack] };

beforeEach(() => {
  mocks.fetchManifest.mockReset().mockResolvedValue(null);
  mocks.getPackStatus.mockReset().mockResolvedValue(null);
  mocks.ensurePack.mockReset().mockResolvedValue('wordlens/en-zh.json');
});
afterEach(cleanup);

describe('Word Lens public resources', () => {
  it('owns TV focus and Back instead of letting the settings dialog or reader handle it', async () => {
    vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'true');
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 40,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 200,
      bottom: 40,
      toJSON: () => ({}),
    });
    HTMLElement.prototype.scrollIntoView = vi.fn();
    const parentBack = vi.fn();
    const onBack = vi.fn();
    const stop = installTVInput(document);
    const removeParent = registerTVScope({
      element: document.body,
      priority: 100,
      onBack: parentBack,
    });
    try {
      render(<WordLensPanel bookKey='book' onBack={onBack} />);
      const back = screen.getByRole('button', { name: 'Language' });
      await waitFor(() => expect(document.activeElement).toBe(back));
      const refresh = screen.getByRole('button', { name: 'Refresh' });
      refresh.focus();
      const child = document.createElement('div');
      child.innerHTML = '<button>Color dialog</button>';
      document.body.append(child);
      const childBack = vi.fn();
      const removeChild = registerTVScope({ element: child, priority: 100, onBack: childBack });
      try {
        await act(async () => {
          await Promise.resolve();
          fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
          fireEvent.keyUp(document.activeElement!, { key: 'Escape' });
        });
        expect(childBack).toHaveBeenCalledOnce();
        expect(onBack).not.toHaveBeenCalled();
      } finally {
        removeChild();
        child.remove();
      }
      await act(async () => {
        fireEvent.keyDown(refresh, { key: 'Escape' });
        fireEvent.keyUp(refresh, { key: 'Escape' });
      });
      expect(onBack).toHaveBeenCalledOnce();
      expect(parentBack).not.toHaveBeenCalled();
    } finally {
      cleanup();
      removeParent();
      stop();
      rect.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('can explicitly retry a failed catalog and download the pack without enabling automatic downloads', async () => {
    render(<WordLensPanel bookKey='book' onBack={vi.fn()} />);
    await waitFor(() => expect(mocks.fetchManifest).toHaveBeenCalledOnce());
    const refresh = await screen.findByRole('button', { name: 'Refresh' });
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();

    mocks.fetchManifest.mockResolvedValue(manifest);
    mocks.getPackStatus.mockResolvedValue({ pack, downloaded: false });
    refresh.focus();
    fireEvent.click(refresh);
    await waitFor(() =>
      expect(mocks.fetchManifest).toHaveBeenLastCalledWith(mocks.appService, { force: true }),
    );
    const download = await screen.findByRole('button', { name: 'Download' });
    expect(mocks.ensurePack).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(refresh);

    fireEvent.click(download);
    await screen.findByRole('button', { name: 'Delete' });
    expect(mocks.ensurePack).toHaveBeenCalledWith(
      mocks.appService,
      pack,
      expect.objectContaining({ allowDownload: true }),
    );
    expect(mocks.settings.globalReadSettings.wordLensAutoDownload).toBe(false);
  });

  it('leaves Refresh reachable after another catalog failure, without scheduling retries', async () => {
    render(<WordLensPanel bookKey='book' onBack={vi.fn()} />);
    const refresh = await screen.findByRole('button', { name: 'Refresh' });
    fireEvent.click(refresh);
    await waitFor(() => expect(mocks.fetchManifest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(refresh.hasAttribute('disabled')).toBe(false));
    expect(screen.getByText('Failed to download Word Lens data')).toBeTruthy();
    expect(mocks.ensurePack).not.toHaveBeenCalled();
  });
});
