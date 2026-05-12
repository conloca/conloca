import type { JsxComponentDescriptor } from '@mdxeditor/editor';
import { AsideEditor } from './jsx-editors/AsideEditor';

/**
 * Conloca-specific typed JSX descriptors.
 *
 * The CMSMDXEditor forwards this list to BaseMDXEditor, which appends the
 * library's wildcard fallback descriptors after it (editor-core.tsx). Order
 * matters: an exact-name match in this list wins over the wildcards, so
 * tags listed here get their custom editing surface while everything else
 * still round-trips through GenericJsxEditor.
 *
 * Add a new entry when a JSX component shows up in real MDX content and
 * authors would benefit from form-based prop editing. The `<Aside>` entry
 * below is included by default because it's the only typed callout
 * component Conloca currently ships an editor for; sites whose MDX uses a
 * differently-named callout fall through to GenericJsxEditor until a
 * consumer-supplied descriptor registry lands.
 *
 * `source` is intentionally omitted: MDXEditor only uses it to auto-insert
 * an `import` statement, and the consumer's MDX runtime (Astro layout,
 * Next.js MDX provider, etc.) is expected to scope the component in
 * already — baking a fixed import path here would couple the CMS shell
 * to whichever package the consumer happens to import from.
 */
export const cmsJsxDescriptors: JsxComponentDescriptor[] = [
  {
    name: 'Aside',
    kind: 'flow',
    props: [
      { name: 'type', type: 'string' },
      { name: 'title', type: 'string' },
    ],
    hasChildren: true,
    Editor: AsideEditor,
  },
];
