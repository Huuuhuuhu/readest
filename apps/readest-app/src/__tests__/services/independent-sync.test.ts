import { describe, expect, it } from 'vitest';
import {
  getActiveFileSyncBackends,
  getCloudSyncProviders,
} from '@/services/sync/cloudSyncProvider';
import type { SystemSettings } from '@/types/settings';

describe('independent sync configuration', () => {
  it('does not enable an official cloud implicitly on a fresh install', () => {
    expect(getCloudSyncProviders({} as unknown as SystemSettings)).toEqual([]);
  });

  it('runs the configured WebDAV service without account state or a membership cache', () => {
    const settings = { webdav: { enabled: true } } as unknown as SystemSettings;
    expect(getActiveFileSyncBackends(settings)).toEqual(['webdav']);
    expect(getCloudSyncProviders(settings)).toEqual(['webdav']);
  });

  it('does not reactivate the official backend from an imported old setting', () => {
    const settings = {
      readestCloud: { enabled: true },
      s3: { enabled: true },
    } as unknown as SystemSettings;
    expect(getCloudSyncProviders(settings)).toEqual(['s3']);
  });
});
