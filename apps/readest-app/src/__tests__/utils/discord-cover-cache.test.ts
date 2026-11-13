import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

// Issue #5352: a single transient upload failure used to poison the Discord
// cover for a full hour — the presence kept showing the fallback book icon
// long after the network recovered, which is why the reporter saw covers
// "stop working" for books that had rendered fine minutes earlier. Transient
// failures must be retried quickly (with backoff); only a genuinely missing
// cover deserves a long negative cache.

const invokeMock = vi.fn();
const processDiscordCoverMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invokeMock(...a),
}));
vi.mock('@/utils/image', () => ({
  processDiscordCover: (...a: unknown[]) => processDiscordCoverMock(...a),
}));

const BOOK = {
  hash: 'bookhash1234',
  title: 'Lord of the Flies',
  author: 'William Golding',
  coverHash: 'coverhashabcd',
} as Book;

type Svc = AppService & {
  exists: ReturnType<typeof vi.fn>;
  uploadFileToCloud: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
};

const makeAppService = (): Svc =>
  ({
    isDesktopApp: true,
    exists: vi.fn().mockResolvedValue(true),
    resolveFilePath: vi.fn().mockResolvedValue('/books/cover.png'),
    getImageURL: vi.fn().mockResolvedValue('asset://cover.png'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    uploadFileToCloud: vi.fn().mockResolvedValue('https://storage.readest.com/temp/img/u/c.jpg'),
  }) as unknown as Svc;

const loadDiscord = async () => {
  vi.resetModules();
  return import('@/utils/discord');
};

const lastPresence = () =>
  invokeMock.mock.calls.filter((c) => c[0] === 'update_book_presence').at(-1)?.[1] as
    | { presence: { coverUrl: string | null } }
    | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-07-28T12:00:00Z'));
  invokeMock.mockReset().mockResolvedValue(undefined);
  processDiscordCoverMock.mockReset().mockResolvedValue({
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Discord presence without official cover hosting', () => {
  it('uses an existing public cover supplied by metadata', async () => {
    const { updateDiscordPresence } = await loadDiscord();
    const appService = makeAppService();
    await updateDiscordPresence(
      { ...BOOK, coverImageUrl: 'https://example.com/cover.jpg' },
      123,
      appService,
    );
    expect(lastPresence()?.presence.coverUrl).toBe('https://example.com/cover.jpg');
    expect(appService.uploadFileToCloud).not.toHaveBeenCalled();
  });
  it('keeps local covers private on every presence tick', async () => {
    const { updateDiscordPresence } = await loadDiscord();
    const appService = makeAppService();
    for (const offset of [0, 60_000, 3600_000]) {
      await updateDiscordPresence(BOOK, offset, appService);
    }
    expect(lastPresence()?.presence.coverUrl).toBeNull();
    expect(appService.uploadFileToCloud).not.toHaveBeenCalled();
    expect(processDiscordCoverMock).not.toHaveBeenCalled();
  });
  it('does not contact Discord on Android', async () => {
    const { updateDiscordPresence } = await loadDiscord();
    const appService = makeAppService();
    appService.isDesktopApp = false;
    await updateDiscordPresence(BOOK, 123, appService);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
