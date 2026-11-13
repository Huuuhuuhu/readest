import { useMemo, useSyncExternalStore } from 'react';

import { useEnv } from '@/context/EnvContext';

import { getFlowConnectors } from '@/services/sync/dataFlow/connectors';
import { readFlowState, subscribeFlowState } from '@/services/sync/dataFlow/log';
import { useABSServerStore } from '@/store/absServerStore';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { useSettingsStore } from '@/store/settingsStore';

export const useFlowConnectors = () => {
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const absServers = useABSServerStore((s) => s.servers);
  const opdsCatalogs = useCustomOPDSStore((s) => s.catalogs);
  return useMemo(
    () =>
      getFlowConnectors({
        settings,
        envConfig,
        absServers,
        opdsCatalogs,
      }),
    [settings, envConfig, absServers, opdsCatalogs],
  );
};

export const useFlowState = () =>
  useSyncExternalStore(subscribeFlowState, readFlowState, readFlowState);
