import { editorPageContentSecurityPolicy } from '@conloca/content-api/editor-host';
import { type ReactNode, useState } from 'react';
import { createPortal } from 'react-dom';
import { expect, waitFor } from 'storybook/test';

/**
 * Story harness: a srcdoc frame whose meta CSP is the editor page's own, with tripwires on it and its parent, and the
 * hostile MDX the stories render in it. Not a CSF file, so Storybook does not collect it.
 */

// sha256 of the empty string; the frame loads no import map, so any well-formed hash serves.
const testHash = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';

const payload = 'window.__pwned=1;try{parent.__pwned=1}catch(e){}';

export const hostileMdx = [
  `<script>${payload}</script>`,
  `<img src="x" onerror="${payload}" />`,
  '<a href="javascript:window.__pwned=1">js link</a>',
  '<div style="background:url(https://evil.test/b)">styled</div>',
  '<p STYLE="background:url(https://evil.test/c)">upper</p>',
  '<p Style="background:url(https://evil.test/d)">mixed</p>',
  '<Spread style={{"background":"url(https://evil.test/e)"}}>spread</Spread>',
  '<Spread STYLE="background:url(https://evil.test/f)">spread upper</Spread>',
  '<Spread Style="background:url(https://evil.test/g)">spread mixed</Spread>',
  '<iframe src="https://evil.test/frame"></iframe>',
  `<Callout onClick="${payload}">callout</Callout>`,
  '<Card link="javascript:x" cta={{"href":"data:text/html,x"}} items={["vbscript:x"]} />',
  '<Callout data={{"x":"<script>alert(1)</script>"}} />',
  '<Spread __proto__={{"dangerouslySetInnerHTML":{"__html":"<img src=x onerror=alert(1)>"}}} />',
  '<Callout data={{"a":{"b":{"dangerouslySetInnerHTML":{"__html":"<img src=x onerror=alert(1)>"}}},"c":[{"DangerouslySetInnerHTML":{"__html":"PWN"}}]}} />',
  '<a href="/x" target="_top">top link</a>',
  '<a href="/x" target="_parent">parent link</a>',
  '<form action="/x"><button type="submit">s</button></form>',
  '<map name="m"><area href="/x" shape="rect" coords="0,0,10,10" /></map>',
  '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" useMap="#m" width="10" height="10" />',
  '<button form="outside" formaction="/x">outside submit</button>',
].join('\n\n');

/** What a tripwire saw, on either window; a fetch entry carries its URL. */
export const fired: string[] = [];
export const restores: (() => void)[] = [];

/** Replaces `alert`, `fetch` and `postMessage` on `win` with recorders until the story restores them. */
export function armTripwires(win: Window, name: string): void {
  // oxlint-disable-next-line typescript/unbound-method -- saved only to be put back on the same window.
  const { alert, fetch, postMessage } = win;
  win.alert = () => fired.push(`${name}.alert`);
  win.fetch = async (input) => {
    fired.push(`${name}.fetch ${input instanceof Request ? input.url : String(input)}`);
    return new Response();
  };
  win.postMessage = () => fired.push(`${name}.postMessage`);
  Reflect.deleteProperty(win, '__pwned');
  restores.push(() => {
    win.alert = alert;
    win.fetch = fetch;
    win.postMessage = postMessage;
  });
}

/** Portals `children` into a srcdoc frame under the editor page's CSP, once both windows carry tripwires. */
export function CspFrame({ children }: { children: ReactNode }) {
  const [body, setBody] = useState<HTMLElement | null>(null);
  const csp = editorPageContentSecurityPolicy(`${window.location.origin}/host/v1/`, testHash);
  return (
    <>
      <iframe
        title="Canvas"
        srcDoc={`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body><form id="outside" action="/away"></form></body></html>`}
        onLoad={(event) => {
          const frame = event.currentTarget.contentWindow;
          if (!frame) return;
          armTripwires(window, 'parent');
          armTripwires(frame, 'frame');
          setBody(frame.document.body);
        }}
      />
      {body && createPortal(children, body)}
    </>
  );
}

/** Positive control: the editor-page CSP is in force in the frame, blocking an inline script and an inline handler. */
export async function expectCspInForce(frame: Window, doc: Document): Promise<void> {
  const violations: string[] = [];
  doc.addEventListener('securitypolicyviolation', (event) => violations.push(event.effectiveDirective));
  const script = doc.createElement('script');
  script.textContent = 'window.__ctrl = 1';
  doc.body.append(script);
  const probe = doc.createElement('div');
  probe.innerHTML = '<img src="x" onerror="window.__ctrl2 = 1">';
  doc.body.append(probe);
  await waitFor(() => expect(violations).toEqual(expect.arrayContaining(['script-src-elem', 'script-src-attr'])));
  await expect(Reflect.get(frame, '__ctrl')).toBeUndefined();
  await expect(Reflect.get(frame, '__ctrl2')).toBeUndefined();
  probe.remove();
  script.remove();
}
