import { bookshelfAdapter } from './adapters/bookshelf';

import { dictionaryAdapter } from './adapters/dictionary';
import { fontAdapter } from './adapters/font';
import { textureAdapter } from './adapters/texture';
import { opdsCatalogAdapter } from './adapters/opdsCatalog';
import { absServerAdapter } from './adapters/absServer';
import { customTranslatorAdapter, translationPromptAdapter } from './adapters/customTranslator';
import { customTTSAdapter } from './adapters/customTTS';
import { settingsAdapter } from './adapters/settings';

import { getReplicaAdapter, registerReplicaAdapter } from './replicaRegistry';

import type { ReplicaAdapter } from './replicaRegistry';

const KNOWN_ADAPTERS: ReplicaAdapter<unknown>[] = [
  bookshelfAdapter as unknown as ReplicaAdapter<unknown>,
  dictionaryAdapter as unknown as ReplicaAdapter<unknown>,
  fontAdapter as unknown as ReplicaAdapter<unknown>,
  textureAdapter as unknown as ReplicaAdapter<unknown>,
  // Metadata-only — no binary download handler needed.
  opdsCatalogAdapter as unknown as ReplicaAdapter<unknown>,
  // Metadata-only — no binary download handler needed.
  absServerAdapter as unknown as ReplicaAdapter<unknown>,
  // Metadata-only — no binary download handler needed.
  customTranslatorAdapter as unknown as ReplicaAdapter<unknown>,
  translationPromptAdapter as unknown as ReplicaAdapter<unknown>,
  // Metadata-only — no binary download handler needed.
  customTTSAdapter as unknown as ReplicaAdapter<unknown>,
  // Bundled scalar settings — singleton row, no binary.
  settingsAdapter as unknown as ReplicaAdapter<unknown>,
];

let didBootstrap = false;

export const bootstrapReplicaAdapters = (): void => {
  if (didBootstrap) return;
  for (const adapter of KNOWN_ADAPTERS) {
    if (getReplicaAdapter(adapter.kind)) continue;
    registerReplicaAdapter(adapter);
  }
  // Per-kind download-completion handlers — fired by
  // replicaTransferIntegration once binaries are on disk. Each store
  // exposes a markAvailable* method that clears the placeholder
  // `unavailable` flag set by the pull orchestrator.

  // Fonts need more than the unavailable flag cleared: the binary must
  // be loaded into a blob URL and the @font-face rule injected, the
  // same plumbing manual import does in CustomFonts.tsx. Without this
  // the auto-downloaded font appears in the UI but renders in a
  // fallback face. Falls back to flag-only when persist env hasn't
  // landed yet (extremely early boot).

  // Textures: mark available + load the file into a blob URL so the
  // panel grid renders the swatch and `applyTexture` can mount it
  // without re-reading disk. Mounting only happens when the user
  // selects the texture (via applyTexture), so no automatic mount
  // here. Falls back to flag-only when persist env hasn't landed yet.

  didBootstrap = true;
};

export const __resetBootstrapForTests = (): void => {
  didBootstrap = false;
};
