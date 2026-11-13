import type { CustomTTSService } from '@/types/customTTS';
type TTSInput = Omit<CustomTTSService, 'id' | 'addedAt' | 'updatedAt'>;
const text = (value: unknown, max: number, required = false): string => {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    throw new Error('请检查必填项和字段长度');
  return value.trim();
};
export function validateTTSInput(value: unknown): TTSInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('配置格式不正确');
  const data = value as Record<string, unknown>;
  const baseUrl = text(data['baseUrl'], 2048, true);
  const url = new URL(baseUrl);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error('服务地址必须是 HTTP(S) 接口地址，不能包含凭据或查询参数');
  const responseFormat = data['responseFormat'] ?? 'mp3';
  if (!['mp3', 'wav', 'none'].includes(String(responseFormat))) throw new Error('音频格式不正确');
  return {
    name: text(data['name'], 100, true),
    baseUrl,
    apiKey: text(data['apiKey'], 4096),
    model: text(data['model'], 200, true),
    voices: text(data['voices'], 4000),
    instructions: text(data['instructions'], 8000),
    responseFormat: responseFormat as 'mp3' | 'wav' | 'none',
    disabled: data['disabled'] === true,
  };
}
export function resolveTTSInput(value: unknown, old?: CustomTTSService): TTSInput {
  const input = validateTTSInput(value);
  if ((value as Record<string, unknown>)['keepApiKey'] === true && !input.apiKey)
    input.apiKey = old?.apiKey ?? '';
  return input;
}
export const publicTTSConfig = (services: CustomTTSService[]) =>
  services
    .filter((s) => !s.deletedAt)
    .map((s) => ({
      id: s.id,
      name: s.name,
      baseUrl: s.baseUrl,
      model: s.model,
      voices: s.voices ?? '',
      instructions: s.instructions ?? '',
      responseFormat: s.responseFormat ?? 'mp3',
      disabled: !!s.disabled,
      hasApiKey: !!s.apiKey,
    }));
