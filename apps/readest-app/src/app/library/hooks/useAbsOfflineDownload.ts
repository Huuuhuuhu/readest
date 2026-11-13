import { useCallback } from 'react';
import { transferManager } from '@/services/transferManager';
import type { Book } from '@/types/book';

export const useAbsOfflineDownload = () => {
  const handleBooksOfflineDownload = useCallback((books: Book[]) => {
    for (const book of books) transferManager.queueAbsOfflineDownload(book, 1);
  }, []);
  const handleBookOfflineDownload = useCallback(
    (book: Book) => handleBooksOfflineDownload([book]),
    [handleBooksOfflineDownload],
  );
  return { handleBookOfflineDownload, handleBooksOfflineDownload };
};
