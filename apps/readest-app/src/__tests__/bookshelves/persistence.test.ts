import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HlcGenerator } from '@/libs/crdt';
import { useSettingsStore } from '@/store/settingsStore';
import type { EnvConfigType } from '@/services/environment';
import type { SystemSettings } from '@/types/settings';
import type { ReplicaRow } from '@/types/replica';
import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { mergeBookshelfStates, readBookshelves } from '@/services/bookshelves/state';
import {
  applyRemoteBookshelfRows,
  replayBookshelfOperations,
  saveBookshelfDraft,
} from '@/services/bookshelves/persistence';
import { readPendingBookshelves } from '@/services/bookshelves/journal';

const mocks = vi.hoisted(() => ({
  userId: 'account',
  connected: false,
  markDirty: vi.fn(),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

const hlc = new HlcGenerator('device');
vi.mock('@/services/sync/replicaSync', () => ({
  getReplicaSync: () => (mocks.connected ? { hlc, manager: { markDirty: mocks.markDirty } } : null),
}));
const env = {} as EnvConfigType;
beforeEach(() => {
  localStorage.clear();
  mocks.userId = 'account';
  localStorage.setItem('user', JSON.stringify({ id: mocks.userId }));

  mocks.connected = false;
  mocks.markDirty.mockClear();
  mocks.saveSettings.mockClear();
  useSettingsStore.setState({
    settings: { ...DEFAULT_SYSTEM_SETTINGS, replicaDeviceId: 'device' } as SystemSettings,
    saveSettings: mocks.saveSettings,
  });
});
describe('bookshelf persistence and sync integration', () => {
  it('discards anonymous shelves created and deleted locally, including stale cached state', async () => {
    localStorage.removeItem('user');
    mocks.userId = '';
    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Never published');
    await saveBookshelfDraft(env, base, [...base, custom]);
    const cached = useSettingsStore.getState().settings.bookshelves;
    await saveBookshelfDraft(env, [...base, custom], base);
    expect(readPendingBookshelves()).toEqual([]);
    expect(useSettingsStore.getState().settings.bookshelves?.rows[custom.id]).toBeUndefined();
    expect(mergeBookshelfStates(cached).rows[custom.id]).toBeUndefined();
    expect(readBookshelves({ bookshelves: cached }).some((s) => s.id === custom.id)).toBe(false);
    mocks.userId = 'account';
    mocks.connected = true;
    await replayBookshelfOperations(env);
    expect(mocks.markDirty).not.toHaveBeenCalled();
  });

  it('does not resurrect a discarded shelf from a stale editor', async () => {
    localStorage.removeItem('user');
    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Discarded');
    await saveBookshelfDraft(env, base, [...base, custom]);
    await saveBookshelfDraft(env, [...base, custom], base);
    await saveBookshelfDraft(env, [...base, custom], [...base, { ...custom, name: 'Stale edit' }]);
    expect(readPendingBookshelves()).toEqual([]);
    expect(useSettingsStore.getState().settings.bookshelves?.rows[custom.id]).toBeUndefined();
  });

  it('keeps thousands of anonymous create/delete cycles bounded', async () => {
    localStorage.removeItem('user');
    const base = readBookshelves(useSettingsStore.getState().settings);
    for (let i = 0; i < 1000; i++) {
      const custom = createBookshelf(`Temporary ${i}`);
      await saveBookshelfDraft(env, base, [...base, custom]);
      await saveBookshelfDraft(env, [...base, custom], base);
    }
    expect(readPendingBookshelves()).toEqual([]);
    expect(Object.keys(useSettingsStore.getState().settings.bookshelves?.rows || {})).toEqual([]);
    expect(localStorage.length).toBe(1); // Only the logical clock remains.
  });

  it('keeps legacy anonymous deletions when creation provenance is unknown', async () => {
    localStorage.removeItem('user');
    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Legacy');
    const t = hlc.next();
    await applyRemoteBookshelfRows(env, [
      {
        user_id: '',
        kind: 'bookshelf',
        replica_id: custom.id,
        fields_jsonb: { definition: { v: custom, t, s: 'device' } },
        updated_at_ts: t,
        deleted_at_ts: null,
        manifest_jsonb: null,
        reincarnation: null,
        schema_version: 1,
      },
    ]);
    await saveBookshelfDraft(env, [...base, custom], base);
    expect(readPendingBookshelves()[0]?.deleted_at_ts).toBeTruthy();
  });

  it('saves offline edits under the cached account without waiting for token refresh', async () => {
    let finishRefresh: (() => void) | undefined;

    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Offline with expired token');
    const saving = saveBookshelfDraft(env, base, [custom, ...base]);
    try {
      expect(readPendingBookshelves()).toContainEqual(
        expect.objectContaining({ user_id: '', replica_id: custom.id }),
      );
      await saving;
      expect(mocks.saveSettings).toHaveBeenCalledOnce();
      mocks.userId = 'other-account';

      mocks.connected = true;
      await replayBookshelfOperations(env);
      expect(mocks.markDirty).not.toHaveBeenCalled();
    } finally {
      finishRefresh?.();
      await saving;
    }
  });
  it('recovers offline edits after restart with original timestamps', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    const custom = createBookshelf('Offline');
    await saveBookshelfDraft(env, base, [custom, ...base]);
    const original = readPendingBookshelves()[0]!;
    expect(original.user_id).toBe('');
    useSettingsStore.setState({ settings: { ...DEFAULT_SYSTEM_SETTINGS } as SystemSettings });
    mocks.connected = true;
    await replayBookshelfOperations(env);
    expect(
      readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === custom.id)?.name,
    ).toBe('Offline');
    expect(mocks.markDirty).not.toHaveBeenCalled();
    expect(readPendingBookshelves()[0]!.updated_at_ts).toBe(original.updated_at_ts);
  });
  it('persists a draft once per autosave', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    mocks.connected = true;
    await saveBookshelfDraft(env, base, [createBookshelf('Once'), ...base]);
    expect(mocks.saveSettings).toHaveBeenCalledOnce();
    expect(mocks.markDirty).not.toHaveBeenCalled();
  });
  it('merges remote definitions without publishing them or losing a newer pending edit', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    const t = hlc.next();
    const remote: ReplicaRow = {
      user_id: '',
      kind: 'bookshelf',
      replica_id: 'default',
      fields_jsonb: {
        definition: {
          v: { ...base.find((s) => s.id === 'default')!, name: 'Old remote' },
          t,
          s: 'remote',
        },
      },
      updated_at_ts: t,
      deleted_at_ts: null,
      manifest_jsonb: null,
      reincarnation: null,
      schema_version: 1,
    };
    await applyRemoteBookshelfRows(env, [remote]);
    expect(readPendingBookshelves()).toEqual([]);
    expect(mocks.markDirty).not.toHaveBeenCalled();
    const latest = readBookshelves(useSettingsStore.getState().settings);
    await saveBookshelfDraft(
      env,
      latest,
      latest.map((s) => (s.id === 'default' ? { ...s, name: 'New local' } : s)),
    );
    const pending = readPendingBookshelves();
    await applyRemoteBookshelfRows(env, [remote]);
    expect(
      readBookshelves(useSettingsStore.getState().settings).find((s) => s.id === 'default')?.name,
    ).toBe('New local');
    expect(readPendingBookshelves()).toEqual(pending);
  });
  it('never queues another account’s pending operations', async () => {
    const base = readBookshelves(useSettingsStore.getState().settings);
    await saveBookshelfDraft(env, base, [createBookshelf('Account A'), ...base]);
    mocks.userId = 'other-account';
    mocks.connected = true;
    await replayBookshelfOperations(env);
    expect(mocks.markDirty).not.toHaveBeenCalled();
    expect(readPendingBookshelves()[0]!.user_id).toBe('');
  });
  it('follows App settings sync independently of file-provider selection', async () => {
    const settings = {
      ...useSettingsStore.getState().settings,
      syncCategories: { settings: false, dictionary: false },
      readestCloud: { enabled: false },
    };
    useSettingsStore.setState({ settings });
    mocks.connected = true;
    const base = readBookshelves(settings);
    await saveBookshelfDraft(env, base, [createBookshelf('Local only'), ...base]);
    expect(mocks.markDirty).not.toHaveBeenCalled();
    useSettingsStore.setState({
      settings: { ...useSettingsStore.getState().settings, syncCategories: { settings: true } },
    });
    await replayBookshelfOperations(env);
    expect(mocks.markDirty).not.toHaveBeenCalled();
  });
});
