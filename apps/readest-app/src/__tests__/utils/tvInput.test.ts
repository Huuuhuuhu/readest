import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { focusTV, installTVInput, registerTVScope } from '@/utils/tvInput';

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
  it('does not rescan every input when narration updates a text label', async () => {
    await Promise.resolve();
    const label = document.createElement('span');
    label.textContent = '00:01';
    document.querySelector('main')!.append(label);
    await Promise.resolve();
    const scan = vi.spyOn(document, 'querySelectorAll');
    label.textContent = '00:02';
    await Promise.resolve();
    expect(scan).not.toHaveBeenCalledWith('input, textarea');
  });
  const place = (element: HTMLElement, x: number, y: number, width = 44, height = 44) => {
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x,
        y,
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
        width,
        height,
        toJSON: () => ({}),
      }),
    });
  };

  it('prefers the same visual row over a closer diagonal control in either direction', async () => {
    await Promise.resolve();
    const [speed, voice, rewind] = [...document.querySelectorAll<HTMLElement>('input,button')];
    place(speed!, 100, 300, 100, 56);
    place(voice!, 210, 300, 100, 56);
    place(rewind!, 165, 250, 40, 40);
    speed!.focus();
    press('ArrowRight');
    expect(document.activeElement).toBe(voice);
    press('ArrowLeft');
    expect(document.activeElement).toBe(speed);
  });

  it('starts without a highlighted control and first OK selects, but does not open, the first book', async () => {
    removeScope();
    const root = document.querySelector('main')!;
    root.tabIndex = -1;
    const first = root.querySelector('button')!;
    first.dataset['bookHash'] = 'first';
    const open = vi.fn();
    first.addEventListener('click', open);
    removeScope = registerTVScope({ element: root, deferInitialFocus: true });
    await Promise.resolve();
    expect(document.activeElement).toBe(root);
    press('Enter');
    expect(document.activeElement).toBe(first);
    expect(open).not.toHaveBeenCalled();
    press('Enter');
    expect(open).toHaveBeenCalledOnce();
  });

  it('leaves the first book row for the leftmost toolbar control, not the same book column', async () => {
    await Promise.resolve();
    const root = document.querySelector('main')!;
    root.innerHTML =
      '<header data-tv-library-toolbar><button>Search</button><button>Menu</button></header><section data-tv-library-grid><button data-book-hash="one">One</button><button data-book-hash="two">Two</button></section>';
    const [search, menu, one, two] = [...root.querySelectorAll('button')];
    place(search!, 400, 0);
    place(menu!, 500, 0);
    place(one!, 0, 100, 150, 220);
    place(two!, 180, 100, 150, 220);
    two!.focus();
    press('ArrowUp');
    expect(document.activeElement).toBe(search);
  });

  it('does not scroll the clipped book cell when focusing an inline footer control', () => {
    const cell = document.querySelector('main')!;
    cell.style.overflow = 'hidden';
    const button = cell.querySelector('button')!;
    // Native scrollIntoView scrolls even overflow:hidden ancestors, shifting
    // the whole page when an inactive footer panel extends below the cell.
    button.scrollIntoView = () => {
      cell.scrollTop = 152;
    };
    focusTV(button);
    expect(cell.scrollTop).toBe(0);
    expect(document.activeElement).toBe(button);
  });

  it('moves between aligned book rows in the same column and across books horizontally', async () => {
    await Promise.resolve();
    const root = document.querySelector('main')!;
    root.innerHTML =
      '<section data-tv-library-grid>' +
      Array.from({ length: 6 }, (_, i) => `<button data-book-hash="${i}">Book ${i}</button>`).join(
        '',
      ) +
      '</section>';
    const books = [...root.querySelectorAll('button')];
    books.forEach((book, i) => place(book, (i % 3) * 180, Math.floor(i / 3) * 240, 150, 220));
    books[5]!.focus();
    press('ArrowUp');
    expect(document.activeElement).toBe(books[2]);
    press('ArrowLeft');
    expect(document.activeElement).toBe(books[1]);
    press('ArrowDown');
    expect(document.activeElement).toBe(books[4]);
  });

  it('keeps focus on original toolbars when a font reflow focuses the book inside the same reader', async () => {
    removeScope();
    const root = document.querySelector('main')!;
    const toolbarButtons = [...root.querySelectorAll('button')];
    const page = document.createElement('button');
    page.textContent = 'Book document';
    root.append(page);
    removeScope = registerTVScope({ element: root, controls: () => toolbarButtons });
    await Promise.resolve();
    toolbarButtons[1]!.focus();
    page.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(toolbarButtons[1]);
  });

  it('keeps a dialog focused when background narration tries to focus the book', async () => {
    const dialog = document.createElement('section');
    dialog.innerHTML = '<button>Pause narration</button><button>Voice</button>';
    document.body.append(dialog);
    const close = registerTVScope({ element: dialog, priority: 100 });
    await Promise.resolve();
    const voice = dialog.querySelectorAll('button')[1]!;
    voice.focus();
    document.querySelector('input')!.focus();
    await Promise.resolve();
    expect(document.activeElement).toBe(voice);
    close();
    dialog.remove();
  });

  it('repairs focus when a subpage replaces the focused control', async () => {
    const main = document.querySelector('main')!;
    await Promise.resolve();
    document.querySelector('button')!.focus();
    main.innerHTML = '<button>Back to player</button><input aria-label="Voice search">';
    await Promise.resolve();
    await Promise.resolve();
    expect(document.activeElement).toBe(main.querySelector('button'));
  });

  it('moves focus to an available control when the focused action becomes disabled', async () => {
    await Promise.resolve();
    const button = document.querySelector('button')!;
    button.focus();
    button.disabled = true;
    await Promise.resolve();
    await Promise.resolve();
    expect(document.activeElement).toBe(document.querySelector('input'));
  });

  it('adjusts a transparent range with left/right while up/down still navigates', () => {
    const range = document.querySelector('input')!;
    range.type = 'range';
    range.min = '0';
    range.max = '10';
    range.step = '0.5';
    range.value = '5';
    range.style.opacity = '0';
    const changed = vi.fn();
    range.addEventListener('input', changed);
    range.focus();
    press('ArrowRight');
    expect(range.value).toBe('5.5');
    expect(changed).toHaveBeenCalledTimes(1);
    press('ArrowLeft');
    expect(range.value).toBe('5');
    press('ArrowDown');
    expect(document.activeElement?.textContent).toBe('Save');
  });
  it('changes native selections with left/right and opens an accessible picker on OK', () => {
    const select = document.createElement('select');
    select.innerHTML = '<option>a</option><option disabled>b</option><option>c</option>';
    document.querySelector('main')!.prepend(select);
    const open = vi.fn();
    window.addEventListener('tv-select', open);
    select.focus();
    press('ArrowRight');
    expect(select.value).toBe('c');
    press('Enter');
    expect(open).toHaveBeenCalledTimes(1);
    window.removeEventListener('tv-select', open);
  });
  it('lets a pending seek cancel before closing its containing dialog', () => {
    const back = vi.fn();
    removeScope();
    removeScope = registerTVScope({ element: document.querySelector('main')!, onBack: back });
    const button = document.querySelector('button')!;
    button.focus();
    button.addEventListener('tv-back', (e) => e.preventDefault(), { once: true });
    press('Escape');
    expect(back).not.toHaveBeenCalled();
    press('Escape');
    expect(back).toHaveBeenCalledTimes(1);
  });

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
