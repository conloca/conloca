# React Testing with Bun - Best Practices

## Setup

1. **Dependencies**: `bun add -d @happy-dom/global-registrator @testing-library/react @testing-library/jest-dom`
2. **Configure** `bunfig.toml`: `[test] preload = ["./test-setup.ts"]`
3. **test-setup.ts** (exact order matters):

```typescript
// This file will be loaded by Bun before running tests
import { expect, mock } from 'bun:test';
import * as matchers from '@testing-library/jest-dom/matchers';
import React from 'react';

// Set up DOM environment
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();

// Extend Bun's expect with jest-dom matchers
expect.extend(matchers);

// Mock problematic React components
// - Example: render Radix UI Portal inline for testing
mock.module('@radix-ui/react-portal', () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));
```

⚠️ **CRITICAL**: Add `afterEach(() => cleanup())` in EACH test file, NOT in setup.ts (breaks `screen` export)

## The Golden Rules

### 1. ALWAYS Use data-testid

```tsx
// Component
<div data-testid="dashboard-loading">Loading...</div>
<button data-testid="submit-button">Submit</button>

// Test
const button = await findByTestId('submit-button'); // ✅ Stable
const button = await findByText('Submit'); // ❌ Breaks if text changes
```

### 2. Use findBy for Element Appearance, waitFor for Complex Assertions

```typescript
// ✅ GOOD - Use findBy when waiting for elements to appear
const content = await findByTestId('content');
const button = await findByRole('button', { name: /submit/i });

// ✅ GOOD - Use waitFor for complex assertions or multiple conditions
await waitFor(() => {
  expect(mockFunction).toHaveBeenCalledWith('expected-arg');
  expect(screen.queryByTestId('loading')).not.toBeInTheDocument();
});

// ❌ WRONG - Don't put actions inside waitFor
await waitFor(() => {
  fireEvent.click(screen.getByRole('button')); // This will click repeatedly!
});

// ✅ CORRECT - Find element first, then click
const button = await screen.findByRole('button', { name: /delete/i });
fireEvent.click(button);

// ❌ EXTREMELY SLOW - waitFor with null check can take 1.7+ seconds!
await waitFor(() => {
  expect(screen.queryByText('Block to Delete')).toBeNull();
});

// ✅ FAST - waitForElementToBeRemoved takes only milliseconds
await waitForElementToBeRemoved(() => screen.queryByText('Block to Delete'));
// This is 350x faster for the same operation!

// ⚠️ IMPORTANT: Set up removal watcher BEFORE the action that causes removal
const removalPromise = waitForElementToBeRemoved(() => screen.queryByText('Modal Title'));
fireEvent.click(closeButton); // Action that removes the element
await removalPromise; // Wait for removal to complete
```

### 3. Query Priority

1. `*ByTestId` - Always first choice
2. `*ByRole` - For accessibility
3. `*ByLabelText` - For form inputs
4. `*ByText` - Last resort

### 4. Async Content Rules

- `findBy*` → Waits for element to appear (replaces waitFor)
- `getBy*` → Element must exist now
- `queryBy*` → Returns null if not found (for checking absence)

## Example Test Pattern

```typescript
/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, waitForElementToBeRemoved } from '@testing-library/react';
import React from 'react';

afterEach(() => cleanup()); // REQUIRED in each test file

describe('Component', () => {
  test('async loading', async () => {
    const { findByTestId, getByTestId, queryByTestId } = render(<Component />);

    // Wait for async content
    const content = await findByTestId('content');

    // Get existing elements
    const button = getByTestId('submit-button');

    // Check absence
    expect(queryByTestId('error')).not.toBeInTheDocument();
  });
});
```

## Debugging

**Test fails?**

1. Check `data-testid` exists
2. Use `screen.debug()` to see DOM
3. Verify using `findBy*` for async content

**Test slow?**

1. Look for ANY `waitFor` usage - replace with `findBy`
2. Check for missing `data-testid`
3. Move heavy imports to test-setup.ts

## Quick Reference

```typescript
// ❌ AVOID
await waitFor(() => expect(queryByTestId('loading')).not.toBeInTheDocument());
await waitFor(() => expect(getByTestId('content')).toBeInTheDocument());
getByText('Dynamic Content'); // If content loads async

// ✅ PREFER
await findByTestId('content'); // Replaces ALL waitFor patterns
findByTestId('dynamic-content'); // For async content
```

## Exceptions: When to Keep waitFor

Only use `waitFor` for:

- Complex assertions (checking function calls: `expect(mockFn).toHaveBeenCalled()`)
- Multiple conditions that can't be expressed with a single query
- Actions that must happen inside the wait

## CRITICAL Performance Fix: Element Removal

**⚠️ This is the #1 cause of slow tests!**

When waiting for elements to disappear after actions (like deletions), NEVER use `waitFor` with
null/not.toBeInTheDocument checks:

```typescript
// ❌ EXTREMELY SLOW - Can take 1.7+ seconds even for in-memory operations!
await waitFor(() => {
  expect(screen.queryByText('Deleted Item')).toBeNull();
});

await waitFor(() => {
  expect(screen.queryByText('Deleted Item')).not.toBeInTheDocument();
});

// ✅ FAST - Takes only milliseconds (350x faster!)
await waitForElementToBeRemoved(() => screen.queryByText('Deleted Item'));
```

**Real example**: In our tests, this single change reduced test time from 2.34s to 593ms!

**Setup timing**: `waitForElementToBeRemoved` must be called BEFORE the action that removes the element, or it will
throw an error if the element is already gone.

## Performance Optimization

When elements appear together (e.g., after initial render), use `waitFor` with multiple assertions instead of sequential
`findBy*` calls:

```typescript
// ❌ SLOW - Sequential findBy calls each wait up to 1s
await screen.findByText('Hero Block');
await screen.findByText('Feature Block');

// ✅ FAST - Single wait for both elements
await waitFor(() => {
  expect(screen.getByText('Hero Block')).toBeInTheDocument();
  expect(screen.getByText('Feature Block')).toBeInTheDocument();
});
```

Use `findBy*` only for the FIRST element you're waiting for, then use `getBy*` for related elements that should already
be present.

## Key Takeaways

1. **data-testid** prevents debugging nightmares
2. **findBy** for waiting for single elements to appear
3. **waitFor** for multiple elements appearing together (faster than sequential findBy)
4. **Never** put actions (clicks, types) inside waitFor - they'll execute repeatedly
5. **ALWAYS use waitForElementToBeRemoved** for element removal - it's 350x faster than waitFor with null checks!
6. **Always** add cleanup to test files
