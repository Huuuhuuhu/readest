import { Book } from '@/types/book';
import { AppService } from '@/types/system';

/**
 * True when the URL is fetchable by external services (Readwise, markdown
 * readers), i.e. not a local dev server or the Tauri asset protocol.
 */
export const isPublicImageUrl = (url?: string | null): url is string =>
  !!url && /^https?:\/\/(?!localhost|127\.|asset\.localhost)/.test(url);

/** Use only a cover URL already supplied by the book's metadata. */
export const getPublicCoverUrl = async (
  book: Book,
  _appService: AppService | null,
): Promise<string | undefined> =>
  isPublicImageUrl(book.coverImageUrl) ? book.coverImageUrl : undefined;
