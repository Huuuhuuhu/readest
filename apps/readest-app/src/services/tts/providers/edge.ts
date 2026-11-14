// Edge (Microsoft) speech as a SpeechProvider. The direct Microsoft WebSocket
// transport, LRU + inflight caches, and voice list all stay in
// EdgeSpeechTTS (@/libs/edgeTTS); this adapter owns the contract-level
// concerns — the rate-1.0 invariant and permanent-error classification.

import { EDGE_TTS_PROTOCOL, EdgeSpeechTTS } from '@/libs/edgeTTS';
import type { TTSVoice } from '../types';
import {
  SpeechProvider,
  SpeechSynthesisPermanentError,
  SpeechSynthesisRequest,
  SpeechSynthesisResult,
} from './types';

export class EdgeSpeechProvider implements SpeechProvider {
  readonly id = 'edge-tts';
  readonly label = 'Edge TTS';
  readonly fallbackVoiceId = 'en-US-AriaNeural';
  readonly cacheable = true;

  #tts: EdgeSpeechTTS | null = null;

  // Microsoft only. A failed connection never falls back to a Readest proxy.
  async init(protocol: EDGE_TTS_PROTOCOL = 'wss'): Promise<boolean> {
    this.#tts = new EdgeSpeechTTS(protocol);
    // Voices are bundled. Probe synthesis added a round trip before the first
    // actual sentence, even for offline cached audio. Report transport errors
    // on the requested sentence instead of gating the whole player on a probe.
    return true;
  }

  async getAllVoices(): Promise<TTSVoice[]> {
    return EdgeSpeechTTS.voices;
  }

  async synthesize(
    req: SpeechSynthesisRequest,
    signal: AbortSignal,
  ): Promise<SpeechSynthesisResult> {
    const tts = this.#tts;
    if (!tts) throw new Error('EdgeSpeechProvider not initialized');
    try {
      // Rate pinned to 1.0: keeps the audio cache rate-independent; the
      // playback rate is applied at playout.
      const { data, boundaries } = await tts.createAudioData(
        {
          lang: req.lang,
          text: req.text,
          voice: req.voice,
          rate: 1.0,
          pitch: req.pitch,
        },
        signal,
      );
      return { audio: data, boundaries };
    } catch (err) {
      // Permanent for this sentence: Edge answered without audio frames.
      if (err instanceof Error && err.message === 'No audio data received.') {
        throw new SpeechSynthesisPermanentError(err.message, { cause: err });
      }
      throw err;
    }
  }

  pickDefaultVoice(voices: TTSVoice[]): string | undefined {
    // Avoid AnaNeural (a child voice) as an accidental English default.
    const first = voices[0];
    if (first?.id === 'en-US-AnaNeural') return 'en-US-AriaNeural';
    return first?.id;
  }
}
