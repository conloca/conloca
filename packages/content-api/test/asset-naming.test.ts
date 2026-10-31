import { describe, expect, it } from 'bun:test';
import {
  fileNameFromUrl,
  folderCaseClashError,
  folderPathError,
  safeAssetFilename,
  uniqueAssetName,
  withNumberSuffix,
} from '../src/asset-naming.js';
import * as browserEntry from '../src/index.js';

describe('uniqueAssetName — a taken name gets the next free -n, whatever its case', () => {
  it('keeps a free name', () => expect(uniqueAssetName('hero.webp', new Set())).toBe('hero.webp'));
  it('treats Hero.webp as taking hero.webp', () =>
    expect(uniqueAssetName('hero.webp', new Set(['hero.webp']))).toBe('hero-1.webp'));
  it('skips every taken suffix', () =>
    expect(uniqueAssetName('hero.webp', new Set(['hero.webp', 'hero-1.webp']))).toBe('hero-2.webp'));
  it('never picks a name Windows cannot check out', () => {
    expect(uniqueAssetName('aux.png', new Set())).toBe('aux-1.png');
    expect(uniqueAssetName('Com1', new Set())).toBe('Com1-1');
    expect(uniqueAssetName('Com0', new Set())).toBe('Com0-1');
    expect(uniqueAssetName('lpt0.png', new Set())).toBe('lpt0-1.png');
    expect(uniqueAssetName('nul.tar.png', new Set(['nul-1.tar.png']))).toBe('nul-2.tar.png');
    expect(uniqueAssetName('auxiliary.png', new Set())).toBe('auxiliary.png');
  });
});

describe('folderPathError — folders git can hold and a link can name', () => {
  it.each(['', 'team', 'team/2026', 'a-b_c.d', 'фото', 'a+b=c', 'a@b!', 'v~1'])('accepts %p', (p) =>
    expect(folderPathError(p)).toBeNull(),
  );
  it.each([
    '.git',
    'x/.GIT',
    'GIT~1',
    '../up',
    'a//b',
    '.hidden',
    'trail.',
    'trail ',
    'a b',
    'a%20b',
    'a#b',
    'con',
    'Lpt9.old',
    'com0',
    'LPT0.x',
    'tab\there',
    'nul\u0000l',
    'a*b',
    'a:b',
    'a|b',
    "Niko's",
    '2026 (old)',
    'a<b>',
    'a`b',
    'a\\b',
    'q?x',
    'Tom&Jerry',
    'a"b',
  ])('refuses %p', (p) => expect(folderPathError(p)).toEqual(expect.any(String)));
  it('names the folder and the rule', () => {
    expect(folderPathError('photos/.git')).toBe('".git" is reserved by Git and cannot be a folder name.');
    expect(folderPathError('My Photos')).toContain('"My Photos" cannot hold spaces');
  });
});

describe('folderCaseClashError — a new folder Mac and Windows would merge with an existing one', () => {
  it('refuses a name that differs from an existing folder only in case', () =>
    expect(folderCaseClashError('Photos', ['team', 'photos'])).toBe(
      'The folder "photos" already exists, and "Photos" differs from it only in capital letters, which Mac and Windows treat as the same folder.',
    ));
  it('accepts the existing folder itself and a new name', () => {
    expect(folderCaseClashError('photos', ['photos'])).toBeNull();
    expect(folderCaseClashError('team', ['photos'])).toBeNull();
  });
});

describe('safeAssetFilename — lowercase, spaces→dash, drop unsafe chars, keep extension', () => {
  it('lowercases and dashes spaces', () => {
    expect(safeAssetFilename('My Hero Image.PNG')).toBe('my-hero-image.png');
  });

  it('strips characters outside [a-z0-9._-]', () => {
    expect(safeAssetFilename('café!@#.jpg')).toBe('cafe.jpg');
  });

  it('keeps the base letters of an accented or fullwidth Latin name, whatever its Unicode form', () => {
    expect(safeAssetFilename('café.png')).toBe('cafe.png');
    expect(safeAssetFilename('café.png')).toBe('cafe.png');
    expect(safeAssetFilename('Über uns.png')).toBe('uber-uns.png');
    expect(safeAssetFilename('Ｐｈｏｔｏ.png')).toBe('photo.png');
  });

  it('reads a fullwidth dot as a plain one, so a name written with it keeps its extension', () => {
    expect(safeAssetFilename('photo．png')).toBe('photo.png');
    expect(safeAssetFilename('my．photo.jpg')).toBe('my.photo.jpg');
    // The 200-character cut applies to the part before that dot, never to the extension after it.
    expect(safeAssetFilename(`${'a'.repeat(250)}．png`)).toBe(`${'a'.repeat(200)}.png`);
    // An extension written in fullwidth letters is read as the plain one too.
    expect(safeAssetFilename('photo.ｐｎｇ')).toBe('photo.png');
  });

  it('falls back to "file" when the base sanitizes to empty', () => {
    expect(safeAssetFilename('!!!.png')).toBe('file.png');
  });

  it('names an upload whose name keeps no Latin letter or digit "file"', () => {
    expect(safeAssetFilename('фото.png')).toBe('file.png');
    expect(safeAssetFilename('照片.jpeg')).toBe('file.jpeg');
    expect(safeAssetFilename('мой фото.png')).toBe('file.png');
    expect(safeAssetFilename('фото-кота.png')).toBe('file.png');
    expect(safeAssetFilename('_.png')).toBe('file.png');
    expect(safeAssetFilename('2026 фото.png')).toBe('2026-.png');
  });

  it('handles a name with no extension', () => {
    expect(safeAssetFilename('README')).toBe('readme');
  });

  it('never names an upload as a hidden dot-file', () => {
    expect(safeAssetFilename('.config.png')).toBe('config.png');
    expect(safeAssetFilename('..png')).toBe('file.png');
    expect(safeAssetFilename('фото..png')).toBe('file.png');
  });

  it('keeps dots and underscores inside a name and drops control characters', () => {
    expect(safeAssetFilename('Photo_0001.JPG')).toBe('photo_0001.jpg');
    expect(safeAssetFilename('my.photo.v2.png')).toBe('my.photo.v2.png');
    expect(safeAssetFilename('a\u0000b.png')).toBe('ab.png');
  });

  it('cuts a long name to its first 200 cleaned characters and keeps the extension', () => {
    expect(safeAssetFilename(`${'a'.repeat(1100)}.png`)).toBe(`${'a'.repeat(200)}.png`);
    expect(safeAssetFilename(`${'фото'.repeat(50)}${'é'.repeat(300)}.PNG`)).toBe(`${'e'.repeat(200)}.png`);
    expect(safeAssetFilename(`${'.'.repeat(300)}hero.png`)).toBe('hero.png');
    expect(safeAssetFilename(`${'b'.repeat(200)}.png`)).toBe(`${'b'.repeat(200)}.png`);
  });

  it('leaves a name that is only an extension, or ends in a dot, without one, so the upload is refused', () => {
    expect(safeAssetFilename('.png')).toBe('png');
    expect(safeAssetFilename('фото.')).toBe('file');
  });
});

describe('withNumberSuffix', () => {
  it('inserts the collision suffix before the extension', () => {
    expect(withNumberSuffix('photo.png', 1)).toBe('photo-1.png');
    expect(withNumberSuffix('noext', 2)).toBe('noext-2');
  });
});

const nameOf = (address: string) => fileNameFromUrl(new URL(address));

describe('fileNameFromUrl — the name an imported image is shown under', () => {
  it('is the decoded last part of the address', () => {
    expect(nameOf('https://images.example.com/photos/%E5%86%99%E7%9C%9F%20kot.png')).toBe('写真 kot.png');
    expect(nameOf('https://images.example.com/foo%ZZ.png')).toBe('foo%ZZ.png');
  });

  it('drops folders that last part holds as a decoded slash or backslash', () => {
    expect(nameOf('https://images.example.com/photos%2Fdays%2FBeach.png')).toBe('Beach.png');
    expect(nameOf('https://images.example.com/..%5C..%5Cx.png')).toBe('x.png');
  });

  it('keeps the part as written when decoding it would add an invisible control character', () => {
    expect(nameOf('https://images.example.com/line%0Abreak.png')).toBe('line%0Abreak.png');
    expect(nameOf('https://images.example.com/a%00b.png')).toBe('a%00b.png');
    expect(nameOf('https://images.example.com/a%C2%85b.png')).toBe('a%C2%85b.png');
  });

  it('keeps the part as written when nothing follows its last decoded slash, and says "import" for no part', () => {
    expect(nameOf('https://images.example.com/photos%2F')).toBe('photos%2F');
    expect(nameOf('https://images.example.com/')).toBe('import');
  });
});

describe('the browser entry', () => {
  it('re-exports the naming rule', () => {
    expect(browserEntry.uniqueAssetName).toBe(uniqueAssetName);
    expect(browserEntry.folderPathError).toBe(folderPathError);
  });
});
