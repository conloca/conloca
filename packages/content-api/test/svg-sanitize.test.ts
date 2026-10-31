import { describe, expect, it } from 'bun:test';
import { sanitizeSvg } from '../src/svg-sanitize.js';
import { pngBytes } from './helpers/image-fixtures.js';
import { LOCATION_PROBE, latin1, photoWithGps } from './helpers/photo-fixtures.js';

/** An Adobe Illustrator logo export: DOCTYPE entities name the namespaces, a private `i:pgf` block and a style. */
const ILLUSTRATOR_LOGO = `<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 24.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
	<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">
	<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">
	<!ENTITY ns_svg "http://www.w3.org/2000/svg">
	<!ENTITY ns_xlink "http://www.w3.org/1999/xlink">
]>
<svg version="1.1" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;" x="0px" y="0px" viewBox="0 0 100 40" xml:space="preserve">
<style type="text/css">
	.cls-1{fill:#e30613}
</style>
<switch>
	<foreignObject requiredExtensions="&ns_ai;" x="0" y="0" width="1" height="1">
		<i:pgf id="adobe_illustrator_pgf"><![CDATA[eJzt]]></i:pgf>
	</foreignObject>
	<g i:extraneous="self">
		<rect class="cls-1" width="100" height="40"/>
	</g>
</switch>
</svg>`;

const svg = (body: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${body}</svg>`;

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** The bytes of every `data:image/…;base64,` raster embedded in `text`. */
const embedded = (text: string) =>
  [...text.matchAll(/data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)/g)].map(([, data]) =>
    Buffer.from(data ?? '', 'base64'),
  );

describe('sanitizeSvg — nothing in an uploaded SVG can run or call out', () => {
  it.each([
    [svg('<script>alert(1)</script>'), '<script'],
    [svg('', ' onload="alert(1)"'), 'onload'],
    [svg('', ' ONLOAD="alert(1)"'), 'ONLOAD'],
    [svg('<foreignObject><div/></foreignObject>'), 'foreignObject'],
    [svg('<use href="https://evil.test/x.svg#a"/>'), 'evil.test'],
    [svg('<use x:href="https://evil.test/x.svg#a"/>', ' xmlns:x="http://www.w3.org/1999/xlink"'), 'evil.test'],
    [svg('<g xml:base="https://evil.test/"/>'), 'xml:base'],
    [svg('<rect fill="url(https://evil.test/p)"/>'), 'evil.test'],
    [svg('<rect><animate attributeName="href" to="javascript:x"/></rect>'), 'animate'],
    [svg('<style>@import url(https://evil.test/a.css)</style>'), 'evil.test'],
    [svg('<rect style="fill:url(https://evil.test/p)"/>'), 'evil.test'],
    [`<?xml-stylesheet href="https://evil.test/a.css"?>${svg('')}`, 'xml-stylesheet'],
    [svg('<a href="javascript:alert(1)"><rect id="kept"/></a>'), 'javascript:'],
    [svg('<image href="data:image/svg+xml;base64,PHN2Zy8+"/>'), 'svg+xml'],
    [svg('<style>.a{background:url("https://evil.test/p")}</style>'), 'evil.test'],
    [svg('<style><![CDATA[.a{fill:u\\72l(https://evil.test/p)}]]></style>'), 'evil.test'],
    [svg('<fe:script>alert(1)</fe:script>', ' xmlns:fe="http://www.w3.org/2000/svg"'), 'alert'],
    [svg('<rect><fe:set attributeName="fill" to="red"/></rect>', ' xmlns:fe="http://www.w3.org/2000/svg"'), 'set'],
    [svg('<fe:foreignObject/>', ' xmlns:fe="http://www.w3.org/1999/xhtml"'), 'foreignObject'],
    [svg('<g xmlns="http://www.w3.org/1999/xhtml"><rect/></g>'), 'xhtml'],
    [svg('<rect fill="java&#9;script:alert(1)"/>'), 'script:'],
    [svg('<rect fill="java&#x0A;script&#58;alert(1)"/>'), 'alert'],
    [svg('<image href="data:image/gif;base64,R0lGODlhAQABAAAAACw="/>'), 'gif'],
  ])('removes the danger in %s', (input, gone) => {
    const out = sanitizeSvg(input);
    expect(out).not.toBeNull();
    expect(out).not.toContain(gone);
  });

  it('keeps the shapes inside an unwrapped link', () => {
    const out = sanitizeSvg(svg('<a href="https://x.test"><rect id="kept"/><a><circle id="inner"/></a></a>'));
    expect(out).toContain('id="kept"');
    expect(out).toContain('id="inner"');
    expect(out).not.toContain('<a');
  });

  it('keeps an Illustrator logo with its DOCTYPE entities expanded', () => {
    const out = sanitizeSvg(ILLUSTRATOR_LOGO);
    expect(out).toContain('.cls-1{fill:#e30613}');
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('<rect class="cls-1"');
    expect(out).not.toContain('DOCTYPE');
    expect(out).not.toContain('pgf');
    // Illustrator's own namespaces go, and every attribute in them, so the output still parses.
    expect(out).not.toContain('adobe');
    expect(out).not.toContain('i:extraneous');
    expect(out).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
  });

  it('keeps internal references, embedded raster images and a style that embeds a data: font', () => {
    const png = base64(pngBytes());
    const out = sanitizeSvg(
      svg(
        `<style>@font-face{src:url(data:font/woff2;base64,AA)}.a{fill:red}</style><use href="#a"/><rect fill="url(#g)"/><image href="data:image/png;base64,${png}"/>`,
      ),
    );
    expect(out).toContain('fill:red');
    expect(out).toContain('href="#a"');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain(`data:image/png;base64,${png}`);
  });

  it('keeps filter primitives by their exact names', () => {
    const out = sanitizeSvg(svg('<filter id="f"><feGaussianBlur stdDeviation="2"/><feDropShadow dx="1"/></filter>'));
    expect(out).toContain('<feGaussianBlur');
    expect(out).toContain('<feDropShadow');
  });

  it('strips the location from a photo embedded in an image link and in a style', async () => {
    const photo = base64(await photoWithGps('jpeg'));
    const out = sanitizeSvg(
      svg(
        `<image href="data:image/jpeg;base64,${photo}"/><style>.a{fill:url("data:image/jpeg;base64,${photo}")}</style>`,
      ),
    );
    const rasters = embedded(out ?? '');
    expect(rasters).toHaveLength(2);
    for (const raster of rasters) {
      expect(latin1(raster)).not.toContain(LOCATION_PROBE);
      expect(raster.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    }
  });

  it('drops an embedded image whose bytes are not the format it names', () => {
    const out = sanitizeSvg(svg('<image id="i" href="data:image/png;base64,AA=="/>'));
    expect(out).toContain('id="i"');
    expect(out).not.toContain('data:');
  });

  it('refuses an SVG it cannot parse', () => expect(sanitizeSvg('<svg><g></svg>')).toBeNull());

  it('refuses a file whose root is not svg', () =>
    expect(sanitizeSvg('<html xmlns="http://www.w3.org/1999/xhtml"/>')).toBeNull());

  it('refuses an SVG larger than 5 MiB', () =>
    expect(sanitizeSvg(svg(`<desc>${'x'.repeat(5 * 1024 * 1024)}</desc>`))).toBeNull());

  it('refuses a DOCTYPE whose internal declarations are larger than 4 KB', () =>
    expect(sanitizeSvg(`<!DOCTYPE svg [<!ENTITY a "${'x'.repeat(5000)}">]>${svg('<desc>&a;</desc>')}`)).toBeNull());

  it('refuses a DOCTYPE that hides its size behind a quoted bracket', () =>
    expect(
      sanitizeSvg(`<!DOCTYPE svg [<!ENTITY q "]>"><!ENTITY a "${'x'.repeat(5000)}">]>${svg('<desc>&a;</desc>')}`),
    ).toBeNull());

  it('refuses an SVG whose entities expand it past 5 MiB', () => {
    const entity = `<!DOCTYPE svg [<!ENTITY a "${'y'.repeat(4000)}">]>`;
    const body = `<desc>${'x'.repeat(5 * 1024 * 1024 - 10_000)}${'&a;'.repeat(300)}</desc>`;
    expect(sanitizeSvg(`${entity}${svg(body)}`)).toBeNull();
  });
});
