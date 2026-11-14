import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultViewSettings, loadSettings } from '@/services/settingsService';
import { loadBookConfig } from '@/services/bookService';
import type { Book, ViewSettings } from '@/types/book';
import type { SystemSettings } from '@/types/settings';
import type { FileSystem } from '@/types/system';
import { serializeConfig } from '@/utils/serializer';
import { DEFAULT_BOOK_SEARCH_CONFIG } from '@/services/constants';

const ctx = { fs: {} as FileSystem, isMobile: true, isEink: false, isAppDataSandbox: false };
const fullPage = { maxColumnCount: 1, maxInlineSize: 9999, maxBlockSize: 9999, scrolled: false };
const oldLayout = { maxColumnCount: 1, maxInlineSize: 720, maxBlockSize: 1440, scrolled: true };
const persistence = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/services/persistence', () => ({
  safeLoadJSON: (...args: unknown[]) => persistence.load(...args),
  safeSaveJSON: (...args: unknown[]) => persistence.save(...args),
}));

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'true'));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('TV full-screen single-column reading with the original renderer', () => {
  it('defaults to a full-width, full-height paginated page on a TV', () => {
    expect(getDefaultViewSettings(ctx)).toMatchObject(fullPage);
  });

  it('does not change the non-TV defaults', () => {
    vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'false');
    expect(getDefaultViewSettings(ctx).maxInlineSize).toBe(720);
  });

  it('migrates the saved narrow global layout once and preserves later adjustments', async () => {
    let saved: SystemSettings | undefined;
    const fs = { getPrefix: async () => 'books' } as unknown as FileSystem;
    persistence.load.mockImplementation(
      (_fs, _name, _base, defaults: SystemSettings) =>
        saved ?? {
          ...defaults,
          globalViewSettings: { ...defaults.globalViewSettings, ...oldLayout },
        },
    );
    persistence.save.mockImplementation((_fs, _name, _base, settings: SystemSettings) => {
      saved = settings;
    });
    const settings = await loadSettings({ ...ctx, fs });
    expect(settings.globalViewSettings).toMatchObject(fullPage);
    expect(saved).toBeDefined();
    // An explicit later user choice must survive an app restart.
    saved = {
      ...settings,
      globalViewSettings: { ...settings.globalViewSettings, maxInlineSize: 1600, scrolled: true },
    };
    expect((await loadSettings({ ...ctx, fs })).globalViewSettings).toMatchObject({
      maxInlineSize: 1600,
      scrolled: true,
    });
  });

  it('migrates old per-book overrides, preserving font and reading position', async () => {
    const old = { lastLocation: 'chapter-7', viewSettings: { ...oldLayout, defaultFontSize: 28 } };
    const fs = {
      exists: async () => true,
      readFile: async () => JSON.stringify(old),
    } as unknown as FileSystem;
    const settings = { globalViewSettings: getDefaultViewSettings(ctx) } as SystemSettings;
    const config = await loadBookConfig(fs, { hash: 'book', format: 'TXT' } as Book, settings);
    expect(config.viewSettings).toMatchObject({ ...fullPage, defaultFontSize: 28 });
    expect(config).toMatchObject({ lastLocation: 'chapter-7' });
    config.viewSettings = { ...config.viewSettings, maxInlineSize: 1800, scrolled: true };
    fs.readFile = async () =>
      serializeConfig(config, settings.globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
    expect(
      (await loadBookConfig(fs, { hash: 'book', format: 'TXT' } as Book, settings)).viewSettings,
    ).toMatchObject({ maxInlineSize: 1800, scrolled: true });
  });

  it('inherits the chosen global layout for a new book and leaves fixed pages alone', async () => {
    const fs = { exists: async () => false } as unknown as FileSystem;
    const settings = {
      globalViewSettings: { ...getDefaultViewSettings(ctx), maxInlineSize: 1600 } as ViewSettings,
    } as SystemSettings;
    expect(
      (await loadBookConfig(fs, { hash: 'new', format: 'TXT' } as Book, settings)).viewSettings
        ?.maxInlineSize,
    ).toBe(1600);
    fs.exists = async () => true;
    fs.readFile = async () =>
      JSON.stringify({ viewSettings: { ...oldLayout, zoomMode: 'fit-page' } });
    expect(
      (await loadBookConfig(fs, { hash: 'pdf', format: 'PDF' } as Book, settings)).viewSettings,
    ).toMatchObject({ ...oldLayout, zoomMode: 'fit-page' });
  });
});
