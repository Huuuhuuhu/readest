import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
import { useLibraryStore } from '@/store/libraryStore';
import { getAPIBaseUrl } from '@/services/environment';
import { fetchWithTimeout } from '@/utils/fetch';
import { ShareApiError, getShare } from './share';
/** Import an explicitly opened public link into the local library. No account or analytics. */
export const ensureSharedBookLocal = async ({
  token,
  appService,
}: {
  token: string;
  appService: AppService;
}): Promise<Book> => {
  const meta = await getShare(token);
  if (meta.size > 200 * 1024 * 1024) throw new Error('Shared book exceeds the 200 MB import limit');
  const response = await fetchWithTimeout(
    `${getAPIBaseUrl()}/share/${encodeURIComponent(token)}/download`,
    {},
    120000,
  );
  if (!response.ok)
    throw new ShareApiError(response.status, undefined, 'Could not download shared book');
  const limit = 200 * 1024 * 1024;
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Shared book response has no content');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > limit) throw new Error('Shared book exceeds the 200 MB import limit');
      chunks.push(new Uint8Array(part.value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const blob = new Blob(chunks, {
    type: response.headers.get('content-type') ?? 'application/octet-stream',
  });
  const file = new File([blob], `${meta.title}.${meta.format.toLowerCase()}`, { type: blob.type });
  const store = useLibraryStore.getState();
  const library = store.libraryLoaded ? [...store.library] : await appService.loadLibraryBooks();
  const book = await appService.importBook(file, library);
  if (!book) throw new Error('Could not import shared book');
  await appService.saveLibraryBooks(library);
  if (store.libraryLoaded) store.setLibrary(library);
  return book;
};
