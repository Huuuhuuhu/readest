import { useSettingsStore } from '@/store/settingsStore';
import { getActiveFileSyncBackends } from '@/services/sync/cloudSyncProvider';
import { createFileSyncProvider } from '@/services/sync/file/providerRegistry';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import type { AppService } from '@/types/system';
import { createFileSyncDestination } from './fileSyncDestination';
import type { BookDataDestination } from './types';

/** TTS packs use the same configured file backends as the local library. */
export const getBookDataDestinations = async (
  _appService: AppService,
  _bookHash: string,
): Promise<BookDataDestination[]> => {
  if (!isSyncCategoryEnabled('book_data')) return [];
  const settings = useSettingsStore.getState().settings;
  const destinations: BookDataDestination[] = [];
  for (const backend of getActiveFileSyncBackends(settings)) {
    const provider = await createFileSyncProvider(backend, settings).catch(() => null);
    if (provider) destinations.push(createFileSyncDestination(backend, provider));
  }
  return destinations;
};
