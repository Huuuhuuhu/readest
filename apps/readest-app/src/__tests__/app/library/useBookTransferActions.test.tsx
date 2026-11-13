import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { SetStateAction } from 'react';

import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { AppService } from '@/types/system';
import { type ProgressHandler } from '@/utils/transfer';

/**
 * Issue #5062 — cloud sync providers are independently selectable, so a
 * per-book Upload/Download must route to whichever of {Readest Cloud, a file
 * backend} the user has switched on, instead of assuming exactly one.
 *
 * `isReadestCloudEnabled` and `getActiveFileSyncBackends` are settable per
 * test (same pattern as useBooksSync-routing.test.tsx) so every routing
 * branch can be exercised directly, without rendering the whole library page.
 */

const routing = vi.hoisted(() => ({
  readestEnabled: true,
  booksSyncEnabled: true,
  backends: [] as ('webdav' | 'gdrive' | 's3' | 'onedrive' | 'icloud')[],
}));

const runFileBookUpload = vi.hoisted(() => vi.fn(async () => true));
const runFileBookDownload = vi.hoisted(() =>
  vi.fn(
    async (
      _envConfig: EnvConfigType,
      _book: Book,
      _onProgress?: ProgressHandler,
    ): Promise<boolean> => true,
  ),
);
const queueUpload = vi.hoisted(() => vi.fn(() => 'transfer-1'));
const queueDownload = vi.hoisted(() => vi.fn(() => 'transfer-1'));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation:
    () =>
    (text: string, params?: Record<string, string | number>): string => {
      if (!params) return text;
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replace(`{{${k}}}`, String(v)),
        text,
      );
    },
}));

vi.mock('@/services/sync/cloudSyncProvider', () => ({
  isReadestCloudEnabled: () => routing.readestEnabled,
  getActiveFileSyncBackends: () => routing.backends,
}));

vi.mock('@/services/sync/syncCategories', () => ({
  isSyncCategoryEnabled: (id: string) => id !== 'book' || routing.booksSyncEnabled,
}));

vi.mock('@/services/sync/file/runLibrarySync', () => ({
  runFileBookUpload,
  runFileBookDownload,
}));

vi.mock('@/services/transferManager', () => ({
  transferManager: {
    queueUpload,
    queueDownload,
  },
}));

const { useBookTransferActions } = await import('@/app/library/hooks/useBookTransferActions');

const envConfig: EnvConfigType = { getAppService: async () => ({}) as AppService };

const makeBook = (over: Partial<Book> = {}): Book => ({
  hash: 'book-1',
  format: 'EPUB',
  title: 'Title',
  author: 'Author',
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

type ProgressState = { [key: string]: number };

const setup = (appService: AppService | null = null) => {
  const updateBook = vi.fn(async (_envConfig: EnvConfigType, _book: Book) => {});
  // Mimic React's functional state updates so tests can assert the actual
  // progress transitions (indeterminate start, percentage updates, cleanup).
  let progressState: ProgressState = {};
  const setBooksTransferProgress = vi.fn((updater: SetStateAction<ProgressState>) => {
    progressState = typeof updater === 'function' ? updater(progressState) : updater;
  });
  const { result } = renderHook(() =>
    useBookTransferActions(envConfig, appService, updateBook, setBooksTransferProgress),
  );
  return { result, updateBook, getProgress: () => progressState };
};

beforeEach(() => {
  vi.clearAllMocks();
  routing.readestEnabled = true;
  routing.booksSyncEnabled = true;
  routing.backends = ['webdav'];
});

describe('independent per-book transfers', () => {
  it('uploads to configured file services without any account provider', async () => {
    routing.backends = ['webdav'];
    const { result } = setup();
    const book = makeBook();
    expect(await result.current.handleBookUpload(book)).toBe(true);
    expect(runFileBookUpload).toHaveBeenCalledWith(envConfig, book);
    expect(queueUpload).not.toHaveBeenCalled();
  });
  it('does not upload anywhere with no configured backend', async () => {
    routing.backends = [];
    const { result } = setup();
    expect(await result.current.handleBookUpload(makeBook())).toBe(false);
    expect(runFileBookUpload).not.toHaveBeenCalled();
  });
  it('reports an independent upload failure without a login fallback', async () => {
    routing.backends = ['s3'];
    runFileBookUpload.mockRejectedValueOnce(new Error('offline'));
    expect(await setup().result.current.handleBookUpload(makeBook())).toBe(false);
    expect(queueUpload).not.toHaveBeenCalled();
  });
  it('downloads through the configured provider engine and saves metadata', async () => {
    const { result, updateBook } = setup();
    const book = makeBook();
    expect(await result.current.handleBookDownload(book)).toBe(true);
    expect(runFileBookDownload).toHaveBeenCalledWith(envConfig, book, expect.any(Function));
    expect(updateBook).toHaveBeenCalledWith(envConfig, book);
  });
  it('leaves metadata unchanged when a provider has no file', async () => {
    runFileBookDownload.mockResolvedValueOnce(false);
    const { result, updateBook } = setup();
    expect(await result.current.handleBookDownload(makeBook())).toBe(false);
    expect(updateBook).not.toHaveBeenCalled();
  });
  it('queues a silent batch download without entering the direct path', async () => {
    const { result } = setup();
    const book = makeBook();
    expect(await result.current.handleBookDownload(book, { queued: true, silent: true })).toBe(
      true,
    );
    expect(queueDownload).toHaveBeenCalledWith(book, 1, true);
    expect(runFileBookDownload).not.toHaveBeenCalled();
  });
  it('contains a network exception and clears progress', async () => {
    runFileBookDownload.mockRejectedValueOnce(new Error('offline'));
    const { result, getProgress } = setup();
    expect(await result.current.handleBookDownload(makeBook())).toBe(false);
    expect(getProgress()).toEqual({});
  });
  it('ignores late progress callbacks after completion', async () => {
    let progress: ProgressHandler | undefined;
    runFileBookDownload.mockImplementationOnce(async (_env, _book, handler) => {
      progress = handler;
      return true;
    });
    const { result, getProgress } = setup();
    await result.current.handleBookDownload(makeBook());
    progress?.({ progress: 5, total: 10, transferSpeed: 0 });
    expect(getProgress()).toEqual({});
  });
});
