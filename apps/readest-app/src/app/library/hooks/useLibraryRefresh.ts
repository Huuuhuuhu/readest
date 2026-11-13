import type { RefObject } from 'react';

import { useABSSync } from '@/hooks/useABSSync';
import { useOPDSSubscriptions } from '@/hooks/useOPDSSubscriptions';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';

export function useLibraryRefresh(
  scrollRef: RefObject<HTMLDivElement | null>,
  pullLibrary: (fullRefresh?: boolean, verbose?: boolean) => Promise<void>,
) {
  const { checkOPDSSubscriptions } = useOPDSSubscriptions();
  const { checkABSServers } = useABSSync();

  const refresh = async (fullRefresh: boolean) => {
    await pullLibrary(fullRefresh, true);
    await checkOPDSSubscriptions(true);
    await checkABSServers();
  };

  usePullToRefresh(
    scrollRef,
    () => refresh(false),
    () => refresh(true),
  );
}
