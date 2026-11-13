import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppService } from '@/types/system';
import { loadPublicFontStyles, downloadPublicFont, PUBLIC_FONTS } from '@/services/publicFonts';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/utils/fetch', () => ({ fetchWithTimeout: request }));
const files = new Map<string, string | ArrayBuffer>();
const service = {
  exists: vi.fn(async (path: string) => files.has(path)),
  readFile: vi.fn(async (path: string) => files.get(path)),
  writeFile: vi.fn(async (path: string, _base: string, data: string | ArrayBuffer) => {
    files.set(path, data);
  }),
  createDir: vi.fn(async () => {}),
  resolveFilePath: vi.fn(async (path: string) => `/local/${path}`),
  getImageURL: vi.fn(async (path: string) => `asset://${path}`),
} as unknown as AppService;
beforeEach(() => {
  files.clear();
  vi.clearAllMocks();
});
describe('optional public font resources', () => {
  it('starts with local fonts and never contacts a resource server on cache miss', async () => {
    expect(await loadPublicFontStyles(service)).toBe('');
    expect(request).not.toHaveBeenCalled();
  });
  it('downloads explicitly, then loads the cached font while offline', async () => {
    request
      .mockResolvedValueOnce(
        new Response(
          '@font-face { font-family: "Test"; src: url("./one.woff2") format("woff2"); }',
        ),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    await downloadPublicFont(service, PUBLIC_FONTS[0]!.family);
    expect(request).toHaveBeenCalledTimes(2);
    request.mockRejectedValue(new Error('offline'));
    const css = await loadPublicFontStyles(service);
    expect(css).toContain('asset:///local/');
    expect(css).not.toContain('https:');
    await downloadPublicFont(service, PUBLIC_FONTS[0]!.family);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('does not mark a failed download as installed or retry it in the background', async () => {
    request.mockRejectedValue(new Error('offline'));
    await expect(downloadPublicFont(service, PUBLIC_FONTS[0]!.family)).rejects.toThrow('offline');
    expect(await loadPublicFontStyles(service)).toBe('');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
