/** Resolve unpublished draft images for site renderers without changing Puck's persisted data. */
import { IMAGE_EXTENSION_MIME } from '@conloca/content-api-client';
import type { Config, Field, Fields } from '@puckeditor/core';
import { type ComponentType, createElement, isValidElement } from 'react';
import { appendAssetUrlPath } from '../../utils/asset-url.js';

function draftImageUrl(value: string, base: string): string {
  if (!value.startsWith('/assets/')) return value;
  const path = value.slice('/assets/'.length);
  if (/[\\?#]/.test(path)) return value;
  const segments = path.split('/');
  for (const part of segments) {
    if (
      part === '' ||
      part === '.' ||
      part === '..' ||
      [...part].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    ) {
      return value;
    }
  }
  const filename = segments[segments.length - 1] ?? '';
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return value;
  const extension = filename.slice(dot + 1).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(IMAGE_EXTENSION_MIME, extension)) return value;
  const encoded = segments.map((part) =>
    encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`),
  );
  return appendAssetUrlPath(base, encoded.join('/'));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || isValidElement(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fieldValue(value: unknown, field: Field, base: string): unknown {
  if (field.type === 'slot') return value;
  if (typeof value === 'string') return draftImageUrl(value, base);
  if (field.type === 'object' && isRecord(value)) return fieldProps(value, field.objectFields, base);
  if (field.type === 'array' && Array.isArray(value)) {
    const next = value.map((item: unknown) => (isRecord(item) ? fieldProps(item, field.arrayFields, base) : item));
    return next.some((item, index) => item !== value[index]) ? next : value;
  }
  return value;
}

function fieldProps(props: Record<string, unknown>, fields: Fields | undefined, base: string): Record<string, unknown> {
  let next = props;
  for (const [name, field] of Object.entries(fields ?? {})) {
    if (name === 'puck' || name === 'children' || name === 'editMode') continue;
    if (field === undefined || !Object.prototype.hasOwnProperty.call(props, name)) continue;
    const value = fieldValue(props[name], field, base);
    if (value === props[name]) continue;
    if (next === props) next = { ...props };
    next[name] = value;
  }
  return next;
}

/** Static declared fields bound traversal; dynamic field resolvers and runtime contexts remain untouched. */
export function withDraftMediaRendering(config: Config, base: string | undefined): Config {
  if (base === undefined) return config;
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
            render: (props: Parameters<typeof rootRender>[0]) =>
              createElement(rootRender as ComponentType<typeof props>, {
                ...props,
                ...fieldProps(props, root.fields, base),
              }),
          },
        }
      : {}),
    components: Object.fromEntries(
      Object.entries(config.components).map(([name, component]) => [
        name,
        {
          ...component,
          render: (props: Parameters<typeof component.render>[0]) =>
            createElement(component.render, { ...props, ...fieldProps(props, component.fields, base) }),
        },
      ]),
    ),
  };
}
