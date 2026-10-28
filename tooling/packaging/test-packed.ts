#!/usr/bin/env bun
/**
 * Proves the published shape of one npm package. Packs it and its workspace
 * closure with `bun pm pack --ignore-scripts` (what a release runs underneath),
 * installs the tarballs into a throwaway project with real dependencies, then
 * checks what no compiler flag checks: every export, and every declaration file
 * it names, resolves inside the install under ESM semantics, every relative
 * import inside the installed files points at a file the tarball actually
 * ships, the Node-facing entries load under plain Node, a consumer typechecks
 * under nodenext and bundler, and any CLI runs from its installed binary.
 *
 * The import scanner is regex over text with comments and template literals
 * stripped, so it misses minified `import{a}from"…"`, `require()`, and imports
 * written inside template literals, and a lone backtick or `/*` inside a string
 * swallows the rest of that file.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const projectName = process.argv[2];
if (!projectName) {
  throw new Error('usage: test-packed.ts <nx project name>');
}

// Entries that must load under plain Node. Browser-only entries (React
// components) are covered by the typecheck and by the site builds instead.
const NODE_ENTRIES = {
  'content-api': 'all',
  // `./testing` ships real helpers that import nothing at all — no test runner
  // is pulled in — so it loads under Node like the main entry.
  'content-api-client': 'all',
  mdx: ['./node', './sandbox-frame'],
  // `./node/content` and `./collections` import Astro's `astro:content`,
  // `./cms-handler` imports this package's own `virtual:*` modules (declared by
  // its types-only `./virtual-modules` export), and `./page-feed` imports both;
  // they exist only inside an Astro dev/build process, so the site builds cover
  // them.
  'astro-cms': ['.', './node', './checks', './page-schemas', './components'],
  // The editor's own entries need React and a DOM. These need no DOM: the
  // schema and theme helpers a server or config file uses, the helper blocks
  // call as they render on the server, and the frame protocol and channel a
  // parent frame imports (they reach React only through content-api-client,
  // which loads).
  'cms-spa': [
    './mdx-components-define',
    './page-schema-define',
    './page-setting-attributes',
    './theme',
    './frame-protocol',
    './frame-channel',
  ],
  cli: [],
  // `./site-middleware` imports Astro's `astro:content` and this package's own
  // `virtual:*` modules, and `./preview-handler` is an Astro component; both
  // exist only inside an Astro dev/build process, so the site builds cover
  // them.
  'cloud-astro': ['.', './node', './preview', './doctor', './satteri-workerd'],
} satisfies Record<string, string[] | 'all'>;

const SCOPE = '@conloca/';

type ExportTarget = string | null | { [condition: string]: ExportTarget };
type PackageManifest = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  exports?: Record<string, ExportTarget>;
  bin?: string | Record<string, string>;
};

const packageDirOf = (project: string) => join(repoRoot, 'packages', project);
const readManifest = (project: string) =>
  JSON.parse(readFileSync(join(packageDirOf(project), 'package.json'), 'utf8')) as PackageManifest;
const unscoped = (name: string) => name.slice(name.lastIndexOf('/') + 1);

const manifest = readManifest(projectName);
const nodeEntries = new Map<string, string[] | 'all'>(Object.entries(NODE_ENTRIES)).get(projectName);
assert.ok(nodeEntries !== undefined, `${projectName}: add it to NODE_ENTRIES first`);

// TypeScript source, as opposed to declarations. A release prunes conditions
// pointing here before packing, because a consumer whose runtime activates the
// matching condition would resolve raw TypeScript out of node_modules.
const isTypeScriptSource = (target: string) => /\.(?:[mc]?ts|tsx)$/.test(target) && !/\.d\.[mc]?ts$/.test(target);

// Parity with the publish pass a release applies before packing: it drops
// export conditions that point at TypeScript source and moves `types` to the
// front of every condition map. Both must already hold, or the tarball under
// test would not be the tarball consumers get.
const assertPublishableExports = (packageName: string, exportsMap: Record<string, ExportTarget> | undefined) => {
  const visit = (value: ExportTarget, path: string) => {
    if (typeof value === 'string') {
      assert.ok(!isTypeScriptSource(value), `${packageName}: ${path} points at TypeScript source (${value})`);
      return;
    }
    if (value === null) {
      return;
    }
    const entries = Object.entries(value);
    const isSubpathMap = entries.some(([key]) => key.startsWith('.'));
    if (!isSubpathMap) {
      const typesIndex = entries.findIndex(([condition]) => condition === 'types');
      assert.ok(typesIndex <= 0, `${packageName}: ${path} must list the types condition first`);
    }
    for (const [key, target] of entries) {
      // A TypeScript target under `types` is resolved by TypeScript alone and
      // reaches no runtime, so a release leaves it as authored.
      if (!isSubpathMap && key === 'types') {
        continue;
      }
      visit(target, `${path}[${key}]`);
    }
  };
  if (exportsMap !== undefined) {
    visit(exportsMap, 'exports');
  }
};

// Every workspace package the consumer will need, this one included: a release
// publishes them together, so the throwaway project resolves them all from
// tarballs rather than from the workspace. A workspace peer is one of them —
// the consumer installs it next to the package, and the release closes over
// peers as it does over dependencies.
const packClosure = (rootProject: string) => {
  const found = new Map<string, PackageManifest>();
  const queue = [rootProject];
  while (queue.length > 0) {
    const project = queue.pop();
    if (project === undefined || found.has(project)) {
      continue;
    }
    const packageManifest = readManifest(project);
    found.set(project, packageManifest);
    for (const dependency of Object.keys({ ...packageManifest.dependencies, ...packageManifest.peerDependencies })) {
      if (!dependency.startsWith(SCOPE)) {
        continue;
      }
      const dependencyProject = dependency.slice(SCOPE.length);
      // The scope also covers packages outside packages/, which are not
      // published and cannot be packed here.
      assert.ok(
        existsSync(packageDirOf(dependencyProject)),
        `${packageManifest.name} depends on ${dependency}, which is not a package under packages/ and cannot be packed.`,
      );
      queue.push(dependencyProject);
    }
  }
  return new Map([...found].sort(([a], [b]) => a.localeCompare(b)));
};

const isLoadable = (target: ExportTarget) =>
  typeof target === 'string' || (target !== null && ('import' in target || 'default' in target));

/** Every `types` target in an export's condition map, nested maps included. */
const typesTargetsOf = (target: ExportTarget): string[] => {
  if (target === null || typeof target === 'string') {
    return [];
  }
  return Object.entries(target).flatMap(([condition, value]) =>
    condition === 'types' && typeof value === 'string' ? [value] : typesTargetsOf(value),
  );
};

// Whether what an export hands runtimes is JavaScript. A stylesheet, or an
// Astro component an integration injects as a route, is a file to ship rather
// than a module to import: it must resolve, but nothing loads or typechecks it.
const isScript = (target: ExportTarget): boolean =>
  typeof target === 'string'
    ? /\.[mc]?js$/.test(target)
    : target !== null && isScript(target.import ?? target.default ?? null);

// `./package.json` is not a shape under test and `*` patterns have no single
// target to resolve; everything else must resolve, stylesheets included.
const exportEntries = Object.entries(manifest.exports ?? {}).filter(
  ([subpath]) => subpath !== './package.json' && !subpath.includes('*'),
);
const runtimeEntries = exportEntries.filter(([, target]) => isLoadable(target));
const typesOnlyEntries = exportEntries.filter(([, target]) => !isLoadable(target));
const typecheckSubpaths = exportEntries
  .filter(([, target]) => !isLoadable(target) || isScript(target))
  .map(([subpath]) => subpath);
// A stylesheet that declares types promises a TypeScript consumer can import
// it for its side effect without a module shim of its own.
const typedStylesheets = exportEntries
  .filter(([subpath, target]) => subpath.endsWith('.css') && typesTargetsOf(target).length > 0)
  .map(([subpath]) => subpath);
const nodeLoadable = runtimeEntries.filter(([, target]) => isScript(target)).map(([subpath]) => subpath);
const specifierFor = (subpath: string) => (subpath === '.' ? manifest.name : `${manifest.name}/${subpath.slice(2)}`);
const binaries = typeof manifest.bin === 'string' ? { [unscoped(manifest.name)]: manifest.bin } : (manifest.bin ?? {});
const binaryNames = Object.keys(binaries);

// A run that loads nothing and runs nothing has proved nothing.
assert.ok(
  runtimeEntries.length > 0 || binaryNames.length > 0,
  `${manifest.name}: no runtime exports and no bin — nothing for a consumer to use`,
);

// Relative specifiers, covering side-effect `import '…'`, `import … from '…'`,
// a re-export's `from '…'`, and `import('…')` including the `import('…').Type`
// form TypeScript writes into declarations. Statements are anchored to the
// start of a line, and comments and template literals come out first: prose
// that quotes an import, and the scaffold sources a CLI writes into a user's
// project, are text rather than imports of the file that holds them. Imports
// in the per-file output this guards are never inside either.
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
// A `//` that follows whitespace starts a trailing comment, so a commented-out
// `import('./x.js')` is not counted. `https://` survives because its `//`
// follows a colon; a `//` inside a string literal after a space does not, which
// is the heuristic's cost.
const LINE_COMMENT_RE = /(?:^|(?<=\s))\/\/[^\n]*/g;
const TEMPLATE_LITERAL_RE = /`(?:\\[\s\S]|[^\\`])*`/g;
const IMPORT_STATEMENT_RE = /^\s*import\s+(?:[^'"]*?\bfrom\s*)?['"](\.[^'"]*)['"]/gm;
const EXPORT_STATEMENT_RE = /^\s*export\s+[^'"]*?\bfrom\s*['"](\.[^'"]*)['"]/gm;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g;

const relativeSpecifiersIn = (source: string) => {
  // Comments first: they carry stray backticks that would otherwise pair up
  // with a real template literal and swallow the code between them.
  const code = source.replace(BLOCK_COMMENT_RE, '').replace(LINE_COMMENT_RE, '').replace(TEMPLATE_LITERAL_RE, '``');
  const found: string[] = [];
  for (const pattern of [IMPORT_STATEMENT_RE, EXPORT_STATEMENT_RE, DYNAMIC_IMPORT_RE]) {
    for (const match of code.matchAll(pattern)) {
      found.push(match[1]);
    }
  }
  return found;
};

// A directory satisfies `existsSync` but Node refuses to import one, so every
// import target has to be a file.
const isFile = (path: string) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const listFiles = (root: string) => {
  if (!existsSync(root)) {
    return [];
  }
  const found: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(full);
      } else {
        found.push(full);
      }
    }
  };
  visit(root);
  return found;
};

/**
 * Every relative import inside an installed package must land on a file the
 * tarball ships. The consumer typecheck runs with `skipLibCheck`, which is what
 * keeps third-party declaration noise out of the run but also stops TypeScript
 * from ever reporting a shipped declaration that imports a missing sibling — so
 * nothing else in this script would notice a file left out of `files`.
 */
const assertRelativeImportsResolve = (packageName: string, packageDir: string) => {
  const files = [
    ...listFiles(join(packageDir, 'dist')).filter((file) => file.endsWith('.js') || file.endsWith('.d.ts')),
    ...listFiles(join(packageDir, 'src')).filter((file) => file.endsWith('.d.ts')),
  ];
  // Nothing to walk is not a pass: it means the tarball shipped no runtime or
  // declaration files at all, which every assertion below would then skip.
  assert.ok(files.length > 0, `${packageName}: the install holds no dist or declaration files to walk`);
  let resolved = 0;
  for (const file of files) {
    const isDeclaration = file.endsWith('.d.ts');
    for (const specifier of relativeSpecifiersIn(readFileSync(file, 'utf8'))) {
      const target = resolve(dirname(file), specifier);
      // A declaration's `./x.js` is satisfied by the declaration twin; a
      // runtime file's specifier must be the file itself. It has to be a file:
      // a directory exists but Node refuses to import it.
      const exists = isDeclaration ? isFile(target.replace(/\.js$/, '.d.ts')) || isFile(target) : isFile(target);
      assert.ok(
        exists,
        `${packageName}: ${relative(packageDir, file)} imports '${specifier}', which the tarball does not ship`,
      );
      resolved += 1;
    }
  }
  return resolved;
};

const temporary = realpathSync(mkdtempSync(join(tmpdir(), `conloca-packed-${projectName}-`)));
try {
  // 1. Pack the closure. Every member is already built: this target depends on
  //    `build` and `^build`, and Nx builds transitive dependencies through the
  //    graph.
  const closure = packClosure(projectName);
  const packDir = join(temporary, 'pack');
  mkdirSync(packDir);
  const dependencies: Record<string, string> = {};
  const overrides: Record<string, string> = {};
  for (const [project, packageManifest] of closure) {
    assertPublishableExports(packageManifest.name, packageManifest.exports);
    // `overrides` pins every packed name to its tarball, which would otherwise
    // hide a dependency range the closure does not actually satisfy.
    assert.ok(
      packageManifest.version === manifest.version,
      `${packageManifest.name}@${packageManifest.version} does not match ${manifest.name}@${manifest.version}`,
    );
    const tarball = join(packDir, `${unscoped(packageManifest.name)}-${packageManifest.version}.tgz`);
    execFileSync('bun', ['pm', 'pack', '--filename', tarball, '--ignore-scripts', '--quiet'], {
      cwd: packageDirOf(project),
      stdio: 'inherit',
    });
    dependencies[packageManifest.name] = `file:${tarball}`;
    overrides[packageManifest.name] = `file:${tarball}`;
  }

  // Peers are the consumer's job to install, and the closure's peers are as
  // much the consumer's job as the packed package's own. Workspace peers are
  // closure members, installed from their tarballs above.
  const peerRanges = new Map<string, string[]>();
  for (const packageManifest of closure.values()) {
    for (const [peer, range] of Object.entries(packageManifest.peerDependencies ?? {})) {
      if (!peer.startsWith(SCOPE)) {
        peerRanges.set(peer, [...(peerRanges.get(peer) ?? []), range]);
      }
    }
  }
  // Pin peers and the typechecker to the repository's install. A peer is
  // installed for whichever closure member declares it, not necessarily for the
  // package under test, so every member is a place to look. The workspace can
  // hold several versions of one peer, and the first one found need not be one
  // the closure accepts, so a peer takes the first install that satisfies every
  // range the closure declares for it.
  const searchPaths = [
    join(repoRoot, 'package.json'),
    ...[...closure.keys()].map((project) => join(packageDirOf(project), 'package.json')),
  ].map((from) => createRequire(from));
  const manifestOf = (dependency: string, ranges: string[] = []) => {
    for (const searchPath of searchPaths) {
      let manifestPath: string;
      try {
        manifestPath = searchPath.resolve(`${dependency}/package.json`);
      } catch {
        continue;
      }
      const dependencyManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        version: string;
        main?: unknown;
      };
      if (ranges.every((range) => Bun.semver.satisfies(dependencyManifest.version, range))) {
        return { directory: dirname(manifestPath), manifest: dependencyManifest };
      }
    }
    const wanted = ranges.length > 0 ? ` at ${ranges.join(' and ')}` : '';
    throw new Error(`${dependency}: not installed${wanted} anywhere in the workspace, so the consumer cannot pin it`);
  };
  // The typechecker is resolved on its own because the check below needs where
  // it landed as well as its version.
  const typescript = manifestOf('typescript');
  dependencies.typescript = typescript.manifest.version;
  for (const [peer, ranges] of peerRanges) {
    dependencies[peer] = manifestOf(peer, ranges).manifest.version;
  }
  for (const dependency of ['@types/node', '@types/react', '@types/react-dom']) {
    dependencies[dependency] = manifestOf(dependency).manifest.version;
  }
  // The repository installs a second TypeScript under an alias — a native
  // launcher that also calls itself `typescript` — and Bun's linker can leave
  // it in the unscoped slot. Its `tsc` runs, so the consumer would typecheck
  // and report nothing amiss, with a different compiler from the one these
  // packages are published against. `lib/typescript.js` is what tells the two
  // apart, so look for the compiler entry rather than for a major that a
  // legitimate upgrade would break.
  const compilerApi = [
    typeof typescript.manifest.main === 'string' ? resolve(typescript.directory, typescript.manifest.main) : null,
    join(typescript.directory, 'lib', 'typescript.js'),
  ].find((candidate) => candidate !== null && existsSync(candidate));
  assert.ok(
    compilerApi,
    `typescript ${typescript.manifest.version} resolves to ${typescript.directory}, which ships no compiler API. ` +
      'The @typescript/native alias won the typescript slot: run bun install, then ' +
      'bun tooling/direnv/setup-environment.ts, which puts the compiler API back.',
  );

  // 2. Install into a throwaway consumer with copies, never links.
  const consumer = join(temporary, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'conloca-packed-consumer', private: true, type: 'module', dependencies, overrides }),
  );
  // A temporary consumer must not inherit the developer's global package store.
  writeFileSync(join(consumer, 'bunfig.toml'), '[install]\nlinker = "isolated"\nglobalStore = false\n');
  execFileSync('bun', ['install', '--backend=copyfile', '--ignore-scripts'], { cwd: consumer, stdio: 'inherit' });
  const installRoot = `${join(consumer, 'node_modules')}${sep}`;

  // 3. Every scope package in the install came from a packed tarball. The top
  //    level only ever lists what this script wrote there, so it cannot show a
  //    transitive package the registry supplied instead; bun's isolated store
  //    can. Its directory names read `@conloca+<name>@<descriptor>`, where the
  //    descriptor is a registry version (`0.1.16`) or the tarball's path with
  //    separators swapped for `+`, truncated and hashed. Bun truncates the tail,
  //    so this matches the temporary root the tarballs sit under rather than the
  //    exact file: enough to tell a local tarball from a registry download,
  //    which is the way a missing closure member silently slips in.
  const storeDir = join(consumer, 'node_modules', '.bun');
  const packedPrefix = temporary.replaceAll(sep, '+').slice(0, 24);
  const packedNames = new Set([...closure.values()].map((packageManifest) => unscoped(packageManifest.name)));
  const storePrefix = `${SCOPE.slice(0, -1)}+`;
  for (const entry of readdirSync(storeDir)) {
    if (!entry.startsWith(storePrefix)) {
      continue;
    }
    const separator = entry.indexOf('@', 1);
    const name = entry.slice(entry.indexOf('+') + 1, separator);
    const descriptor = entry.slice(separator + 1);
    assert.ok(packedNames.has(name), `${entry}: ${SCOPE}${name} is installed but is not a packed closure member`);
    assert.ok(
      descriptor.startsWith(packedPrefix),
      `${SCOPE}${name} was installed from ${descriptor}, not from the tarball packed for this run`,
    );
  }

  // 4. Every installed package ships the files its own code imports.
  let relativeImports = 0;
  const scopeDir = join(consumer, 'node_modules', SCOPE.slice(0, -1));
  for (const packageManifest of closure.values()) {
    const installed = realpathSync(join(scopeDir, unscoped(packageManifest.name)));
    relativeImports += assertRelativeImportsResolve(packageManifest.name, installed);
  }
  // The count is reported at the end, where a zero would read as a clean run.
  // A closure whose every member resolves nothing means the scanner stopped
  // matching, not that the packages are import-free.
  assert.ok(
    relativeImports > 0,
    'no relative import was checked anywhere in the closure, so this run proves nothing about shipped files',
  );

  // 5. Every export resolves inside the install, with the ESM semantics a
  //    modern consumer uses — `require`'s conditions would miss `import`.
  const specifiers = runtimeEntries.map(([subpath]) => specifierFor(subpath));
  const resolver = [
    `const specifiers = ${JSON.stringify(specifiers)};`,
    'const resolved = {};',
    'for (const specifier of specifiers) resolved[specifier] = import.meta.resolve(specifier);',
    'process.stdout.write(JSON.stringify(resolved));',
  ].join('\n');
  const resolved = JSON.parse(
    execFileSync('node', ['--input-type=module', '-e', resolver], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }),
  ) as Record<string, string>;
  // `realpathSync` is what proves the target is really there, but on a miss it
  // throws about a path with no hint of which export led to it.
  const realpathOf = (path: string, what: string) => {
    try {
      return realpathSync(path);
    } catch {
      throw new Error(`${what} resolves to ${path}, which the install does not contain`);
    }
  };
  for (const specifier of specifiers) {
    const url = resolved[specifier];
    assert.ok(url?.startsWith('file:'), `${specifier} did not resolve to a file (${url})`);
    const file = realpathOf(fileURLToPath(url), specifier);
    assert.ok(file.startsWith(installRoot), `${specifier} resolved outside the install: ${file}`);
  }
  // TypeScript reads an export's `types` target instead of its runtime one, so
  // every declaration an export names has to be in the install too. A
  // types-only entry has nothing else to resolve, so it must name one.
  const installedPackageDir = realpathSync(join(consumer, 'node_modules', manifest.name));
  for (const [subpath, target] of exportEntries) {
    const typesTargets = typesTargetsOf(target);
    assert.ok(isLoadable(target) || typesTargets.length > 0, `${manifest.name}: ${subpath} has no types target`);
    const specifier = specifierFor(subpath);
    for (const types of typesTargets) {
      const file = realpathOf(join(installedPackageDir, types), `${specifier} types`);
      assert.ok(file.startsWith(installRoot), `${specifier} types resolved outside the install: ${file}`);
    }
  }

  // 6. Node loads the Node-facing entries.
  const toLoad = nodeEntries === 'all' ? nodeLoadable : nodeEntries;
  for (const subpath of toLoad) {
    const specifier = specifierFor(subpath);
    execFileSync('node', ['--input-type=module', '-e', `await import(${JSON.stringify(specifier)})`], {
      cwd: consumer,
      stdio: 'inherit',
    });
  }

  // 7. A consumer typechecks under both resolution modes. A types-only export
  // contributes ambient declarations rather than a module — there is nothing to
  // import from it — so the consumer reaches it the way a real one does, with a
  // types reference. That still proves the subpath resolves through the exports
  // map and that its declarations compile. A typed stylesheet is imported for
  // its side effect, as a real consumer does, and must declare no value:
  // bundlers give a stylesheet import none, so a declared default or named
  // export would let code type-check that breaks when it runs.
  const typesOnlySubpaths = new Set(typesOnlyEntries.map(([subpath]) => subpath));
  const references = typecheckSubpaths
    .filter((subpath) => typesOnlySubpaths.has(subpath))
    .map((subpath) => `/// <reference types=${JSON.stringify(specifierFor(subpath))} />`)
    .join('\n');
  const moduleSubpaths = typecheckSubpaths.filter((subpath) => !typesOnlySubpaths.has(subpath));
  const imports = moduleSubpaths
    .map((subpath, index) => `import * as m${index} from ${JSON.stringify(specifierFor(subpath))};`)
    .join('\n');
  const stylesheetImports = typedStylesheets
    .flatMap((subpath, index) => {
      const specifier = specifierFor(subpath);
      // The failure type is a sentence, so the compiler error says what is wrong.
      const failure = JSON.stringify(`${specifier} declares a value, but a stylesheet import has none`);
      return [
        `import ${JSON.stringify(specifier)};`,
        `import * as stylesheet${index} from ${JSON.stringify(specifier)};`,
        `export const stylesheet${index}ExportsNothing: [keyof typeof stylesheet${index}] extends [never] ? true : ${failure} = true;`,
      ];
    })
    .join('\n');
  writeFileSync(
    join(consumer, 'consumer.ts'),
    `${references}\n${imports}\n${stylesheetImports}\n` +
      `export const loaded = [${moduleSubpaths.map((_, index) => `m${index}`).join(', ')}];\n`,
  );
  for (const [mode, options] of [
    ['nodenext', { module: 'nodenext', moduleResolution: 'nodenext' }],
    ['bundler', { module: 'esnext', moduleResolution: 'bundler' }],
  ] as const) {
    writeFileSync(
      join(consumer, `tsconfig.${mode}.json`),
      JSON.stringify({
        compilerOptions: {
          ...options,
          target: 'es2022',
          strict: true,
          noEmit: true,
          // Third-party declarations are not under test here, and their errors
          // would drown the ones that are.
          skipLibCheck: true,
          // With it off, TypeScript skips a side-effect import it cannot
          // resolve, so a stylesheet's missing or wrong `types` target would
          // pass unseen. Only TypeScript 6 turns it on by default.
          noUncheckedSideEffectImports: true,
          jsx: 'react-jsx',
          types: ['node'],
          lib: ['es2022', 'dom', 'dom.iterable'],
        },
        files: ['consumer.ts'],
      }),
    );
    execFileSync(
      'node',
      [join(consumer, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(consumer, `tsconfig.${mode}.json`)],
      { cwd: consumer, stdio: 'inherit' },
    );
  }

  // 8. A CLI runs from the installed binary.
  for (const binary of binaryNames) {
    execFileSync('node', [join(consumer, 'node_modules', '.bin', binary), '--help'], {
      cwd: consumer,
      stdio: 'inherit',
    });
  }
  console.log(
    `test-packed: ${manifest.name}@${manifest.version} ok (${exportEntries.length} exports, ` +
      `${toLoad.length} Node-loaded, ${relativeImports} relative imports resolved)`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
