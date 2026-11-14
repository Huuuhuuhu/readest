import { useEffect } from 'react';

const ARROW_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
type Position = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>;
/** Choose the nearest row/column in the requested physical direction. */
export const spatialTarget = (
  positions: Position[],
  current: number,
  key: string,
  alignedOnly = false,
): number => {
  const origin = positions[current];
  if (!origin) return -1;
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
  const x = origin.left + origin.width / 2;
  const y = origin.top + origin.height / 2;
  let best = -1;
  let score = Infinity;
  positions.forEach((rect, index) => {
    if (index === current) return;
    const dx = rect.left + rect.width / 2 - x;
    const dy = rect.top + rect.height / 2 - y;
    const forward = (horizontal ? dx : dy) * sign;
    const sideways = Math.abs(horizontal ? dy : dx);
    if (forward <= 5 || (horizontal && sideways > Math.max(origin.height, rect.height) / 2)) return;
    if (alignedOnly) {
      const overlap = horizontal
        ? Math.min(rect.top + rect.height, origin.top + origin.height) -
          Math.max(rect.top, origin.top)
        : Math.min(rect.left + rect.width, origin.left + origin.width) -
          Math.max(rect.left, origin.left);
      if (overlap <= 2) return;
    }
    const distance = forward + sideways * 2;
    if (distance < score) {
      score = distance;
      best = index;
    }
  });
  return best;
};
const getItems = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('[role="button"][tabindex="0"]')).filter(
    (el) => !el.closest('[inert]'),
  );
const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !!target.closest('input, textarea, select, [contenteditable], dialog[open], [role="dialog"]');
export function useSpatialNavigation(containerRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const navigate = (e: KeyboardEvent | CustomEvent<{ key: string }>) => {
      const tv = e instanceof CustomEvent;
      const key = tv ? e.detail.key : e.key;
      if (
        !ARROW_KEYS.has(key) ||
        e.defaultPrevented ||
        editable(e.target) ||
        document.querySelector('dialog[open]')
      )
        return;
      const items = getItems(container);
      if (!items.length) return;
      const active = document.activeElement as HTMLElement;
      if (!container.contains(active) && key !== 'ArrowDown') return;
      const current = items.indexOf(active);
      // Focus resting on a non-navigable control inside the shelf (a carousel
      // scroller, its arrows) belongs to that control: arrow keys must keep
      // scrolling it natively.
      if (current < 0 && active !== container && container.contains(active)) return;
      const next =
        current < 0
          ? 0
          : spatialTarget(
              items.map((item) => item.getBoundingClientRect()),
              current,
              key,
              tv,
            );
      if (next >= 0) {
        items[next]!.focus({ preventScroll: true });
        items[next]!.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        e.preventDefault();
      } else if (key === 'ArrowDown' || key === 'ArrowUp') {
        // Ask the one vertical scroller to mount the next virtual row, then
        // choose by the old focus geometry. No global column-count assumption.
        const scroller = container.querySelector<HTMLElement>('[data-virtuoso-scroller]');
        if (!scroller) return;
        const origin = active.getBoundingClientRect();
        const before = scroller.scrollTop;
        scroller.scrollTop += (key === 'ArrowDown' ? 1 : -1) * Math.max(120, origin.height);
        const moved = scroller.scrollTop - before;
        if (tv && moved === 0) return;
        frame = requestAnimationFrame(() => {
          const mounted = getItems(container);
          const positions = [
            {
              left: origin.left,
              top: origin.top - moved,
              width: origin.width,
              height: origin.height,
            },
            ...mounted.map((item) => item.getBoundingClientRect()),
          ];
          const target = spatialTarget(positions, 0, key, tv);
          if (target > 0) mounted[target - 1]?.focus({ preventScroll: true });
        });
        e.preventDefault();
      }
    };
    const tvNavigate = (event: Event) => navigate(event as CustomEvent<{ key: string }>);
    container.addEventListener('tv-navigate', tvNavigate);
    window.addEventListener('keydown', navigate);
    return () => {
      container.removeEventListener('tv-navigate', tvNavigate);
      window.removeEventListener('keydown', navigate);
      cancelAnimationFrame(frame);
    };
  }, [containerRef]);
}
