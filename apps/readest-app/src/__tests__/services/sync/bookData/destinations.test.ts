import { beforeEach, describe, expect, test, vi } from 'vitest';

const listFilesMock = vi.fn();
const downloadFileMock = vi.fn();
const deleteCloudFileMock = vi.fn();
vi.mock('@/libs/storage', () => ({
  listAllFiles: async (...a: unknown[]) => (await listFilesMock(...a)).files,
  downloadFile: (...a: unknown[]) => downloadFileMock(...a),
  deleteFile: (...a: unknown[]) => deleteCloudFileMock(...a),
}));

import { createFileSyncDestination } from '@/services/sync/bookData/fileSyncDestination';
import { FileSyncError } from '@/services/sync/file/provider';

import { FakeFileSyncProvider } from './fakeFileSyncProvider';

const bytes = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

describe('file-sync destination', () => {
  let provider: FakeFileSyncProvider;
  beforeEach(() => {
    provider = new FakeFileSyncProvider();
  });

  test('writes under books/<hash>/<kind>/', async () => {
    const dest = createFileSyncDestination('webdav', provider);
    await dest.write('h', 'tts', 'a.mp3', bytes('mp3'), 'audio/mpeg');
    expect(provider.files.has('/Readest/books/h/tts/a.mp3')).toBe(true);
    expect(provider.ops[0]).toBe(
      'ensureDir:/Readest,/Readest/books,/Readest/books/h,/Readest/books/h/tts',
    );
    expect(dest.id).toBe('webdav');
  });

  test('prepares the folder once per book and kind', async () => {
    const dest = createFileSyncDestination('webdav', provider);
    await dest.write('h', 'tts', 'a.mp3', bytes('mp3'), 'audio/mpeg');
    await dest.write('h', 'tts', 'a.json', bytes('{}'), 'application/json');
    expect(provider.ops.filter((op) => op.startsWith('ensureDir'))).toHaveLength(1);
  });

  test('a folder its listing found is not prepared again before writing', async () => {
    provider.files.set('/Readest/books/h/tts/a.mp3', bytes('mp3'));
    const dest = createFileSyncDestination('webdav', provider);
    await dest.list('h', 'tts');
    await dest.write('h', 'tts', 'b.mp3', bytes('mp3'), 'audio/mpeg');
    expect(provider.ops.filter((op) => op.startsWith('ensureDir'))).toEqual([]);
  });

  test('lists and reads that kind', async () => {
    provider.files.set('/Readest/books/h/tts/a.mp3', bytes('mp3'));
    provider.files.set('/Readest/books/h/Title.epub', bytes('epub'));
    const dest = createFileSyncDestination('webdav', provider);
    expect(await dest.list('h', 'tts')).toEqual(new Set(['a.mp3']));
    expect(new TextDecoder().decode((await dest.read('h', 'tts', 'a.mp3'))!)).toBe('mp3');
    expect(await dest.read('h', 'tts', 'b.mp3')).toBeNull();
  });

  test('list is empty for a missing folder', async () => {
    const dest = createFileSyncDestination('webdav', provider);
    expect(await dest.list('h', 'tts')).toEqual(new Set());
  });

  test('a listing error throws instead of reading as an empty folder', async () => {
    // Read as empty, it would make push upload every pack again.
    provider.listError = new FileSyncError('timeout', 'NETWORK');
    const dest = createFileSyncDestination('webdav', provider);
    await expect(dest.list('h', 'tts')).rejects.toThrow('timeout');
  });
});
