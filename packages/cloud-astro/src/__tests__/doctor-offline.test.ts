import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SitesConfig } from '@conloca/content-api';
import type { ScanFs } from '../doctor/config-scan.js';
import { runDoctor } from '../doctor/run.js';
import type { CheckOutcome, DoctorDeps } from '../doctor/types.js';
import { framingSnippets } from '../editor-page/framing.js';

const PROJECT = '/proj';
const CONTENT = join(PROJECT, 'content');
const CONFIG = join(PROJECT, 'astro.config.mjs');
const TS_CONFIG = join(PROJECT, 'astro.config.ts');
const SITES = join(CONTENT, 'sites.json');
const WORKFLOWS = 'ls-files -- :(top).github/workflows';
const CMS_ONLY =
  "import { conlocaCMS } from '@conloca/astro-cms/node';\nexport default { integrations: [conlocaCMS({})] };";
const WITHOUT_CMS =
  "import { conlocaCloud } from '@conloca/cloud-astro';\nexport default { integrations: [conlocaCloud({ endpoint: 'https://x.test' })] };";
const PUBLISHES =
  '/_conloca/editor/conloca.json publishes the repository name acme/site and the build branch; if the repository is not public, its name becomes public on deploy';

/** sites.json with one `default` site; `site` overrides its fields. */
const sitesJson = (site: Partial<SitesConfig['sites'][string]> = { domains: { en: 'www.acme.test' } }) =>
  JSON.stringify({ sites: { default: { locales: ['en'], defaultLocale: 'en', ...site } }, globalLocales: ['en'] });

/** A config with Astro's own `settings` ahead of the integrations. */
const withSettings = (settings: string) =>
  [
    "import { conlocaCMS } from '@conloca/astro-cms/node';",
    "import { conlocaCloud } from '@conloca/cloud-astro';",
    `export default { ${settings} integrations: [conlocaCMS({}), conlocaCloud({})] };`,
  ].join('\n');

function fakeFs(files: Record<string, string>): ScanFs {
  return {
    exists: (path: string) => path in files,
    readFile: (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`ENOENT ${path}`);
      return text;
    },
  };
}

/** A config that exists but cannot be read (permissions). */
const unreadableFs: ScanFs = {
  exists: () => true,
  readFile: () => {
    throw new Error('EACCES');
  },
};

/** A config with react + conlocaCMS wired and conlocaCloud(<options>). */
function config(
  options: string,
  cms = "conlocaCMS({ contentRoot: './content', puckConfigPath: './src/puck.config.tsx' })",
): string {
  return [
    "import { conlocaCMS } from '@conloca/astro-cms/node';",
    "import { conlocaCloud } from '@conloca/cloud-astro';",
    `export default { integrations: [react(), ${cms}, conlocaCloud(${options})] };`,
  ].join('\n');
}

/** Offline doctor must not network: the fetch fake throws so a regression fails loudly. git answers from `git`. */
async function runWith(
  fs: ScanFs,
  env: Record<string, string | undefined>,
  git: Record<string, string> = {},
  projectDir = PROJECT,
) {
  return runDoctor(
    { contractVersion: 1, projectDir, contentRoot: join(projectDir, 'content'), live: false },
    {
      ...fs,
      env,
      git: (args) => git[args.join(' ')],
      fetch: () => {
        throw new Error('offline doctor must not fetch');
      },
    },
  );
}

async function run(
  files: Record<string, string>,
  env: Record<string, string | undefined> = {},
  git: Record<string, string> = {},
) {
  return runWith(fakeFs(files), env, git);
}

function check(result: { checks: CheckOutcome[] }, id: string): CheckOutcome {
  const found = result.checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
}

const messages = (outcome: CheckOutcome) => outcome.problems.map((p) => `${p.level}: ${p.message}`);

describe('doctor extension — contract', () => {
  it('answers contract 1 with CC1, CC9, CC10, CC14, CC8 and skips the live checks without --live', async () => {
    const result = await run({
      [CONFIG]: config("{ endpoint: 'https://cms.example.com', puckConfigPath: './src/puck.config.tsx' }"),
    });
    expect(result.contractVersion).toBe(1);
    expect(result.checks.map((c) => c.id)).toEqual(['CC1', 'CC9', 'CC10', 'CC14', 'CC8', 'CC11', 'CC12', 'CC13']);
    for (const id of ['CC11', 'CC12', 'CC13']) {
      expect(check(result, id).skipped).toBe('live checks run only with --live');
    }
  });

  it('reads astro.config.mjs when astro.config.ts exists too', async () => {
    const outcome = check(
      await run({ [CONFIG]: config("{ endpoint: 'https://x.test' }"), [TS_CONFIG]: WITHOUT_CMS }),
      'CC1',
    );
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toStartWith('conlocaCloud(...) is called;');
  });
});

describe('CC1 — conlocaCloud next to conlocaCMS', () => {
  it('reports the call when it is visible', async () => {
    const result = await run({ [CONFIG]: config("{ endpoint: 'https://cms.example.com' }") });
    expect(check(result, 'CC1').problems).toEqual([]);
    expect(check(result, 'CC1').detail).toStartWith('conlocaCloud(...) is called;');
  });

  it('notes when the call is there but its options are not a literal', async () => {
    const outcome = check(await run({ [CONFIG]: config('options') }), 'CC1');
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toStartWith(
      'conlocaCloud(...) is called with options doctor cannot read as a plain object literal;',
    );
  });

  it('is an info when the dependency is installed but the call is not visible (gated off / spread)', async () => {
    const outcome = check(await run({ [CONFIG]: CMS_ONLY }), 'CC1');
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toBe(
      '@conloca/cloud-astro is installed but conlocaCloud(...) is not detectably called — fine when it is gated off or conditionally spread',
    );
  });

  it('errors when conlocaCMS is absent entirely — the both-integrations rule', async () => {
    expect(messages(check(await run({ [CONFIG]: WITHOUT_CMS }), 'CC1'))).toEqual([
      'error: conlocaCMS(...) is not called in the astro config — conlocaCloud is an add-on to conlocaCMS, keep both in integrations',
    ]);
  });

  it('skips without an astro config, warns on an unreadable one', async () => {
    expect(check(await run({}), 'CC1').skipped).toBe('no astro.config found');
    const outcome = check(await runWith(unreadableFs, {}), 'CC1');
    expect(outcome.problems).toEqual([
      {
        check: 'CC1',
        level: 'warn',
        message: 'doctor could not read /proj/astro.config.mjs — check its file permissions',
        path: '/proj/astro.config.mjs',
      },
    ]);
  });

  it('CC1 notes that conloca.json publishes the repository name', async () => {
    const files = { [CONFIG]: config('{}') };
    expect(check(await run(files, { GITHUB_REPOSITORY: 'acme/site' }), 'CC1').detail).toBe(
      `conlocaCloud(...) is called; ${PUBLISHES}`,
    );
    const fromGit = { 'config --get remote.origin.url': 'git@github.com:acme/site.git' };
    expect(check(await run(files, {}, fromGit), 'CC1').detail).toBe(`conlocaCloud(...) is called; ${PUBLISHES}`);
  });
});

describe('CC9 — the site domain is declared in sites.json', () => {
  it('reports the address from the default site', async () => {
    const outcome = check(await run({ [CONFIG]: config('{}'), [SITES]: sitesJson() }), 'CC9');
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toBe('https://www.acme.test/');
    const docs = check(
      await run({
        [CONFIG]: withSettings("base: '/docs',"),
        [SITES]: sitesJson({ domains: { en: 'acme.test' }, base: '/docs/' }),
      }),
      'CC9',
    );
    expect(docs.problems).toEqual([]);
    expect(docs.detail).toBe('https://acme.test/docs/');
  });

  it('CC9 errors when the address site has no domains host', async () => {
    const outcome = check(await run({ [CONFIG]: config('{}'), [SITES]: sitesJson({}) }), 'CC9');
    expect(messages(outcome)).toEqual([
      `error: site "default" in sites.json has no domains.en — run conloca connect, or add your site's host there`,
    ]);
    expect(outcome.problems[0]?.path).toBe(SITES);
  });

  it('errors on a domain that is not a bare host, a bad base, a missing sites.json and an unpickable site', async () => {
    const cases: [Record<string, string>, string][] = [
      [
        { [SITES]: sitesJson({ domains: { en: 'https://www.acme.test' } }) },
        'error: site "default" has domains.en "https://www.acme.test", which is not a bare host such as www.example.com',
      ],
      [
        { [SITES]: sitesJson({ domains: { en: 'www.acme.test' }, base: 'docs' }) },
        'error: site "default" has base "docs", which is not a path such as /docs/',
      ],
      [{}, `error: ${SITES} is missing or not JSON — run conloca connect`],
      [
        {
          [SITES]: JSON.stringify({
            sites: { a: { locales: ['en'], defaultLocale: 'en' }, b: { locales: ['en'], defaultLocale: 'en' } },
          }),
        },
        'error: sites.json lists several sites and none is named default, so the editor cannot tell which one gives the address',
      ],
    ];
    const results = await Promise.all(cases.map(([files]) => run({ [CONFIG]: config('{}'), ...files })));
    expect(results.map((result) => messages(check(result, 'CC9')))).toEqual(cases.map(([, message]) => [message]));
  });

  it('refuses localhost, IP literals and conloca.com hosts the way the editor does', async () => {
    const refused: [string, string][] = [
      ['localhost', 'localhost'],
      ['app.localhost', 'localhost'],
      ['127.0.0.1', 'an IP address'],
      ['127.1', 'an IP address'],
      ['shop.conloca.com', 'a conloca.com host'],
    ];
    const results = await Promise.all(
      refused.map(([host]) => run({ [CONFIG]: config('{}'), [SITES]: sitesJson({ domains: { en: host } }) })),
    );
    expect(results.map((result) => messages(check(result, 'CC9')))).toEqual(
      refused.map(([host, what]) => [
        `error: site "default" has domains.en "${host}", which is ${what}: the editor never frames a page there — use your site's public host`,
      ]),
    );
  });

  it('CC9 warns when Astro site names another host', async () => {
    const outcome = check(
      await run({ [CONFIG]: withSettings("site: 'https://other.test',"), [SITES]: sitesJson() }),
      'CC9',
    );
    expect(messages(outcome)).toEqual([
      `warn: Astro's site is https://other.test but sites.json gives the site "default" the host www.acme.test: the workspace editor opens https://www.acme.test/_conloca/editor/. Make them match.`,
    ]);
    expect(outcome.problems[0]?.path).toBe(CONFIG);
  });

  it("warns when Astro's base differs from the base in sites.json", async () => {
    const outcome = check(await run({ [CONFIG]: withSettings("base: '/docs',"), [SITES]: sitesJson() }), 'CC9');
    expect(messages(outcome)).toEqual([
      `warn: Astro's base is /docs/ but sites.json gives the site "default" base /: the workspace editor looks for the editor page under /_conloca/editor/ and will not find it. Make them match.`,
    ]);
  });

  it('skips when conlocaCloud is not called', async () => {
    expect(check(await run({ [CONFIG]: CMS_ONLY, [SITES]: sitesJson({}) }), 'CC9').skipped).toBe(
      'conlocaCloud(...) is not called in the astro config',
    );
  });
});

describe('CC10 — committed headers allow framing the editor page', () => {
  let root: string | undefined;
  afterEach(async () => {
    if (root !== undefined) await rm(root, { recursive: true, force: true });
    root = undefined;
  });
  const diskFs: Pick<DoctorDeps, 'exists' | 'readFile'> = {
    exists: existsSync,
    readFile: (path) => readFileSync(path, 'utf8'),
  };

  it('CC10 errors on a site-wide X-Frame-Options in public/_headers and shows the editor block', async () => {
    root = await mkdtemp(join(tmpdir(), 'doctor-framing-'));
    await mkdir(join(root, 'public'));
    await writeFile(join(root, 'astro.config.mjs'), config('{}'));
    await writeFile(join(root, 'public', '_headers'), '/*\n  X-Frame-Options: DENY\n');
    const outcome = check(await runWith(diskFs, {}, {}, root), 'CC10');
    expect(messages(outcome)).toEqual([
      `error: public/_headers sets X-Frame-Options for the whole site, so the workspace editor cannot frame /_conloca/editor/ — run conloca connect, or add:\n${framingSnippets('conloca.com').cloudflareHeaders}`,
    ]);
    expect(outcome.problems[0]?.path).toBe(join(root, 'public', '_headers'));
  });

  it('passes when no committed header forbids framing', async () => {
    const outcome = check(await run({ [CONFIG]: config('{}') }), 'CC10');
    expect(outcome.problems).toEqual([]);
  });
});

describe('CC14 — no build key leftovers', () => {
  it('CC14 warns with the line of a workflow that still names CONLOCA_BUILD_TOKEN', async () => {
    const workflow = [
      'name: build',
      'jobs:',
      '  build:',
      '    env:',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: a GitHub Actions expression, not a template
      '      CONLOCA_BUILD_TOKEN: ${{ secrets.CONLOCA_BUILD_TOKEN }}',
    ].join('\n');
    const files = {
      [CONFIG]: config('{ buildToken: process.env.CONLOCA_BUILD_TOKEN }'),
      [join(PROJECT, '.github/workflows/build.yml')]: workflow,
    };
    const git = { [WORKFLOWS]: '.github/workflows/build.yml\n.github/workflows/README.md' };
    const outcome = check(await run(files, {}, git), 'CC14');
    expect(messages(outcome)).toEqual([
      'warn: .github/workflows/build.yml:5 still names CONLOCA_BUILD_TOKEN, left from the build key the editor page no longer needs — remove it',
      'warn: astro.config.mjs:3 still names buildToken, CONLOCA_BUILD_TOKEN, left from the build key the editor page no longer needs — remove it',
    ]);
    expect(outcome.problems.map((p) => p.path)).toEqual([join(PROJECT, '.github/workflows/build.yml'), CONFIG]);
  });

  it('names each removed option and stays quiet on a clean project', async () => {
    const options = "{ publicBaseUrl: 'https://a.test', previewDomain: 'p.test', requireRegistration: true }";
    expect(messages(check(await run({ [CONFIG]: config(options) }), 'CC14'))).toEqual([
      'warn: astro.config.mjs:3 still names publicBaseUrl, previewDomain, requireRegistration, left from the build key the editor page no longer needs — remove it',
    ]);
    expect(check(await run({ [CONFIG]: config('{}') }), 'CC14').problems).toEqual([]);
  });
});

describe('CC8 — the preview build, when previewBuild is set, has an SSR adapter', () => {
  const STATIC_ERROR =
    'error: previewBuild is set, but the project is static and has no SSR adapter, so astro build fails at config time — add one (previewBuild: { adapter }) or remove previewBuild from conlocaCloud(...)';
  const NOT_VERIFIED = 'not verified — doctor cannot read previewBuild, output or the adapter from the config text';

  /** A config with the site's own settings (output, adapter, ...) ahead of the integrations. */
  function siteConfig(settings: string, options: string): string {
    return [
      "import node from '@astrojs/node';",
      "import { conlocaCMS } from '@conloca/astro-cms/node';",
      "import { conlocaCloud } from '@conloca/cloud-astro';",
      `export default { ${settings} integrations: [react(), conlocaCMS({}), conlocaCloud(${options})] };`,
    ].join('\n');
  }

  it('errors on a static project without an adapter when previewBuild is set', async () => {
    for (const text of [
      config("{ endpoint: 'https://x.test', previewBuild: {} }"),
      config("{ endpoint: 'https://x.test', previewBuild: { outDir: '.preview' } }"),
      siteConfig("output: 'static',", "{ endpoint: 'https://x.test', previewBuild: {} }"),
    ]) {
      const outcome = check(await run({ [CONFIG]: text }), 'CC8');
      expect(messages(outcome)).toEqual([STATIC_ERROR]);
      expect(outcome.problems[0].path).toBe(CONFIG);
    }
  });

  it('reports no preview build when previewBuild is absent, even on a static project', async () => {
    const outcome = check(
      await run({ [CONFIG]: siteConfig("output: 'static',", "{ endpoint: 'https://x.test' }") }),
      'CC8',
    );
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toBe('previewBuild is not set — no preview build runs');
  });

  it('passes when previewBuild is false', async () => {
    const outcome = check(
      await run({ [CONFIG]: config("{ endpoint: 'https://x.test', previewBuild: false }") }),
      'CC8',
    );
    expect(outcome.problems).toEqual([]);
    expect(outcome.detail).toBe('previewBuild: false — no preview build runs');
  });

  it('passes when the project or previewBuild names an adapter', async () => {
    for (const text of [
      siteConfig(
        "output: 'server', adapter: node({ mode: 'standalone' }),",
        "{ endpoint: 'https://x.test', previewBuild: {} }",
      ),
      config("{ endpoint: 'https://x.test', previewBuild: { adapter: cloudflare() } }"),
      config("{ endpoint: 'https://x.test', previewBuild: { adapter } }"),
    ]) {
      const outcome = check(await run({ [CONFIG]: text }), 'CC8');
      expect(outcome.problems).toEqual([]);
      expect(outcome.detail).toBe('the preview build has an SSR adapter');
    }
  });

  it('leaves unjudged what the config text cannot show', async () => {
    for (const text of [
      config('options'),
      config("{ ...shared, endpoint: 'https://x.test' }"),
      config("{ endpoint: 'https://x.test', previewBuild: process.env.CI ? {} : false }"),
      config("{ endpoint: 'https://x.test', previewBuild }"),
      siteConfig('output: mode,', "{ endpoint: 'https://x.test', previewBuild: {} }"),
      siteConfig('...base,', "{ endpoint: 'https://x.test', previewBuild: {} }"),
    ]) {
      const outcome = check(await run({ [CONFIG]: text }), 'CC8');
      expect(outcome.problems).toEqual([]);
      expect(outcome.detail).toBe(NOT_VERIFIED);
    }
  });

  it('skips without a config, on an unreadable one, and when conlocaCloud is not called', async () => {
    expect(check(await run({}), 'CC8').skipped).toBe('no astro.config found');
    expect(check(await runWith(unreadableFs, {}), 'CC8').skipped).toBe('astro config could not be read');
    expect(check(await run({ [CONFIG]: CMS_ONLY }), 'CC8').skipped).toBe(
      'conlocaCloud(...) is not called in the astro config',
    );
  });
});
