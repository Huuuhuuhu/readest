import { render, act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import type { BookDoc, TOCItem } from '@/libs/document';

const bookDoc = { sections: [], rendition: {} } as unknown as BookDoc;

// ---------- Shared mutable test state (captured by the mock factories) ----------
let scrollToIndexSpy: Mock<(arg: unknown) => void>;
// Only the FIRST (mount-time) `initialized` callback is captured, mirroring how
// OverlayScrollbars binds its event handlers when it initializes the viewport.
// A fix that relied on a fresher render closure would pass against the latest
// callback but still break in the real app — so the test forces a ref-based fix.
let capturedInitialized:
  | ((instance: { elements: () => { viewport: HTMLElement } }) => void)
  | undefined;
let mockProgress: { sectionHref: string; location: string } | null;
const goTo = vi.fn();
const goToFraction = vi.fn();
const setSideBarVisible = vi.fn();

// ---------- Mocks ----------
vi.mock('@/store/readerStore', () => {
  const state = {
    getView: () => ({ goTo, goToFraction }),
    getViewSettings: () => ({ isEink: false }),
    getProgress: () => mockProgress,
  };
  return {
    useReaderStore: <R,>(selector?: (s: typeof state) => R) => (selector ? selector(state) : state),
  };
});

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(() => ({ sideBarBookKey: 'book1', isSideBarVisible: true }), {
    getState: () => ({ setSideBarVisible }),
  }),
}));

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn(), on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/services/nav', async () => import('@/services/nav/lookup'));

vi.mock('@/utils/misc', () => ({
  getContentMd5: (s: string) => s,
  stubTranslation: (s: string) => s,
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));

vi.mock('@/app/reader/hooks/useTextTranslation', () => ({
  useTextTranslation: () => {},
}));

// Virtuoso is replaced with a stub that exposes a spy-able `scrollToIndex`
// through the imperative handle and hands TOCView a scroller element.
vi.mock('react-virtuoso', async () => {
  const ReactMod = await import('react');
  return {
    Virtuoso: ReactMod.forwardRef(
      (
        props: {
          scrollerRef?: (el: HTMLElement | Window | null) => void;
          totalCount?: number;
          itemContent?: (index: number) => React.ReactNode;
        },
        ref: React.Ref<unknown>,
      ) => {
        ReactMod.useImperativeHandle(ref, () => ({
          scrollToIndex: (arg: unknown) => scrollToIndexSpy(arg),
        }));
        ReactMod.useEffect(() => {
          props.scrollerRef?.(document.createElement('div'));
        }, []);
        return (
          <div>
            {Array.from({ length: Math.min(10, props.totalCount ?? 0) }, (_, index) => (
              <ReactMod.Fragment key={index}>{props.itemContent?.(index)}</ReactMod.Fragment>
            ))}
          </div>
        );
      },
    ),
  };
});

// Capture the OverlayScrollbars `initialized` callback so the test can fire it
// on demand (the real hook fires it after a deferred, timing-dependent init).
vi.mock('overlayscrollbars-react', () => ({
  useOverlayScrollbars: (opts: {
    events?: { initialized?: (i: { elements: () => { viewport: HTMLElement } }) => void };
  }) => {
    if (!capturedInitialized) capturedInitialized = opts.events?.initialized;
    return [vi.fn(), () => undefined];
  },
}));

// eslint-disable-next-line import/first
import TOCView from '@/app/reader/components/sidebar/TOCView';

const makeFlatToc = (count: number): TOCItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    label: `Chapter ${i}`,
    href: `ch${i}.html`,
    index: i,
  }));

const fireOverlayScrollbarsInitialized = () => {
  act(() => {
    capturedInitialized?.({ elements: () => ({ viewport: document.createElement('div') }) });
  });
};

beforeEach(() => {
  scrollToIndexSpy = vi.fn<(arg: unknown) => void>();
  capturedInitialized = undefined;
  mockProgress = null;
  // Run rAF synchronously so the callback's scroll happens inside act().
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('TV TOC jump controls', () => {
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'true'));

  it('returns to reading after confirming a chapter, even with a pinned sidebar', () => {
    render(<TOCView bookKey='book1' bookDoc={bookDoc} toc={makeFlatToc(3)} />);
    fireEvent.click(screen.getByRole('treeitem', { name: 'Chapter 1, 2' }));
    expect(goTo).toHaveBeenCalledWith('ch1.html');
    expect(setSideBarVisible).toHaveBeenCalledWith(false);
  });

  it('keeps the existing desktop sidebar behavior outside TV mode', () => {
    vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'false');
    render(<TOCView bookKey='book1' bookDoc={bookDoc} toc={makeFlatToc(3)} />);
    fireEvent.click(screen.getByRole('treeitem', { name: 'Chapter 1, 2' }));
    expect(goTo).toHaveBeenCalledWith('ch1.html');
    expect(setSideBarVisible).not.toHaveBeenCalled();
  });

  it('finds chapters inside collapsed volumes without changing the reading location', () => {
    const chapters = makeFlatToc(2000);
    const toc = [
      { id: 3000, label: 'Volume one', href: '', subitems: chapters.slice(0, 1000) },
      { id: 3001, label: 'Volume two', href: '', subitems: chapters.slice(1000) },
    ] as TOCItem[];
    render(<TOCView bookKey='book1' bookDoc={bookDoc} toc={toc} />);
    fireEvent.change(screen.getByLabelText('Chapter number'), { target: { value: '1500' } });
    fireEvent.click(screen.getByText('Go'));
    expect(screen.queryByText('Chapter number is out of range')).toBeNull();
    // First volume remains collapsed; second volume expands to reveal chapter 1500.
    expect(scrollToIndexSpy).toHaveBeenCalledWith(expect.objectContaining({ index: 501 }));
    expect(goTo).not.toHaveBeenCalled();
  });

  it('uses page numbers for a PDF with no outline, including with thumbnails disabled', () => {
    const pdf = { ...bookDoc, getPageThumbnail: vi.fn(), sections: Array(20).fill({}) } as BookDoc;
    render(<TOCView bookKey='book1' bookDoc={pdf} toc={[]} />);
    fireEvent.change(screen.getByLabelText('Page number'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Go'));
    expect(goTo).toHaveBeenCalledWith(11);
  });

  it('offers progress for a TXT with no chapters and rejects invalid percentages', () => {
    render(<TOCView bookKey='book1' bookDoc={bookDoc} toc={[]} />);
    fireEvent.change(screen.getByLabelText('Reading progress (%)'), { target: { value: '101' } });
    fireEvent.click(screen.getByText('Go'));
    expect(goToFraction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reading progress (%)'), { target: { value: '35' } });
    fireEvent.click(screen.getByText('Go'));
    expect(goToFraction).toHaveBeenCalledWith(0.35);
    expect(setSideBarVisible).toHaveBeenCalledWith(false);
  });
});

describe('TOCView — OverlayScrollbars init does not rewind the TOC to the top', () => {
  it('re-applies the auto-scroll to the active item when OverlayScrollbars initializes after the reading position arrives', () => {
    const toc = makeFlatToc(8);
    const activeHref = 'ch5.html';

    // Fresh refresh: TOCView mounts before the first relocate, so `progress`
    // (and thus the mount-time initialScrollTarget) has no reading position.
    mockProgress = null;
    const { rerender } = render(<TOCView bookKey='book1' bookDoc={bookDoc} toc={toc} />);

    // The relocate arrives → the normal auto-scroll effect centers the active
    // chapter. (OverlayScrollbars' deferred init, which resets scrollTop to 0,
    // has not fired yet.)
    mockProgress = { sectionHref: activeHref, location: 'epubcfi(/6/12!/4/1:0)' };
    act(() => {
      rerender(<TOCView bookKey='book1' bookDoc={bookDoc} toc={toc} />);
    });

    // Ignore that first scroll; we only care whether the OverlayScrollbars init
    // (which clobbers scrollTop) re-applies it instead of stranding the top.
    scrollToIndexSpy.mockClear();

    fireOverlayScrollbarsInitialized();

    expect(scrollToIndexSpy).toHaveBeenCalledWith(expect.objectContaining({ index: 5 }));
  });

  it('does not force a scroll on OverlayScrollbars init when there is no reading position', () => {
    const toc = makeFlatToc(8);

    mockProgress = null;
    render(<TOCView bookKey='book1' bookDoc={bookDoc} toc={toc} />);

    scrollToIndexSpy.mockClear();
    fireOverlayScrollbarsInitialized();

    expect(scrollToIndexSpy).not.toHaveBeenCalled();
  });
});
