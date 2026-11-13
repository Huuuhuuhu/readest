import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTVInput, registerTVScope } from '@/utils/tvInput';

let stop: () => void;
let removeScope: () => void;
const key = (type: 'keydown' | 'keyup', value: string, repeat = false) => {
  const event = new KeyboardEvent(type, { key: value, repeat, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
};
const press = (value: string) => {
  key('keydown', value);
  key('keyup', value);
};

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TV_MODE', 'true');
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const index = [...document.querySelectorAll('button,input')].indexOf(this);
    return {
      x: 0,
      y: index * 60,
      left: 0,
      right: 200,
      top: index * 60,
      bottom: index * 60 + 50,
      width: 200,
      height: 50,
      toJSON: () => ({}),
    };
  });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  document.body.innerHTML =
    '<main><input aria-label="Search"><button>Save</button><button>Cancel</button></main>';
  stop = installTVInput(document);
  removeScope = registerTVScope({ element: document.querySelector('main')! });
});
afterEach(() => {
  removeScope();
  stop();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('TV remote input ownership', () => {
  it('focuses the current chapter when a virtual list mounts after its scope', async () => {
    removeScope();
    const root = document.querySelector('main')!;
    removeScope = registerTVScope({
      element: root,
      initialFocus: () => root.querySelector('[aria-current="page"]'),
    });
    await Promise.resolve();
    const chapter = document.createElement('button');
    chapter.textContent = 'Current chapter';
    chapter.setAttribute('aria-current', 'page');
    root.append(chapter);
    await Promise.resolve();
    expect(document.activeElement).toBe(chapter);
  });

  it('does not steal focus when a delayed current chapter arrives after manual navigation', async () => {
    removeScope();
    const root = document.querySelector('main')!;
    removeScope = registerTVScope({
      element: root,
      initialFocus: () => root.querySelector('[aria-current="page"]'),
    });
    await Promise.resolve();
    press('ArrowDown');
    const chosen = document.activeElement;
    const chapter = document.createElement('button');
    chapter.setAttribute('aria-current', 'page');
    root.append(chapter);
    await Promise.resolve();
    expect(document.activeElement).toBe(chosen);
  });

  it('moves down to the next setting row even when its input is right aligned', () => {
    const [contents, theme] = document.querySelectorAll('button');
    const input = document.querySelector('input')!;
    vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this === contents) return new DOMRect(0, 0, 600, 50);
      if (this === input) return new DOMRect(450, 60, 60, 50);
      if (this === theme) return new DOMRect(0, 180, 600, 50);
      return new DOMRect(0, 0, 600, 240);
    });
    contents!.focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(input);
    expect(input.readOnly).toBe(true);
  });

  it('focuses fields without editing; one OK edits and one Back returns to navigation with the draft', () => {
    const input = document.querySelector('input')!;
    input.focus();
    expect(input.readOnly).toBe(true);
    press('Enter');
    expect(input.readOnly).toBe(false);
    input.value = '未提交的批注';
    press('Escape');
    expect(input.readOnly).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('未提交的批注');
    press('ArrowDown');
    expect(document.activeElement?.textContent).toBe('Save');
  });

  it('activates only the focused button on release, and suppresses key repeat', () => {
    const [save, cancel] = document.querySelectorAll('button');
    const onSave = vi.fn();
    const onCancel = vi.fn();
    save!.onclick = onSave;
    cancel!.onclick = onCancel;
    cancel!.focus();
    key('keydown', 'Enter');
    key('keydown', 'Enter', true);
    expect(onCancel).not.toHaveBeenCalled();
    key('keyup', 'Enter');
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('does not carry the same OK press into a newly opened modal', () => {
    document.querySelector('button')!.focus();
    key('keydown', 'Enter');
    const modal = document.createElement('section');
    modal.innerHTML = '<button>Delete</button>';
    document.body.append(modal);
    const onDelete = vi.fn();
    modal.querySelector('button')!.onclick = onDelete;
    const removeModal = registerTVScope({ element: modal, priority: 100 });
    modal.querySelector('button')!.focus();
    key('keydown', 'Enter', true);
    key('keyup', 'Enter');
    expect(onDelete).not.toHaveBeenCalled();
    removeModal();
    modal.remove();
  });

  it('contains directions in the top dialog, even at its boundary', () => {
    const pageTurn = vi.fn();
    window.addEventListener('keydown', pageTurn);
    document.querySelectorAll('button')[1]!.focus();
    press('ArrowDown');
    expect(pageTurn).not.toHaveBeenCalled();
    window.removeEventListener('keydown', pageTurn);
  });

  it('long OK opens the book actions without opening the book', () => {
    vi.useFakeTimers();
    const book = document.querySelector('button')!;
    book.dataset['tvLongPress'] = 'true';
    const openBook = vi.fn();
    const context = vi.fn();
    book.onclick = openBook;
    book.addEventListener('contextmenu', context);
    book.focus();
    key('keydown', 'Enter');
    vi.advanceTimersByTime(650);
    key('keyup', 'Enter');
    expect(context).toHaveBeenCalledOnce();
    expect(openBook).not.toHaveBeenCalled();
  });

  it('does not leave a hidden editing layer after its form is removed', async () => {
    const input = document.querySelector('input')!;
    input.focus();
    press('Enter');
    input.remove();
    await Promise.resolve();
    const [save, cancel] = document.querySelectorAll('button');
    save!.focus();
    press('ArrowDown');
    expect(document.activeElement).toBe(cancel);
  });
});

describe('special TV mode controls', () => {
  it('owns arrows and releases OK once, while an overlay still takes precedence', async () => {
    removeScope();
    const root = document.querySelector('main')!;
    root.tabIndex = -1;
    const adjust = vi.fn(() => true),
      toggle = vi.fn(() => true);
    removeScope = registerTVScope({
      element: root,
      reading: true,
      onArrow: adjust,
      onActivate: toggle,
    });
    await Promise.resolve();
    expect(key('keydown', 'ArrowRight').defaultPrevented).toBe(true);
    expect(adjust).toHaveBeenCalledWith('ArrowRight', false);
    key('keydown', 'Enter');
    key('keydown', 'Enter', true);
    key('keyup', 'Enter');
    expect(toggle).toHaveBeenCalledTimes(1);
    const overlay = document.createElement('aside');
    overlay.innerHTML = '<button>Cancel</button>';
    document.body.append(overlay);
    const removeOverlay = registerTVScope({ element: overlay, priority: 100 });
    await Promise.resolve();
    press('ArrowLeft');
    press('Enter');
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(adjust).toHaveBeenCalledTimes(1);
    removeOverlay();
    overlay.remove();
  });
});
