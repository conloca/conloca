import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import { sanitizeComponentHtml, sanitizeHtml } from '../../utils/sanitize-html.js';

/**
 * Browser-proven DOMPurify behavior for the GenericBlock response belt.
 * These run in real Chromium (the Storybook browser pipeline) — the ONLY
 * environment where DOMPurify's DOM-walking is correct. happy-dom mis-parses
 * DOMPurify (it neither strips `<script>`/`onerror` nor keeps legitimate
 * structure), so bun:test cannot prove this; the play functions below call the
 * shipped sanitizers directly and assert what survives and what dies.
 */

function SanitizeHarness() {
  return <div data-testid="sanitize-harness" />;
}

const meta = {
  component: SanitizeHarness,
  args: {},
} satisfies Meta<typeof SanitizeHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

/** B-original: the author-strict sanitizer strips scripts, handlers, and schemes. */
export const AuthorSanitizerStripsExecution: Story = {
  play: async () => {
    expect(sanitizeHtml('<div><script>alert(1)</script></div>')).not.toContain('alert(1)');
    expect(sanitizeHtml('<img src="x" onerror="alert(1)">').toLowerCase()).not.toContain('onerror');
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>').toLowerCase()).not.toContain('javascript:');
    // Author input may NOT inject iframes — only trusted component output can.
    expect(sanitizeHtml('<iframe src="https://youtube-nocookie.com/embed/x"></iframe>').toLowerCase()).not.toContain(
      'iframe',
    );
    // Benign structural markup survives.
    const benign = sanitizeHtml('<div class="callout"><p>hello</p></div>');
    expect(benign).toContain('callout');
    expect(benign).toContain('hello');
  },
};

/** B2: CSS `url()` beacons are stripped from `style`, benign styles survive. */
export const StripsCssUrlBeacons: Story = {
  play: async () => {
    const beacon = sanitizeHtml('<p style="background:url(https://attacker.example/beacon)">x</p>');
    expect(beacon.toLowerCase()).not.toContain('url(');
    expect(beacon.toLowerCase()).not.toContain('attacker');
    expect(beacon).toContain('>x<'); // the paragraph itself survives
    // The same beacon fired through the component sanitizer is also stripped.
    expect(
      sanitizeComponentHtml('<div style="background:url(https://attacker.example/b)">x</div>').toLowerCase(),
    ).not.toContain('attacker');
    // A benign inline style is preserved.
    expect(sanitizeHtml('<p style="color:red">x</p>')).toContain('color:red');
  },
};

/** B3: component output keeps VideoEmbed's iframe and SVG icon sprites while
 * still stripping execution and clamping iframe src to https:. */
export const ComponentSanitizerKeepsEmbedsStripsExecution: Story = {
  play: async () => {
    const iframe = sanitizeComponentHtml(
      '<iframe src="https://www.youtube-nocookie.com/embed/x" title="Video" allow="autoplay" allowfullscreen loading="lazy"></iframe>',
    );
    expect(iframe.toLowerCase()).toContain('<iframe');
    expect(iframe).toContain('https://www.youtube-nocookie.com/embed/x');
    expect(iframe.toLowerCase()).toContain('allowfullscreen');

    // SVG icon sprite (`<use href="#icon">`) survives.
    const svg = sanitizeComponentHtml('<svg viewBox="0 0 24 24"><use href="#icon"></use></svg>');
    expect(svg.toLowerCase()).toContain('<use');
    expect(svg.toLowerCase()).toContain('#icon');

    // Execution still dies inside component output.
    expect(sanitizeComponentHtml('<div><script>alert(1)</script></div>')).not.toContain('alert(1)');
    expect(sanitizeComponentHtml('<img src="x" onerror="alert(1)">').toLowerCase()).not.toContain('onerror');

    // A hostile iframe src (non-https or javascript:) has its src dropped.
    expect(sanitizeComponentHtml('<iframe src="javascript:alert(1)"></iframe>').toLowerCase()).not.toContain(
      'javascript:',
    );
    const httpIframe = sanitizeComponentHtml('<iframe src="http://attacker.example/x"></iframe>');
    expect(httpIframe.toLowerCase()).not.toContain('attacker');
  },
};
