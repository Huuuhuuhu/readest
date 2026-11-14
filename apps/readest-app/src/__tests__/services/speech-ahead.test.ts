import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SpeechAhead,
  type SpeechAheadItem,
  type SpeechAheadPosition,
} from '@/services/tts/speechAhead';

const audio = (size = 4) => ({ audio: new ArrayBuffer(size), boundaries: [] });
const item = (key: string, section = 0, seconds = 10): SpeechAheadItem => ({
  key,
  section,
  seconds,
  synthesize: vi.fn(async () => audio()),
});
const position = (section: number, items: SpeechAheadItem[]): SpeechAheadPosition => ({
  bookHash: 'book',
  section,
  position: String(section),
  voice: 'voice',
  async *sentences() {
    yield* items;
  },
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('foreground speech ahead', () => {
  it('shares an in-flight sentence with playback and releases its document once', async () => {
    const cache = new SpeechAhead();
    const onSettled = vi.fn();
    let finish!: (result: ReturnType<typeof audio>) => void;
    const entry = item('shared');
    entry.synthesize = vi.fn(
      () =>
        new Promise<ReturnType<typeof audio>>((resolve) => {
          finish = resolve;
        }),
    );
    cache.follow({ ...position(0, [entry]), onSettled }, 0);
    await vi.advanceTimersByTimeAsync(0);
    const ready = cache.ready('shared', new AbortController().signal);
    finish(audio());
    expect((await ready)?.audio.byteLength).toBe(4);
    await vi.runAllTimersAsync();
    cache.pause();
    expect(onSettled).toHaveBeenCalledOnce();
    expect(entry.synthesize).toHaveBeenCalledOnce();
  });

  it('slides forward within one long chapter without filling storage with already-read sentences', async () => {
    const cache = new SpeechAhead(8);
    cache.follow(position(0, [item('a'), item('b')]), 0);
    await vi.runAllTimersAsync();
    cache.follow({ ...position(0, [item('c'), item('d')]), position: 'later page' }, 0);
    await vi.runAllTimersAsync();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
    expect(cache.get('c')).not.toBeNull();
    expect(cache.get('d')).not.toBeNull();
  });
  it('warms silently, reuses audio, and deletes the completed chapter while keeping the next', async () => {
    const cache = new SpeechAhead();
    const first = item('first');
    const next = item('next', 1);
    cache.follow(position(0, [first, next]), 0);
    await vi.runAllTimersAsync();
    expect(cache.get('first')?.audio.byteLength).toBe(4);
    cache.follow(position(1, [next]), 0);
    expect(cache.get('first')).toBeNull();
    await vi.runAllTimersAsync();
    expect(next.synthesize).toHaveBeenCalledOnce();
    expect(cache.get('next')?.audio).not.toBe(cache.get('next')?.audio);
  });

  it('aborts a distant chapter instantly and rejects its late result without delaying the new one', async () => {
    const cache = new SpeechAhead();
    let signal: AbortSignal | undefined;
    let finish!: (result: ReturnType<typeof audio>) => void;
    const slow = item('old');
    slow.synthesize = (s) => {
      signal = s;
      return new Promise<ReturnType<typeof audio>>((resolve) => {
        finish = resolve;
      });
    };
    cache.follow(position(0, [slow]), 0);
    await vi.advanceTimersByTimeAsync(0);
    cache.follow(position(600, [item('new', 600)]), 0);
    expect(signal?.aborted).toBe(true);
    await vi.runAllTimersAsync();
    expect(cache.get('new')).not.toBeNull();
    finish(audio());
    await Promise.resolve();
    expect(cache.get('old')).toBeNull();
  });

  it('bounds both generated duration and bytes, and stops quietly on service failure', async () => {
    const cache = new SpeechAhead(8);
    const entries = [item('a'), item('b'), item('c')];
    cache.follow(position(0, entries), 0);
    await vi.runAllTimersAsync();
    expect(entries[2]!.synthesize).not.toHaveBeenCalled();
    cache.clear();
    const long = item('long', 0, 180);
    const excess = item('excess');
    cache.follow(position(0, [long, excess]), 0);
    await vi.runAllTimersAsync();
    expect(excess.synthesize).not.toHaveBeenCalled();
    cache.clear();
    const broken = item('broken');
    broken.synthesize = vi.fn(async () => {
      throw new Error('offline');
    });
    cache.follow(position(0, [broken, excess]), 0);
    await vi.runAllTimersAsync();
    expect(broken.synthesize).toHaveBeenCalledOnce();
    expect(excess.synthesize).not.toHaveBeenCalled();
  });

  it('stops when hidden or closed and clears audio on book or voice replacement', async () => {
    const cache = new SpeechAhead();
    const entry = item('a');
    cache.follow(position(0, [entry]));
    cache.pause();
    await vi.runAllTimersAsync();
    expect(entry.synthesize).not.toHaveBeenCalled();
    cache.follow(position(0, [entry]), 0);
    await vi.runAllTimersAsync();
    cache.follow({ ...position(0, []), voice: 'new voice' });
    expect(cache.get('a')).toBeNull();
  });
});
