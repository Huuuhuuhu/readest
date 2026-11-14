import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NavigationPanel } from '@/app/reader/components/footerbar/NavigationPanel';

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
const progress = { fraction: 0.2 };
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ history: { canGoBack: false, canGoForward: false } }),
    getProgress: () => progress,
    getViewSettings: () => ({ rtl: false }),
  }),
}));
vi.mock('@/app/reader/components/footerbar/PageJumpInput', () => ({ default: () => null }));

const navigationHandlers = {
  onPrevPage: vi.fn(),
  onNextPage: vi.fn(),
  onPrevSection: vi.fn(),
  onNextSection: vi.fn(),
  onGoBack: vi.fn(),
  onGoForward: vi.fn(),
  onProgressChange: vi.fn(),
};
const props = {
  bookKey: 'book',
  actionTab: 'progress',
  progressFraction: 0.2,
  progressValid: true,
  navigationHandlers,
  bottomOffset: '64px',
  sliderHeight: 28,
  forceMobileLayout: true,
};

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'true'));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('original reading progress panel on TV', () => {
  it('previews with directions and seeks only when Go is confirmed', () => {
    render(<NavigationPanel {...props} />);
    const slider = screen.getByRole('slider', { name: 'Reading Progress' });
    act(() => {
      slider.dispatchEvent(
        new CustomEvent('tv-navigate', {
          bubbles: true,
          cancelable: true,
          detail: { key: 'ArrowRight' },
        }),
      );
    });
    expect(slider.getAttribute('aria-valuenow')).toBe('21');
    expect(navigationHandlers.onProgressChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /^Go$/ }));
    expect(navigationHandlers.onProgressChange).toHaveBeenCalledExactlyOnceWith(21);
  });

  it('discards an unconfirmed seek when Back closes the panel', () => {
    const { rerender } = render(<NavigationPanel {...props} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '70' } });
    rerender(<NavigationPanel {...props} actionTab='' />);
    rerender(<NavigationPanel {...props} />);
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('20');
    expect(navigationHandlers.onProgressChange).not.toHaveBeenCalled();
  });

  it('excludes unavailable reading-history actions from remote focus', () => {
    render(<NavigationPanel {...props} />);
    expect((screen.getByRole('button', { name: 'Go Back' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Go Forward' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('preserves the original immediate pointer seek outside TV mode', () => {
    vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'false');
    render(<NavigationPanel {...props} />);
    fireEvent.change(screen.getByRole('slider'), { target: { value: '70' } });
    expect(navigationHandlers.onProgressChange).toHaveBeenCalledWith(70);
    expect(screen.queryByRole('button', { name: /^Go$/ })).toBeNull();
  });
});
