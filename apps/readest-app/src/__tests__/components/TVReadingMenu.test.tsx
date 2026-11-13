import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const h = vi.hoisted(() => ({
  settings: { maxColumnCount: 2, maxInlineSize: 720, defaultFontSize: 16, scrolled: false },
  renderer: null as HTMLElement | null,
  save: vi.fn(),
  applyTurn: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (value: string) => value }));
vi.mock('@/store/readerStore', () => {
  const state = {
    bookKeys: ['book'],
    getViewSettings: () => h.settings,
    getView: () => ({ renderer: h.renderer }),
  };
  return { useReaderStore: Object.assign(() => state, { getState: () => state }) };
});
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: { getState: () => ({ getBookData: () => ({ isFixedLayout: false }) }) },
}));
vi.mock('@/store/sidebarStore', () => ({ useSidebarStore: { getState: () => ({}) } }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: { getState: () => ({}) } }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: (select: (state: { themeMode: string }) => unknown) =>
    select({ themeMode: 'light' }),
}));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: h.save }));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({ applyPageTurnAttributes: h.applyTurn }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: vi.fn() } }));
vi.mock('@/components/Dialog', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    expect(h.applyTurn).toHaveBeenCalledWith({ renderer: h.renderer }, h.settings, false);
  });
});
