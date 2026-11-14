export interface TVScope {
  element: HTMLElement;
  id?: string;
  priority?: number;
  reading?: boolean;
  deferInitialFocus?: boolean;
  controls?: () => HTMLElement[];
  initialFocus?: () => HTMLElement | null;
  onBack?: () => void;
  onMenu?: () => void;
  onArrow?: (key: string, repeat: boolean) => boolean;
  onActivate?: () => boolean;
}

export const isTVMode = () =>
  typeof window !== 'undefined' &&
  (process.env['NEXT_PUBLIC_TV_MODE'] === 'true' || /ReadestTV/.test(navigator.userAgent));

type TextField = HTMLInputElement | HTMLTextAreaElement;
type FieldState = { readOnly: boolean; inputMode: string };
const scopes: TVScope[] = [];
const fields = new Map<TextField, FieldState>();
const rememberedFocus = new Map<string, string>();
let revision = 0;
let editing: TextField | null = null;
const controls =
  'button, summary, a[href], input:not([type="hidden"]), textarea, select, [tabindex], [role="button"], [role="treeitem"], [role="menuitem"]';
const directions = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);

declare global {
  interface Window {
    onTVRemoteKey?: (key: string, phase: 'keydown' | 'keyup', repeat: boolean) => string;
    onTVKeyboardHidden?: () => void;
  }
}

export const getTVScope = (retiring?: TVScope) =>
  scopes
    .filter((scope) => scope.element.isConnected || scope === retiring)
    .reduce<TVScope | undefined>(
      (top, scope) => (!top || (scope.priority ?? 0) >= (top.priority ?? 0) ? scope : top),
      undefined,
    );

const textField = (element: Element | null): element is TextField =>
  !!element &&
  (element.tagName === 'TEXTAREA' ||
    (element.tagName === 'INPUT' &&
      /^(text|search|email|url|password|tel|number)$/.test((element as HTMLInputElement).type)));

const prepareField = (element: TextField) => {
  if (!fields.has(element))
    fields.set(element, { readOnly: element.readOnly, inputMode: element.inputMode });
  if (element !== editing && !element.readOnly) element.readOnly = true;
  if (element !== editing && element.inputMode !== 'none') element.inputMode = 'none';
};

export const isTVVisible = (
  element: HTMLElement,
  styles?: WeakMap<HTMLElement, CSSStyleDeclaration>,
) => {
  if (
    !element.isConnected ||
    element.closest(
      '[inert], [hidden], [aria-hidden="true"], [aria-disabled="true"], .btn-disabled',
    ) ||
    element.matches(':disabled')
  )
    return false;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = styles?.get(node) ?? getComputedStyle(node);
    styles?.set(node, style);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      (style.opacity === '0' && !(node === element && element.matches('input[type=range]')))
    )
      return false;
  }
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

export const getTVControls = (root: HTMLElement) => {
  const styles = new WeakMap<HTMLElement, CSSStyleDeclaration>();
  return Array.from(root.querySelectorAll<HTMLElement>(controls)).filter(
    (element) => element.tabIndex >= 0 && isTVVisible(element, styles),
  );
};

const scopeControls = (scope: TVScope) => scope.controls?.() ?? getTVControls(scope.element);
const ownsFocus = (scope: TVScope, element: Element | null) =>
  !!element &&
  scope.element.contains(element) &&
  isTVVisible(element as HTMLElement) &&
  (!scope.controls || scopeControls(scope).includes(element as HTMLElement));

const identity = (element: HTMLElement) =>
  element.dataset['bookHash'] ||
  element.dataset['groupName'] ||
  element.dataset['tvId'] ||
  element.closest<HTMLElement>('[data-setting-id]')?.dataset['settingId'] ||
  element.id;

export const focusTV = (element: HTMLElement | null | undefined) => {
  if (!element) return;
  if (textField(element)) prepareField(element);
  element.focus({ preventScroll: true });
  // scrollIntoView also scrolls overflow:hidden book cells. Only scroll real
  // lists/panels; focusing chrome must never shift the rendered reading page.
  for (
    let parent = element.parentElement;
    parent && parent !== element.ownerDocument.body;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    const rect = element.getBoundingClientRect();
    const box = parent.getBoundingClientRect();
    if (/^(auto|scroll)$/.test(style.overflowY)) {
      const top = box.top + parent.clientTop;
      const bottom = top + parent.clientHeight;
      parent.scrollTop += rect.top < top ? rect.top - top : Math.max(0, rect.bottom - bottom);
    }
    if (/^(auto|scroll)$/.test(style.overflowX)) {
      const left = box.left + parent.clientLeft;
      const right = left + parent.clientWidth;
      parent.scrollLeft += rect.left < left ? rect.left - left : Math.max(0, rect.right - right);
    }
  }
};

const focusScope = (scope: TVScope) => {
  const saved = scope.id ? rememberedFocus.get(scope.id) : undefined;
  const target =
    scope.initialFocus?.() || (saved && scopeControls(scope).find((el) => identity(el) === saved));
  if (target && isTVVisible(target)) focusTV(target);
  else if (scope.reading || scope.deferInitialFocus) focusTV(scope.element);
  else focusTV(scopeControls(scope)[0] ?? scope.element);
};

export const registerTVScope = (scope: TVScope): (() => void) => {
  if (!isTVMode()) return () => {};
  const previous = scope.element.ownerDocument.activeElement as HTMLElement | null;
  scopes.push(scope);
  revision++;
  let observer: MutationObserver | undefined;
  const stopInitialFocus = () => {
    observer?.disconnect();
    scope.element.removeEventListener('focusin', stopInitialFocus);
    scope.element.removeEventListener('click', stopInitialFocus, true);
  };
  // Layout effects may register before the new surface has its final geometry.
  queueMicrotask(() => {
    if (getTVScope() !== scope) return;
    focusScope(scope);
    if (!scope.initialFocus || scope.initialFocus()) return;
    // Virtualized chapters can mount after their surrounding panel. Resolve
    // the initial target once, unless the user already chose another control.
    observer = new MutationObserver(() => {
      if (getTVScope() !== scope) return stopInitialFocus();
      const target = scope.initialFocus?.();
      if (!target || !isTVVisible(target)) return;
      stopInitialFocus();
      focusTV(target);
    });
    observer.observe(scope.element, { childList: true, subtree: true, attributes: true });
    scope.element.addEventListener('focusin', stopInitialFocus);
    scope.element.addEventListener('click', stopInitialFocus, true);
  });
  return () => {
    stopInitialFocus();
    const active = scope.element.ownerDocument.activeElement as HTMLElement | null;
    if (scope.id && active && scope.element.contains(active) && identity(active))
      rememberedFocus.set(scope.id, identity(active)!);
    // React may detach a conditional surface before its effect cleanup. It
    // still owned focus and must restore it, even though isConnected is false.
    const wasTop = getTVScope(scope) === scope;
    const index = scopes.indexOf(scope);
    if (index >= 0) scopes.splice(index, 1);
    revision++;
    if (!wasTop) return;
    queueMicrotask(() => {
      const top = getTVScope();
      if (previous?.isConnected && isTVVisible(previous) && (!top || ownsFocus(top, previous)))
        focusTV(previous);
      else if (top) focusScope(top);
    });
  };
};

const endEditing = () => {
  const field = editing;
  if (!field) return;
  editing = null;
  // Blurring closes the IME. Refocus as read-only navigation in the same turn;
  // the field's value is its draft, not a form submission.
  field.blur();
  prepareField(field);
  delete field.dataset['tvEditing'];
  if (field.isConnected) focusTV(field);
};

const beginEditing = (field: TextField) => {
  prepareField(field);
  const original = fields.get(field)!;
  if (original.readOnly || field.disabled) return;
  editing = field;
  field.readOnly = false;
  field.inputMode = original.inputMode;
  field.dataset['tvEditing'] = 'true';
  // Chromium must recreate its input connection after a read-only focus.
  field.blur();
  field.focus({ preventScroll: true });
};

export const installTVInput = (doc: Document = document): (() => void) => {
  if (!isTVMode()) return () => {};
  const win = doc.defaultView!;
  const scopeFocus = new WeakMap<TVScope, HTMLElement>();
  const repairFocus = () => {
    const scope = getTVScope();
    if (!scope || scope.reading || ownsFocus(scope, doc.activeElement)) return;
    queueMicrotask(() => {
      if (
        getTVScope() !== scope ||
        ownsFocus(scope, doc.activeElement) ||
        !isTVVisible(scope.element)
      )
        return;
      const previous = scopeFocus.get(scope);
      if (previous && ownsFocus(scope, previous) && isTVVisible(previous)) focusTV(previous);
      else focusScope(scope);
    });
  };
  doc.documentElement.dataset['tvMode'] = 'true';
  let held: {
    target: HTMLElement;
    scope: TVScope | undefined;
    revision: number;
    long: boolean;
    timer?: ReturnType<typeof setTimeout>;
  } | null = null;
  const cancelHold = () => {
    if (held?.timer) clearTimeout(held.timer);
    held = null;
  };
  const consume = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const prepare = (records?: MutationRecord[]) => {
    if (editing && !editing.isConnected) {
      delete editing.dataset['tvEditing'];
      editing = null;
    }
    const roots = records
      ? records.flatMap((record) =>
          [...record.addedNodes].filter((node): node is HTMLElement => node instanceof HTMLElement),
        )
      : [doc.body];
    for (const root of roots) {
      if (textField(root)) prepareField(root);
      root.querySelectorAll('input, textarea').forEach((el) => {
        if (textField(el)) prepareField(el);
      });
    }
    for (const el of fields.keys()) if (!el.isConnected) fields.delete(el);
    repairFocus();
  };
  prepare();
  const observer = new MutationObserver(prepare);
  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled', 'aria-disabled', 'hidden', 'aria-hidden'],
  });
  const onFocus = (event: FocusEvent) => {
    const target = event.target as HTMLElement;
    if (textField(target)) prepareField(target);
    const scope = getTVScope();
    if (scope && !scope.reading && !ownsFocus(scope, target)) {
      // Narration/renderer position updates must not steal a panel's focus.
      // Wait for the current commit so a newly opened higher scope can take over.
      repairFocus();
      return;
    }
    if (scope) scopeFocus.set(scope, target);
    if (scope?.id && scope.element.contains(target) && identity(target))
      rememberedFocus.set(scope.id, identity(target)!);
  };
  const navigate = (target: HTMLElement, scope: TVScope | undefined, key: string) => {
    const custom = new CustomEvent('tv-navigate', {
      detail: { key },
      bubbles: true,
      cancelable: true,
    });
    if (!target.dispatchEvent(custom)) return;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const direction = key === 'ArrowRight' ? 1 : -1;
      if (target instanceof HTMLSelectElement) {
        let index = target.selectedIndex + direction;
        while (index >= 0 && index < target.options.length) {
          const option = target.options[index]!;
          if (
            !option.disabled &&
            !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)
          ) {
            target.selectedIndex = index;
            target.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
          index += direction;
        }
        return;
      }
      if (target instanceof HTMLInputElement && target.type === 'range') {
        const step = parseFloat(target.step) || 1;
        const next = Math.min(
          parseFloat(target.max) || 100,
          Math.max(parseFloat(target.min) || 0, parseFloat(target.value) + direction * step),
        );
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          target,
          String(Math.round(next * 1e6) / 1e6),
        );
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
    }
    const root = scope?.element ?? doc.body;
    const items = scope ? scopeControls(scope) : getTVControls(root);
    const grid = target.closest('[data-tv-library-grid]');
    if (grid && key === 'ArrowUp') {
      const row = target.getBoundingClientRect();
      const above = items.some(
        (item) => grid.contains(item) && item.getBoundingClientRect().bottom <= row.top + 2,
      );
      if (!above) {
        const toolbar = items.filter((item) => item.closest('[data-tv-library-toolbar]'));
        toolbar.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        if (toolbar[0]) return focusTV(toolbar[0]);
      }
    }
    const origin = target.getBoundingClientRect();
    const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
    const sign = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    let best: HTMLElement | undefined;
    let score = Infinity;
    let bestInLane = false;
    for (const item of items) {
      if (item === target || item.contains(target) || target.contains(item)) continue;
      const rect = item.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - origin.left - origin.width / 2;
      const dy = rect.top + rect.height / 2 - origin.top - origin.height / 2;
      const forward = (horizontal ? dx : dy) * sign;
      // Use the gap between edges, not centers. A full-width action shares a
      // vertical lane with the right-aligned input in the very next row.
      const sideways = horizontal
        ? Math.max(0, rect.top - origin.bottom, origin.top - rect.bottom)
        : Math.max(0, rect.left - origin.right, origin.left - rect.right);
      if (forward <= 2) continue;
      // A button in this visual row/column always wins over a diagonal one.
      // This matters when a wide Speed tile sits below small transport icons.
      const inLane = sideways === 0;
      const candidateScore = forward + sideways * 4;
      if ((inLane && !bestInLane) || (inLane === bestInLane && candidateScore < score)) {
        best = item;
        score = candidateScore;
        bestInLane = inLane;
      }
    }
    if (best) focusTV(best);
    else if (!root.contains(target) || target === root) focusTV(items[0]);
  };
  const onKey = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing
    )
      return;
    const scope = getTVScope();
    const target = doc.activeElement as HTMLElement | null;
    if (!target) return;
    if (editing) {
      if (event.key === 'Escape') {
        consume(event);
        if (event.type === 'keydown') endEditing();
      }
      return;
    }
    if (event.key === 'Enter') {
      consume(event);
      if (event.type === 'keydown') {
        if (event.repeat || held) return;
        held = { target, scope, revision, long: false };
        if (target.dataset['tvLongPress'] === 'true') {
          held.timer = setTimeout(() => {
            if (!held || held.revision !== revision || !target.isConnected) return;
            held.long = true;
            const rect = target.getBoundingClientRect();
            target.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: rect.left + rect.width / 2,
                clientY: rect.top + rect.height / 2,
              }),
            );
          }, 600);
        }
      } else {
        const press = held;
        cancelHold();
        if (
          !press ||
          press.long ||
          press.revision !== revision ||
          press.scope !== scope ||
          press.target !== target ||
          !target.isConnected
        )
          return;
        if (scope?.onActivate?.()) return;
        if (scope?.deferInitialFocus && target === scope.element) {
          const items = scopeControls(scope);
          focusTV(
            items.find((item) => item.matches('[data-book-hash], [data-group-name]')) ?? items[0],
          );
          return;
        }
        if (target instanceof HTMLSelectElement)
          win.dispatchEvent(new CustomEvent('tv-select', { detail: target }));
        else if (textField(target)) beginEditing(target);
        else if (scope?.reading) scope.onMenu?.();
        else if (isTVVisible(target)) target.click();
      }
      return;
    }
    if (event.key === 'ContextMenu' || event.key === 'Menu') {
      consume(event);
      if (event.type === 'keydown' && !event.repeat) {
        cancelHold();
        if (scope?.onMenu) scope.onMenu();
        else if (target.dataset['tvLongPress'] === 'true')
          target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      }
      return;
    }
    if (event.key === 'Escape' && scope?.onBack) {
      consume(event);
      if (event.type === 'keydown' && !event.repeat) {
        cancelHold();
        if (target.dispatchEvent(new CustomEvent('tv-back', { bubbles: true, cancelable: true })))
          scope.onBack();
      }
      return;
    }
    if (
      directions.has(event.key) &&
      event.type === 'keydown' &&
      scope?.onArrow?.(event.key, event.repeat)
    ) {
      consume(event);
      return;
    }
    if (directions.has(event.key) && !scope?.reading) {
      consume(event);
      if (event.type === 'keydown') navigate(target, scope, event.key);
    }
  };
  const onBlur = () => {
    cancelHold();
    // Focusing a document inside foliate-view's shadow iframe may emit only a
    // window blur, not a focusin in this document. The top dialog still owns keys.
    repairFocus();
  };
  win.addEventListener('keydown', onKey, true);
  win.addEventListener('keyup', onKey, true);
  win.addEventListener('blur', onBlur);
  doc.addEventListener('focusin', onFocus, true);
  win.onTVKeyboardHidden = endEditing;
  win.onTVRemoteKey = (key, phase, repeat) => {
    const event = new KeyboardEvent(phase, { key, repeat, bubbles: true, cancelable: true });
    (doc.activeElement ?? doc.body).dispatchEvent(event);
    return editing ? 'editing' : event.defaultPrevented ? 'handled' : 'unhandled';
  };
  return () => {
    cancelHold();
    observer.disconnect();
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('keyup', onKey, true);
    win.removeEventListener('blur', onBlur);
    doc.removeEventListener('focusin', onFocus, true);
    delete win.onTVRemoteKey;
    delete win.onTVKeyboardHidden;
    delete doc.documentElement.dataset['tvMode'];
    editing = null;
    for (const [field, original] of fields) {
      field.readOnly = original.readOnly;
      field.inputMode = original.inputMode;
      delete field.dataset['tvEditing'];
    }
    fields.clear();
  };
};
