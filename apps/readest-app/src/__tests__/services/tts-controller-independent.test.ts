import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { TTSClient, TTSMessageEvent } from '@/services/tts/TTSClient';
import type { TTSGranularity, TTSVoice } from '@/services/tts/types';
import type { FoliateView } from '@/types/view';
import type { AppService } from '@/types/system';

// Independent engines share the per-book cache without any application account.

const h = vi.hoisted(() => ({
  edgeArgs: [] as unknown[][],
  store: { get: async () => null, put: async () => {} },
  customClient: null as Record<string, unknown> | null,
  customInit: true,
  customVoices: null as TTSVoice[] | null,
  customArgs: [] as unknown[],
}));

function mockClient(name: string): TTSClient {
  return {
    name,
    initialized: false,
    init: vi.fn().mockImplementation(async function (this: { initialized: boolean }) {
      this.initialized = true;
      return true;
    }),
    shutdown: vi.fn().mockResolvedValue(undefined),
    speak: vi.fn().mockImplementation(async function* (): AsyncGenerator<TTSMessageEvent> {
      yield { code: 'end' };
    }),
    pause: vi.fn().mockResolvedValue(true),
    resume: vi.fn().mockResolvedValue(true),
    stop: vi.fn().mockResolvedValue(undefined),
    setPrimaryLang: vi.fn(),
    setRate: vi.fn().mockResolvedValue(undefined),
    setPitch: vi.fn().mockResolvedValue(undefined),
    setVoice: vi.fn().mockResolvedValue(undefined),
    getAllVoices: vi.fn().mockResolvedValue([]),
    getVoices: vi.fn().mockResolvedValue([]),
    getGranularities: vi.fn().mockReturnValue(['sentence'] as TTSGranularity[]),
    getCapabilities: vi.fn().mockReturnValue({
      wordBoundaries: true,
      mediaClock: true,
      gapControl: true,
      liveRateChange: false,
    }),
    getVoiceId: vi.fn().mockReturnValue('voice-1'),
    getSpeakingLang: vi.fn().mockReturnValue('en'),
  };
}

const bufferedExtras = () => ({
  setSentenceGap: vi.fn(),
  setParagraphGap: vi.fn(),
  canDownload: vi.fn().mockReturnValue(true),
  getSectionCacheStatuses: vi.fn().mockResolvedValue(new Map()),
  getCacheBytes: vi.fn().mockResolvedValue(0),
  beginDownloadSections: vi.fn(),
  completeDownloadSections: vi.fn(),
  cancelDownloadSections: vi.fn(),
  clearDownloads: vi.fn(),
});

vi.mock('@/services/tts/WebSpeechClient', () => ({
  WebSpeechClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, mockClient('web-speech'));
  }),
}));
vi.mock('@/services/tts/EdgeTTSClient', () => ({
  // constants.ts imports this from here (circular import in production code).
  DEFAULT_SENTENCE_GAP_SEC: 0.15,
  EdgeTTSClient: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    ...args: unknown[]
  ) {
    h.edgeArgs.push(args);
    Object.assign(this, mockClient('edge-tts'), bufferedExtras());
    (this['getAllVoices'] as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' },
    ]);
  }),
}));
vi.mock('@/services/tts/NativeTTSClient', () => ({
  NativeTTSClient: vi.fn(),
}));
vi.mock('@/services/tts/BufferedTTSClient', () => ({
  BufferedTTSClient: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
    ...args: unknown[]
  ) {
    if ((args[0] as { id: string }).id === 'custom-tts') {
      Object.assign(this, mockClient('custom-tts'), bufferedExtras());
      (this['init'] as ReturnType<typeof vi.fn>).mockImplementation(async function (this: {
        initialized: boolean;
      }) {
        this.initialized = h.customInit;
        return h.customInit;
      });
      (this['getAllVoices'] as ReturnType<typeof vi.fn>).mockImplementation(
        async () => h.customVoices ?? CUSTOM_VOICES,
      );
      (this['getVoices'] as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 'custom-tts:svc', name: 'My TTS', voices: CUSTOM_VOICES },
      ]);
      h.customClient = this;
      h.customArgs = args;
      return;
    }
    throw new Error('Unexpected account-dependent provider');
  }),
}));
vi.mock('@/services/tts/providers/openaiCompatible', () => ({
  OpenAICompatibleSpeechProvider: vi.fn().mockImplementation(function (
    this: Record<string, unknown>,
  ) {
    Object.assign(this, { id: 'custom-tts' });
  }),
}));
vi.mock('@/services/tts/providers/bookCacheStore', async (orig) => ({
  ...(await orig<typeof import('@/services/tts/providers/bookCacheStore')>()),
  createBookTTSCacheStore: vi.fn(() => h.store),
}));
vi.mock('@/services/tts/TTSUtils', () => ({
  TTSUtils: {
    getPreferredClient: vi.fn().mockReturnValue(null),
    getPreferredClientForLang: vi.fn().mockReturnValue(null),
    setPreferredClient: vi.fn(),
    setPreferredVoice: vi.fn(),
    getPreferredVoice: vi.fn().mockReturnValue(null),
  },
}));
vi.mock('foliate-js/overlayer.js', () => ({ Overlayer: { highlight: 'highlightFn' } }));
vi.mock('@/utils/node', () => ({ createRejectFilter: vi.fn(() => () => 1) }));

import { TTSController } from '@/services/tts/TTSController';
import { TTSUtils } from '@/services/tts/TTSUtils';
import { CachingProvider } from '@/services/tts/providers/cache';
import { createBookTTSCacheStore } from '@/services/tts/providers/bookCacheStore';

const CUSTOM_VOICES = [
  { id: 'svc:nova', name: 'nova', lang: 'mul' },
  { id: 'kok:af_heart', name: 'af_heart', lang: 'en-US' },
];
const view = {
  renderer: { primaryIndex: 0, getContents: vi.fn().mockReturnValue([]) },
  book: { sections: [] },
  language: { isCJK: false },
  tts: null,
} as unknown as FoliateView;
const appService = { isAndroidApp: false, isIOSApp: false } as unknown as AppService;

let controller: TTSController;
const custom = () => h.customClient as unknown as TTSClient & ReturnType<typeof bufferedExtras>;

beforeEach(() => {
  h.edgeArgs = [];
  h.customInit = true;
  h.customVoices = null;
  vi.mocked(TTSUtils.getPreferredClient).mockReturnValue(null);
  vi.mocked(TTSUtils.getPreferredClientForLang).mockReturnValue(null);
  vi.mocked(createBookTTSCacheStore).mockClear();
  controller = new TTSController(appService, view);
});

afterEach(() => vi.clearAllMocks());

describe('independent engine construction', () => {
  test('Edge and custom TTS share one per-book cache store', () => {
    expect(createBookTTSCacheStore).toHaveBeenCalledTimes(1);
    expect(h.edgeArgs[0]![2]).toBe(h.store);
    expect(h.customArgs[0]).toBeInstanceOf(CachingProvider);
    expect((h.customArgs[0] as CachingProvider).id).toBe('custom-tts');
  });

  test('without a cache store the custom provider is used directly', () => {
    vi.mocked(createBookTTSCacheStore).mockReturnValueOnce(null);
    new TTSController(appService, view);
    expect(h.customArgs[0]).not.toBeInstanceOf(CachingProvider);
  });

  test('an obsolete official-engine preference cannot revive its service', async () => {
    vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('readest-tts');
    await controller.init();
    expect(controller.ttsClient.name).toBe('edge-tts');
    expect((await controller.getVoices('en')).map((group) => group.id)).not.toContain(
      'readest-tts',
    );
  });
});

describe('custom TTS services', () => {
  test('share the per-book cache store and are never the default engine', async () => {
    expect(controller.ttsCustomClient).toBe(custom());
    expect(h.customArgs[0]).toBeInstanceOf(CachingProvider);
    expect((h.customArgs[0] as CachingProvider).id).toBe('custom-tts');
    await controller.init();
    expect(custom().init).toHaveBeenCalled();
    expect(controller.ttsClient.name).toBe('edge-tts');
    vi.mocked(TTSUtils.getPreferredClient).mockReturnValue('custom-tts');
    await controller.init();
    expect(controller.ttsClient).toBe(custom());
  });

  test('list their groups right after narration, for any language', async () => {
    await controller.init();
    vi.mocked(controller.ttsEdgeClient.getVoices).mockResolvedValue([
      { id: 'edge-tts', name: 'Edge TTS', voices: [] },
    ]);
    const groups = await controller.getVoices('de');
    expect(groups.map((g) => g.id)).toEqual(['custom-tts:svc', 'edge-tts']);
  });

  test('are hidden when no service is configured', async () => {
    h.customInit = false;
    await controller.init();
    const groups = await controller.getVoices('en');
    expect(groups.map((g) => g.id)).not.toContain('custom-tts:svc');
  });

  test('a custom voice selects the custom client, which keeps it for any language', async () => {
    await controller.init();
    await controller.setVoice('svc:nova', 'en');
    expect(controller.ttsClient).toBe(custom());
    expect(TTSUtils.setPreferredClient).toHaveBeenCalledWith('custom-tts', '');
    expect(custom().setVoice).toHaveBeenCalledWith('svc:nova');
    await controller.setLang('ja');
    expect(controller.ttsClient).toBe(custom());
  });

  test('a service without a voice for the book language yields to the default engine', async () => {
    h.customVoices = [CUSTOM_VOICES[1]!];
    await controller.init();
    await controller.setVoice('kok:af_heart', 'en-US');
    await controller.setLang('en-GB');
    expect(controller.ttsClient).toBe(custom());
    await controller.setLang('ja');
    expect(controller.ttsClient.name).toBe('edge-tts');
  });

  test('settings, downloads and shutdown fan out to the custom client', async () => {
    await controller.init();
    await controller.setVoice('svc:nova', 'en');
    await controller.setPrimaryLang('en');
    controller.setSentenceGap(0.2);
    controller.setParagraphGap(0.5);
    await controller.clearDownloads();
    await controller.shutdown();
    expect(custom().setPrimaryLang).toHaveBeenCalledWith('en');
    expect(custom().setSentenceGap).toHaveBeenCalledWith(0.2);
    expect(custom().setParagraphGap).toHaveBeenCalledWith(0.5);
    expect(custom().clearDownloads).toHaveBeenCalledTimes(1);
    expect(custom().shutdown).toHaveBeenCalled();
  });
});
