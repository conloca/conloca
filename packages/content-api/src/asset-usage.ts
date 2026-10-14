import type { AssetUsage } from './asset-types.js';
import type { ContentAPI } from './content-api.interface.js';

/**
 * Every page, fragment and data entry language whose meta or content links to an asset. The editor
 * links an asset as `<assetRefBase>/<path>`, `/assets/<path>` by default; only that link standing whole
 * counts, so `/assets/trip/beach.png` is no use of `beach.png` and neither is `/assets/my-beach.png` or
 * `/assets/beach.png.bak`. A full URL such as `https://…/assets/beach.png` never counts, even one to this
 * site, whose address is not known here.
 */
export async function findAssetUsage(api: ContentAPI, path: string, assetRefBase = '/assets'): Promise<AssetUsage[]> {
  const link = `${assetRefBase}/${path.replace(/^\/+|\/+$/g, '')}`;
  const whole = new RegExp(`(?<![\\w.~%/-])${link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w./-])`);
  const usage: AssetUsage[] = [];
  const severalSites = Object.keys(api.sitesConfig.sites).length > 1;
  // Listed first: reading an entry can re-index it, which must not disturb the listing being walked
  for (const manifest of [...api.listAllContent()]) {
    for (const locale of Object.keys(manifest.locales)) {
      const entry = await api.getLocalized(manifest.id, locale);
      if (!entry) continue;
      const { meta, content, pathname, name } = entry.localized;
      const field = fieldWith({ meta, content }, whole);
      if (field) {
        const where = pathname ?? (name ? `${entry.collection}/${name}` : entry.id);
        const site = severalSites && entry.site ? `${entry.site}: ` : '';
        usage.push({ page: `${site}${where} (${locale})`, field });
      }
    }
  }
  return usage;
}

/** The path of the first string field in `value` that `pattern` matches, e.g. `meta.ogImage`. */
function fieldWith(value: unknown, pattern: RegExp, path = ''): string | null {
  if (typeof value === 'string') return pattern.test(value) ? path : null;
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      const found = fieldWith(item, pattern, `${path}[${i}]`);
      if (found) return found;
    }
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const found = fieldWith(item, pattern, path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  return null;
}
