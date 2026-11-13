import { afterEach, describe, expect, test, vi } from 'vitest';
import nextConfig from '../../next.config.mjs';

/** Next's own `getCloneableBody` fallback (`DEFAULT_BODY_CLONE_SIZE_LIMIT`). */
const NEXT_DEFAULT_BODY_CLONE_LIMIT = 10 * 1024 * 1024;

describe('Next.js static asset headers', () => {
  test('keeps bundled workers cross-origin isolated', async () => {
    const rules = ((await nextConfig.headers?.()) ?? []) as Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }>;
    const staticRule = rules.find((rule) => rule.source === '/_next/static/:path*');

    expect(staticRule?.headers).toContainEqual({
      key: 'Cross-Origin-Embedder-Policy',
      value: 'require-corp',
    });
  });
});

describe('Proxy request body clone limit', () => {
  // `middleware.ts` matches every /api/* route, and Next buffers a clone of the
  // request body so both the middleware and the route handler can read it. Past
  // `experimental.proxyClientMaxBodySize` the clone is truncated and the route
  // handler sees a short body with a clean `end` — a silently corrupt upload,
  // not an error (#6091).
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  test('every build raises it past the truncating default', () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBeGreaterThan(
      NEXT_DEFAULT_BODY_CLONE_LIMIT,
    );
  });
});

describe('Browser-only database WASM', () => {
  // The web build stores its database in turso's WASM build; Tauri uses the
  // native turso crate. Tauri embeds every file in `out/` into the binary, so
  // the WASM chunk must not be emitted there (a 12.7MB file, 3.3MB in the APK).
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const loadConfig = async (platform: string) => {
    vi.stubEnv('NEXT_PUBLIC_APP_PLATFORM', platform);
    vi.resetModules();
    return (await import('../../next.config.mjs')).default;
  };

  test('the Tauri build stubs the package the web database imports', async () => {
    const tauri = await loadConfig('tauri');
    expect(tauri.turbopack?.resolveAlias?.['@readest/turso-database-wasm/webpack']).toBe(
      './src/utils/stub.ts',
    );
  });

  test('the web build keeps it', async () => {
    const web = await loadConfig('web');
    expect(web.turbopack?.resolveAlias?.['@readest/turso-database-wasm/webpack']).toBeUndefined();
  });
});
