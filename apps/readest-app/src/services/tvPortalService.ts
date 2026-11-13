import type { EnvConfigType } from '@/services/environment';
import type { CustomTTSService } from '@/types/customTTS';
import { useCustomTTSStore } from '@/store/customTTSStore';
import { useCustomOPDSStore } from '@/store/customOPDSStore';
import { useSettingsStore } from '@/store/settingsStore';
import { resolveTTSInput, publicTTSConfig, connectionText, connectionURL } from './tvPortalConfig';
import { OpenAICompatibleSpeechProvider, customVoiceId } from './tts/providers/openaiCompatible';
const base64 = (buffer: ArrayBuffer) => {
  let value = '';
  for (const byte of new Uint8Array(buffer)) value += String.fromCharCode(byte);
  return btoa(value);
};
const publicConfig = (services: CustomTTSService[]) => {
  const { webdav, opdsCatalogs } = useSettingsStore.getState().settings;
  return {
    tts: publicTTSConfig(services),
    webdav: {
      enabled: !!webdav?.enabled,
      serverUrl: webdav?.serverUrl ?? '',
      username: webdav?.username ?? '',
      rootPath: webdav?.rootPath ?? '/Readest',
      hasPassword: !!webdav?.password,
    },
    opds: (opdsCatalogs ?? [])
      .filter((c) => !c.deletedAt)
      .map((c) => ({
        id: c.id,
        name: c.name,
        url: c.url,
        username: c.username ?? '',
        hasPassword: !!c.password,
        allowSelfSignedCert: !!c.allowSelfSignedCert,
      })),
  };
};
async function saveLibraryConnection(
  env: EnvConfigType,
  op: string,
  data: Record<string, unknown> | null,
) {
  if (!data) throw new Error('缺少配置');
  const { settings, saveSettings, setSettings } = useSettingsStore.getState();
  if (op === 'saveWebDAV') {
    const old = settings.webdav;
    const password = connectionText(data['password'], 4096);
    const webdav = {
      ...old,
      enabled: data['enabled'] === true,
      serverUrl: connectionURL(data['serverUrl']),
      username: connectionText(data['username'], 256),
      password: !password && data['keepPassword'] === true ? (old?.password ?? '') : password,
      rootPath: connectionText(data['rootPath'], 1024) || '/Readest',
    };
    await saveSettings(env, { ...settings, webdav });
    setSettings({ ...useSettingsStore.getState().settings, webdav });
    return { ok: true };
  }
  // Start from the persisted TV list; do not overwrite a catalog just because
  // the OPDS page has not mounted/hydrated its store yet.
  const store = useCustomOPDSStore.getState();
  const previous = store.catalogs;
  useCustomOPDSStore.setState({ catalogs: settings.opdsCatalogs ?? [] });
  try {
    const old = useCustomOPDSStore.getState().getCatalog(String(data['id'] ?? ''));
    if (op === 'deleteOPDS') {
      if (!old || old.deletedAt) throw new Error('书源不存在');
      store.removeCatalog(old.id);
    } else {
      if (data['id'] && (!old || old.deletedAt)) throw new Error('书源已删除，请刷新');
      if (!old && (settings.opdsCatalogs?.filter((c) => !c.deletedAt).length ?? 0) >= 100)
        throw new Error('最多保存 100 个书源');
      const password = connectionText(data['password'], 4096);
      const input = {
        name: connectionText(data['name'], 100, true),
        url: connectionURL(data['url']),
        username: connectionText(data['username'], 256),
        password: !password && data['keepPassword'] === true ? (old?.password ?? '') : password,
        allowSelfSignedCert: data['allowSelfSignedCert'] === true,
      };
      if (old) store.updateCatalog(old.id, input);
      else store.addCatalog({ ...input, id: crypto.randomUUID() });
    }
    const opdsCatalogs = useCustomOPDSStore.getState().catalogs.filter((c) => !c.deletedAt);
    await saveSettings(env, { ...settings, opdsCatalogs });
    setSettings({ ...useSettingsStore.getState().settings, opdsCatalogs });
    return { ok: true };
  } catch (error) {
    useCustomOPDSStore.setState({ catalogs: previous });
    throw error;
  }
}
/** Shared by the phone RPC and TV stores; no account or hosted intermediary. */
export async function handleTVPortalRequest(
  envConfig: EnvConfigType,
  op: string,
  data: Record<string, unknown> | null,
): Promise<unknown> {
  let result: unknown;
  const store = useCustomTTSStore.getState();
  if (!store.loaded) await store.loadCustomTTSServices(envConfig);
  const services = useCustomTTSStore.getState().services;
  const old = services.find((service) => service.id === data?.['id'] && !service.deletedAt);
  if (op === 'getConfig') result = publicConfig(services);
  else if (['saveWebDAV', 'saveOPDS', 'deleteOPDS'].includes(op))
    return saveLibraryConnection(envConfig, op, data);
  else if (op === 'deleteTTS') {
    if (!old) throw new Error('服务不存在');
    store.removeService(old.id);
    try {
      await store.saveCustomTTSServices(envConfig);
    } catch (error) {
      useCustomTTSStore.setState({ services });
      throw error;
    }
    result = { ok: true };
  } else {
    const input = resolveTTSInput(data, old);
    if (op === 'saveTTS') {
      if (data?.['id'] && !old) throw new Error('服务已删除，请刷新');
      if (!old && services.filter((service) => !service.deletedAt).length >= 30)
        throw new Error('最多保存 30 个朗读服务');
      const serviceId = old?.id ?? store.addService(input).id;
      if (old) store.updateService(serviceId, input);
      try {
        await store.saveCustomTTSServices(envConfig);
      } catch (error) {
        useCustomTTSStore.setState({ services });
        throw error;
      }
      result = { id: serviceId };
    } else if (op === 'testTTS') {
      const text = typeof data?.['text'] === 'string' ? data['text'].trim() : '';
      if (!text || text.length > 200) throw new Error('试听文字需为 1–200 字');
      const service = {
        ...input,
        id: old?.id ?? 'preview',
        addedAt: 0,
        updatedAt: 0,
        disabled: false,
      };
      const provider = new OpenAICompatibleSpeechProvider(() => [service]);
      const voice =
        service.voices?.split(',')[0]?.trim() ||
        (await provider.getAllVoices())[0]?.id?.split(':').slice(1).join(':') ||
        'alloy';
      const audio = await provider.synthesize(
        { text, lang: 'zh-CN', voice: customVoiceId(service.id, voice), pitch: 1 },
        AbortSignal.timeout(30000),
      );
      if (audio.audio.byteLength > 8 * 1024 * 1024) throw new Error('试听音频过大，请缩短文本');
      result = {
        audio: base64(audio.audio),
        mime:
          new TextDecoder().decode(audio.audio.slice(0, 4)) === 'RIFF' ? 'audio/wav' : 'audio/mpeg',
      };
    } else throw new Error('操作不支持');
  }
  return result;
}
