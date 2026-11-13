import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import TVSelectDialog from '@/components/TVSelectDialog';
import { installTVInput, registerTVScope } from '@/utils/tvInput';
let stop: () => void;
let remove: () => void;
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'true');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 200,
    bottom: 50,
    width: 200,
    height: 50,
    toJSON: () => ({}),
  });
  stop = installTVInput(document);
});
afterEach(() => {
  remove?.();
  stop();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
describe('TV select picker', () => {
  it('opens with current selection, applies one change, and restores the field', async () => {
    const change = vi.fn();
    render(
      <main>
        <select aria-label='Theme' defaultValue='dark' onChange={change}>
          <option>light</option>
          <option>dark</option>
          <option disabled>unavailable</option>
        </select>
        <TVSelectDialog />
      </main>,
    );
    const field = screen.getByRole('combobox') as HTMLSelectElement;
    remove = registerTVScope({ element: document.querySelector('main')! });
    field.focus();
    await act(async () => {
      window.dispatchEvent(new CustomEvent('tv-select', { detail: field }));
    });
    expect(
      within(screen.getByRole('dialog')).getByRole('option', { name: /dark/, selected: true }),
    ).toBe(document.activeElement);
    expect(
      within(screen.getByRole('dialog'))
        .getByRole('option', { name: 'unavailable' })
        .hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('option', { name: 'light' }));
    expect(field.value).toBe('light');
    expect(change).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(document.activeElement).toBe(field);
  });
  it('Back cancels without changing value or triggering the parent Back', async () => {
    const back = vi.fn();
    render(
      <main>
        <select aria-label='Theme'>
          <option>light</option>
          <option>dark</option>
        </select>
        <TVSelectDialog />
      </main>,
    );
    const field = screen.getByRole('combobox') as HTMLSelectElement;
    remove = registerTVScope({ element: document.querySelector('main')!, onBack: back });
    field.focus();
    await act(async () => {
      window.dispatchEvent(new CustomEvent('tv-select', { detail: field }));
    });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.keyUp(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(field.value).toBe('light');
    expect(back).not.toHaveBeenCalled();
  });
});
