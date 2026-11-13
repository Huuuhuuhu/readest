import { normalizeToShortLang } from '@/utils/lang';

export const toDeepLLang = (lang: string): string => {
  const [primary, ...rest] = normalizeToShortLang(lang).split('-');
  return [primary!.toUpperCase(), ...rest].join('-');
};
