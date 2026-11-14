import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { spatialTarget, useSpatialNavigation } from '@/app/library/hooks/useSpatialNavigation';
const rect = (x: number, y: number, width = 100, height = 100) => ({
  left: x,
  top: y,
  width,
  height,
});
describe('mixed shelf spatial navigation', () => {
  it('moves between a carousel, a three-column grid and full-width list by geometry', () => {
    const positions = [
      rect(0, 0),
      rect(110, 0),
      rect(220, 0),
      rect(0, 160),
      rect(110, 160),
      rect(220, 160),
      rect(0, 330, 330),
      rect(0, 440, 330),
    ];
    expect(spatialTarget(positions, 1, 'ArrowDown')).toBe(4);
    expect(spatialTarget(positions, 5, 'ArrowDown')).toBe(6);
    expect(spatialTarget(positions, 6, 'ArrowDown')).toBe(7);
    expect(spatialTarget(positions, 6, 'ArrowUp')).toBe(4);
    expect(spatialTarget(positions, 4, 'ArrowLeft')).toBe(3);
  });
  it('uses physical arrows correctly in RTL', () => {
    const positions = [rect(220, 0), rect(110, 0), rect(0, 0)];
    expect(spatialTarget(positions, 0, 'ArrowLeft')).toBe(1);
    expect(spatialTarget(positions, 1, 'ArrowRight')).toBe(0);
  });
});
describe('library arrow-key focus handling', () => {
  it('does not redirect a TV grid move diagonally into a partly filled last row', () => {
    const container = mount();
    container.innerHTML =
      '<div role="button" tabindex="0" id="third"></div><div role="button" tabindex="0" id="second"></div>';
    const third = container.querySelector<HTMLElement>('#third')!;
    const second = container.querySelector<HTMLElement>('#second')!;
    third.getBoundingClientRect = () => new DOMRect(300, 0, 150, 220);
    second.getBoundingClientRect = () => new DOMRect(150, 220, 150, 220);
    third.focus();
    third.dispatchEvent(
      new CustomEvent('tv-navigate', {
        detail: { key: 'ArrowDown' },
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(document.activeElement).toBe(third);
  });

  it('lets the unified TV router move between mounted book cards', () => {
    const container = mount();
    container.innerHTML =
      '<div role="button" tabindex="0" id="first"></div><div role="button" tabindex="0" id="second"></div>';
    const first = container.querySelector<HTMLElement>('#first')!;
    const second = container.querySelector<HTMLElement>('#second')!;
    first.getBoundingClientRect = () => ({
      ...rect(0, 0),
      x: 0,
      y: 0,
      right: 100,
      bottom: 100,
      toJSON: () => ({}),
    });
    second.getBoundingClientRect = () => ({
      ...rect(110, 0),
      x: 110,
      y: 0,
      right: 210,
      bottom: 100,
      toJSON: () => ({}),
    });
    first.focus();
    const event = new CustomEvent('tv-navigate', {
      detail: { key: 'ArrowRight' },
      bubbles: true,
      cancelable: true,
    });
    first.dispatchEvent(event);
    expect(document.activeElement).toBe(second);
    expect(event.defaultPrevented).toBe(true);
  });

  let unmount = () => {};
  // jsdom has no scrollIntoView; the hook only uses it to reveal the target.
  Element.prototype.scrollIntoView = () => {};
  const mount = () => {
    const container = document.createElement('div');
    container.tabIndex = -1;
    container.innerHTML =
      '<div role="button" tabindex="0" id="card"></div><div tabindex="0" id="scroller"></div>';
    document.body.append(container);
    unmount = renderHook(() => useSpatialNavigation({ current: container })).unmount;
    return container;
  };
  const press = (key: string) => {
    const event = new KeyboardEvent('keydown', { key, cancelable: true });
    window.dispatchEvent(event);
    return event;
  };
  afterEach(() => {
    unmount();
    document.body.innerHTML = '';
  });
  it('leaves arrow keys to a focused carousel scroller', () => {
    const container = mount();
    const scroller = container.querySelector<HTMLElement>('#scroller')!;
    scroller.focus();
    const event = press('ArrowRight');
    expect(document.activeElement).toBe(scroller);
    expect(event.defaultPrevented).toBe(false);
  });
  it('still enters the first card when focus is outside the library', () => {
    const container = mount();
    const event = press('ArrowDown');
    expect(document.activeElement).toBe(container.querySelector('#card'));
    expect(event.defaultPrevented).toBe(true);
  });
});
