import { describe, expect, test } from 'bun:test';
import { isUneditedSkill, skillChecksum, stampSkill } from '../src/skill-stamp.js';

const TEMPLATE = '---\nname: conloca\ndescription: Load when x.\n---\n\n# Body\n';

describe('stampSkill', () => {
  test('records the release and the checksum inside the frontmatter', () => {
    const stamped = stampSkill(TEMPLATE, '0.2.4');
    expect(stamped).toStartWith(
      '---\nname: conloca\ndescription: Load when x.\nmetadata:\n  version: "0.2.4"\n  checksum: "sha256:',
    );
    expect(stamped).toEndWith('"\n---\n\n# Body\n');
  });
  test('refuses a template that already carries metadata', () => {
    expect(() => stampSkill(stampSkill(TEMPLATE, '0.2.4'), '0.2.4')).toThrow();
  });
  test('refuses a template without frontmatter', () => {
    expect(() => stampSkill('# Body\n', '0.2.4')).toThrow();
  });
});

describe('isUneditedSkill', () => {
  test('accepts the stamped page as written', () => {
    expect(isUneditedSkill(stampSkill(TEMPLATE, '0.2.4'), [])).toBe(true);
  });
  test('accepts the stamped page checked out with CRLF line endings', () => {
    expect(isUneditedSkill(stampSkill(TEMPLATE, '0.2.4').replaceAll('\n', '\r\n'), [])).toBe(true);
  });
  test('sees any other change to the body, whitespace included', () => {
    expect(isUneditedSkill(`${stampSkill(TEMPLATE, '0.2.4')}\n`, [])).toBe(false);
    expect(isUneditedSkill(stampSkill(TEMPLATE, '0.2.4').replace('# Body', '# Body '), [])).toBe(false);
  });
  test('accepts an unstamped page only when its checksum is a listed release', () => {
    expect(isUneditedSkill(TEMPLATE, [skillChecksum(TEMPLATE)])).toBe(true);
    expect(isUneditedSkill(TEMPLATE.replaceAll('\n', '\r\n'), [skillChecksum(TEMPLATE)])).toBe(true);
    expect(isUneditedSkill(TEMPLATE, [])).toBe(false);
  });
});
