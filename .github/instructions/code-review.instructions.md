---
applyTo: '**/*.{ts,tsx,astro,js,jsx}'
---

# Code Review Instructions for GitHub Copilot

## Critical Context: This is a Static Site Generation (SSG) Project

**Most false positives come from assuming Server-Side Rendering (SSR) instead of Static Site Generation (SSG).**

### Key Differences:

**SSG (Our Project):**

- Code runs at **BUILD TIME** (developer's machine / CI)
- Errors appear in **build logs**, not user browsers
- Output is **static HTML files** served by nginx/CDN
- No Node.js runtime in production
- `export const prerender = true` indicates SSG

**SSR (What Copilot Often Assumes):**

- Code runs at **REQUEST TIME** (production server)
- Errors happen when users visit pages
- HTTP status codes (404, 500) matter at runtime
- Node.js runs on every request

### Implications for Code Review:

**DON'T flag these as issues in SSG:**

- ❌ "All errors redirect to /404 instead of returning 500" - SSG doesn't have runtime status codes
- ❌ "Error messages displayed without sanitization" - Build-time errors only seen by developers
- ❌ "Missing error handling propagation" - Build failures are shown in logs
- ❌ "Logging to console in production" - These are build logs, not runtime logs

**DO focus on:**

- ✅ Build will fail for missing dependencies
- ✅ Content errors logged clearly for debugging
- ✅ Edge cases in static path generation

## Architecture Principles

### 1. Peer Dependency Pattern

**Pattern:** Package receives an instance as parameter, only imports the **type**

```typescript
// ✅ CORRECT - This is intentional, not a missing dependency
import type { ContentAPI } from '@conloca/content-api';

export function evaluateMDXBlocks(api: ContentAPI, locale: string) {
  // Function receives api instance from caller
  // Package does NOT have @conloca/content-api as runtime dependency
}
```

**DON'T comment:**

- ❌ "Missing dependency on @conloca/content-api"
- ❌ "Should add @conloca/content-api to dependencies"

**WHY:** Caller provides the instance (peer dependency pattern). Only the type is imported for type checking.

### 2. Type-Only Imports

```typescript
// ✅ Type-only import - doesn't create runtime dependency
import type { MDXCompileResult } from './types.js';

// ✅ Also correct - named import with type keyword
import { type ContentAPI } from '@conloca/content-api';
```

**These are NOT missing dependencies.** They're intentional type imports.

### 3. Intentional Error Handling Patterns

#### Pattern A: Build-Time Error Logging

```typescript
try {
  const data = await fetchData();
} catch (error) {
  // ✅ This is CORRECT for SSG
  console.error('[FunctionName] Context:', error);
  throw error; // Let build fail
}
```

**DON'T suggest:**

- ❌ "Should handle error gracefully"
- ❌ "Should return user-friendly error"
- ❌ "Error exposed to users"

**WHY:** Build-time errors SHOULD fail the build. Developers see them in logs.

#### Pattern B: Graceful Degradation

```typescript
try {
  blocks = Array.from(api.listAllContent({ kind: 'block' }));
} catch (error) {
  // ✅ This is CORRECT for content errors
  console.error('[evaluateMDXBlocks] Failed to list blocks:', error);
  return []; // Continue build without blocks
}
```

**DON'T suggest:**

- ❌ "Should propagate error to caller"
- ❌ "Silent error handling"

**WHY:** Missing content blocks shouldn't crash the entire build. Error is logged with context.

### 4. Logging Levels Are Already Correct

```typescript
// Expected errors (404, missing content)
console.warn(`[${pathname}] Page not found`);

// Unexpected errors (crashes, bugs)
console.error(`[${slug}] Failed to render:`, error);
console.error(`  Stack trace:`, error.stack);
```

**This is the CORRECT pattern!** Don't suggest:

- ❌ "Inconsistent logging"
- ❌ "Should use same log level"
- ❌ "Should differentiate by response code"

**WHY:** Log levels (WARN vs ERROR) differentiate expected vs unexpected. Response codes don't matter in SSG.

## Security Context

### Build-Time vs Runtime XSS

**Not a security issue:**

```typescript
// ✅ Safe - Build time, admin content, React auto-escapes
const { Component, error } = await evaluateMDXToComponent(mdxContent);
React.createElement('p', {}, error.message);
```

**WHY:**

1. Runs at **build time**, not in user browsers
2. Error messages from **trusted sources** (our API, MDX compiler)
3. `React.createElement()` **auto-escapes** text content
4. MDX content is **admin-authored** in CMS

**DO flag as security issue:**

```typescript
// ❌ Actual XSS risk - user input at runtime
<div dangerouslySetInnerHTML={{ __html: req.body.userInput }} />
```

### When to Flag Security Issues:

**✅ Flag these:**

- User input directly in DOM (runtime)
- `dangerouslySetInnerHTML` with user data
- SQL injection risks
- Exposed credentials/secrets

**❌ Don't flag these:**

- Error messages from our own code (build time)
- Admin-authored MDX content
- React.createElement with trusted content
- Console logs at build time

## Variable Scope

### Before Flagging "Variable Not Declared"

**Check carefully:**

```typescript
try {
  const api = createAPI();        // Line 49
  const locale = 'en';             // Line 51
  const pathname = slug || '/';    // Line 52 ← Declared here

  if (!found) {
    console.warn(pathname);        // Line 57 ← Used here
  }

  if (!localized) {
    console.warn(pathname);        // Line 63 ← Also used here
  }
}
```

**DON'T comment:**

- ❌ "Variable pathname not declared" (check lines above!)
- ❌ "ReferenceError: pathname is not defined"

**WHY:** Variables declared at the top of a block are available throughout that block.

### Common Scope Patterns:

**Astro frontmatter:**

```astro
---
// Entire frontmatter (between ---) is ONE scope
const a = 1;  // Line 2
const b = 2;  // Line 3
// ... 50 lines ...
console.log(a); // Line 53 - ✅ 'a' IS declared above
---
```

## Component Patterns

### Display Names (Low Priority)

```typescript
// Current code:
return function PageRendererWithBlocks() {
  return <Component />;
};
```

**DON'T suggest adding displayName:**

- ❌ Named function expressions already get displayName
- ❌ Low value for SSG (no React runtime in production)
- ❌ DevTools already show function name

**Only suggest if:**

- Using arrow functions without names
- Component truly anonymous
- High value for debugging

## Code Review Guidelines

### When to Comment

**✅ DO comment on:**

- Actual bugs (crashes, incorrect logic, data loss)
- Security vulnerabilities with user input
- Performance issues (N+1 queries, memory leaks)
- Type safety issues (actual `any` that should be typed)
- Missing error handling for truly unexpected errors

**❌ DON'T comment on:**

- Intentional architecture (peer dependencies, type-only imports)
- Build-time safety (XSS, sanitization) - not relevant to SSG
- "Missing" dependencies when using peer pattern
- Variables that ARE declared (check scope carefully)
- Graceful error handling (returning empty arrays, fallback components)
- Logging patterns that are already correct
- Code style preferences (linters handle this)
- displayName suggestions (low value)

### Severity Guidelines

**Use appropriate severity:**

- **Critical**: Will crash production, data loss, actual security vulnerability
- **High**: Logic errors, incorrect behavior, missing critical error handling
- **Medium**: Performance issues, unclear code, potential edge cases
- **Low/Nitpick**: Code style, minor suggestions, "consider" alternatives

**Important:**

- **DON'T use "nitpick" for false positives** - If it's not an issue, don't comment
- **DON'T mark SSG assumptions as critical** - Understand the context first
- **DO verify the issue exists** before commenting (read the whole function)

### Before Commenting Checklist

Ask yourself:

1. ✅ Is this **actually wrong** or just a different approach?
2. ✅ Have I checked the **whole file/function** for context?
3. ✅ Is this **SSG or SSR**? (changes everything!)
4. ✅ Is the variable **really** not declared? (checked scope?)
5. ✅ Is there **real security risk** or am I being overly cautious?
6. ✅ Does this pattern appear **intentional**? (consistent, commented, documented)
7. ✅ Would this comment **help the developer** or create noise?
8. ✅ Am I suggesting something **already implemented**?

**If unsure → Don't comment or mark as [question] instead of [issue]**

## Common False Positives from Reviews

### 1. "Missing dependency on content-api"

**What you see:**

```typescript
import type { ContentAPI } from '@conloca/content-api';
// But @conloca/content-api not in dependencies
```

**Why it's not an issue:** Peer dependency pattern - type-only import

### 2. "Error message not sanitized"

**What you see:**

```typescript
React.createElement('p', {}, error.message);
```

**Why it's not an issue:** Build-time code, React auto-escapes, trusted source

### 3. "Variable not declared"

**What you see:**

```typescript
console.warn(pathname); // Line 57
// But pathname declared on line 52
```

**Why it's not an issue:** Check scope - variable IS declared above

### 4. "Inconsistent logging"

**What you see:**

```typescript
console.warn('Page not found'); // Line 57
console.error('Failed:', error); // Line 76
```

**Why it's not an issue:** This IS consistent - warn for expected, error for unexpected

### 5. "All errors return 404"

**What you see:**

```typescript
if (!found) return Astro.redirect('/404');
catch (error) return Astro.redirect('/404');
```

**Why it's not an issue:** SSG - all failures mean "skip page". Logs differentiate the errors.

### 6. "Should return 500 for server errors"

**Why it's not an issue:** SSG doesn't have runtime status codes. Build fails instead.

### 7. "Silent error handling"

**What you see:**

```typescript
catch (error) {
  console.error(...);
  return []; // Empty array
}
```

**Why it's not an issue:** Error IS logged. Graceful degradation for content errors.

## Project-Specific Knowledge

### MDX Package Architecture

The `@conloca/mdx` package:

- Exports browser-safe code from `@conloca/mdx`
- Exports Node.js-only code from `@conloca/mdx/node`
- Uses peer dependency pattern with ContentAPI
- Does NOT depend on content-api at runtime (type-only imports)

### Error Components

Error components for content failures:

```typescript
Component = () => React.createElement('div', { className: '...' }, 'Error message');
```

This is:

- ✅ Safe (React auto-escapes)
- ✅ Intentional (helps developers debug)
- ✅ Build-time only (users never see it)

### Logging Pattern

Structured logging with context:

```typescript
console.error(`[FunctionName] What failed:`, error);
```

**Don't suggest removing logs** - they're intentional for debugging builds.

## Summary

### Golden Rules:

1. **Understand SSG vs SSR** - Most false positives come from this confusion
2. **Read the whole function** - Don't flag variables that ARE declared
3. **Check if intentional** - Peer dependencies, type imports are by design
4. **Verify severity** - Don't mark false positives as critical
5. **When in doubt, don't comment** - Better to miss a minor issue than create noise

### Good Comment Example:

```
[High] The function modifies the array in-place while iterating, which will
skip elements. Use Array.filter() instead.
```

### Bad Comment Examples:

```
❌ [nitpick] Missing dependency on @conloca/content-api
   → It's a type-only import (peer dependency)

❌ [medium] Should return 500 for server errors instead of 404
   → This is SSG, not SSR. Build-time errors only.

❌ [low] Variable pathname is not declared
   → It IS declared on line 52, check scope carefully
```

### When You've Helped:

You've provided a valuable code review when:

- ✅ You found an actual bug or security issue
- ✅ You improved code clarity or performance
- ✅ You caught an edge case the developer missed
- ✅ Your comment teaches something useful

You haven't helped when:

- ❌ You flagged intentional architecture as bugs
- ❌ You made assumptions without checking context
- ❌ You suggested what's already implemented
- ❌ You confused SSG with SSR patterns
