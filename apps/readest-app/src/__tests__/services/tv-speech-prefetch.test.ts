import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookDoc } from '@/libs/document';
import type { SpeechSynthesisRequest } from '@/services/tts/providers/types';
import { speechAhead } from '@/services/tts/speechAhead';
import { claimTVSpeechReader, followTVSpeech } from '@/services/tts/tvSpeechPrefetch';
import { computeTTSCacheKey } from '@/services/tts/providers/cache';
import { TTSUtils } from '@/services/tts/TTSUtils';

const synthesize = vi.hoisted(() =>
  vi.fn(async (_req: SpeechSynthesisRequest, _signal: AbortSignal) => ({
    audio: new ArrayBuffer(4),
    boundaries: [],
  })),
);
vi.mock('@/services/tts/providers/edge', () => ({
  EdgeSpeechProvider: class {
    id = 'edge-tts';
    label = 'Edge TTS';
    fallbackVoiceId = 'en-US-AriaNeural';
    init = async () => true;
    getAllVoices = async () => [{ id: 'en-US-AriaNeural', name: 'Aria', lang: 'en-US' }];
    synthesize = synthesize;
  },
}));
vi.mock('@/store/customTTSStore', () => ({ getEnabledCustomTTSServices: () => [] }));

const makeBook = (): BookDoc =>
  ({
    sections: [0, 1].map((i) => ({
      id: String(i),
      createDocument: async () => {
        const doc = document.implementation.createHTMLDocument();
        doc.body.innerHTML =
          i === 0 ? '<p>Skip this.</p><p>Read this.</p>' : '<p>Next chapter.</p>';
        return doc;
      },
    })),
  }) as unknown as BookDoc;
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'true');
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  localStorage.clear();
  synthesize.mockClear();
});
afterEach(() => {
  claimTVSpeechReader('cleanup')();
  speechAhead.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('TV foreground prefetch uses the live speech pipeline', () => {
  it('starts at the page anchor, applies speech corrections, and retains audio under playback keys', async () => {
    const release = claimTVSpeechReader('book-view');
    followTVSpeech({
      bookHash: 'book',
      book: makeBook(),
      section: 0,
      position: 'paragraph2',
      lang: 'en',
      settings: { ttsVoice: '', ttsSkipInlineAnnotations: false, ttsUseNarration: true },
      anchor: (doc) => {
        const range = doc.createRange();
        range.selectNodeContents(doc.querySelectorAll('p')[1]!);
        return range;
      },
      preprocess: async (ssml) => ssml.replace('Read this', 'Corrected speech'),
    });
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalledTimes(2), { timeout: 3000 });
    const requests = synthesize.mock.calls.map(([req]) => req);
    expect(requests.map((req) => req.text.trim())).toEqual(['Corrected speech.', 'Next chapter.']);
    expect(speechAhead.get(computeTTSCacheKey('edge-tts', requests[0]!))).not.toBeNull();
    release();
  });

  it('does not synthesize with Edge when Android system speech is selected or the app is hidden', async () => {
    const input = {
      bookHash: 'book',
      book: makeBook(),
      section: 0,
      position: 'start',
      lang: 'en',
      settings: { ttsVoice: '', ttsSkipInlineAnnotations: false, ttsUseNarration: true },
    };
    TTSUtils.setPreferredClient('native-tts', 'en');
    followTVSpeech(input);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(synthesize).not.toHaveBeenCalled();
    TTSUtils.setPreferredClient('edge-tts', 'en');
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    followTVSpeech(input);
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(synthesize).not.toHaveBeenCalled();
  });

  it('does not mistake media metadata without narration for a recorded book', async () => {
    const book = makeBook();
    book.media = { duration: 0 } as BookDoc['media'];
    followTVSpeech({
      bookHash: 'metadata-only',
      book,
      section: 0,
      position: 'start',
      lang: 'en',
      settings: { ttsVoice: '', ttsSkipInlineAnnotations: false, ttsUseNarration: true },
    });
    await vi.waitFor(() => expect(synthesize).toHaveBeenCalled(), { timeout: 1500 });
  });
});
