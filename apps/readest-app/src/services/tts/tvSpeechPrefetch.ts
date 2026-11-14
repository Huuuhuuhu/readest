// One foreground lookahead, shared by imported books and the displayed reader.
// Compressed audio only: no player, media session, SQLite writes or background service.
import type { BookDoc } from '@/libs/document';
import type { Book, PairedAudiobook, ViewSettings } from '@/types/book';
import type { AppService } from '@/types/system';
import { isTVMode } from '@/utils/tvInput';
import { isCJKLang } from '@/utils/lang';
import { parseSSMLMarks } from '@/utils/ssml';
import { getEnabledCustomTTSServices } from '@/store/customTTSStore';
import { useSettingsStore } from '@/store/settingsStore';
import { BufferedTTSClient } from './BufferedTTSClient';
import { EdgeSpeechProvider } from './providers/edge';
import { OpenAICompatibleSpeechProvider } from './providers/openaiCompatible';
import { speechCacheKey } from './providers/cache';
import { createTTSNodeFilter } from './nodeFilter';
import { transformTTSSectionDocument } from './transformDoc';
import { stripInlineReadingAnnotationsFromSSML } from './inlineAnnotations';
import { estimateSentenceSeconds } from './ttsDuration';
import { TTSUtils } from './TTSUtils';
import { speechAhead } from './speechAhead';
import { hasMediaOverlays } from './mediaOverlay';
import { findPairedAudiobookSection } from './pairedAudiobook';

export interface TVSpeechPosition {
  bookHash: string;
  book: BookDoc;
  section: number;
  position: string;
  lang: string;
  settings: Pick<ViewSettings, 'ttsVoice' | 'ttsSkipInlineAnnotations' | 'ttsUseNarration'>;
  pairedAudiobook?: PairedAudiobook | null;
  anchor?: (doc: Document) => Range;
  preprocess?: (ssml: string) => Promise<string>;
  onSettled?: () => void;
}
let readerOwner: string | null = null;
let current: TVSpeechPosition | null = null;
let importGeneration = 0;
let releaseImport: (() => void) | undefined;
let listening = false;

export function followTVSpeech(position: TVSpeechPosition): void {
  if (!isTVMode()) return;
  current = position;
  if (!listening) {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) speechAhead.pause();
      else if (current) followTVSpeech(current);
    });
    window.addEventListener('online', () => {
      speechAhead.pause();
      if (current && !document.hidden) followTVSpeech(current);
    });
  }
  if (document.hidden) {
    speechAhead.pause();
    position.onSettled?.();
    return;
  }
  const engine = TTSUtils.getPreferredClient(position.lang) ?? 'edge-tts';
  // System voices synthesize/play inside Android's engine; do not make online
  // requests for a different engine behind the user's selected voice.
  if (
    !['edge-tts', 'custom-tts'].includes(engine) ||
    (position.settings.ttsUseNarration !== false &&
      (hasMediaOverlays(position.book) ||
        (position.pairedAudiobook &&
          findPairedAudiobookSection(position.book, position.pairedAudiobook, 0, 1) >= 0)))
  ) {
    speechAhead.clear();
    position.onSettled?.();
    return;
  }
  const services = getEnabledCustomTTSServices();
  const provider =
    engine === 'custom-tts'
      ? new OpenAICompatibleSpeechProvider(() => services)
      : new EdgeSpeechProvider();
  const voice = JSON.stringify([
    engine,
    position.settings.ttsVoice,
    position.settings.ttsSkipInlineAnnotations,
    TTSUtils.getDefaultVoice(position.lang),
    engine === 'custom-tts' ? services : null,
  ]);
  speechAhead.follow({
    ...position,
    voice,
    async *sentences(signal) {
      const client = new BufferedTTSClient(provider);
      if (!(await client.init()) || signal.aborted) return;
      client.setPrimaryLang(position.lang);
      if (position.settings.ttsVoice) await client.setVoice(position.settings.ttsVoice);
      const [{ TTS }, { textWalker }] = await Promise.all([
        import('foliate-js/tts.js'),
        import('foliate-js/text-walker.js'),
      ]);
      const preferredGranularity = isCJKLang(position.lang) ? 'sentence' : 'word';
      const supported = client.getGranularities();
      const granularity = supported.includes(preferredGranularity)
        ? preferredGranularity
        : supported[0]!;
      for (let index = position.section; index <= position.section + 1; index++) {
        if (signal.aborted) return;
        const section = position.book.sections[index];
        if (!section?.createDocument) return;
        const doc = await transformTTSSectionDocument(
          position.book,
          section.id,
          await section.createDocument(),
        );
        if (signal.aborted) return;
        if (!doc.documentElement.getAttribute('lang'))
          doc.documentElement.setAttribute('lang', position.lang);
        const tts = new TTS(doc, textWalker, createTTSNodeFilter(), () => {}, granularity);
        let ssml =
          index === position.section && position.anchor
            ? tts.from(position.anchor(doc))
            : tts.start();
        for (; ssml && !signal.aborted; ssml = tts.next()) {
          const raw = position.settings.ttsSkipInlineAnnotations
            ? stripInlineReadingAnnotationsFromSSML(ssml)
            : ssml;
          const processed = position.preprocess ? await position.preprocess(raw) : raw;
          const { marks } = parseSSMLMarks(processed, position.lang);
          for (const mark of marks) {
            if (signal.aborted) return;
            const req = {
              lang: mark.language,
              text: mark.text,
              voice: await client.getVoiceIdFromLang(mark.language),
              pitch: 1,
            };
            yield {
              section: index,
              key: speechCacheKey(provider, req),
              seconds: estimateSentenceSeconds(req.text, req.lang, req.voice),
              synthesize: (signal: AbortSignal) => provider.synthesize(req, signal),
            };
          }
        }
      }
    },
  });
}

export function claimTVSpeechReader(bookKey: string): () => void {
  readerOwner = bookKey;
  importGeneration++;
  speechAhead.pause();
  releaseImport?.();
  releaseImport = undefined;
  return () => {
    if (readerOwner !== bookKey) return;
    readerOwner = null;
    current = null;
    speechAhead.pause();
  };
}

export async function prefetchImportedTVBook(app: AppService, book: Book): Promise<void> {
  if (!isTVMode() || readerOwner || document.hidden) return;
  const generation = ++importGeneration;
  // The import and cover have finished before reopening anything for speech.
  await new Promise<void>((resolve) => setTimeout(resolve, 750));
  if (generation !== importGeneration || readerOwner || document.hidden) return;
  let doc: BookDoc | undefined;
  let file: (File & { close?: () => Promise<void> }) | undefined;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    void Promise.resolve(doc?.destroy?.()).catch(() => {});
    void file?.close?.().catch(() => {});
  };
  try {
    const { DocumentLoader } = await import('@/libs/document');
    file = (await app.loadBookContent(book)).file;
    doc = (await new DocumentLoader(file).open()).book;
    if (generation !== importGeneration || readerOwner) {
      release();
      return;
    }
    releaseImport?.();
    releaseImport = release;
    followTVSpeech({
      bookHash: book.hash,
      book: doc,
      section: 0,
      position: 'import',
      lang: book.primaryLanguage || 'en',
      settings: useSettingsStore.getState().settings.globalViewSettings,
      onSettled: () => {
        if (current?.book === doc) current = null;
        if (releaseImport === release) releaseImport = undefined;
        release();
      },
    });
  } catch {
    release();
  }
}
