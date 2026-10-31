import { describe, expect, it } from 'bun:test';
import * as browserEntry from '../src/index.js';
import { isAutoWrittenLfsAttributes, lfsRuleFor } from '../src/lfs-attributes.js';

/** The `.gitattributes` the local editor wrote into the media folder on its first upload. */
const AUTO_WRITTEN_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'avif', 'ico'];
const autoWrittenText = (extensions: readonly string[]) =>
  extensions.map((ext) => `*.${ext} filter=lfs diff=lfs merge=lfs -text\n`).join('');
const AUTO_WRITTEN_LINES = AUTO_WRITTEN_EXTENSIONS.map((ext) => `*.${ext} filter=lfs diff=lfs merge=lfs -text`);
const AUTO_WRITTEN_TEXT_FIXTURE = autoWrittenText(AUTO_WRITTEN_EXTENSIONS);

/** The same lines in another order, as a later run of the local editor appended the ones missing. */
const shuffledAutoWritten = () => autoWrittenText(['webp', 'ico', 'png', 'jpg', 'avif', 'gif', 'jpeg', 'svg']);

const lfs = (dir: string, text: string) => ({ dir, text });

describe('lfsRuleFor — the LFS rule git would apply to the final path', () => {
  const M = 'public/assets';
  it('matches a basename pattern in a parent folder', () =>
    expect(lfsRuleFor('public/assets/hero.webp', [lfs('', '*.webp filter=lfs diff=lfs merge=lfs -text\n')], M)).toEqual(
      { attributesPath: '.gitattributes', pattern: '*.webp' },
    ));
  it('names the deeper file that sets the rule', () =>
    expect(lfsRuleFor('public/assets/hero.webp', [lfs(M, '*.webp filter=lfs\n')], 'img')).toEqual({
      attributesPath: 'public/assets/.gitattributes',
      pattern: '*.webp',
    }));
  it('lets a deeper file unset it', () =>
    expect(
      lfsRuleFor('public/assets/hero.webp', [lfs('', '*.webp filter=lfs\n'), lfs(M, '*.webp -filter\n')], M),
    ).toBeNull());
  it('lets a deeper file make it unspecified or another filter', () => {
    expect(
      lfsRuleFor('public/assets/a.webp', [lfs('', '*.webp filter=lfs\n'), lfs(M, '*.webp !filter\n')], M),
    ).toBeNull();
    expect(
      lfsRuleFor('public/assets/a.webp', [lfs('', '*.webp filter=lfs\n'), lfs(M, '*.webp filter=x\n')], M),
    ).toBeNull();
  });
  it('lets a later line win over an earlier one', () => {
    expect(lfsRuleFor('public/assets/a.png', [lfs('', '*.png filter=lfs\n*.png -filter\n')], M)).toBeNull();
    expect(lfsRuleFor('public/assets/a.png', [lfs('', '*.png -filter\n*.png filter=lfs\n')], M)).not.toBeNull();
  });
  it('anchors a pattern with a slash to its own folder', () =>
    expect(lfsRuleFor('public/assets/a.png', [lfs('', 'assets/*.png filter=lfs\n')], M)).toBeNull());
  it('matches a pattern with a slash relative to its folder, a leading slash anchoring it there', () => {
    expect(lfsRuleFor('public/assets/a.png', [lfs('public', 'assets/*.png filter=lfs\n')], M)).not.toBeNull();
    expect(lfsRuleFor('public/assets/a.png', [lfs('', '/public/assets/a.png filter=lfs\n')], M)).not.toBeNull();
  });
  it('does not let * cross a folder', () =>
    expect(lfsRuleFor('public/assets/team/a.png', [lfs('public', 'assets/*.png filter=lfs\n')], M)).toBeNull());
  it('lets ** span zero or more folders', () => {
    expect(lfsRuleFor('public/assets/a.png', [lfs('public', 'assets/**/*.png filter=lfs\n')], M)).not.toBeNull();
    expect(lfsRuleFor('public/assets/a.png', [lfs('', '**/assets/*.png filter=lfs\n')], M)).not.toBeNull();
    expect(lfsRuleFor('public/assets/team/a.png', [lfs('', 'public/**/*.png filter=lfs\n')], M)).not.toBeNull();
    expect(lfsRuleFor('public/assets/team/a.png', [lfs('', 'public/** filter=lfs\n')], M)).not.toBeNull();
  });
  it('matches ? and [...] classes within one name only', () => {
    expect(lfsRuleFor('public/assets/a1.png', [lfs('', 'a?.png filter=lfs\n')], M)).not.toBeNull();
    expect(lfsRuleFor('public/assets/a1.png', [lfs('', 'a[0-9].png filter=lfs\n')], M)).not.toBeNull();
    expect(lfsRuleFor('public/assets/a1.png', [lfs('', 'a[!0-9].png filter=lfs\n')], M)).toBeNull();
    expect(lfsRuleFor('public/assets/a1.png', [lfs('', 'a[[:digit:]].png filter=lfs\n')], M)).not.toBeNull();
    expect(lfsRuleFor('public/assets/a.png', [lfs('', 'public[/]assets/a.png filter=lfs\n')], M)).toBeNull();
  });
  it('never matches a pattern git could not read', () => {
    expect(lfsRuleFor('public/assets/a.png', [lfs('', '[a.png filter=lfs\n')], M)).toBeNull();
    expect(lfsRuleFor('public/assets/a.png', [lfs('', '*.png filter=lfs 0bad=x\n')], M)).not.toBeNull();
    expect(lfsRuleFor('public/assets/a.png', [lfs('', '*.png filter=lfs -=x\n')], M)).toBeNull();
  });
  it('reads a C-style quoted pattern', () =>
    expect(lfsRuleFor('public/assets/my photo.png', [lfs('', '"my\\040photo.png" filter=lfs\n')], M)).toEqual({
      attributesPath: '.gitattributes',
      pattern: 'my photo.png',
    }));
  it('does not apply a folder pattern to the files inside it', () => {
    expect(lfsRuleFor('public/assets/a.png', [lfs('', 'public/assets filter=lfs\n')], M)).toBeNull();
    expect(lfsRuleFor('public/assets/a.png', [lfs('', 'assets/ filter=lfs\n')], M)).toBeNull();
  });
  it('expands a root macro', () =>
    expect(lfsRuleFor('public/assets/a.webp', [lfs('', '[attr]img filter=lfs\n*.webp img\n')], M)).toEqual({
      attributesPath: '.gitattributes',
      pattern: '*.webp',
    }));
  it('expands no macro that a later line unsets, and none defined below the root', () => {
    expect(
      lfsRuleFor('public/assets/a.webp', [lfs('', '[attr]img filter=lfs\n*.webp img\n*.webp -img\n')], M),
    ).toBeNull();
    expect(lfsRuleFor('public/assets/a.webp', [lfs('public', '[attr]img filter=lfs\n*.webp img\n')], M)).toBeNull();
  });
  it('matches case-insensitively', () =>
    expect(lfsRuleFor('public/assets/a.png', [lfs('', '*.PNG filter=lfs\n')], M)).not.toBeNull());
  it('skips comments, blank lines and negative patterns', () =>
    expect(lfsRuleFor('public/assets/a.png', [lfs('', '# *.png filter=lfs\n\n!*.png filter=lfs\n')], M)).toBeNull());
  it('ignores a file in a folder the path is not under', () =>
    expect(lfsRuleFor('public/assets/a.png', [lfs('docs', '*.png filter=lfs\n')], M)).toBeNull());
  it('ignores the rules the local editor wrote, in any order, in the media folder', () =>
    expect(lfsRuleFor('public/assets/hero.webp', [lfs(M, shuffledAutoWritten())], M)).toBeNull());
  it('applies the same text in another folder', () =>
    expect(lfsRuleFor('public/assets/hero.webp', [lfs('', AUTO_WRITTEN_TEXT_FIXTURE)], M)).not.toBeNull());
  it('applies it once the site added a line', () =>
    expect(
      lfsRuleFor('public/assets/hero.webp', [lfs(M, `${AUTO_WRITTEN_TEXT_FIXTURE}*.pdf filter=lfs\n`)], M),
    ).not.toBeNull());
  it("still applies the site's own rule beside the auto-written file", () =>
    expect(
      lfsRuleFor('public/assets/hero.webp', [lfs('', '*.webp filter=lfs\n'), lfs(M, shuffledAutoWritten())], M),
    ).toEqual({ attributesPath: '.gitattributes', pattern: '*.webp' }));
});

describe('isAutoWrittenLfsAttributes — exactly the eight lines the local editor wrote', () => {
  it('accepts them with LF, CRLF, trailing spaces and in any order', () => {
    expect(isAutoWrittenLfsAttributes(AUTO_WRITTEN_TEXT_FIXTURE)).toBe(true);
    expect(isAutoWrittenLfsAttributes(AUTO_WRITTEN_LINES.join('\r\n'))).toBe(true);
    expect(isAutoWrittenLfsAttributes(`${AUTO_WRITTEN_LINES.join('  \n')}\n\n`)).toBe(true);
    expect(isAutoWrittenLfsAttributes(shuffledAutoWritten())).toBe(true);
  });
  it('refuses a ninth line or a missing one', () => {
    expect(isAutoWrittenLfsAttributes(`${AUTO_WRITTEN_TEXT_FIXTURE}*.pdf filter=lfs diff=lfs merge=lfs -text\n`)).toBe(
      false,
    );
    expect(isAutoWrittenLfsAttributes(AUTO_WRITTEN_LINES.slice(1).join('\n'))).toBe(false);
  });
  it('is exported from the browser entry', () => {
    expect(browserEntry.lfsRuleFor).toBe(lfsRuleFor);
    expect(browserEntry.isAutoWrittenLfsAttributes).toBe(isAutoWrittenLfsAttributes);
  });
});
