import { afterEach, describe, expect, it, vi } from 'vitest';
import { CachingProvider, computeTTSCacheKey } from '@/services/tts/providers/cache';
import { BufferedTTSClient } from '@/services/tts/BufferedTTSClient';
import { speechAhead } from '@/services/tts/speechAhead';

afterEach(() => {
  vi.unstubAllEnvs();
  speechAhead.clear();
});
describe('TV automatic audio versus explicit offline downloads', () => {
  it('keeps automatic synthesis off disk, while explicit chapter downloads persist the same audio', async () => {
    vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'true');
    const store = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      recordMarkKey: vi.fn(async () => {}),
    };
    const inner = {
      id: 'test',
      label: 'Test',
      fallbackVoiceId: 'en-US-Test',
      init: async () => true,
      getAllVoices: async () => [{ id: 'en-US-Test', name: 'Test', lang: 'en-US' }],
      synthesize: vi.fn(async () => ({ audio: new ArrayBuffer(4), boundaries: [] })),
    };
    const provider = new CachingProvider(inner, store);
    const client = new BufferedTTSClient(provider);
    await client.init();
    const req = { lang: 'en', text: 'One sentence.', voice: 'en-US-Test', pitch: 1 };
    await provider.synthesize(req, new AbortController().signal);
    expect(store.put).not.toHaveBeenCalled();
    expect(await client.warmSentence(0, 0, 'en', 'One sentence.')).toBe(true);
    expect(store.put).toHaveBeenCalledOnce();
    expect(store.recordMarkKey).toHaveBeenCalledOnce();
    expect(inner.synthesize).toHaveBeenCalledOnce();

    // The foreground pre-generator and playback use exactly the same key and
    // synthesis path. An automatic hit must not call the online service again.
    const next = { ...req, text: 'A prefetched sentence.' };
    speechAhead.follow(
      {
        bookHash: 'book',
        section: 0,
        position: 'next',
        voice: 'test',
        async *sentences() {
          yield {
            key: computeTTSCacheKey('test', next),
            section: 0,
            seconds: 1,
            synthesize: async () => ({ audio: new ArrayBuffer(8), boundaries: [] }),
          };
        },
      },
      0,
    );
    await vi.waitFor(() =>
      expect(speechAhead.get(computeTTSCacheKey('test', next))).not.toBeNull(),
    );
    expect(await client.warmSentence(0, 1, 'en', next.text)).toBe(true);
    expect(inner.synthesize).toHaveBeenCalledOnce();
    expect(store.put).toHaveBeenCalledTimes(2);
  });
});
