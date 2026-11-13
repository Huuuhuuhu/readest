// @vitest-environment node
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, expect, it, vi } from 'vitest';
const html = readFileSync('src-tauri/src/tv_portal/index.html', 'utf8');
const script = readFileSync('src-tauri/src/tv_portal/app.js', 'utf8');
let dom: JSDOM;
afterEach(() => dom?.window.close());
const config = {
  tts: [],
  webdav: { serverUrl: '', username: '', rootPath: '/Readest', enabled: false, hasPassword: false },
  opds: [],
};
function setup(reply: (path: string, init: RequestInit) => object | Promise<object>) {
  dom = new JSDOM(html, {
    url: 'http://192.168.1.8:8765/#test-temporary-capability',
    runScripts: 'outside-only',
  });
  const fetch = vi.fn(async (path: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    json: () => reply(path, init),
  }));
  Object.assign(dom.window, { fetch, confirm: () => true, setInterval: vi.fn() });
  dom.window.eval(script);
  return {
    document: dom.window.document,
    fetch,
    button: (id: string) => dom.window.document.getElementById(id) as HTMLButtonElement,
  };
}
const settled = () =>
  vi.waitFor(() =>
    expect(dom.window.document.getElementById('message')?.textContent).toContain('已连接电视'),
  );

it('phone TTS form keeps capability and service keys out of URLs and saves explicitly', async () => {
  const { document, fetch, button } = setup((path, init) =>
    path === '/api/status'
      ? { uploads: [] }
      : JSON.parse(String(init.body)).op === 'saveTTS'
        ? { id: 'tts-local' }
        : config,
  );
  await settled();
  expect(dom.window.location.hash).toBe('');
  button('tts-tab').click();
  await vi.waitFor(() => expect(document.getElementById('tts')?.hidden).toBe(false));
  const form = document.getElementById('tts-form') as HTMLFormElement;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  // Let the initial configuration response settle before entering the draft.
  await vi.waitFor(() => expect(field('model').value).toBe('tts-1'));
  field('name').value = 'Local speech';
  field('baseUrl').value = 'http://192.168.1.9:8880/v1';
  field('apiKey').value = 'fixture-key-never-in-url';
  field('model').value = 'kokoro';
  field('voices').value = 'voice-a';
  expect(fetch.mock.calls.some(([, init]) => String(init.body).includes('fixture-key'))).toBe(
    false,
  );
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.getElementById('message')?.textContent).toContain('已保存到电视'),
  );
  const call = fetch.mock.calls.find(([, init]) => String(init.body).includes('saveTTS'))!;
  expect(JSON.parse(String(call[1].body))).toMatchObject({
    op: 'saveTTS',
    data: {
      model: 'kokoro',
      voices: 'voice-a',
      apiKey: 'fixture-key-never-in-url',
      keepApiKey: true,
    },
  });
  for (const [path, init] of fetch.mock.calls) {
    expect(path).toMatch(/^\/api\//);
    expect(path).not.toMatch(/fixture-key|test-temporary/);
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer test-temporary-capability',
    );
  }
});

it('phone sends one approved batch then each selected book, without requesting auto-open', async () => {
  let batch = false;
  const files = [
    { id: 'a', batch: 'b', name: '中文小说.txt', size: 3, status: 'ready' },
    { id: 'c', batch: 'b', name: '第二本.txt', size: 4, status: 'ready' },
  ];
  const { document, fetch, button } = setup((path) => {
    if (path === '/api/status') return { uploads: batch ? files : [] };
    if (path === '/api/batch') {
      batch = true;
      return { batch: 'b', files };
    }
    return { ok: true };
  });
  await settled();
  Object.defineProperty(document.getElementById('files'), 'files', {
    value: [
      new dom.window.File(['abc'], '中文小说.txt'),
      new dom.window.File(['defg'], '第二本.txt'),
    ],
  });
  button('upload').click();
  await vi.waitFor(() =>
    expect(document.getElementById('message')?.textContent).toContain('传输完成'),
  );
  expect(fetch.mock.calls.filter(([path]) => path === '/api/batch')).toHaveLength(1);
  expect(
    fetch.mock.calls.filter(([, init]) => init.method === 'PUT').map(([path]) => path),
  ).toEqual(['/api/upload/a', '/api/upload/c']);
  expect(fetch.mock.calls.some(([path]) => /open|cancel/.test(path))).toBe(false);
});

it('phone keeps WebDAV password blank unless replaced and reuses the TV configuration', async () => {
  const saved = {
    ...config,
    webdav: {
      serverUrl: 'https://dav.example.test/',
      username: 'reader',
      rootPath: '/Books',
      enabled: true,
      hasPassword: true,
    },
  };
  const { document, fetch, button } = setup((path) =>
    path === '/api/status' ? { uploads: [] } : saved,
  );
  await settled();
  button('library-tab').click();
  const form = document.getElementById('webdav-form') as HTMLFormElement;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  await vi.waitFor(() => expect(field('username').value).toBe('reader'));
  expect(field('password').value).toBe('');
  expect(field('password').placeholder).toContain('已有密码');
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() =>
    expect(document.getElementById('message')?.textContent).toContain('连接已保存到电视'),
  );
  const call = fetch.mock.calls.find(([, init]) => String(init.body).includes('saveWebDAV'))!;
  expect(JSON.parse(String(call[1].body))).toMatchObject({
    op: 'saveWebDAV',
    data: { password: '', keepPassword: true, rootPath: '/Books' },
  });
});

it('phone stops polling and forgets authorization after repeated connection loss', async () => {
  let offline = false;
  const { fetch } = setup(() => {
    if (offline) throw new Error('network unavailable');
    return { uploads: [] };
  });
  await settled();
  offline = true;
  const tick = vi.mocked(dom.window.setInterval).mock.calls[0]![0] as () => void;
  for (let i = 0; i < 3; i++) {
    tick();
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(dom.window.sessionStorage.getItem('tv-capability')).toBeNull();
  expect(dom.window.document.getElementById('message')?.textContent).toContain('重新扫码');
  const calls = fetch.mock.calls.length;
  tick();
  await new Promise((resolve) => setImmediate(resolve));
  expect(fetch.mock.calls).toHaveLength(calls);
});
