import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useEnv } from '@/context/EnvContext';
import { isTauriAppPlatform } from '@/services/environment';
import { useTVScope } from '@/hooks/useTVScope';
import { eventDispatcher } from '@/utils/event';
import { useCustomTTSStore } from '@/store/customTTSStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { resolveTTSInput, publicTTSConfig } from '@/services/tvPortalConfig';
import {
  OpenAICompatibleSpeechProvider,
  customVoiceId,
} from '@/services/tts/providers/openaiCompatible';
import { ingestFile } from '@/services/ingestService';
import QRCode from '@/components/settings/integrations/QRCode';
interface Upload {
  id: string;
  batch: string;
  name: string;
  size: number;
  received: number;
  status: string;
}
interface PortalStatus {
  active: boolean;
  port: number;
  addresses: string[];
  token: string;
  expiresAt: number;
  accepting: boolean;
  uploads: Upload[];
}
interface PortalRequest {
  id: string;
  op: string;
  data: Record<string, unknown> | null;
}
const labels: Record<string, string> = {
  pending: '等待批准',
  ready: '等待传输',
  receiving: '正在接收',
  complete: '准备导入',
  importing: '正在导入',
  saved: '已加入书库',
  failed: '传输失败',
  cancelled: '已取消',
  'import-failed': '导入失败',
};
const button = 'btn eink-bordered min-h-12 px-5';
const base64 = (buffer: ArrayBuffer) => {
  let value = '';
  for (const byte of new Uint8Array(buffer)) value += String.fromCharCode(byte);
  return btoa(value);
};
/** The native server lives independently of this sheet; hiding it never changes playback or focus. */
export default function TVPortal({ appActive = true }: { appActive?: boolean }) {
  const { envConfig } = useEnv();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const scope = useRef<HTMLDivElement>(null);
  const importing = useRef(false);
  const requestQueue = useRef<Promise<void>>(Promise.resolve());
  const close = () => setOpen(false);
  useTVScope(scope, open, { id: 'phone-portal', priority: 1000, onBack: close, onMenu: close });
  const update = useCallback(async () => {
    const next = await invoke<PortalStatus | null>('tv_portal_status');
    setStatus(next);
    if (next?.active)
      setAddress((current) =>
        next.addresses.includes(current) ? current : (next.addresses[0] ?? ''),
      );
    if (!next?.active || importing.current) return;
    const upload = next.uploads.find((item) => item.status === 'complete');
    if (!upload) return;
    importing.current = true;
    let success = false;
    try {
      const path = await invoke<string>('tv_portal_take_upload', { id: upload.id });
      const appService = await envConfig.getAppService();
      const book = await ingestFile(
        { file: path, books: useLibraryStore.getState().library, forceCopy: true },
        { appService, settings: useSettingsStore.getState().settings },
      );
      if (book) await useLibraryStore.getState().updateBooks(envConfig, [book]);
      success = true;
      eventDispatcher.dispatch('toast', { type: 'info', message: `已接收：${upload.name}` });
    } catch {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: `无法导入：${upload.name}，请检查文件后重新上传。`,
      });
    } finally {
      await invoke('tv_portal_finish_upload', { id: upload.id, success }).catch(() => {});
      importing.current = false;
    }
  }, [envConfig]);
  useEffect(() => {
    const show = () => {
      setOpen(true);
      setError('');
    };
    eventDispatcher.on('open-tv-portal', show);
    return () => eventDispatcher.off('open-tv-portal', show);
  }, []);
  useEffect(() => {
    if (!isTauriAppPlatform()) return;
    if (!appActive) {
      void invoke('tv_portal_stop').catch(() => {});
      setOpen(false);
      return;
    }
    let mounted = true;
    const poll = () => {
      if (mounted) void update().catch(() => {});
    };
    const timer = setInterval(poll, 1500);
    poll();
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [appActive, update]);
  useEffect(() => {
    if (!isTauriAppPlatform() || !appActive) return;
    let disposed = false;
    const listener = listen<PortalRequest>('tv-portal-request', (event) => {
      requestQueue.current = requestQueue.current
        .catch(() => {})
        .then(async () => {
          if (
            disposed ||
            !(await invoke<boolean>('tv_portal_request_valid', { id: event.payload.id }))
          )
            return;
          const { id, op, data } = event.payload;
          try {
            let result: unknown;
            const store = useCustomTTSStore.getState();
            if (!store.loaded) await store.loadCustomTTSServices(envConfig);
            const services = useCustomTTSStore.getState().services;
            const old = services.find(
              (service) => service.id === data?.['id'] && !service.deletedAt,
            );
            if (op === 'getConfig') result = { tts: publicTTSConfig(services) };
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
                if (audio.audio.byteLength > 8 * 1024 * 1024)
                  throw new Error('试听音频过大，请缩短文本');
                result = {
                  audio: base64(audio.audio),
                  mime: service.responseFormat === 'wav' ? 'audio/wav' : 'audio/mpeg',
                };
              } else throw new Error('操作不支持');
            }
            await invoke('tv_portal_respond', { id, result });
          } catch {
            // Provider responses can echo credentials. Never forward raw exceptions or log request bodies.
            await invoke('tv_portal_respond', {
              id: event.payload.id,
              error:
                '操作失败，请检查接口地址、模型、音色、密钥和网络后重试。配置需填写名称、接口地址和模型。',
            }).catch(() => {});
          }
        });
    });
    return () => {
      disposed = true;
      void listener.then((unlisten) => unlisten());
    };
  }, [appActive, envConfig]);
  const start = async () => {
    if (!isTauriAppPlatform()) {
      setError('手机助手需要安装电视 APK 后使用。');
      return;
    }
    setStarting(true);
    setError('');
    try {
      const next = await invoke<PortalStatus>('tv_portal_start');
      setStatus(next);
      setAddress(next.addresses[0] ?? '');
    } catch (error) {
      setError(typeof error === 'string' ? error : '无法开启，请检查电视网络。');
    } finally {
      setStarting(false);
    }
  };
  const control = async (action: string, id?: string) => {
    try {
      await invoke('tv_portal_control', { action, id });
      await update();
    } catch {
      setError('操作失败，请重新开启手机助手。');
    }
  };
  const stop = async () => {
    await invoke('tv_portal_stop');
    setStatus(null);
  };
  if (!open) return null;
  const active = status?.active;
  const url = active && address ? `http://${address}:${status.port}/#${status.token}` : '';
  const pending = status?.uploads.find((item) => item.status === 'pending');
  return (
    <div
      className='fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 p-6'
      data-capture-blocking-overlay='true'
    >
      <div
        ref={scope}
        role='dialog'
        aria-modal='true'
        aria-labelledby='phone-portal-title'
        tabIndex={-1}
        className='modal-box eink-bordered bg-base-100 max-h-[90vh] w-full max-w-5xl overflow-auto p-8'
      >
        <h2 id='phone-portal-title' className='mb-3 text-3xl font-semibold'>
          手机助手 · 上传与配置
        </h2>
        <p className='mb-4'>手机和电视连接同一局域网。方向键选择，确认操作，返回收起。</p>
        {error && (
          <p role='alert' className='text-error my-3'>
            {error}
          </p>
        )}
        {active ? (
          <>
            <div className='grid gap-5 md:grid-cols-[260px_1fr]'>
              <div>
                {url ? (
                  <QRCode value={url} />
                ) : (
                  <p>未检测到可用局域网地址，请连接 Wi-Fi 或有线网络。</p>
                )}
              </div>
              <div>
                <p>扫码打开普通手机浏览器，上传书籍或设置朗读服务。</p>
                <p>
                  授权至 {new Date(status.expiresAt * 1000).toLocaleTimeString()}
                  ，关闭或网络变化后失效。
                </p>
                {status.addresses.length > 1 && (
                  <label className='block py-3'>
                    访问地址
                    <select
                      className='select eink-bordered ml-3'
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                    >
                      {status.addresses.map((ip) => (
                        <option key={ip} value={ip}>
                          {ip}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {url && (
                  <p className='my-3 select-text break-all rounded border p-3 text-sm'>{url}</p>
                )}
                <p>API Key 不在二维码中；手机页面使用临时授权，配置仅保存到电视。</p>
              </div>
            </div>
            {pending && (
              <div className='my-4 rounded border p-4'>
                <p>
                  手机请求上传{' '}
                  {status.uploads.filter((file) => file.batch === pending.batch).length}{' '}
                  本书，请确认文件列表后批准。
                </p>
                <div className='mt-3 flex gap-3'>
                  <button className={button} onClick={() => void control('reject', pending.batch)}>
                    拒绝此批
                  </button>
                  <button
                    className={`${button} btn-contrast`}
                    onClick={() => void control('approve', pending.batch)}
                  >
                    批准此批
                  </button>
                </div>
              </div>
            )}
            <ul className='my-4'>
              {status.uploads.map((file) => (
                <li key={file.id} className='flex items-center justify-between gap-4 border-b py-2'>
                  <span>
                    {file.name} · {labels[file.status]}
                    {file.status === 'receiving' &&
                      ` ${Math.round((file.received / file.size) * 100)}%`}
                  </span>
                  {['ready', 'receiving'].includes(file.status) && (
                    <button className={button} onClick={() => void control('cancel', file.id)}>
                      取消传输
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className='mt-5 flex flex-wrap gap-3'>
              <button className={button} onClick={close}>
                收起，继续传输
              </button>
              <button
                className={button}
                onClick={() => void control(status.accepting ? 'stop-new' : 'accept-new')}
              >
                {status.accepting ? '停止接收新文件' : '继续接收新文件'}
              </button>
              <button
                className={button}
                onClick={() => void stop().catch(() => setError('关闭失败，请重试。'))}
              >
                关闭入口并取消传输
              </button>
            </div>
          </>
        ) : (
          <>
            <p className='my-4'>
              入口仅在主动开启后运行，15
              分钟后自动关闭。上传文件需用遥控器批准；手机配置保存后立即生效。
            </p>
            <div className='flex gap-3'>
              <button
                className={`${button} btn-contrast`}
                disabled={starting}
                onClick={() => void start()}
              >
                {starting ? '正在开启…' : '开启手机助手'}
              </button>
              <button className={button} onClick={close}>
                返回
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
