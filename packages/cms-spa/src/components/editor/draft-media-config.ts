/** Resolve unpublished draft images for site renderers without changing Puck's persisted data. */
/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-returns -- block props are whatever the site's components take; this walk only swaps image strings and passes every other value through as it came. */
import { draftMediaRefPath, mediaRefPath } from '@conloca/content-api-client';
import type { Config, Field, Fields, PuckContext } from '@puckeditor/core';
import { type ComponentType, createElement, isValidElement } from 'react';
import { loadedMedia, mediaLoadState, useMediaCacheVersion } from '../../frame/media-cache.js';
import type { MediaLoadInput } from '../../frame/protocol.js';
import { getUIConfig } from '../../ui-config.js';

/** A 1×1 transparent GIF: what an image shows until its bytes arrive, and a draft address after a failed load. */
export const DRAFT_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** What a stored image link renders as; `undefined` keeps the stored value. */
type DraftImageResolver = (source: MediaLoadInput) => string | undefined;

/**
 * The one decision of where an image value's bytes come from: a draft address, or a link under the site's media
 * URL (`UIConfig.assetRefBase`, `/assets` by default). A link is URL text, so each segment is decoded once, as
 * the site's static host does; an escape that would change the path (a bad one, or a decoded `/`, `\`, control
 * character, `.` or `..`) makes it no image of ours.
 */
export function mediaSourceOf(value: string): MediaLoadInput | undefined {
  const draftPath = draftMediaRefPath(value);
  if (draftPath !== undefined) return { route: 'serve', path: draftPath };
  const linked = mediaRefPath(value, getUIConfig().assetRefBase ?? '/assets');
  if (linked === undefined) return undefined;
  const segments: string[] = [];
  for (const segment of linked.split('/')) {
    let part: string;
    try {
      part = decodeURIComponent(segment);
    } catch {
      return undefined;
    }
    const control = Array.from(part, (char) => char.charCodeAt(0)).some((code) => code < 32 || code === 127);
    if (part === '.' || part === '..' || /[/\\]/.test(part) || control) return undefined;
    segments.push(part);
  }
  return { route: 'repo', path: segments.join('/') };
}

/**
 * What an image value shows in the canvas once a loader is set: its bytes when loaded, the placeholder while
 * loading and for a draft address that failed, the stored value (`undefined`) for a repository image that failed.
 */
function shownImage({ route, path }: MediaLoadInput): string | undefined {
  const state = mediaLoadState(route, path);
  if (state?.status === 'loaded') return state.url;
  // shortcut: until PR 4 publishes the real media folder, a repository image the guessed folder misses keeps showing the deployed copy; PR 4 shows the placeholder instead.
  if (state?.status === 'failed' && route === 'repo') return undefined;
  return DRAFT_IMAGE_PLACEHOLDER;
}

/**
 * What the MDX editor canvas shows for an image `src`: the loaded bytes of a draft image, else the placeholder for a
 * draft address, else `src` itself.
 * The URL is the media cache's own, which a media write or eviction revokes; mdxeditor resolves an image again only
 * when its `src` changes or it remounts, so a mounted image keeps painting its decoded bytes from a revoked URL.
 */
export async function draftImagePreview(src: string): Promise<string> {
  const source = mediaSourceOf(src);
  if (source === undefined) return src;
  const url = (await loadedMedia(source.route, source.path))?.url;
  return url ?? (source.route === 'serve' ? DRAFT_IMAGE_PLACEHOLDER : src);
}

function dataUrl(blob: Blob): Promise<string> {
  // The package's lib target predates Promise.withResolvers.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The image could not be read as a data URL.'));
    });
    reader.addEventListener('error', () => {
      reject(reader.error ?? new Error('The image could not be read.'));
    });
    reader.readAsDataURL(blob);
  });
}

// Keyed by the cached Blob, so a cleared or evicted cache entry frees its string too.
const dataUrls = new WeakMap<Blob, Promise<string>>();

async function draftImageDataUrl({ route, path }: MediaLoadInput): Promise<string | undefined> {
  const media = await loadedMedia(route, path);
  if (!media) return undefined;
  let url = dataUrls.get(media.blob);
  if (!url) {
    url = dataUrl(media.blob);
    dataUrls.set(media.blob, url);
  }
  return url;
}

/** How long a preview update waits for its draft images before it goes without the ones still loading. */
export const DRAFT_IMAGE_WAIT_MS = 5000;

/**
 * Data URLs of the images compiled MDX or sanitized HTML names, keyed by their stored value, for the opaque-origin
 * preview frame, which cannot read this page's blob URLs: an `src`, an HTML `src="…"` attribute or an MDX
 * component's prop. Images that fail to load, or are still loading after `DRAFT_IMAGE_WAIT_MS`, show the
 * placeholder for a draft address and are left out for a repository image, which then keeps its stored link.
 */
export async function draftImageData(code: string): Promise<Record<string, string>> {
  // shortcut: finds values only as plain double-quoted literals, the form the MDX compiler and the HTML sanitizer emit; widen if an escaped path must preview.
  const literals = code.match(/"[^"\\]*"/g);
  const srcs = new Set(literals?.map((literal) => literal.slice(1, -1)));
  const images: Record<string, string> = {};
  let timer: number | undefined;
  const expired = new Promise<undefined>((resolve) => {
    timer = window.setTimeout(resolve, DRAFT_IMAGE_WAIT_MS, undefined);
  });
  await Promise.all(
    [...srcs].map(async (src) => {
      const source = mediaSourceOf(src);
      if (source === undefined) return;
      const url = await Promise.race([draftImageDataUrl(source).catch(() => undefined), expired]);
      const shown = url ?? (source.route === 'serve' ? DRAFT_IMAGE_PLACEHOLDER : undefined);
      if (shown !== undefined) images[src] = shown;
    }),
  );
  window.clearTimeout(timer);
  return images;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || isValidElement(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** What the canvas shows for a string: what `resolve` decides when `mediaSourceOf` reads it as an image, else itself. */
function imageValue(value: string, resolve: DraftImageResolver): string {
  const source = mediaSourceOf(value);
  return source === undefined ? value : (resolve(source) ?? value);
}

/** `items` mapped by `map`, or `items` itself when no item changed. */
function mapped(items: unknown[], map: (item: unknown) => unknown): unknown[] {
  const next = items.map(map);
  return next.some((item, index) => item !== items[index]) ? next : items;
}

function fieldValue(value: unknown, field: Field, resolve: DraftImageResolver): unknown {
  if (field.type === 'slot') return value;
  if (typeof value === 'string') return imageValue(value, resolve);
  if (field.type === 'object' && isRecord(value)) return fieldProps(value, field.objectFields, resolve);
  if (field.type === 'array' && Array.isArray(value)) {
    return mapped(value, (item) => (isRecord(item) ? fieldProps(item, field.arrayFields, resolve) : item));
  }
  return value;
}

function fieldProps(
  props: Record<string, unknown>,
  fields: Fields | undefined,
  resolve: DraftImageResolver,
): Record<string, unknown> {
  let next = props;
  for (const [name, field] of Object.entries(fields ?? {})) {
    if (name === 'puck' || name === 'children' || name === 'editMode') continue;
    // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is past this package's ES2020 lib.
    if (field === undefined || !Object.prototype.hasOwnProperty.call(props, name)) continue;
    const value = fieldValue(props[name], field, resolve);
    if (value === props[name]) continue;
    if (next === props) next = { ...props };
    next[name] = value;
  }
  return next;
}

/** Page settings with every string in them read as a possible image, as the branch save scans them for uploads. */
function settingsValue(value: unknown, resolve: DraftImageResolver): unknown {
  if (typeof value === 'string') return imageValue(value, resolve);
  if (Array.isArray(value)) return mapped(value, (item) => settingsValue(item, resolve));
  if (!isRecord(value)) return value;
  let next = value;
  for (const [name, item] of Object.entries(value)) {
    const shown = settingsValue(item, resolve);
    if (shown === item) continue;
    if (next === value) next = { ...value };
    next[name] = shown;
  }
  return next;
}

/** The page with its settings' images shown; everything else on it, its Dates included, as given. */
function pageWithImages(page: unknown, resolve: DraftImageResolver): unknown {
  if (!isRecord(page)) return page;
  const meta = settingsValue(page.meta, resolve);
  return meta === page.meta ? page : { ...page, meta };
}

/**
 * `puck` with the images in the page settings its metadata carries, the page's own and each page its route binds,
 * shown as `resolve` decides: a block such as an article header shows a page setting without a field of its own.
 */
function puckWithImages(puck: PuckContext, resolve: DraftImageResolver): PuckContext {
  const { metadata } = puck;
  if (!isRecord(metadata)) return puck;
  const page = pageWithImages(metadata.page, resolve);
  const pages = Array.isArray(metadata.pages)
    ? mapped(metadata.pages, (item) => pageWithImages(item, resolve))
    : metadata.pages;
  if (page === metadata.page && pages === metadata.pages) return puck;
  return { ...puck, metadata: { ...metadata, page, pages } };
}

/**
 * Static declared fields bound traversal, plus the page settings in `puck.metadata`; dynamic field resolvers and
 * other runtime contexts remain untouched. Every image value `mediaSourceOf` accepts shows what `shownImage`
 * decides; `config` itself without `UIConfig.loadMedia`, so every value renders as stored.
 */
export function withDraftMediaRendering(config: Config): Config {
  if (getUIConfig().loadMedia === undefined) return config;
  const root = config.root;
  const rootRender = root?.render;
  return {
    ...config,
    ...(root && rootRender
      ? {
          root: {
            ...root,
            // Rendered as an element so memo/forwardRef roots keep working. Root props are a
            // children/no-children union, so name the component's own prop type for createElement.
            render: (props: Parameters<typeof rootRender>[0]) => {
              // Re-render when a loaded image arrives.
              useMediaCacheVersion();
              // SAFETY: `props` is typed from `rootRender` itself; the cast only picks one member of Puck's root union.
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see the SAFETY note.
              return createElement(rootRender as ComponentType<typeof props>, {
                ...props,
                ...fieldProps(props, root.fields, shownImage),
                puck: puckWithImages(props.puck, shownImage),
              });
            },
          },
        }
      : {}),
    components: Object.fromEntries(
      Object.entries(config.components).map(([name, component]) => [
        name,
        {
          ...component,
          render: (props: Parameters<typeof component.render>[0]) => {
            useMediaCacheVersion();
            return createElement(component.render, {
              ...props,
              ...fieldProps(props, component.fields, shownImage),
              puck: puckWithImages(props.puck, shownImage),
            });
          },
        },
      ]),
    ),
  };
}
