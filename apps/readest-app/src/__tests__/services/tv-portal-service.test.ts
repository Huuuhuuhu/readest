import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemSettings } from '@/types/settings';
import type { EnvConfigType } from '@/services/environment';
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock('@/services/ai/utils/httpFetch', () => ({ getAIFetch: () => fetchMock }));
import { useSettingsStore } from '@/store/settingsStore';
import { useCustomTTSStore } from '@/store/customTTSStore';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { handleTVPortalRequest } from '@/services/tvPortalService';

let disk: SystemSettings;
const save = vi.fn(async (_env: unknown, settings: SystemSettings) => {
  disk = structuredClone(settings);
});
const env = {} as EnvConfigType;
const input = {
  name: 'Home TTS',
  baseUrl: 'http://192.168.1.10:8880/v1',
  model: 'tts-1',
  voices: 'nova',
  apiKey: 'private-test-key',
};
const call = (op: string, data: Record<string, unknown> | null = null) =>
  handleTVPortalRequest(env, op, data);

beforeEach(() => {
  vi.clearAllMocks();
  disk = {
    webdav: { enabled: false, serverUrl: '', username: '', password: '', rootPath: '/Readest' },
    opdsCatalogs: [],
    customTTSServices: [],
  } as unknown as SystemSettings;
  useSettingsStore.setState({
    settings: structuredClone(disk),
    saveSettings: save,
    setSettings: (settings) => useSettingsStore.setState({ settings }),
  });
  useCustomTTSStore.setState({ services: [], loaded: false });
  useCustomOPDSStore.setState({ catalogs: [] });
});

describe('phone configuration uses the TV local stores', () => {
  it('persists TTS, masks secrets, reloads after restart, and deletes', async () => {
    await call('saveTTS', input);
    expect(disk.customTTSServices?.[0]?.apiKey).toBe(input.apiKey);
    const config = (await call('getConfig')) as { tts: { id: string; hasApiKey: boolean }[] };
    expect(JSON.stringify(config)).not.toContain(input.apiKey);
    expect(config.tts[0]?.hasApiKey).toBe(true);
    useCustomTTSStore.setState({ services: [], loaded: false });
    useSettingsStore.setState({ settings: structuredClone(disk) });
    await call('getConfig');
    expect(useCustomTTSStore.getState().services[0]?.apiKey).toBe(input.apiKey);
    await call('saveTTS', {
      ...input,
      id: config.tts[0]!.id,
      apiKey: '',
      keepApiKey: true,
      name: 'Renamed',
    });
    expect(disk.customTTSServices?.[0]?.apiKey).toBe(input.apiKey);
    await call('deleteTTS', { id: config.tts[0]!.id });
    expect(disk.customTTSServices).toEqual([]);
  });
  it('previews directly with draft parameters without saving or playing on the TV', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'audio/mpeg' } }),
    );
    expect(await call('testTTS', { ...input, text: '测试' })).toMatchObject({
      audio: 'AQID',
      mime: 'audio/mpeg',
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(`${input.baseUrl}/audio/speech`);
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe(`Bearer ${input.apiKey}`);
    expect(save).not.toHaveBeenCalled();
  });
  it('rolls back failed writes, leaving local reading settings and old service intact', async () => {
    await call('saveTTS', input);
    const original = structuredClone(disk);
    save.mockRejectedValueOnce(new Error('disk full'));
    await expect(
      call('saveTTS', { ...input, id: disk.customTTSServices![0]!.id, name: 'Bad write' }),
    ).rejects.toThrow('disk full');
    expect(disk).toEqual(original);
    expect(useCustomTTSStore.getState().services[0]?.name).toBe(input.name);
    expect(useSettingsStore.getState().settings).toEqual(original);
  });
  it('shares WebDAV credentials while keeping existing sync choices', async () => {
    useSettingsStore.getState().settings.webdav.syncBooks = true;
    await call('saveWebDAV', {
      serverUrl: 'http://192.168.1.2/dav',
      username: 'reader',
      password: 'dav-secret',
      rootPath: '/Books',
      enabled: true,
    });
    expect(disk.webdav).toMatchObject({
      password: 'dav-secret',
      syncBooks: true,
      rootPath: '/Books',
      enabled: true,
    });
    expect(JSON.stringify(await call('getConfig'))).not.toContain('dav-secret');
    await call('saveWebDAV', {
      serverUrl: disk.webdav.serverUrl,
      username: 'reader',
      password: '',
      keepPassword: true,
      rootPath: '/Books',
      enabled: false,
    });
    expect(disk.webdav.password).toBe('dav-secret');
  });
  it('adds, edits and removes OPDS in the same store used by the TV catalog screen', async () => {
    await call('saveOPDS', {
      name: 'LAN library',
      url: 'http://192.168.1.3/opds',
      username: 'user',
      password: 'opds-secret',
    });
    const id = disk.opdsCatalogs![0]!.id;
    expect(useCustomOPDSStore.getState().getCatalog(id)?.password).toBe('opds-secret');
    expect(JSON.stringify(await call('getConfig'))).not.toContain('opds-secret');
    await call('saveOPDS', {
      id,
      name: 'Updated library',
      url: 'http://192.168.1.3/opds',
      keepPassword: true,
    });
    expect(disk.opdsCatalogs![0]?.password).toBe('opds-secret');
    await call('deleteOPDS', { id });
    expect(disk.opdsCatalogs).toEqual([]);
  });
  it('rejects unsupported operations and credential-bearing endpoint URLs', async () => {
    await expect(call('signIn', {})).rejects.toThrow();
    await expect(
      call('saveWebDAV', { serverUrl: 'https://user:pass@server/dav' }),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});
