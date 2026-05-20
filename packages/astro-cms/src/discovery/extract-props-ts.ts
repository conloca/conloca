/**
 * TypeScript-aware extraction of a component's `Props` interface,
 * replacing the regex-based path in `scan-components.ts`. Uses
 * `ts-morph` (a thin wrapper over the TypeScript compiler API) so
 * derived types — `(typeof asideVariants)[number]`, mapped types,
 * imported aliases, conditional types — resolve to their concrete
 * literal-union values. The regex scanner couldn't follow any
 * indirection and silently dropped options for those props (Aside's
 * `type` being the canonical example).
 *
 * The output shape is identical to the regex path (`ParsedProp[]`)
 * so the rest of the discovery pipeline doesn't change.
 *
 * Astro files are handled by extracting the frontmatter block and
 * feeding it to the Project as a virtual `.ts` source — see
 * `extractAstroFrontmatter` in `astro-frontmatter.ts`.
 */

import {
  type InterfaceDeclaration,
  ModuleKind,
  ModuleResolutionKind,
  Project,
  type PropertySignature,
  ScriptTarget,
  type SourceFile,
  type Type,
  type TypeAliasDeclaration,
  type TypeLiteralNode,
} from 'ts-morph';
import type { ParsedProp } from './scan-components.js';

/**
 * One Project per scan run, reused across `extractPropsViaTs` calls
 * within the same scan. Building the Project loads `lib.dom.d.ts`
 * etc. which dominates cold-start cost (~500ms-2s); sharing across
 * files in a scan amortises that. A fresh Project is built per scan
 * run so file changes are picked up — ts-morph's `addSourceFile`
 * caches by path and wouldn't see external edits otherwise.
 */
export function createScanProject(tsConfigFilePath?: string): Project {
  // When the host has a tsconfig, use it — that's how cross-file
  // `typeof` refs and path mappings (`@/foo`) resolve. Without one,
  // fall back to permissive defaults that still handle the common
  // shapes (literal unions inside a single file, simple imports).
  if (tsConfigFilePath) {
    try {
      return new Project({
        tsConfigFilePath,
        // Add files explicitly per scan; don't auto-load every file
        // referenced by tsconfig.include — that would slow scans on
        // big projects.
        skipAddingFilesFromTsConfig: true,
      });
    } catch {
      // tsconfig parse failure — fall through to defaults
    }
  }
  return new Project({
    compilerOptions: {
      target: ScriptTarget.ES2022,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
      allowJs: true,
      esModuleInterop: true,
      skipLibCheck: true,
      strict: false,
    },
    skipAddingFilesFromTsConfig: true,
  });
}

/**
 * Extract the Props interface from a source string and return the
 * parsed prop list. `filepath` is used as the virtual file's path
 * inside the Project so error messages and source-map debugging
 * point back at the right file; the actual content comes from
 * `sourceText`. `.astro` callers pass the extracted frontmatter as
 * `sourceText` and `${filepath}.virtual.ts` as `filepath`.
 *
 * Returns `[]` when no Props interface is found — same contract as
 * the regex path so callers don't need a special-case branch.
 */
export function extractPropsViaTs(
  project: Project,
  filepath: string,
  sourceText: string,
  componentName?: string,
): ParsedProp[] {
  let sf: SourceFile;
  try {
    sf = project.createSourceFile(filepath, sourceText, { overwrite: true });
  } catch (err) {
    // Source parse failure — eg the .astro frontmatter contained
    // syntax the TS compiler rejected (rare; most front-matter is
    // valid TS). Return empty so the merge layer can still surface
    // the component, just without prop schema.
    console.warn(`[conloca:ts-morph] parse failed for ${filepath}:`, err instanceof Error ? err.message : err);
    return [];
  }

  // Try `${ComponentName}Props` first (matches the convention
  // `interface CardProps {...}` used by some libraries), then the
  // bare `Props` name (Astro components and most React components).
  // Try interface declarations first, then type aliases — same
  // priority the regex scanner used.
  const candidates: string[] = [];
  if (componentName) candidates.push(`${componentName}Props`);
  candidates.push('Props');

  let propertySignatures: PropertySignature[] = [];
  for (const name of candidates) {
    const iface = sf.getInterface(name);
    if (iface) {
      propertySignatures = collectLocalProperties(iface);
      break;
    }
    const alias = sf.getTypeAlias(name);
    if (alias) {
      propertySignatures = collectAliasProperties(alias);
      break;
    }
  }
  if (propertySignatures.length === 0) {
    project.removeSourceFile(sf);
    return [];
  }

  const props: ParsedProp[] = [];
  for (const prop of propertySignatures) {
    const name = prop.getName();
    // `getType()` on the PropertySignature node resolves at the
    // declaration site — this is where `(typeof X)[number]` collapses
    // to its literal union, generics expand, conditional types branch.
    const type = prop.getType();
    const required = !prop.hasQuestionToken();
    props.push(parseType(name, type, required));
  }

  // Clean up the virtual source file so successive calls in the
  // same scan don't accumulate sources and bloat memory.
  project.removeSourceFile(sf);

  return props;
}

/**
 * Get ONLY the locally-declared properties on an interface, NOT
 * properties inherited from `extends` clauses. This is the key choice
 * that keeps the side panel sane for components like Starlight's
 * `LinkCard` which declares `extends Omit<HTMLAttributes<'a'>, 'title'>`:
 * the type-level `Type.getProperties()` would include every HTML
 * attribute (~200 entries — `accesskey`, `aria-*`, `on*`, etc), making
 * the panel useless. The declaration-level `iface.getProperties()`
 * returns just the props the author explicitly wrote inside the
 * braces, which is the editor's intent.
 *
 * Trade-off: a property the author "overrides" via re-declaration
 * (eg LinkCard's local `title: string` overriding the inherited
 * `title?: string`) appears — good. A property the author NEVER
 * declared locally but the inherited interface defines (eg `href`
 * inherited from HTMLAttributes) does NOT appear — also good, the
 * panel stays focused on what the author wanted to expose. Hosts
 * who want a specific inherited prop surfaced can re-declare it
 * locally or use the sidecar `cmsConfig.props` override.
 */
function collectLocalProperties(iface: InterfaceDeclaration): PropertySignature[] {
  // PropertySignature[] — only what's between this interface's own
  // braces. Inherited properties from `extends` aren't included.
  return iface.getProperties();
}

/**
 * Type-alias variant. For `type Props = { ... }`, the declaration
 * node is a TypeLiteralNode and we read its own member list. For
 * intersections (`type Props = A & { ... }`) or imported aliases,
 * we get an empty list rather than walking into the constituent
 * types — same author-intent rationale as the interface case.
 */
function collectAliasProperties(alias: TypeAliasDeclaration): PropertySignature[] {
  const node = alias.getTypeNode();
  // ts-morph's `asKind(SyntaxKind.TypeLiteral)` would narrow this
  // cleanly, but we only need the duck-typed check that the node
  // exposes `getMembers()`. A type literal does; an intersection or
  // imported reference doesn't — those return an empty list and the
  // alias is skipped by the caller.
  const members = (node as TypeLiteralNode | undefined)?.getMembers?.();
  if (!members) return [];
  return members.filter((m): m is PropertySignature => m.getKindName() === 'PropertySignature');
}

/**
 * Map a resolved `Type` to a `ParsedProp`. Mirrors the kind of
 * branching the old regex did, but on real type information.
 */
function parseType(name: string, type: Type, required: boolean): ParsedProp {
  if (type.isString()) return { name, type: 'string', required };
  if (type.isNumber()) return { name, type: 'number', required };
  if (type.isBoolean()) return { name, type: 'boolean', required };

  if (type.isUnion()) {
    const members = type.getUnionTypes();
    // Filter out `undefined` (added by the compiler for `?` props
    // under strictNullChecks). The remaining members tell us what
    // the prop actually accepts.
    const nonUndefined = members.filter((m) => !m.isUndefined());

    // All-boolean-literal union (`true | false`, or even `true` alone,
    // or `false` alone) → boolean. Under strict mode, `boolean` is
    // canonicalised by the checker into the union `true | false`, so
    // `isBoolean()` on the original type returns false — we have to
    // detect the expanded form. This is the path that catches eg
    // CardGrid's `stagger?: boolean` (resolved as `true | false |
    // undefined`).
    if (nonUndefined.length > 0 && nonUndefined.every((m) => m.isBooleanLiteral() || m.isBoolean())) {
      return { name, type: 'boolean', required };
    }

    // String-literal union → string prop with `options`. Even when
    // the union also includes a non-literal `string`, surface the
    // literals as picker suggestions.
    const stringLiterals = nonUndefined
      .filter((m) => m.isStringLiteral())
      .map((m) => m.getLiteralValue())
      .filter((v): v is string => typeof v === 'string');
    if (stringLiterals.length > 0) {
      return { name, type: 'string', required, options: stringLiterals };
    }

    // Single non-undefined primitive after stripping the optional
    // undefined — eg `string | undefined` collapses to `string`.
    if (nonUndefined.length === 1) {
      const only = nonUndefined[0];
      if (only.isString()) return { name, type: 'string', required };
      if (only.isNumber()) return { name, type: 'number', required };
      if (only.isBoolean()) return { name, type: 'boolean', required };
      if (only.isStringLiteral()) {
        const v = only.getLiteralValue();
        return { name, type: 'string', required, options: typeof v === 'string' ? [v] : undefined };
      }
    }
  }

  if (type.isStringLiteral()) {
    const v = type.getLiteralValue();
    return { name, type: 'string', required, options: typeof v === 'string' ? [v] : undefined };
  }
  if (type.isBooleanLiteral()) {
    return { name, type: 'boolean', required };
  }

  // Anything else — function types, object types, branded types,
  // arrays, Records — render as a free-form expression input.
  return { name, type: 'expression', required };
}
