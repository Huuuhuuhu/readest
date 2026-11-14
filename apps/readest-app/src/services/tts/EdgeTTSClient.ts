import { EDGE_TTS_PROTOCOL } from '@/libs/edgeTTS';
import { AppService } from '@/types/system';
import { BufferedTTSClient } from './BufferedTTSClient';
import { createBookTTSCacheStore } from './providers/bookCacheStore';
import { CachingProvider, type TTSCacheStore } from './providers/cache';
import { EdgeSpeechProvider } from './providers/edge';
import { SpeechProvider } from './providers/types';
import { TTSController } from './TTSController';

// Everything engine-independent (scheduler, playout, word tracking, preload)
// lives in BufferedTTSClient; the Edge specifics live in EdgeSpeechProvider.
// Keep the persisted engine name. Edge connects directly to Microsoft;
// failures never select an application-hosted relay or request an account.
export { DEFAULT_SENTENCE_GAP_SEC } from './BufferedTTSClient';

export class EdgeTTSClient extends BufferedTTSClient {
  // `store` is the controller's shared per-book cache store (null: caching
  // off). Omitted, the client builds its own (standalone use and tests).
  constructor(
    controller?: TTSController,
    appService?: AppService | null,
    store?: TTSCacheStore | null,
  ) {
    const edgeProvider = new EdgeSpeechProvider();
    let provider: SpeechProvider = edgeProvider;
    // Per-book persistent cache on every platform: appService.openDatabase
    // rides tauri-plugin-turso natively and turso WASM over OPFS on the
    // web. The book key lands on the controller in init(), after this
    // constructor, hence the lazy resolver — the hash is the part of the
    // key before the first dash (see TTSSessionManager.getBookHashFromKey;
    // inlined to avoid a module cycle through the session manager).
    const cacheStore =
      store === undefined
        ? createBookTTSCacheStore(appService, () => controller?.bookKey?.split('-')[0] || null)
        : store;
    if (cacheStore) {
      provider = new CachingProvider(edgeProvider, cacheStore);
    }
    super(provider, controller, appService);
  }

  override async init(_protocol: EDGE_TTS_PROTOCOL = 'wss'): Promise<boolean> {
    return super.init();
  }
}
