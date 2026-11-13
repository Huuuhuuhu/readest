export interface ReadestRuntimeConfig {
  apiBaseUrl?: string;
  objectStorageType?: string;
  fontBaseUrl?: string;
}
declare global {
  interface Window {
    __READEST_RUNTIME_CONFIG?: ReadestRuntimeConfig;
  }
}
export const getRuntimeConfig = () =>
  typeof window === 'undefined' ? undefined : window.__READEST_RUNTIME_CONFIG;
export const getServerRuntimeConfig = (): ReadestRuntimeConfig => ({
  apiBaseUrl: process.env['API_BASE_URL'] ?? process.env['NEXT_PUBLIC_API_BASE_URL'],
  fontBaseUrl:
    process.env['FONT_BASE_URL'] || process.env['NEXT_PUBLIC_FONT_BASE_URL'] || undefined,
});
