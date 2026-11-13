import { RefObject, useLayoutEffect, useRef } from 'react';
import { registerTVScope, TVScope } from '@/utils/tvInput';

export function useTVScope(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  options: Omit<TVScope, 'element'> = {},
) {
  const latest = useRef(options);
  latest.current = options;
  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    return registerTVScope({
      element: ref.current,
      id: options.id,
      priority: options.priority,
      reading: options.reading,
      onArrow: options.onArrow
        ? (key, repeat) => latest.current.onArrow?.(key, repeat) ?? false
        : undefined,
      onActivate: options.onActivate ? () => latest.current.onActivate?.() ?? false : undefined,
      initialFocus: () => latest.current.initialFocus?.() ?? null,
      onBack: options.onBack ? () => latest.current.onBack?.() : undefined,
      onMenu: options.onMenu ? () => latest.current.onMenu?.() : undefined,
    });
  }, [
    enabled,
    ref,
    options.id,
    options.priority,
    options.reading,
    !!options.onBack,
    !!options.onMenu,
    !!options.onArrow,
    !!options.onActivate,
  ]);
}
