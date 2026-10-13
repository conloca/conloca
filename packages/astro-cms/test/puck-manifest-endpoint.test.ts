import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createComponentsEndpoint, endpointReaderOptions } from '../src/puck-manifest/components-endpoint.js';
import { endpointReaderOptions as entryReaderOptions, readPuckConfig } from '../src/puck-manifest/index.js';
import { componentsEndpointBody } from '../src/puck-manifest/read-config.js';

/** A throwaway project directory, removed however the assertions turn out. */
function withRoot(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'puck-endpoint-'));
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('endpointReaderOptions', () => {
  test('hands the reader the host tsconfig when the project has one', () => {
    withRoot((root) => {
      writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { "jsx": "preserve" } }');
      const options = endpointReaderOptions({ puckConfigPath: './src/puck.config.tsx', projectRoot: root });
      expect(options.tsConfigFilePath).toBe(join(root, 'tsconfig.json'));
      // Resolved against the same root the tsconfig came from, so the two can
      // never describe different directories.
      expect(options.configPath).toBe(join(root, 'src', 'puck.config.tsx'));
    });
  });

  test('leaves the tsconfig out when the project has none, so the reader can find the nearest one', () => {
    withRoot((root) => {
      const options = endpointReaderOptions({ puckConfigPath: './src/puck.config.tsx', projectRoot: root });
      // Absent, not present-and-undefined: naming a file that is not there
      // would stop the reader looking for the nearest tsconfig above the
      // config, which is what makes a relative `.tsx` import resolve at all.
      expect('tsConfigFilePath' in options).toBe(false);
    });
  });
});

describe('componentsEndpointBody', () => {
  test('serves a .tsx config as JSON', () => {
    withRoot((root) => {
      // A `.tsx` config with its own tsconfig is the shape both shipped sites
      // use, and the one where a wrong path costs every component silently.
      writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { "jsx": "preserve" } }');
      mkdirSync(join(root, 'src'));
      writeFileSync(
        join(root, 'src', 'Hero.tsx'),
        "export const Hero = { label: 'Hero', fields: { title: { type: 'text' } } };",
      );
      writeFileSync(
        join(root, 'src', 'puck.config.tsx'),
        "import { Hero } from './Hero';\nexport default { components: { Hero } };",
      );

      const body = JSON.parse(
        componentsEndpointBody(endpointReaderOptions({ puckConfigPath: 'src/puck.config.tsx', projectRoot: root })),
      );
      expect(body.components.Hero.fields.title.type).toBe('text');
      expect(body.unresolved).toEqual([]);
    });
  });

  test('answers a config that is not there with an empty manifest, marked unread', () => {
    withRoot((root) => {
      const body = JSON.parse(componentsEndpointBody({ configPath: join(root, 'src', 'puck.config.tsx') }));
      expect(body.components).toEqual({});
      // The flag is the difference the endpoint's caller needs: a site with no
      // components looks nothing like a config the reader could not open.
      expect(body.unreadable).toBe(true);
    });
  });

  // The two shapes that once took the endpoint down: a computed name summed
  // from twenty thousand parts, and a file nested deeper than the parser goes.
  test('answers a config it cannot read to the end with 200 and a manifest, never an error', () => {
    const deep = 20_000;
    const configs = {
      sum: `export default { components: { [${"'a' + ".repeat(19_999)}'b']: { fields: {} } } };`,
      nested: `export default { components: { C: { fields: { f: { type: 'custom', ai: ${'['.repeat(deep)}1${']'.repeat(deep)} } } } } };`,
    };
    for (const [name, config] of Object.entries(configs)) {
      withRoot((root) => {
        writeFileSync(join(root, 'puck.config.ts'), config);
        const response = {
          statusCode: 0,
          body: '',
          setHeader() {},
          end(body: string) {
            this.body = body;
          },
        };
        createComponentsEndpoint({ configPath: join(root, 'puck.config.ts') })(
          {} as never,
          response as never,
          () => {},
        );
        expect([name, response.statusCode]).toEqual([name, 200]);
        const manifest = JSON.parse(response.body);
        if (name === 'sum') expect(Object.keys(manifest.components)[0]).toHaveLength(20_000);
        else expect(manifest.unreadableReason).toMatch(/^reading the config ran out of call stack/);
      });
    }
  });
});

describe('the puck-manifest entry', () => {
  test('lets a host build read a config exactly as the dev endpoint serves it', () => {
    withRoot((root) => {
      writeFileSync(join(root, 'tsconfig.json'), '{ "compilerOptions": { "jsx": "preserve" } }');
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src', 'Hero.tsx'), "export const Hero = { fields: { title: { type: 'text' } } };");
      writeFileSync(
        join(root, 'src', 'puck.config.tsx'),
        "import { Hero } from './Hero';\nexport default { components: { Hero } };",
      );
      const paths = { puckConfigPath: 'src/puck.config.tsx', projectRoot: root };
      expect(JSON.stringify(readPuckConfig(entryReaderOptions(paths)))).toBe(
        componentsEndpointBody(endpointReaderOptions(paths)),
      );
    });
  });
});

describe('middleware response contract', () => {
  test.each(['error', 'string'])('returns a logged JSON 500 for an internal %s failure', (kind) => {
    const child = Bun.spawnSync([process.execPath, join(import.meta.dir, 'fixtures/puck-endpoint-failure.ts'), kind]);
    expect(child.exitCode).toBe(0);
    expect(JSON.parse(child.stdout.toString())).toEqual({
      status: 500,
      body: { error: 'fixture reader failure' },
      headers: { 'content-type': 'application/json; charset=utf-8' },
      warnings: [['[conloca:puck-manifest] components endpoint failed:', 'fixture reader failure']],
      nextCalls: 0,
    });
  });

  test('reuses middleware after source edits and prevents response caching', () => {
    withRoot((root) => {
      const path = join(root, 'puck.config.ts');
      const handler = createComponentsEndpoint({ configPath: path });
      for (const title of ['Initial', 'Updated']) {
        writeFileSync(
          path,
          `export default { components: { Hero: { label: '${title}', fields: { title: { type: 'text' } } } } };`,
        );
        const response = {
          statusCode: 0,
          body: '',
          headers: new Map<string, string>(),
          setHeader(key: string, value: string) {
            this.headers.set(key, value);
          },
          end(body: string) {
            this.body = body;
          },
        };
        handler({} as never, response as never, () => {
          throw new Error('middleware delegated unexpectedly');
        });
        expect(response.statusCode).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(JSON.parse(response.body).components.Hero.label).toBe(title);
      }
    });
  });
});
