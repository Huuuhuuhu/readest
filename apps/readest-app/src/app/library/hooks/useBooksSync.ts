import { useCallback, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { getActiveFileSyncBackends } from '@/services/sync/cloudSyncProvider';
import { runFileLibrarySyncPass } from '@/services/sync/file/runLibrarySync';
import { eventDispatcher } from '@/utils/event';

/** Manual sync shares the same engine as the automatic file-backend sync. */
export const useBooksSync = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const running = useRef<Promise<void> | null>(null);
  const pullLibrary = useCallback(
    async (_fullRefresh = false, verbose = false) => {
      if (running.current) return running.current;
      if (!getActiveFileSyncBackends(useSettingsStore.getState().settings).length) return;
      const pass = async () => {
        const result = await runFileLibrarySyncPass(envConfig, _);
        if (verbose) {
          const ok = result && !result.indexPushFailed && !result.failures;
          eventDispatcher.dispatch('toast', {
            type: ok ? 'info' : 'error',
            message: ok
              ? _('{{count}} book(s) synced', { count: result.booksSynced })
              : _('Sync failed'),
          });
        }
      };
      running.current = pass().finally(() => {
        running.current = null;
      });
      return running.current;
    },
    [envConfig, _],
  );
  return { pullLibrary, pushLibrary: pullLibrary };
};
