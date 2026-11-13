import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { getPublicCoverUrl, isPublicImageUrl } from '@/utils/cover';

// Issue #5424: annotations exported to markdown / pushed to Readwise reference
// the book cover by a publicly fetchable URL. A cover already backed by a
// public URL is reused as-is; local files are never implicitly published.

const makeBook = (hash: string, overrides: Partial<Book> = {}): Book =>
  ({
    hash,
    coverHash: `md5of${hash}`,
    title: 'T',
    author: 'A',
    ...overrides,
  }) as Book;

const makeAppService = (uploadResult: string | undefined | Error) => {
  const uploadFileToCloud = vi.fn(() =>
    uploadResult instanceof Error ? Promise.reject(uploadResult) : Promise.resolve(uploadResult),
  );
  const exists = vi.fn().mockResolvedValue(true);
  return {
    service: { exists, uploadFileToCloud } as unknown as AppService,
    exists,
    uploadFileToCloud,
  };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('isPublicImageUrl', () => {
  it('accepts http(s) URLs and rejects local ones', () => {
    expect(isPublicImageUrl('https://example.com/c.png')).toBe(true);
    expect(isPublicImageUrl('http://example.com/c.png')).toBe(true);
    expect(isPublicImageUrl('http://localhost:3000/c.png')).toBe(false);
    expect(isPublicImageUrl('http://127.0.0.1/c.png')).toBe(false);
    expect(isPublicImageUrl('https://asset.localhost/c.png')).toBe(false);
    expect(isPublicImageUrl('data:image/png;base64,AAAA')).toBe(false);
    expect(isPublicImageUrl(undefined)).toBe(false);
    expect(isPublicImageUrl(null)).toBe(false);
  });
});

describe('getPublicCoverUrl', () => {
  it('reuses an already-public coverImageUrl without uploading', async () => {
    const { service, uploadFileToCloud } = makeAppService('https://assets.readest.com/x.png');
    const book = makeBook('aaa1', { coverImageUrl: 'https://example.com/cover.jpg' });

    await expect(getPublicCoverUrl(book, service)).resolves.toBe('https://example.com/cover.jpg');
    expect(uploadFileToCloud).not.toHaveBeenCalled();
  });

  it.each([
    'asset://cover.png',
    'https://asset.localhost/cover.png',
    undefined,
  ])('never uploads a local cover (%s)', async (coverImageUrl) => {
    const { service, uploadFileToCloud, exists } = makeAppService(
      'https://example.com/should-not-publish.png',
    );
    const book = makeBook('local', { coverImageUrl });
    await expect(getPublicCoverUrl(book, service)).resolves.toBeUndefined();
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    await expect(getPublicCoverUrl(book, service)).resolves.toBeUndefined();
    expect(uploadFileToCloud).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });
});
