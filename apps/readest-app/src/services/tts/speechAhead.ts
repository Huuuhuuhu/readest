import type { SpeechSynthesisResult } from './providers/types';

export interface SpeechAheadItem {
  key: string;
  section: number;
  seconds: number;
  synthesize(signal: AbortSignal): Promise<SpeechSynthesisResult>;
}
export interface SpeechAheadPosition {
  bookHash: string;
  section: number;
  position: string;
  voice: string;
  sentences(signal: AbortSignal): AsyncIterable<SpeechAheadItem>;
  onSettled?: () => void;
}

export class SpeechAhead {
  #entries = new Map<string, { section: number; result: SpeechSynthesisResult }>();
  #position: Pick<SpeechAheadPosition, 'bookHash' | 'section' | 'position' | 'voice'> | null = null;
  #abort: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #bytes = 0;
  #finish: (() => void) | undefined;
  #pending = new Map<string, { signal: AbortSignal; result: Promise<SpeechSynthesisResult> }>();
  constructor(readonly budgetBytes = 8 * 1024 * 1024) {}
  follow(position: SpeechAheadPosition, delay = 250): void {
    const previous = this.#position;
    if (
      previous?.bookHash === position.bookHash &&
      previous.voice === position.voice &&
      previous.position === position.position &&
      previous.section === position.section
    )
      return;
    this.pause();
    if (previous?.bookHash !== position.bookHash || previous.voice !== position.voice) {
      this.#entries.clear();
      this.#bytes = 0;
    }
    for (const [key, entry] of this.#entries) {
      if (entry.section < position.section || entry.section > position.section + 1) {
        this.#entries.delete(key);
        this.#bytes -= entry.result.audio.byteLength;
      }
    }
    this.#position = {
      bookHash: position.bookHash,
      section: position.section,
      position: position.position,
      voice: position.voice,
    };
    const abort = new AbortController();
    this.#abort = abort;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (this.#finish === finish) this.#finish = undefined;
      position.onSettled?.();
    };
    this.#finish = finish;
    this.#timer = setTimeout(() => {
      void this.#fill(position, abort.signal).finally(finish);
    }, delay);
  }
  async #fill(position: SpeechAheadPosition, signal: AbortSignal): Promise<void> {
    let seconds = 0;
    let count = 0;
    const wanted = new Set<string>();
    try {
      for await (const item of position.sentences(signal)) {
        if (signal.aborted || seconds >= 180 || count >= 128) break;
        if (item.section < position.section || item.section > position.section + 1) break;
        seconds += item.seconds;
        count++;
        wanted.add(item.key);
        if (!this.#entries.has(item.key)) {
          // Slide the bounded window forward within a very long chapter too.
          for (const [key, entry] of this.#entries) {
            if (this.#bytes < this.budgetBytes) break;
            if (wanted.has(key)) continue;
            this.#entries.delete(key);
            this.#bytes -= entry.result.audio.byteLength;
          }
          if (this.#bytes >= this.budgetBytes) break;
          const pending = { signal, result: item.synthesize(signal) };
          this.#pending.set(item.key, pending);
          let result: SpeechSynthesisResult;
          try {
            result = await pending.result;
          } finally {
            if (this.#pending.get(item.key) === pending) this.#pending.delete(item.key);
          }
          if (signal.aborted) break;
          if (this.#bytes + result.audio.byteLength > this.budgetBytes) break;
          this.#entries.set(item.key, { section: item.section, result });
          this.#bytes += result.audio.byteLength;
        }
        // Yield between sentences, including cache hits: parsing a long chapter
        // must not monopolize the WebView's input/render thread.
        await new Promise<void>((resolve) => setTimeout(resolve, 16));
      }
    } catch {
      // Optional lookahead is silent and has no retry loop. Live playback owns
      // errors and engine switching; a later position/foreground change retries.
    } finally {
      if (!signal.aborted)
        for (const [key, entry] of this.#entries) {
          if (wanted.has(key)) continue;
          this.#entries.delete(key);
          this.#bytes -= entry.result.audio.byteLength;
        }
    }
  }
  get(key: string): SpeechSynthesisResult | null {
    const entry = this.#entries.get(key)?.result;
    return entry ? { audio: entry.audio.slice(0), boundaries: entry.boundaries } : null;
  }
  async ready(key: string, signal: AbortSignal): Promise<SpeechSynthesisResult | null> {
    const cached = this.get(key);
    if (cached) return cached;
    const pending = this.#pending.get(key);
    if (!pending || pending.signal.aborted || signal.aborted) return null;
    return new Promise((resolve) => {
      const done = (result: SpeechSynthesisResult | null) => {
        pending.signal.removeEventListener('abort', abort);
        signal.removeEventListener('abort', abort);
        resolve(result ? { ...result, audio: result.audio.slice(0) } : null);
      };
      const abort = () => done(null);
      pending.signal.addEventListener('abort', abort, { once: true });
      signal.addEventListener('abort', abort, { once: true });
      pending.result.then(
        (result) => done(pending.signal.aborted ? null : result),
        () => done(null),
      );
    });
  }
  pause(): void {
    this.#abort?.abort();
    this.#abort = null;
    this.#pending.clear();
    clearTimeout(this.#timer);
    this.#finish?.();
    this.#finish = undefined;
    // Keep context for pruning but allow resuming this same position.
    if (this.#position) this.#position = { ...this.#position, position: '' };
  }
  clear(): void {
    this.pause();
    this.#position = null;
    this.#entries.clear();
    this.#bytes = 0;
  }
}
export const speechAhead = new SpeechAhead();
