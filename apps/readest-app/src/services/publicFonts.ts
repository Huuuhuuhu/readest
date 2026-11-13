import type { AppService } from '@/types/system';
import { getRuntimeConfig } from './runtimeConfig';
import { md5Fingerprint } from '@/utils/md5';
import { fetchWithTimeout } from '@/utils/fetch';

const hosted = [
  'Huiwen-MinchoGBK',
  'KingHwa_OldSong',
  'Source Han Serif CN',
  'GuanKiapTsingKhai-T',
];
const google = [
  'Bitter',
  'Fira Code',
  'Literata',
  'Merriweather',
  'Noto Sans',
  'Open Sans',
  'Roboto',
  'Roboto Slab',
  'Vollkorn',
  'PT Sans',
  'PT Serif',
  'PT Mono',
  'LXGW WenKai TC',
  'Noto Sans SC',
  'Noto Sans TC',
  'Noto Serif JP',
];
export const PUBLIC_FONTS = [
  ...hosted.map((family) => ({
    family,
    cssUrl: `${(getRuntimeConfig()?.fontBaseUrl || 'https://storage.readest.com/public/font/dist').replace(/\/+$/, '')}/${encodeURIComponent(family)}/result.css`,
  })),
  ...google.map((family) => ({
    family,
    cssUrl: `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&display=swap`,
  })),
  {
    family: 'MiSans',
    cssUrl: 'https://cdn.jsdelivr.net/npm/misans-webfont@1.0.4/misans-l3/misans-l3/result.min.css',
  },
  {
    family: 'LXGW WenKai GB Screen',
    cssUrl:
      'https://cdnjs.cloudflare.com/ajax/libs/lxgw-wenkai-screen-web/1.520.0/lxgwwenkaigbscreen/result.css',
  },
];
const root = 'public-fonts';
const indexPath = `${root}/index.json`;
interface CachedFont {
  family: string;
  css: string;
  files: Record<string, string>;
}
const downloads = new Map<string, Promise<void>>();
let commitQueue: Promise<void> = Promise.resolve();
const readIndex = async (service: AppService): Promise<CachedFont[]> => {
  if (!(await service.exists(indexPath, 'Fonts'))) return [];
  try {
    const data = await service.readFile(indexPath, 'Fonts', 'text');
    const parsed: unknown = JSON.parse(data as string);
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is CachedFont =>
            !!entry &&
            typeof entry.family === 'string' &&
            typeof entry.css === 'string' &&
            typeof entry.files === 'object',
        )
      : [];
  } catch {
    return [];
  }
};
/** This function only reads local storage. Missing/corrupt resources never trigger a request. */
export const loadPublicFontStyles = async (service: AppService): Promise<string> => {
  const styles: string[] = [];
  for (const cached of await readIndex(service)) {
    let css = cached.css;
    let complete = true;
    for (const [marker, path] of Object.entries(cached.files)) {
      if (!(await service.exists(path, 'Fonts'))) {
        complete = false;
        break;
      }
      const url = await service.getImageURL(await service.resolveFilePath(path, 'Fonts'));
      css = css.split(marker).join(url.replaceAll('"', '%22'));
    }
    if (complete) styles.push(css);
  }
  return styles.join('\n');
};
/** Explicit user action. Commit the manifest only once all font shards are stored. */
export const downloadPublicFont = async (service: AppService, family: string): Promise<void> => {
  const pending = downloads.get(family);
  if (pending) return pending;
  const work = (async () => {
    const resource = PUBLIC_FONTS.find((font) => font.family === family);
    if (!resource) return;
    const previous = (await readIndex(service)).find((font) => font.family === family);
    if (
      previous &&
      (
        await Promise.all(
          Object.values(previous.files).map((path) => service.exists(path, 'Fonts')),
        )
      ).every(Boolean)
    )
      return;
    const response = await fetchWithTimeout(resource.cssUrl);
    if (!response.ok) throw new Error(`Font stylesheet download failed (${response.status})`);
    let css = await response.text();
    if (css.length > 2 * 1024 * 1024 || /@import/i.test(css))
      throw new Error('Unsupported font stylesheet');
    const urls = [
      ...new Set(
        [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((match) => match[1]!.trim()),
      ),
    ];
    if (!urls.length || urls.length > 1000) throw new Error('Invalid font stylesheet');
    const dir = `${root}/${md5Fingerprint(family)}`;
    await service.createDir(dir, 'Fonts', true);
    const files: Record<string, string> = {};
    const markers = new Map<string, string>();
    let bytes = 0;
    for (let index = 0; index < urls.length; index++) {
      const relative = urls[index]!;
      const url = new URL(relative, resource.cssUrl);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Invalid font download URL');
      const result = await fetchWithTimeout(url.href, {}, 60000);
      if (!result.ok) throw new Error(`Font download failed (${result.status})`);
      const data = await result.arrayBuffer();
      bytes += data.byteLength;
      if (bytes > 200 * 1024 * 1024) throw new Error('Font download exceeds 200 MB');
      const ext = url.pathname.match(/\.(woff2?|ttf|otf)$/i)?.[1] ?? 'woff2';
      const path = `${dir}/${md5Fingerprint(url.href)}.${ext}`;
      await service.writeFile(path, 'Fonts', data);
      const marker = `__TV_FONT_${index}__`;
      files[marker] = path;
      markers.set(relative, marker);
    }
    css = css.replace(
      /url\(\s*["']?([^"')]+)["']?\s*\)/g,
      (_match, url: string) => `url("${markers.get(url.trim())}")`,
    );
    const commit = commitQueue.then(async () => {
      const latest = (await readIndex(service)).filter((font) => font.family !== family);
      latest.push({ family, css, files });
      await service.writeFile(indexPath, 'Fonts', JSON.stringify(latest));
    });
    commitQueue = commit.catch(() => {});
    await commit;
  })();
  downloads.set(family, work);
  try {
    await work;
  } finally {
    downloads.delete(family);
  }
};
