import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { Node, type Project, type SourceFile, SyntaxKind, ts, VariableDeclarationKind } from 'ts-morph';
import { createScanProject } from '../discovery/extract-props-ts.js';
import {
  excerpt,
  holdsNothing,
  type LiteralWalk,
  type LiteralWalkHooks,
  limitOutput,
  mayHoldUnread,
  namedMember,
  OutputBudgetExceeded,
  type UnreadWrite,
  unwrapExpression,
  WorkBudgetExceeded,
  walkIsWhole,
  walkLiteral,
  withReadingSession,
} from './literal.js';
import { readFieldSet } from './read-field.js';
import {
  type ComponentReading,
  callsDeclaredFunction,
  readComponentWithSpreads,
  readWrapperCall,
  readWrapperCallReading,
  type SpreadReading,
} from './read-wrapper.js';
import { lookUpKey, resolveCallExpression, resolveLiteralValue, resolveObjectLiteral } from './resolve-reference.js';
import type { JsonValue, PuckManifest } from './types.js';

export interface ReadPuckConfigOptions {
  /** Absolute path of the site's puck config (conlocaCMS `puckConfigPath`). */
  configPath: string;
  /**
   * Host tsconfig, so path aliases like `@/components` resolve.
   *
   * Left out, the nearest `tsconfig.json` above the config is used instead —
   * which matters more than it sounds. Real configs are `.tsx`, and a project
   * with no `jsx` option resolves a relative import of a `.tsx` file to nothing
   * at all, with no error: the config would read as every component
   * unresolved, silently.
   */
  tsConfigFilePath?: string;
}

/**
 * Reads a site's Puck config into a manifest, from source and without
 * executing it.
 *
 * Everything unreadable is named rather than dropped: a component whose
 * definition cannot be followed lands in `unresolved`, so an agent is told what
 * it does not know instead of being handed a component that appears to accept
 * nothing.
 *
 * A config that cannot be read at all — no file to open, a file it loads that
 * does not parse, no default export, a default export that is not an object this reader
 * can follow — is refused as a whole with the reason, and so is one that would
 * cost more to read, or produce a bigger manifest, than the reader allows:
 * refused, never read or sent in part.
 *
 * Never throws. A reading that fails in a way nothing above anticipates is
 * refused too, with the error it stopped on as the reason: the caller serves
 * this manifest, and a config it cannot read is an answer, not a crash.
 */
export function readPuckConfig(options: ReadPuckConfigOptions): PuckManifest {
  return withReadingSession(() => {
    try {
      const manifest = readConfigFile(options);
      limitOutput(manifest);
      return manifest;
    } catch (error) {
      return refusal(stoppedReason(error));
    }
  });
}

/**
 * Why a reading that threw is refused. A budget says what it measured; any
 * other error is quoted as it is, because the reader cannot tell a fault of
 * its own from a limit of the runtime it runs on — except the call stack,
 * which source nested thousands of levels deep runs out of, and says so.
 */
function stoppedReason(error: unknown): string {
  if (error instanceof WorkBudgetExceeded || error instanceof OutputBudgetExceeded) return error.message;
  const quoted = excerpt(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  const stack = error instanceof RangeError && /call stack/i.test(error.message);
  return stack
    ? `reading the config ran out of call stack (${quoted}) — usually source nested thousands of levels deep — so its components are unknown`
    : `reading the config stopped on an error (${quoted}), so its components are unknown`;
}

/** A config refused as a whole: no component names to report, so the manifest carries the gap and its reason. */
function refusal(reason: string): PuckManifest {
  return { components: {}, unresolved: [], unreadable: true, unreadableReason: reason };
}

function readConfigFile(options: ReadPuckConfigOptions): PuckManifest {
  const manifest: PuckManifest = { components: {}, unresolved: [] };

  const project = createScanProject(options.tsConfigFilePath ?? nearestTsConfig(dirname(options.configPath)));
  // A project whose options say nothing about `jsx` resolves an import of a
  // `.tsx` file to nothing at all and reports no error — every component would
  // read as unresolved with nothing to explain why. Reachable from three
  // directions: no tsconfig, one that cannot be parsed, and one that simply
  // never mentions jsx. Set before the first file is added, because changing
  // compiler options reparses everything already in the project.
  if (project.compilerOptions.get().jsx === undefined) {
    project.compilerOptions.set({ jsx: ts.JsxEmit.Preserve });
  }

  let file: SourceFile;
  try {
    file = project.addSourceFileAtPath(options.configPath);
  } catch (error) {
    // An unreadable path is a missing config, not a crash in the caller. A
    // file that IS there and still would not open — nested deeper than the
    // parser's call stack goes — is not missing, and is refused for what
    // stopped it.
    if (isFile(options.configPath)) throw error;
    return refusal(
      'the config file could not be opened: it is missing, or its path is not a file this reader can read',
    );
  }
  const directory = dirname(options.configPath);
  // A file that does not parse fails to load, however much of it the parser
  // recovers into something this reader could otherwise read.
  const broken = syntaxError(project.getProgram().compilerObject, file.compilerNode, directory);
  if (broken) return refusal(`the config file, ${broken}, so it fails to load and its components are unknown`);

  const exported = defaultExport(file);
  if (typeof exported === 'string') return refusal(exported);
  // The file is there and its config is not: `export default defineConfig(…)`.
  const configObject = resolveObjectLiteral(exported);
  if (!configObject) {
    return refusal(
      `the config's default export, ${excerpt(exported.getText())}, ${whyNotFollowed(exported)}, so its components are unknown`,
    );
  }

  // The config is walked by the same rules as every literal in it: `{
  // ...base, components: … }` reads base's categories and root, and the last
  // write of a key is the one Puck gets.
  const config = walkLiteral(configObject, CONFIG_KEYS);

  const components = configKey(config, 'components');
  if (components === 'unknown') {
    manifest.unreadable = true;
    manifest.unreadableReason = `${unknownComponentsReason(config)}, so its components are unknown`;
  } else if (components !== 'absent') readComponents(components, manifest);

  const categories = configKey(config, 'categories');
  if (categories === 'unknown') manifest.categoriesUnreadable = true;
  else if (categories !== 'absent') readCategories(categories, manifest);

  const root = configKey(config, 'root');
  if (root === 'unknown') manifest.root = { fields: {}, fieldsUnreadable: true };
  else if (root !== 'absent') {
    const read = readRoot(root);
    if (read) manifest.root = read;
  }

  // A module the reading went through that does not parse fails to load, and
  // takes the config down with it — whatever the parser recovered of it.
  const brokenImport = brokenModule(project, directory);
  if (brokenImport) {
    return refusal(
      `a module the config loads, ${brokenImport}, so the config fails to load and its components are unknown`,
    );
  }
  return manifest;
}

/** The config's own keys, each handed over as the node its last write assigns — spreads followed to the literal they name. */
const CONFIG_KEYS: LiteralWalkHooks<Node> = {
  kind: 'config',
  read: (value) => value,
  spread: (expression) => resolveObjectLiteral(expression),
};

/**
 * What the config provably says about one of its keys: the node its last
 * write assigns; `absent` where nothing writes it — or the write holds nothing,
 * as `root: undefined` does; or `unknown` where a write this reader cannot read
 * may be it — a getter, a spread or a computed name it cannot follow, a
 * prototype.
 */
function configKey(config: LiteralWalk<Node>, key: string): Node | 'absent' | 'unknown' {
  const value = config.entries.get(key);
  if (value) return holdsNothing(value) ? 'absent' : value;
  return mayHoldUnread(config, key) ? 'unknown' : 'absent';
}

/** Whether a path names a file that is there — as opposed to nothing, or a directory. */
function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
}

/**
 * Where a file fails to parse, as a reason names it — `Hero.ts, has a syntax
 * error at line 3 (',' expected)` — or undefined when it parses. The path is
 * taken from the config's directory. Only the parser is asked, which costs
 * nothing the reading would not pay anyway.
 */
function syntaxError(program: ts.Program, file: ts.SourceFile, directory: string): string | undefined {
  const [first] = program.getSyntacticDiagnostics(file);
  if (!first) return undefined;
  const message = ts.flattenDiagnosticMessageText(first.messageText, ' ');
  const line = file.getLineAndCharacterOfPosition(first.start).line + 1;
  return `${relative(directory, file.fileName)}, has a syntax error at line ${line} (${excerpt(message)})`;
}

/**
 * The first file the reading loaded that does not parse, named as
 * `syntaxError` names it. Only syntax counts — a type error still loads — and
 * declaration files and packages are left out: neither is the site's source.
 */
function brokenModule(project: Project, directory: string): string | undefined {
  const program = project.getProgram().compilerObject;
  for (const file of program.getSourceFiles()) {
    const external = program.isSourceFileFromExternalLibrary(file) || file.fileName.includes('/node_modules/');
    if (file.isDeclarationFile || external) continue;
    const broken = syntaxError(program, file, directory);
    if (broken) return broken;
  }
  return undefined;
}

/**
 * The node the config's default export is written as — the expression of
 * `export default …`, or the name `export { config as default }` and `export
 * { default } from './real'` hand over — or the reason there is none this
 * reader can read.
 *
 * The default exports are counted from the statements rather than asked of
 * the compiler, which keeps the first of two and says nothing of the second:
 * a module with two does not load at all.
 */
function defaultExport(file: SourceFile): Node | string {
  const written = file.getStatements().flatMap(defaultExportsOf);
  if (written.length > 1) {
    const lines = written.map((declaration) => declaration.getStartLineNumber()).join(' and ');
    return `the config file has ${written.length} default exports, on lines ${lines}, and a module with more than one fails to load, so its components are unknown`;
  }
  const [declaration] = written;
  if (!declaration) {
    return file.getExportAssignment((node) => node.isExportEquals())
      ? 'the config file exports with `export =`, which this reader does not read as a default export, so its components are unknown'
      : 'the config file has no default export, so there is no config to read';
  }
  if (Node.isExportAssignment(declaration)) return declaration.getExpression();
  if (Node.isExportSpecifier(declaration)) return declaration.getNameNode();
  if (Node.isExportDeclaration(declaration)) {
    return "the config's default export is a module namespace, which this reader does not read, so its components are unknown";
  }
  const kind = Node.isClassDeclaration(declaration) ? 'a class' : 'a function';
  return `the config's default export is ${kind}, not an object written out in the source, so its components are unknown`;
}

/**
 * The default exports one statement makes that exist at runtime. An overload
 * signature and a type-only export make none — a function's overloads are one
 * function, its body — and `export =` is no default export. `export * as
 * default from './real'` makes one: the module's namespace.
 */
function defaultExportsOf(statement: Node): Node[] {
  if (Node.isExportAssignment(statement)) return statement.isExportEquals() ? [] : [statement];
  if (Node.isFunctionDeclaration(statement) || Node.isClassDeclaration(statement)) {
    const signatureOnly = Node.isFunctionDeclaration(statement) && !statement.hasBody();
    return statement.isDefaultExport() && !signatureOnly && !statement.hasDeclareKeyword() ? [statement] : [];
  }
  if (!Node.isExportDeclaration(statement) || statement.isTypeOnly()) return [];
  const namespace = statement.getNamespaceExport();
  if (namespace && exportName(namespace.getNameNode()) === 'default') return [statement];
  return statement.getNamedExports().filter((specifier) => {
    const exported = specifier.getAliasNode() ?? specifier.getNameNode();
    return exportName(exported) === 'default' && !specifier.isTypeOnly();
  });
}

/** The name an export is made under, written as a name or — `export { x as 'default' }` — a string. */
function exportName(name: Node): string {
  return Node.isStringLiteral(name) ? name.getLiteralValue() : name.getText();
}

/**
 * Why a node that was to lead to an object does not, as the clause a reason
 * puts after quoting it. What this reader can tell apart is named — a call, a
 * name it cannot find, a `let` — and anything else is admitted plainly, never
 * guessed at.
 */
function whyNotFollowed(node: Node): string {
  const expression = unwrapExpression(node);
  if (Node.isCallExpression(expression)) return "is a call's result, which this reader would have to run to know";
  const identifier = expression.asKind(SyntaxKind.Identifier);
  if (identifier) {
    const declarations = declarationsOf(identifier);
    if (declarations.length === 0) {
      return 'names nothing this reader can find — an import it cannot resolve, or a global';
    }
    const letOrVar = declarations.some(
      (declaration) =>
        Node.isVariableDeclaration(declaration) &&
        declaration.getVariableStatement()?.getDeclarationKind() !== VariableDeclarationKind.Const,
    );
    if (letOrVar)
      return 'is declared with let or var, and what it holds when Puck reads it may not be what is written there';
  }
  return 'is not an object written out in the source or a name this reader can follow to one';
}

/** How many imports and re-exports `declarationsOf` follows before it gives up. */
const MAX_ALIAS_HOPS = 5;

/** The declarations a name stands for, across imports and re-exports; none when it stands for nothing this reader can find. */
function declarationsOf(identifier: Node): Node[] {
  // A shorthand's name is a property to the checker; the value it stands for
  // is a symbol of its own.
  const shorthand = identifier.getParentIfKind(SyntaxKind.ShorthandPropertyAssignment);
  let symbol = shorthand?.getNameNode() === identifier ? shorthand.getValueSymbol() : identifier.getSymbol();
  for (let hop = 0; symbol?.isAlias() && hop < MAX_ALIAS_HOPS; hop++) symbol = symbol.getAliasedSymbol();
  return symbol?.getDeclarations() ?? [];
}

/**
 * Why the config's `components` key is unknown: what writes it may be code, or
 * a write this reader cannot name, or a prototype.
 */
function unknownComponentsReason(config: LiteralWalk<Node>): string {
  const unread = config.unread.get('components');
  if (unread === 'code')
    return 'the config declares components with a getter or a method, whose code this reader does not run';
  if (unread === 'setter')
    return 'the config writes components last with a setter, which reads back as undefined — or, beside a getter, runs code this reader does not run';
  if (config.lost) return `${unnamedWrite(config, 'the config')}, and it may set the components map`;
  return 'the config sets its prototype with __proto__, and the components map may be inherited through it';
}

/**
 * The write a walk could not name, as a reason puts it: the spread it could
 * not follow — or that led to one it could not — or the computed name it could
 * not work out.
 */
function unnamedWrite(walk: LiteralWalk<unknown>, owner: string): string {
  const spread = walk.lostAt?.asKind(SyntaxKind.SpreadAssignment);
  if (spread)
    return `${owner} spreads ${excerpt(spread.getExpression().getText())}, which this reader cannot follow to the keys it writes`;
  const name = walk.lostAt && namedMember(walk.lostAt)?.getNameNode();
  if (name)
    return `${owner} writes a key under a computed name, ${excerpt(name.getText())}, that this reader cannot work out`;
  return `${owner} writes a key this reader cannot name`;
}

/**
 * The nearest `tsconfig.json` at or above a directory. Absent one, the caller
 * falls back to permissive defaults, which is the best that can be done for a
 * project that has no TypeScript config of its own.
 */
function nearestTsConfig(fromDirectory: string): string | undefined {
  let directory = fromDirectory;
  for (;;) {
    const candidate = join(directory, 'tsconfig.json');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

/** Why a name is admitted when a later write the components map cannot name may have replaced it. */
const MAY_BE_REPLACED =
  'a later entry of the components map — a spread or a computed name this reader cannot follow — may replace this component';

/**
 * Why a name is admitted when the components map declares it in a shape that
 * carries no value to read. `['__proto__']` has no reason: none can be recorded
 * under that name, and `value` never arises — every definition reads as a
 * component or a reason of its own.
 */
function unreadReason(why: UnreadWrite): string | undefined {
  switch (why) {
    case 'code':
      return 'the components map declares it with a getter or a method, whose code this reader does not run';
    case 'setter':
      return 'the components map writes it last with a setter, which reads back as undefined — or, beside a getter, runs code this reader does not run';
    default:
      return undefined;
  }
}

/**
 * Reads the `components` map, whether it is written in the config, named
 * (`components: siteComponents`) or handed over as a shorthand.
 *
 * A map that cannot be followed at all leaves no names behind to report, so the
 * manifest itself is marked unreadable — the difference between a site with no
 * components and a site whose components this reader could not see.
 *
 * The map is walked by the runtime's own rules, spreads merged where they sit
 * and the last entry for a name winning. A later write the walk cannot name —
 * `[name]: …`, `...buildComponents()` — may replace any component written
 * before it, so those move to `unresolved` with that reason, and may add
 * components no name here reveals, so the manifest is marked unreadable too; so
 * does a prototype, through which Puck looks a component up as well.
 */
function readComponents(node: Node, manifest: PuckManifest): void {
  const literal = resolveObjectLiteral(node);
  if (!literal) {
    manifest.unreadable = true;
    manifest.unreadableReason = `the config's components map, ${excerpt(node.getText())}, ${whyNotFollowed(node)}, so its components are unknown`;
    return;
  }

  const walk = walkLiteral(literal, COMPONENT_ENTRIES);
  for (const [name, { component, reason }] of walk.entries) {
    if (component) manifest.components[name] = component;
    else admitComponent(manifest, name, reason);
  }
  for (const [name, why] of walk.unread) admitComponent(manifest, name, unreadReason(why));
  for (const name of walk.cleared) admitComponent(manifest, name, MAY_BE_REPLACED);
  if (walk.lost || walk.inherits) {
    manifest.unreadable = true;
    manifest.unreadableReason = walk.lost
      ? `${unnamedWrite(walk, 'the components map')}, so it may declare components not listed here`
      : 'the components map sets its prototype with __proto__, and Puck finds components through it too, so it may declare components not listed here';
  }
}

/** The components map's entries, each read as a definition — `components: { ...shared, Badge: … }` inlines a second map. */
const COMPONENT_ENTRIES: LiteralWalkHooks<ComponentReading> = {
  kind: 'components map',
  read: (value) => resolveComponentDefinition(value),
  spread: (expression) => resolveObjectLiteral(expression),
};

/** Names a component in `unresolved`, with the reason where one is known. */
function admitComponent(manifest: PuckManifest, name: string, reason: string | undefined): void {
  manifest.unresolved.push(name);
  // `__proto__` would replace the record's prototype rather than add a reason.
  if (!reason || name === '__proto__') return;
  manifest.unresolvedReasons ??= {};
  manifest.unresolvedReasons[name] = reason;
}

/**
 * A component definition reached through a name or written in place: the
 * resolved literal read with its spreads applied, or — when the name stands for
 * a wrapper call — the wrapper's symbolic reading. The reason, when set, names
 * the refusing rule for the manifest.
 *
 * One walker reads both, in source order and by the runtime's own rules, so a
 * component written `{ ...Grid, label: … }` in the config means here exactly
 * what it means inside a wrapper body.
 */
function resolveComponentDefinition(node: Node): ComponentReading {
  const literal = resolveObjectLiteral(node);
  if (literal) return readComponentWithSpreads(literal, wrapperBuiltSpread);
  const call = resolveCallExpression(node);
  return call ? readWrapperCall(call) : {};
}

/**
 * The one spread source the walker cannot reach as text: a name standing for a
 * wrapper CALL. Both of our own configs rename wrapper-built components this
 * way — `Grid: { ...Grid, label: … }` — and the override literal on its own is
 * a label and no fields, so reported as the component it would claim the
 * component accepts nothing.
 *
 * Only a call to a function declared in the source is a wrapper. `...mk()`
 * with `mk` nowhere to be found is a spread that cannot be followed, and the
 * walker's own reason says so; the wrapper reader's would blame a wrapper the
 * config never wrote.
 */
function wrapperBuiltSpread(expression: Node): SpreadReading {
  const call = resolveCallExpression(expression);
  return call && callsDeclaredFunction(call) ? readWrapperCallReading(call) : {};
}

/** One category, as the manifest carries it. */
type Category = NonNullable<PuckManifest['categories']>[string];

/** One category entry read: what it provably declares, and whether any of the part the manifest carries went unread. */
interface CategoryReading {
  category?: Category;
  admitted: boolean;
}

/** A category's own keys: values followed to the `const` they name, spreads to the literal they name. */
const CATEGORY_KEYS: LiteralWalkHooks<JsonValue> = {
  kind: 'category',
  read: (value) => resolveLiteralValue(value),
  spread: (expression) => resolveObjectLiteral(expression),
};

/**
 * Sidebar grouping, walked by the runtime's own rules. A category that cannot
 * be read — or whose name cannot be — is left out and admitted with
 * `categoriesUnreadable`, as is any other part of the value the walk could not
 * see, so a missing category is never mistaken for one the config lacks.
 */
function readCategories(node: Node, manifest: PuckManifest): void {
  const literal = resolveObjectLiteral(node);
  if (!literal) {
    manifest.categoriesUnreadable = true;
    return;
  }
  const walk = walkLiteral(literal, CATEGORY_ENTRIES);

  const categories: [string, Category][] = [];
  let admitted = !walkIsWhole(walk);
  for (const [name, reading] of walk.entries) {
    if (reading.admitted) admitted = true;
    if (reading.category) categories.push([name, reading.category]);
  }
  manifest.categories = Object.fromEntries(categories);
  if (admitted) manifest.categoriesUnreadable = true;
}

/**
 * One category. One whose component list is provably never written says
 * nothing and is left out; one whose list or title may be written but could
 * not be read is admitted — the list by leaving the category out, the title by
 * listing the category without it.
 */
/** The categories map's entries, each read as a category; a spread inlines a second map. */
const CATEGORY_ENTRIES: LiteralWalkHooks<CategoryReading> = {
  kind: 'categories',
  read: (value) => readCategory(value),
  spread: (expression) => resolveObjectLiteral(expression),
};

function readCategory(node: Node): CategoryReading {
  const literal = resolveObjectLiteral(node);
  if (!literal) return { admitted: true };
  const walk = walkLiteral(literal, CATEGORY_KEYS);

  const components = walk.entries.get('components');
  if (!isStringList(components)) {
    return { admitted: components !== undefined || mayHoldUnread(walk, 'components') };
  }
  const title = walk.entries.get('title');
  if (typeof title === 'string') return { category: { title, components }, admitted: false };
  return { category: { components }, admitted: title !== undefined || mayHoldUnread(walk, 'title') };
}

function isStringList(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Page-level fields, which Puck declares as a component in all but name. The
 * `fields` key is looked up by the runtime's rule — the last write wins,
 * spreads included — and a write that may be it but cannot be read admits the
 * set rather than reporting a page with no fields. A root that cannot be read
 * at all — `root: buildRoot()` — is admitted the same way, because it may
 * declare page fields too.
 */
function readRoot(node: Node): PuckManifest['root'] {
  const literal = resolveObjectLiteral(node);
  if (!literal) return { fields: {}, fieldsUnreadable: true };

  const written = lookUpKey(literal, 'fields');
  if (written === 'absent') return undefined;
  const set = written === 'unknown' ? undefined : readFieldSet(written);
  if (!set) return { fields: {}, fieldsUnreadable: true };
  return set.unreadable ? { fields: set.fields, fieldsUnreadable: true } : { fields: set.fields };
}

/**
 * The dev endpoint's response body. Kept beside the reader so the dev route
 * and a build that publishes the manifest serialize identically — one JSON
 * shape, one place.
 */
export function componentsEndpointBody(options: ReadPuckConfigOptions): string {
  return JSON.stringify(readPuckConfig(options));
}
