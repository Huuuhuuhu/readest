import { useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import type { Book } from '@/types/book';
import { getUserLang } from '@/utils/misc';
import { demoLibraries } from '@/services/demoBooks';
import { useLibraryStore } from '@/store/libraryStore';
import { eventDispatcher } from '@/utils/event';
export const useDemoBooks = () => {
  const { envConfig } = useEnv();
  const [books, setBooks] = useState<Book[]>([]);
  const loading = useRef(false);
  useEffect(() => {
    const load = async () => {
      if (loading.current) return;
      loading.current = true;
      let failures = 0;
      const downloaded: Book[] = [];
      try {
        const service = await envConfig.getAppService();
        const sources = getUserLang().startsWith('zh') ? demoLibraries.zh : demoLibraries.en;
        eventDispatcher.dispatch('toast', { type: 'info', message: '正在下载示例书籍…' });
        for (const url of sources.library) {
          try {
            const book = await service.importBook(
              url,
              [...useLibraryStore.getState().library, ...downloaded],
              { saveBook: true },
            );
            if (book) downloaded.push(book);
          } catch {
            failures++;
          }
        }
        setBooks(downloaded);
        eventDispatcher.dispatch('toast', {
          type: failures ? 'error' : 'info',
          message: failures
            ? `已下载 ${downloaded.length} 本，${failures} 本失败；可再次选择下载重试。`
            : `已下载 ${downloaded.length} 本示例书，可离线阅读。`,
        });
      } catch {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: '示例书下载失败，可稍后重试。',
        });
      } finally {
        loading.current = false;
      }
    };
    const onRequest = () => {
      void load();
    };
    eventDispatcher.on('download-public-samples', onRequest);
    return () => eventDispatcher.off('download-public-samples', onRequest);
  }, [envConfig]);
  return books;
};
