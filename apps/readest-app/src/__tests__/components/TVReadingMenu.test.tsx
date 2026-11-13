import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({
  settings: { maxColumnCount: 2, maxInlineSize: 720, defaultFontSize: 16, scrolled: false },
  renderer: null as HTMLElement | null,
  save: vi.fn(),
  applyTurn: vi.fn(),
  goToFraction: vi.fn(),
  historyBack: vi.fn(),
  notebook: vi.fn(),
  sideBarBook: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (value: string) => value }));
vi.mock('@/store/readerStore', () => {
  const state = {
    bookKeys: ['book'],
    getViewSettings: () => h.settings,
    getView: () => ({
      renderer: h.renderer,
      goToFraction: h.goToFraction,
      history: { canGoBack: true, back: h.historyBack },
    }),
    getProgress: () => ({ fraction: 0.2 }),
  };
  return { useReaderStore: Object.assign(() => state, { getState: () => state }) };
});
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({ getBookData: () => ({ isFixedLayout: false }), getConfig: () => ({}) }),
  },
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: {
    getState: () => ({ setSideBarVisible: vi.fn(), setSideBarBookKey: h.sideBarBook }),
  },
}));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({}) } }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: (select: (state: { themeMode: string }) => unknown) =>
    select({ themeMode: 'light' }),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: h.save }));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({ applyPageTurnAttributes: h.applyTurn }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: vi.fn() } }));
vi.mock('@/components/Dialog', () => ({
  default: ({
    children,
    isOpen,
    onClose,
    title,
  }: {
    children: ReactNode;
    isOpen: boolean;
    onClose: () => void;
    title: string;
  }) =>
    isOpen ? (
      <section aria-label={title}>
        {children}
        <button onClick={onClose}>Back {title}</button>
      </section>
    ) : null,
}));

vi.mock('@/store/notebookStore', () => ({
  useNotebookStore: { getState: () => ({ setNotebookVisible: h.notebook }) },
}));
vi.mock('@/app/reader/components/TranslationToggler', () => ({
  default: () => <button>Translate</button>,
}));
vi.mock('@/app/reader/components/SyncInfoDialog', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ViewMenu', () => ({
  default: ({
    setIsDropdownOpen,
    embedded,
  }: {
    setIsDropdownOpen: (open: boolean) => void;
    embedded: boolean;
  }) => (
    <button data-embedded={embedded} onClick={() => setIsDropdownOpen(false)}>
      Speed Reading Mode
    </button>
  ),
}));

import TVReadingMenu from '@/app/reader/components/TVReadingMenu';

beforeEach(() => {
  h.settings = { maxColumnCount: 2, maxInlineSize: 720, defaultFontSize: 16, scrolled: false };
  h.renderer = document.createElement('div');
  h.renderer.setAttribute('max-column-count', '2');
  h.renderer.setAttribute('flow', 'paginated');
  h.save.mockImplementation(async (_env: unknown, _book: string, key: string, value: unknown) => {
    Object.assign(h.settings, { [key]: value });
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TV reading menu applies saved layout to the open book', () => {
  it('changes the live renderer to one column without reopening the book', async () => {
    render(<TVReadingMenu bookKey='book' open onClose={vi.fn()} onLibrary={vi.fn()} />);
    const input = screen.getByLabelText('Maximum Number of Columns');
    act(() => {
      input.dispatchEvent(
        new CustomEvent('tv-navigate', {
          bubbles: true,
          cancelable: true,
          detail: { key: 'ArrowLeft' },
        }),
      );
    });
    await waitFor(() => expect(h.renderer?.getAttribute('max-column-count')).toBe('1'));
    expect(h.settings.maxColumnCount).toBe(1);
    expect(h.renderer?.getAttribute('max-inline-size')).toBe('720px');
  });

  it('applies scrolling immediately and refreshes the page-turn mode', async () => {
    render(<TVReadingMenu bookKey='book' open onClose={vi.fn()} onLibrary={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Scrolled Mode: Off' }));
    await waitFor(() => expect(h.renderer?.getAttribute('flow')).toBe('scrolled'));
    expect(h.settings.scrolled).toBe(true);
    expect(h.applyTurn).toHaveBeenCalledWith(
      expect.objectContaining({ renderer: h.renderer }),
      h.settings,
      false,
    );
  });
});

describe('TV advanced reading entries', () => {
  it('owns progress as a draft until confirm, and Back returns to the menu', () => {
    const onClose = vi.fn();
    render(<TVReadingMenu bookKey='book' open onClose={onClose} onLibrary={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多阅读工具' }));
    fireEvent.change(screen.getByLabelText('阅读进度 (%)'), { target: { value: '35' } });
    fireEvent.blur(screen.getByLabelText('阅读进度 (%)'));
    expect(h.goToFraction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Back 更多阅读工具' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '更多阅读工具' }));
    expect((screen.getByLabelText('阅读进度 (%)') as HTMLInputElement).value).toBe('20');
    fireEvent.change(screen.getByLabelText('阅读进度 (%)'), { target: { value: '35' } });
    fireEvent.blur(screen.getByLabelText('阅读进度 (%)'));
    fireEvent.click(screen.getByRole('button', { name: '确认跳转' }));
    expect(h.goToFraction).toHaveBeenCalledWith(0.35);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes both menus when starting a special mode so it can own remote keys', () => {
    const onClose = vi.fn();
    render(<TVReadingMenu bookKey='book' open onClose={onClose} onLibrary={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '更多阅读工具' }));
    expect(
      screen.getByRole('button', { name: 'Speed Reading Mode' }).getAttribute('data-embedded'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Speed Reading Mode' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText('阅读进度 (%)')).toBeNull();
  });

  it('opens the notebook for this book and leaves the menu', () => {
    const onClose = vi.fn();
    render(<TVReadingMenu bookKey='book' open onClose={onClose} onLibrary={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '笔记本与 AI' }));
    expect(h.sideBarBook).toHaveBeenCalledWith('book');
    expect(h.notebook).toHaveBeenCalledWith(true);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
