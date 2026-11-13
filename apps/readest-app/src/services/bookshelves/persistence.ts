import { isBuiltinBookshelf } from './definitions';
import type { BookshelfDefinition, BookshelfState } from '@/types/bookshelf';
import type { ReplicaRow } from '@/types/replica';
import type { EnvConfigType } from '@/services/environment';
import { useSettingsStore } from '@/store/settingsStore';

import { HlcGenerator } from '@/libs/crdt';
import { LocalStorageHlcStore } from '@/libs/hlcStore';
import { applyBookshelfDraft, mergeBookshelfStates, readBookshelves } from './state';
import {
  journalBookshelfOperation,
  readPendingBookshelves,
  resolveLocalBookshelf,
} from './journal';
import { bookshelfReplicaSchema } from './replica';

let writes: Promise<void> = Promise.resolve();
const persistState = (env: EnvConfigType, state: BookshelfState): Promise<void> => {
  const store = useSettingsStore.getState();
  store.setSettings({
    ...store.settings,
    bookshelves: mergeBookshelfStates(store.settings.bookshelves, state),
  });
  const save = async () => {
    const latest = useSettingsStore.getState();
    await latest.saveSettings(env, latest.settings);
  };
  writes = writes.catch(() => {}).then(save);
  return writes;
};
export const replayBookshelfOperations = async (env: EnvConfigType) => {
  const pending = readPendingBookshelves();
  // Reapply the journal first: a crash between journaling and saving settings
  // cannot lose the user's changes, whether or not sync is currently enabled.
  if (pending.length) {
    let state: BookshelfState = { rows: {} };
    for (const row of pending)
      state = mergeBookshelfStates(state, { rows: { [row.replica_id]: row } });
    await persistState(env, state);
  }
};
export const saveBookshelfDraft = async (
  env: EnvConfigType,
  base: BookshelfDefinition[],
  draft: BookshelfDefinition[],
) => {
  const userId = ''; // Local CRDT schema has an empty owner; no application account.
  const { settings } = useSettingsStore.getState();
  const deviceId = settings.replicaDeviceId || 'local';
  const hlcStore = new LocalStorageHlcStore();
  const hlc = HlcGenerator.restore(hlcStore.load() || { physicalMs: 0, counter: 0 }, deviceId);
  for (const row of Object.values(settings.bookshelves?.rows || {})) hlc.observe(row.updated_at_ts);
  const { state, operations } = applyBookshelfDraft(
    settings.bookshelves || { rows: {} },
    base,
    draft,
    { userId, deviceId, next: () => hlc.next() },
    settings,
  );
  if (!operations.length) return;
  hlcStore.save(hlc.serialize());
  for (const row of operations) {
    const previous = settings.bookshelves?.rows[row.replica_id];
    // A stale editor must not recreate a local shelf discarded in another window.
    if (
      (previous?.localOnly && !resolveLocalBookshelf(previous)) ||
      (!previous &&
        !isBuiltinBookshelf(row.replica_id) &&
        base.some((s) => s.id === row.replica_id))
    ) {
      delete state.rows[row.replica_id];
      continue;
    }
    const localOnly =
      !userId &&
      !previous &&
      !isBuiltinBookshelf(row.replica_id) &&
      !base.some((shelf) => shelf.id === row.replica_id);
    const journaled = journalBookshelfOperation({
      ...row,
      ...(localOnly ? { localOnly: true as const } : {}),
    });
    if (journaled) state.rows[row.replica_id] = journaled;
    else delete state.rows[row.replica_id];
  }
  // The draft state already carries the journaled rows, so publish without
  // replaying — a replay would persist the very same state a second time, and
  // the editor autosaves on every keystroke.
  await persistState(env, state);
};
export const updateBookshelf = async (
  env: EnvConfigType,
  id: string,
  update: (shelf: BookshelfDefinition) => BookshelfDefinition,
) => {
  const base = readBookshelves(useSettingsStore.getState().settings);
  await saveBookshelfDraft(
    env,
    base,
    base.map((s) => (s.id === id ? update(s) : s)),
  );
};
export const applyRemoteBookshelfRows = async (env: EnvConfigType, rows: ReplicaRow[]) => {
  let state: BookshelfState = { rows: {} };
  for (const row of rows) {
    if (!bookshelfReplicaSchema.safeParse(row).success) continue;
    state = mergeBookshelfStates(state, { rows: { [row.replica_id]: row } });
  }
  if (Object.keys(state.rows).length) await persistState(env, state);
};
