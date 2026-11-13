'use strict';
const $ = (id) => document.getElementById(id);
let token = location.hash.slice(1) || sessionStorage.getItem('tv-capability') || '';
if (location.hash) {
  sessionStorage.setItem('tv-capability', token);
  history.replaceState(null, '', '/');
}
let services = [],
  connected = true,
  uploadController,
  previewURL,
  busy = false;
function message(text, error = false) {
  $('message').textContent = text;
  $('message').classList.toggle('error', error);
}
async function api(path, body, options = {}) {
  if (!token) throw new Error('请在电视上开启手机助手并重新扫码。');
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
  };
  const response = await fetch(path, {
    cache: 'no-store',
    headers,
    ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}),
    ...options,
  });
  const data = await response.json();
  if (response.status === 401) {
    token = '';
    sessionStorage.removeItem('tv-capability');
    connected = false;
  }
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}
const rpc = (op, data) => api('/api/rpc', { op, data });
const labels = {
  pending: '等待电视批准',
  ready: '等待传输',
  receiving: '正在接收',
  complete: '准备导入',
  importing: '正在导入书库',
  saved: '已加入书库',
  failed: '传输失败，请重新选择',
  cancelled: '已取消',
  'import-failed': '导入失败，请检查文件是否完整',
};
async function status() {
  const data = await api('/api/status');
  $('transfers').replaceChildren(
    ...data.uploads.map((file) => {
      const item = document.createElement('li');
      item.textContent = `${file.name} · ${labels[file.status] || file.status}${file.status === 'receiving' ? ` ${Math.round((file.received / file.size) * 100)}%` : ''}`;
      return item;
    }),
  );
  return data;
}
function showTab(tab) {
  $('books').hidden = tab !== 'books';
  $('tts').hidden = tab !== 'tts';
  for (const id of ['books', 'tts'])
    $(`${id}-tab`).setAttribute('aria-pressed', String(id === tab));
}
$('books-tab').onclick = () => showTab('books');
$('tts-tab').onclick = () => {
  showTab('tts');
  loadConfig().catch(fail);
};
function fail(error) {
  message(error instanceof Error ? error.message : '操作失败，请重试', true);
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
$('upload').onclick = async () => {
  const files = [...$('files').files];
  if (!files.length) return message('请先选择书籍。', true);
  $('upload').disabled = true;
  $('cancel-upload').hidden = false;
  uploadController = new AbortController();
  let batchId,
    completed = false;
  try {
    const batch = await api(
      '/api/batch',
      files.map(({ name, size }) => ({ name, size })),
    );
    batchId = batch.batch;
    message('请用遥控器在电视的手机助手页面批准这批文件。');
    let state;
    while (!uploadController.signal.aborted) {
      state = await status();
      const entries = state.uploads.filter((item) => item.batch === batch.batch);
      if (!entries.length || entries.some((item) => item.status === 'cancelled'))
        throw new Error('电视已拒绝或取消此批文件。');
      if (entries.every((item) => item.status === 'ready')) break;
      await delay(1000);
    }
    for (let i = 0; i < files.length; i++) {
      if (uploadController.signal.aborted) throw new Error('已取消传输。');
      message(`正在发送 ${i + 1}/${files.length}：${files[i].name}`);
      await api(`/api/upload/${batch.files[i].id}`, undefined, {
        method: 'PUT',
        body: files[i],
        signal: uploadController.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      });
    }
    completed = true;
    message('传输完成，电视正在加入书库。');
    $('files').value = '';
  } catch (error) {
    fail(error);
  } finally {
    if (batchId && !completed) await api('/api/cancel-batch', { batch: batchId }).catch(() => {});
    $('upload').disabled = false;
    $('cancel-upload').hidden = true;
  }
};
$('cancel-upload').onclick = () => uploadController?.abort();
const form = $('tts-form');
const field = (name) => form.elements.namedItem(name);
function fill(id) {
  const service = services.find((item) => item.id === id);
  form.reset();
  for (const name of ['name', 'baseUrl', 'model', 'voices', 'instructions', 'responseFormat'])
    field(name).value =
      service?.[name] ?? (name === 'model' ? 'tts-1' : name === 'responseFormat' ? 'mp3' : '');
  field('disabled').checked = !!service?.disabled;
  field('apiKey').placeholder = service?.hasApiKey
    ? '已有密钥，留空保留；填写则替换'
    : '此服务不需要密钥时可留空';
  $('delete').disabled = !service;
}
async function loadConfig(selectId = $('services').value) {
  services = (await rpc('getConfig')).tts;
  $('services').replaceChildren(
    new Option('添加新服务', ''),
    ...services.map((service) => new Option(service.name, service.id)),
  );
  $('services').value = services.some((s) => s.id === selectId) ? selectId : '';
  fill($('services').value);
}
$('services').onchange = () => fill($('services').value);
function input() {
  const result = {};
  for (const name of [
    'name',
    'baseUrl',
    'apiKey',
    'model',
    'voices',
    'instructions',
    'responseFormat',
  ])
    result[name] = field(name).value;
  return {
    ...result,
    id: $('services').value,
    disabled: field('disabled').checked,
    keepApiKey: !field('clearKey').checked,
  };
}
async function operation(work) {
  if (busy || !form.reportValidity()) return;
  busy = true;
  for (const id of ['test', 'delete']) $(id).disabled = true;
  form.querySelector('[type=submit]').disabled = true;
  try {
    await work();
  } catch (error) {
    fail(error);
  } finally {
    busy = false;
    $('test').disabled = false;
    $('delete').disabled = !$('services').value;
    form.querySelector('[type=submit]').disabled = false;
  }
}
form.onsubmit = (event) => {
  event.preventDefault();
  void operation(async () => {
    const result = await rpc('saveTTS', input());
    await loadConfig(result.id);
    message('已保存到电视，重启后仍保留。');
  });
};
$('delete').onclick = () => {
  if (!confirm('删除这个朗读服务？')) return;
  void operation(async () => {
    await rpc('deleteTTS', { id: $('services').value });
    await loadConfig('');
    message('已删除服务。');
  });
};
$('test').onclick = () => {
  void operation(async () => {
    message('电视正在连接朗读服务…');
    const result = await rpc('testTTS', { ...input(), text: $('preview-text').value });
    if (previewURL) URL.revokeObjectURL(previewURL);
    const bytes = Uint8Array.from(atob(result.audio), (char) => char.charCodeAt(0));
    previewURL = URL.createObjectURL(new Blob([bytes], { type: result.mime }));
    $('preview').src = previewURL;
    $('preview').hidden = false;
    message('连接成功，请播放试听；当前参数尚未保存。');
    await $('preview')
      .play()
      .catch(() => {});
  });
};
status()
  .then(() => message('已连接电视。请选择上传书籍或配置朗读服务。'))
  .catch(fail);
setInterval(() => {
  if (connected && token)
    status().catch((error) => {
      if (!token) fail(error);
    });
}, 2000);
