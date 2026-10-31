/** Resolve unpublished draft images for site renderers without changing Puck's persisted data. */
/* oxlint-disable anti-slop/no-unsafe-dictionary-type, anti-slop/no-unknown-returns -- block props are whatever the site's components take; this walk only swaps image strings and passes every other value through as it came. */
import { DRAFT_MEDIA_REF_BASE, draftMediaRefPath, mediaRefPath } from '@conloca/content-api-client';
import type { Config, Field, Fields } from '@puckeditor/core';
import { type ComponentType, createElement, isValidElement } from 'react';
import { loadedMedia, mediaObjectUrl, useMediaCacheVersion } from '../../frame/media-cache.js';
import type { MediaLoadInput } from '../../frame/protocol.js';
import { getUIConfig } from '../../ui-config.js';
import { appendAssetUrlPath } from '../../utils/asset-url.js';

/** A 1×1 transparent GIF: what a draft address shows until its bytes arrive, and after a failed load. */
export const DRAFT_IMAGE_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** What a stored image link renders as; `undefined` keeps the stored value. */
type DraftImageResolver = (source: MediaLoadInput) => string | undefined;

/** Where the bytes of a stored image link load from: a draft address from `serve`, a site `/assets/` link from `draft`. */
function mediaSourceOf(value: string): MediaLoadInput | undefined {
  const draftPath = draftMediaRefPath(value);
  if (draftPath !== undefined) return { route: 'serve', path: draftPath };
  const path = mediaRefPath(value, '/assets');
  return path === undefined ? undefined : { route: 'draft', path };
}

function draftImageUrl(path: string, base: string): string {
  const encoded = path
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`),
    );
  return appendAssetUrlPath(base, encoded.join('/'));
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
 * Data URLs of the draft images a compiled MDX body names, keyed by their stored `src`, for the
 * opaque-origin preview frame, which cannot read this page's blob URLs. Images that fail to load, or are
 * still loading after `DRAFT_IMAGE_WAIT_MS`, show the placeholder for a draft address and are left out otherwise.
 */
export async function draftImageData(code: string): Promise<Record<string, string>> {
  // shortcut: finds srcs only as plain double-quoted literals, the form the MDX compiler emits for these paths; widen if an escaped path must preview.
  const literals = code.match(new RegExp(`"(?:/assets|${DRAFT_MEDIA_REF_BASE})/[^"\\\\]*"`, 'g'));
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

function fieldValue(value: unknown, field: Field, resolve: DraftImageResolver): unknown {
  if (field.type === 'slot') return value;
  if (typeof value === 'string') {
    const source = mediaSourceOf(value);
    return source === undefined ? value : (resolve(source) ?? value);
  }
  if (field.type === 'object' && isRecord(value)) return fieldProps(value, field.objectFields, resolve);
  if (field.type === 'array' && Array.isArray(value)) {
    const next = value.map((item: unknown) => (isRecord(item) ? fieldProps(item, field.arrayFields, resolve) : item));
    return next.some((item, index) => item !== value[index]) ? next : value;
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
    if (field === undefined || !Object.prototype.hasOwnProperty.call(props, name)) continue;
    const value = fieldValue(props[name], field, resolve);
    if (value === props[name]) continue;
    if (next === props) next = { ...props };
    next[name] = value;
  }
  return next;
}

/**
 * Static declared fields bound traversal; dynamic field resolvers and runtime contexts remain untouched.
 * Draft addresses show object URLs of their loaded bytes, the placeholder until then and without `UIConfig.loadMedia`.
 * With `loadMedia` set, `base` is ignored: site `/assets/` links show their loaded bytes, the stored value until then.
 */
export function withDraftMediaRendering(config: Config, base: string | undefined): Config {
  const loads = getUIConfig().loadMedia !== undefined;
  const resolve: DraftImageResolver = ({ route, path }) => {
    if (route === 'serve') return mediaObjectUrl(route, path) ?? DRAFT_IMAGE_PLACEHOLDER;
    if (loads) return mediaObjectUrl(route, path);
    return base === undefined ? undefined : draftImageUrl(path, base);
  };
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
                ...fieldProps(props, root.fields, resolve),
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
            return createElement(component.render, { ...props, ...fieldProps(props, component.fields, resolve) });
          },
        },
      ]),
    ),
  };
}
