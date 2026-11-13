import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useOverlayScrollbars } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';

import { BookDoc, TOCItem } from '@/libs/document';
import { BookProgress } from '@/types/book';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { eventDispatcher } from '@/utils/event';
import { focusTV, getTVScope, isTVMode } from '@/utils/tvInput';
import { useTranslation } from '@/hooks/useTranslation';
import { useTextTranslation } from '../../hooks/useTextTranslation';
import {
  buildTOCDisplayItems,
  CurrentPositionRow,
  isCurrentPositionItem,
  isPageThumbnailsItem,
  StaticListRow,
  TOCDisplayItem,
  TOCListItem,
} from './TOCItem';
import { PageThumbnailsRow } from './PageThumbnails';
import {
  buildPageThumbnailRows,
  computeExpandedSet,
  computeTOCPageRanges,
  findActiveRowIndex,
  flattenTOC,
  getItemIdentifier,
  getThumbnailsPerRow,
  PageRange,
} from './tocTree';

// A PDF without an outline lists all of its pages instead.
const buildTOCListItems = (
  toc: TOCItem[],
  expandedItems: Set<string>,
  pageRanges: Map<TOCItem, PageRange> | undefined,
  totalPages: number,
  thumbnailsPerRow?: number,
): TOCListItem[] =>
  !toc.length && pageRanges
    ? buildPageThumbnailRows({ start: 0, end: totalPages }, 0, thumbnailsPerRow)
    : flattenTOC(toc, expandedItems, pageRanges, thumbnailsPerRow);

const setsHaveSameContents = (a: Set<string>, b: Set<string>): boolean => {
  if (a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
};

const getInitialScrollTarget = (
  toc: TOCItem[],
  progress: BookProgress | null | undefined,
  pageRanges: Map<TOCItem, PageRange> | undefined,
  totalPages: number,
): { index: number; expanded: Set<string> } => {
  const href = progress?.sectionHref;
  const expanded = computeExpandedSet(toc, href);
  if (!progress) return { index: 0, expanded };
  const rows = buildTOCDisplayItems(
    buildTOCListItems(toc, expanded, pageRanges, totalPages),
    href ?? null,
    progress.page,
  );
  const idx = findActiveRowIndex(rows, href ?? null, pageRanges && progress.section?.current);
  return { index: idx > 0 ? idx : 0, expanded };
};

const TOCView: React.FC<{
  bookKey: string;
  bookDoc: BookDoc;
  toc: TOCItem[];
}> = ({ bookKey, bookDoc, toc }) => {
  const _ = useTranslation();
  const [chapterNumber, setChapterNumber] = useState('');
  const [jumpError, setJumpError] = useState('');
  const pendingTVIndex = useRef<number | null>(null);
  const pendingTVChapter = useRef<TOCItem | null>(null);
  const tvInitialFocusDone = useRef(false);
  const { getView, getViewSettings, getProgress } = useReaderStore();
  const { sideBarBookKey, isSideBarVisible } = useSidebarStore();
  const progress = getProgress(bookKey);
  const viewSettings = getViewSettings(bookKey);
  const isEink = !!viewSettings?.isEink;

  // Fixed-layout formats that can render pages (PDF) unfold page thumbnails
  // under each TOC item, unless the reader turned them off for this book.
  const showThumbnails = !!bookDoc.getPageThumbnail && viewSettings?.showTOCThumbnails !== false;
  const totalPages = bookDoc.sections.length;
  const hasFixedPages = !!bookDoc.getPageThumbnail;
  const chapters = useMemo(() => {
    const result: TOCItem[] = [];
    const visit = (items: TOCItem[]) => {
      for (const item of items) {
        if (item.href) result.push(item);
        if (item.subitems) visit(item.subitems);
      }
    };
    visit(toc);
    return result;
  }, [toc]);
  const pageRanges = useMemo(
    () => (showThumbnails ? computeTOCPageRanges(toc, totalPages) : undefined),
    [showThumbnails, toc, totalPages],
  );
  const currentPage = pageRanges ? progress?.section?.current : undefined;

  const [initialScrollTarget] = useState(() =>
    getInitialScrollTarget(toc, progress, pageRanges, totalPages),
  );
  const [expandedItems, setExpandedItems] = useState<Set<string>>(initialScrollTarget.expanded);
  const [containerHeight, setContainerHeight] = useState(400);
  const [containerWidth, setContainerWidth] = useState(0);
  const thumbnailsPerRow = getThumbnailsPerRow(containerWidth);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const userScrolledRef = useRef(false);
  const scrollCooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingScrollRef = useRef(false);
  const visibleCenterRef = useRef(0);
  const initialScrollHandledRef = useRef(initialScrollTarget.index > 0);
  // Don't honor userScrolledRef before the first post-mount progress arrives.
  // With a pinned sidebar, TOCView mounts before FoliateViewer emits its
  // first relocate; if any programmatic scroll (e.g. OverlayScrollbars'
  // viewport-wrap scrollTop reset) flips userScrolledRef in that window it
  // would otherwise suppress the auto-scroll once progress finally arrives.
  const initialAutoScrollProcessedRef = useRef(false);
  // Mirror the latest active item + flat list so the OverlayScrollbars
  // `initialized` callback (created at mount but fired after a deferred,
  // timing-dependent delay) can re-center on the *current* reading position.
  const activeHrefRef = useRef<string | null>(null);
  const currentPageRef = useRef<number | undefined>(undefined);
  const displayItemsRef = useRef<TOCDisplayItem[]>([]);
  // True once the reader has genuinely driven the list (wheel/touch/pointer/
  // key). Auto-expanding the current volume on open grows the list and fires a
  // synthetic scroll event; without a real gesture behind it, that scroll must
  // not be mistaken for the user taking over and cancel the queued auto-scroll.
  const userInputRef = useRef(false);

  // OverlayScrollbars + Virtuoso integration (same pattern as Bookshelf)
  const osRootRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [initialize, osInstance] = useOverlayScrollbars({
    defer: true,
    options: { scrollbars: { autoHide: 'scroll' } },
    events: {
      initialized(instance) {
        const { viewport } = instance.elements();
        viewport.style.overflowX = 'var(--os-viewport-overflow-x)';
        viewport.style.overflowY = 'var(--os-viewport-overflow-y)';
        // OverlayScrollbars resets the wrapped viewport's scrollTop to 0 as it
        // initializes. On a fresh refresh the auto-scroll to the reading
        // position may already have run by now, so re-apply it here — using the
        // *current* active item, since initialScrollTarget was captured at mount
        // when progress was usually not yet available (index 0). Without this
        // the TOC rewinds to the very top on ~1 in 10 refreshes, depending on
        // whether this deferred init lands before or after the auto-scroll.
        const activeIdx = findActiveRowIndex(
          displayItemsRef.current,
          activeHrefRef.current,
          currentPageRef.current,
        );
        const target = activeIdx > 0 ? activeIdx : initialScrollTarget.index;
        if (target > 0) {
          requestAnimationFrame(() => {
            virtuosoRef.current?.scrollToIndex({
              index: target,
              align: 'center',
              behavior: 'auto',
            });
          });
        }
      },
    },
  });

  useEffect(() => {
    const root = osRootRef.current;
    if (scroller && root) {
      initialize({ target: root, elements: { viewport: scroller } });
    }
    return () => osInstance()?.destroy();
  }, [scroller, initialize, osInstance]);

  // Flag real user gestures so onScroll can tell them apart from the synthetic
  // scroll emitted when the current volume auto-expands on open.
  useEffect(() => {
    if (!scroller) return;
    const markUserInput = () => {
      userInputRef.current = true;
    };
    const passiveCapture = { capture: true, passive: true } as const;
    const capture = { capture: true } as const;
    scroller.addEventListener('wheel', markUserInput, passiveCapture);
    scroller.addEventListener('touchstart', markUserInput, passiveCapture);
    scroller.addEventListener('pointerdown', markUserInput, passiveCapture);
    scroller.addEventListener('keydown', markUserInput, capture);
    return () => {
      scroller.removeEventListener('wheel', markUserInput, passiveCapture);
      scroller.removeEventListener('touchstart', markUserInput, passiveCapture);
      scroller.removeEventListener('pointerdown', markUserInput, passiveCapture);
      scroller.removeEventListener('keydown', markUserInput, capture);
    };
  }, [scroller]);

  const handleScrollerRef = useCallback((el: HTMLElement | Window | null) => {
    setScroller(el instanceof HTMLElement ? el : null);
  }, []);

  useTextTranslation(bookKey, containerRef.current, false, 'translation-target-toc');

  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setContainerWidth(rect.width);
        const parentContainer = containerRef.current.closest('.scroll-container');
        if (parentContainer) {
          const parentRect = parentContainer.getBoundingClientRect();
          const availableHeight = parentRect.height - (rect.top - parentRect.top);
          setContainerHeight(Math.max(400, availableHeight));
        }
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      const parentContainer = containerRef.current.closest('.scroll-container');
      if (parentContainer) {
        resizeObserver = new ResizeObserver(updateHeight);
        resizeObserver.observe(parentContainer);
      }
    }
    return () => {
      window.removeEventListener('resize', updateHeight);
      if (resizeObserver) resizeObserver.disconnect();
    };
  }, []);

  const activeHref = progress?.sectionHref ?? null;
  const flatItems = useMemo(
    () => buildTOCListItems(toc, expandedItems, pageRanges, totalPages, thumbnailsPerRow),
    [toc, expandedItems, pageRanges, totalPages, thumbnailsPerRow],
  );
  // Inject a "current position" row under the active item showing the current
  // reading page.
  const displayItems = useMemo(
    () => buildTOCDisplayItems(flatItems, activeHref, progress?.page),
    [flatItems, activeHref, progress?.page],
  );
  // Keep the refs read by the OverlayScrollbars `initialized` callback current.
  activeHrefRef.current = activeHref;
  currentPageRef.current = currentPage;
  displayItemsRef.current = displayItems;

  const focusTVIndex = useCallback((index: number) => {
    if (index < 0 || index >= displayItemsRef.current.length) return;
    pendingTVIndex.current = index;
    userInputRef.current = true;
    userScrolledRef.current = true;
    pendingScrollRef.current = false;
    virtuosoRef.current?.scrollToIndex({ index, align: 'center', behavior: 'auto' });
    const focusMounted = () => {
      const row = containerRef.current?.querySelector<HTMLElement>(
        `[data-tv-toc-index="${index}"]`,
      );
      const target = row?.querySelector<HTMLElement>('[role="treeitem"],button');
      if (target && getTVScope()?.element.contains(target)) {
        pendingTVIndex.current = null;
        focusTV(target);
      }
    };
    requestAnimationFrame(focusMounted);
  }, []);

  const revealTVChapter = useCallback(
    (item: TOCItem) => {
      pendingTVChapter.current = item;
      setExpandedItems((previous) => new Set([...previous, ...computeExpandedSet(toc, item.href)]));
    },
    [toc],
  );

  useEffect(() => {
    if (!isTVMode()) return;
    if (!isSideBarVisible || sideBarBookKey !== bookKey) {
      tvInitialFocusDone.current = false;
      pendingTVIndex.current = null;
      pendingTVChapter.current = null;
      return;
    }
    const pending = pendingTVChapter.current;
    const index = pending
      ? displayItems.findIndex((row) => 'item' in row && row.item === pending)
      : findActiveRowIndex(displayItems, activeHref, currentPage);
    if (index >= 0 && (pending || !tvInitialFocusDone.current)) {
      pendingTVChapter.current = null;
      tvInitialFocusDone.current = true;
      focusTVIndex(index);
    }
  }, [
    displayItems,
    activeHref,
    currentPage,
    isSideBarVisible,
    sideBarBookKey,
    bookKey,
    focusTVIndex,
  ]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !isTVMode()) return;
    const observer = new MutationObserver(() => {
      const index = pendingTVIndex.current;
      if (index !== null) {
        const target = root.querySelector<HTMLElement>(
          `[data-tv-toc-index="${index}"] [role="treeitem"], [data-tv-toc-index="${index}"] button`,
        );
        if (target && getTVScope()?.element.contains(target)) {
          pendingTVIndex.current = null;
          focusTV(target);
        }
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    const navigate = (event: Event) => {
      tvInitialFocusDone.current = true;
      const source = (event.target as HTMLElement)?.closest<HTMLElement>('[data-tv-toc-index]');
      if (!source) return;
      const index = Number(source.dataset['tvTocIndex']);
      const key = (event as CustomEvent<{ key: string }>).detail.key;
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const next = index + (key === 'ArrowUp' ? -1 : 1);
        if (next >= 0 && next < displayItemsRef.current.length) {
          event.preventDefault();
          focusTVIndex(next);
        }
        // At the top, ordinary spatial navigation reaches the jump controls/tabs.
      } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        const item = source.querySelector<HTMLElement>('[aria-expanded]');
        if (item) {
          event.preventDefault();
          const expanded = item.getAttribute('aria-expanded') === 'true';
          if (expanded !== (key === 'ArrowRight'))
            item.querySelector<HTMLButtonElement>('button')?.click();
        }
      }
    };
    root.addEventListener('tv-navigate', navigate);
    return () => {
      observer.disconnect();
      root.removeEventListener('tv-navigate', navigate);
    };
  }, [focusTVIndex]);

  const handleToggleExpand = useCallback((item: TOCItem) => {
    const itemId = getItemIdentifier(item);
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  }, []);

  const handleItemClick = useCallback(
    (item: TOCItem) => {
      eventDispatcher.dispatch('navigate', { bookKey, href: item.href });
      if (item.href) {
        getView(bookKey)?.goTo(item.href);
        if (isTVMode()) useSidebarStore.getState().setSideBarVisible(false);
      }
    },
    [bookKey, getView],
  );

  const handlePageClick = useCallback(
    (page: number) => {
      eventDispatcher.dispatch('navigate', { bookKey, index: page });
      getView(bookKey)?.goTo(page);
      if (isTVMode()) useSidebarStore.getState().setSideBarVisible(false);
    },
    [bookKey, getView],
  );

  const handleCurrentPositionClick = useCallback(() => {
    const location = getProgress(bookKey)?.location;
    if (!location) return;
    eventDispatcher.dispatch('navigate', { bookKey, cfi: location });
    getView(bookKey)?.goTo(location);
    if (isTVMode()) useSidebarStore.getState().setSideBarVisible(false);
  }, [bookKey, getView, getProgress]);

  useEffect(() => {
    if (!isSideBarVisible || sideBarBookKey !== bookKey) {
      userScrolledRef.current = false;
      pendingScrollRef.current = false;
      initialAutoScrollProcessedRef.current = false;
      return;
    }
    if (userScrolledRef.current && initialAutoScrollProcessedRef.current) return;
    setExpandedItems((prev) => {
      const next = computeExpandedSet(toc, progress?.sectionHref);
      return setsHaveSameContents(prev, next) ? prev : next;
    });
    if (progress?.sectionHref || currentPage !== undefined) {
      if (initialScrollHandledRef.current) {
        initialScrollHandledRef.current = false;
      } else {
        pendingScrollRef.current = true;
      }
      initialAutoScrollProcessedRef.current = true;
    }
  }, [isSideBarVisible, sideBarBookKey, bookKey, toc, progress, currentPage]);

  // Resizing the TOC reflows the thumbnail rows; bring the current page back
  // into view unless the reader has scrolled elsewhere.
  const thumbnailsPerRowRef = useRef(thumbnailsPerRow);
  useEffect(() => {
    if (thumbnailsPerRowRef.current === thumbnailsPerRow) return;
    thumbnailsPerRowRef.current = thumbnailsPerRow;
    if (pageRanges && !userScrolledRef.current) pendingScrollRef.current = true;
  }, [thumbnailsPerRow, pageRanges]);

  useEffect(() => {
    if (!pendingScrollRef.current || !isSideBarVisible) return;
    const idx = findActiveRowIndex(displayItems, activeHref, currentPage);
    if (idx === -1) {
      // The active section's parents were just queued to expand by the
      // post-mount progress effect above — displayItems still reflects the
      // pre-update expandedItems. Leave pendingScrollRef set so this
      // effect retries on the next render once displayItems contains the
      // active section. Clearing it here would strand the scroll.
      return;
    }
    // Eink displays ghost previous frames during smooth JS scroll
    // animations; force an instant jump to avoid the artifact. A CSS-only
    // fix is impossible because scrollTo({ behavior: 'smooth' }) overrides
    // CSS scroll-behavior and is not a CSS transition.
    const distance = Math.abs(idx - visibleCenterRef.current);
    const behavior = isEink || distance > 16 ? 'auto' : 'smooth';
    virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior });
    // When the current volume auto-expands on open, the list grows by dozens of
    // rows in this same commit. Virtuoso scrolls before measuring the new rows,
    // so a single scrollToIndex lands short. Re-assert on the next frame (once
    // they're measured) for the instant-jump case so the chapter ends centered.
    if (behavior === 'auto') {
      requestAnimationFrame(() => {
        virtuosoRef.current?.scrollToIndex({ index: idx, align: 'center', behavior: 'auto' });
      });
    }
    pendingScrollRef.current = false;
  }, [displayItems, activeHref, currentPage, isSideBarVisible, isEink]);

  return (
    <div ref={containerRef} className='toc-list rounded-sm' role='tree'>
      {isTVMode() && (
        <div className='flex flex-wrap items-center gap-2 p-2'>
          <button
            className='btn btn-ghost'
            onClick={() => {
              const chapter = chapters.find((item) => item.href === activeHref);
              if (chapter) revealTVChapter(chapter);
              else
                focusTVIndex(
                  Math.max(0, findActiveRowIndex(displayItems, activeHref, currentPage)),
                );
            }}
          >
            {_('Current Chapter')}
          </button>
          <input
            aria-label={
              chapters.length
                ? _('Chapter number')
                : hasFixedPages
                  ? _('Page number')
                  : _('Reading progress (%)')
            }
            inputMode='numeric'
            value={chapterNumber}
            onChange={(e) => setChapterNumber(e.target.value)}
            className='input w-24'
          />
          <button
            className='btn btn-contrast'
            onClick={() => {
              const number = Number(chapterNumber);
              if (!chapterNumber.trim() || !Number.isFinite(number)) {
                setJumpError(_('Enter a valid number'));
                return;
              }
              if (!chapters.length && !hasFixedPages) {
                if (number < 0 || number > 100) {
                  setJumpError(_('Enter a value from 0 to 100'));
                  return;
                }
                void getView(bookKey)?.goToFraction(number / 100);
                useSidebarStore.getState().setSideBarVisible(false);
              } else if (!chapters.length) {
                if (!Number.isInteger(number) || number < 1 || number > totalPages) {
                  setJumpError(_('Page number is out of range'));
                  return;
                }
                handlePageClick(number - 1);
                useSidebarStore.getState().setSideBarVisible(false);
              } else {
                const chapter = Number.isInteger(number) ? chapters[number - 1] : undefined;
                if (!chapter) {
                  setJumpError(_('Chapter number is out of range'));
                  return;
                }
                revealTVChapter(chapter);
              }
              setJumpError('');
            }}
          >
            {_('Go')}
          </button>
          {jumpError && <p role='status'>{jumpError}</p>}
        </div>
      )}
      <div ref={osRootRef} data-overlayscrollbars-initialize='' style={{ height: containerHeight }}>
        <Virtuoso
          ref={virtuosoRef}
          scrollerRef={handleScrollerRef}
          initialTopMostItemIndex={
            initialScrollTarget.index > 0
              ? { index: initialScrollTarget.index, align: 'center' }
              : 0
          }
          rangeChanged={({ startIndex, endIndex }) => {
            visibleCenterRef.current = Math.floor((startIndex + endIndex) / 2);
          }}
          onScroll={() => {
            // A scroll arriving while a pending auto-scroll is still queued
            // (idx === -1, waiting on flatItems to expand) normally means the
            // user is now driving — drop the queued auto-scroll so the next
            // render doesn't yank them away. But auto-expanding the current
            // volume on open grows the list and emits a synthetic scroll with
            // no gesture behind it; ignore that so the initial auto-scroll
            // survives. A real user scroll still cancels it via userInputRef.
            if (pendingScrollRef.current && !userInputRef.current) return;
            pendingScrollRef.current = false;
            userScrolledRef.current = true;
            if (scrollCooldownRef.current) clearTimeout(scrollCooldownRef.current);
            scrollCooldownRef.current = setTimeout(() => {
              userScrolledRef.current = false;
            }, 10000);
          }}
          style={{ height: containerHeight }}
          totalCount={displayItems.length}
          itemContent={(index) => {
            const row = displayItems[index]!;
            if (isPageThumbnailsItem(row)) {
              return (
                <div data-tv-toc-index={index}>
                  <PageThumbnailsRow
                    bookKey={bookKey}
                    bookDoc={bookDoc}
                    depth={row.depth}
                    pages={row.pages}
                    columns={thumbnailsPerRow}
                    currentPage={currentPage}
                    onPageClick={handlePageClick}
                  />
                </div>
              );
            }
            if (isCurrentPositionItem(row)) {
              return (
                <div data-tv-toc-index={index}>
                  <CurrentPositionRow
                    depth={row.depth}
                    page={row.page}
                    onClick={handleCurrentPositionClick}
                  />
                </div>
              );
            }
            return (
              <div data-tv-toc-index={index}>
                <StaticListRow
                  bookKey={bookKey}
                  flatItem={row}
                  activeHref={activeHref}
                  onToggleExpand={handleToggleExpand}
                  onItemClick={handleItemClick}
                />
              </div>
            );
          }}
          overscan={500}
        />
      </div>
    </div>
  );
};
export default TOCView;
