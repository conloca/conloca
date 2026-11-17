import { type ComponentProps, createElement, type ReactNode } from 'react';
import { defineFragmentComponents } from '../../mdx/vocabulary.js';

interface CalloutProps {
  children?: ReactNode;
  data?: object;
  onClick?: string;
  online?: string;
}

interface CardProps {
  children?: ReactNode;
  link?: string;
  cta?: { href?: string };
  items?: string[];
  ok?: string;
}

// Each component echoes what it received, so a value the filter missed would show in the markup.
export const hostileComponents = {
  Callout: ({ children, data, onClick, online }: CalloutProps) =>
    createElement('aside', { 'data-handler': onClick, 'data-online': online }, children, JSON.stringify(data ?? null)),
  Card: ({ children, link, cta, items = [], ok }: CardProps) =>
    createElement(
      'div',
      null,
      children,
      ...[link, cta?.href, ...items, ok].map((s, i) => createElement('a', { key: i, href: s }, s)),
    ),
  Spread: (props: ComponentProps<'div'>) => createElement('div', props),
  // Spreads every prop onto a custom element, where React SSR emits a string `onclick` verbatim.
  Widget: ({ children, ...rest }: { children?: ReactNode }) => createElement('x-widget', rest, children),
  // Spreads an object prop onto a custom element as its attributes.
  Rec: ({ data }: { data?: object }) => createElement('x-widget', data),
};

export const hostileElements = {
  a: (props: ComponentProps<'a'>) => createElement('a', { ...props, className: 'site-link' }),
  img: (props: ComponentProps<'img'>) => createElement('img', { ...props, className: 'site-img' }),
};

export const hostileVocabulary = defineFragmentComponents({ components: hostileComponents, elements: hostileElements });

/** Hostile fragments rendered with `hostileVocabulary`; `renders` says whether evaluate returns a Component. */
export const hostileCases = {
  nonLiteralProp: { mdx: '<Card ok={fetch("/api")} />', renders: true },
  numberProp: { mdx: '<Card ok={3} />', renders: true },
  onHandler: { mdx: '<Callout onClick="alert(1)">Hi</Callout>', renders: true },
  componentOnline: { mdx: '<Callout online="yes">Hi</Callout>', renders: true },
  rawOnHandler: { mdx: '<div onclick="alert(1)">Hi</div>', renders: true },
  customElementOn: {
    mdx: '<Widget onclick="alert(1)" ONCLICK="alert(2)" Onclick="alert(3)" onerror="alert(4)">Hi</Widget>',
    renders: true,
  },
  nestedHandlerKeys: {
    mdx: '<Rec data={{"onclick":"alert(1)","online":true,"nested":{"OnError":"x"}}} />',
    renders: true,
  },
  keyProp: { mdx: '<Card key="k" ok="1" />', renders: true },
  elementSchemes: {
    mdx: '<a href="javascript:alert(1)">x</a>\n\n<img src="data:text/html,x" />\n\n[y](javascript:alert(2))',
    renders: true,
  },
  jsonSchemes: {
    mdx: '<Card link="javascript:x" cta={{"href":"data:text/html,x"}} items={["vbscript:x"]} ok="https://example.com" />',
    renders: true,
  },
  jsonMarkup: { mdx: '<Callout data={{"x":"<script>alert(1)</script>"}} />', renders: true },
  nestedInnerHtml: {
    mdx: '<Callout data={{"inner":{"DangerouslySetInnerHTML":{"__html":"PWN"}},"onload":"keep-on","__proto__":{"p":"keep-proto"}}} />',
    renders: true,
  },
  topLevelProto: {
    mdx: '<Spread __proto__={{"key":"k","dangerouslySetInnerHTML":{"__html":"<img src=x onerror=alert(1)>"}}} />',
    renders: true,
  },
  rawHtmlStyle: {
    mdx: '<div style="background:url(https://evil)">a</div>\n\n<p STYLE="color:red">b</p>',
    renders: true,
  },
  componentStyleObject: {
    mdx: '<Spread style={{"position":"fixed","background":"url(https://evil)"}}>t</Spread>',
    renders: true,
  },
  componentStyleString: { mdx: '<Spread STYLE="position:fixed">t</Spread>', renders: true },
  // The same props in the object-literal form a formatter writes: unquoted keys, single quotes, trailing commas.
  nestedHandlerKeysLiteral: {
    mdx: "<Rec data={{ onclick: 'alert(1)', online: true, nested: { OnError: 'x' }, }} />",
    renders: true,
  },
  jsonSchemesLiteral: {
    mdx: '<Card link="javascript:x" cta={{ href: \'data:text/html,x\' }} items={[\'vbscript:x\',]} ok="https://example.com" />',
    renders: true,
  },
  jsonMarkupLiteral: { mdx: "<Callout data={{ x: '<script>alert(1)</script>' }} />", renders: true },
  nestedInnerHtmlLiteral: {
    mdx: "<Callout data={{\n  inner: { DangerouslySetInnerHTML: { __html: 'PWN' } },\n  onload: 'keep-on',\n  __proto__: { p: 'keep-proto' },\n}} />",
    renders: true,
  },
  topLevelProtoLiteral: {
    mdx: "<Spread __proto__={{ key: 'k', dangerouslySetInnerHTML: { __html: '<img src=x onerror=alert(1)>' } }} />",
    renders: true,
  },
  componentStyleObjectLiteral: {
    mdx: "<Spread style={{ position: 'fixed', background: 'url(https://evil)' }}>t</Spread>",
    renders: true,
  },
  elementSchemesLiteral: {
    mdx: "<a href={'javascript:alert(1)'}>x</a>\n\n<img src={'data:text/html,x'} />",
    renders: true,
  },
  undeclared: { mdx: '<Nope />', renders: false },
  nonIdentifier: { mdx: '<Foo-bar />', renders: false },
  dotted: { mdx: '<Callout.Inner />', renders: false },
} as const;
