import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { compileMDX, createMDXCompiler } from '../src/mdx/compile';
import type { MDXCompileResult } from '../src/types';

describe('MDX Compilation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mdx-compile-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('compileMDX', () => {
    test('compiles basic MDX content', async () => {
      const content = '# Hello MDX\n\nThis is a test.';
      const result = await compileMDX(content, {});

      expect(result.code).toBeDefined();
      expect(result.code).toContain('Hello MDX');
      expect(result.metadata).toEqual({});
    });

    test('compiles MDX with components', async () => {
      const content = '# Hello\n\n<Button>Click me</Button>';
      const components = {
        Button: () => null,
      };

      const result = await compileMDX(content, components);

      expect(result.code).toBeDefined();
      expect(result.code).toContain('Button');
    });

    test('handles invalid MDX syntax', async () => {
      const invalidContent = '# Unclosed {tag';

      await expect(compileMDX(invalidContent, {})).rejects.toThrow();
    });

    test('extracts YAML frontmatter', async () => {
      const content = `---
title: Test Page
description: A test MDX file
tags:
  - test
  - mdx
---

# Test Content

This is the body.`;

      const result = await compileMDX(content, {});

      expect(result.metadata).toEqual({
        title: 'Test Page',
        description: 'A test MDX file',
        tags: ['test', 'mdx'],
      });
      expect(result.code).toBeDefined();
      expect(result.code).not.toContain('---');
    });

    test('allows using frontmatter variables in MDX content', async () => {
      const content = `---
title: Hello World
author: John Doe
---

# {title}

Written by {author}`;

      const result = await compileMDX(content, {});

      expect(result.metadata).toEqual({
        title: 'Hello World',
        author: 'John Doe',
      });
      expect(result.code).toBeDefined();
      // The compiled code should have the frontmatter values injected
      expect(result.code).toContain('Hello World');
      expect(result.code).toContain('John Doe');
    });

    test('compiles MDX with JSX expressions', async () => {
      const content = `# Count: {props.count}

<div>{props.items.map(item => <span key={item}>{item}</span>)}</div>`;

      const result = await compileMDX(content, {});

      expect(result.code).toBeDefined();
      expect(result.code).toContain('props.count');
      expect(result.code).toContain('props.items');
    });

    test('handles MDX with code blocks', async () => {
      const content = `# Code Example

\`\`\`typescript
const hello = 'world';
console.log(hello);
\`\`\`

Inline code: \`const x = 42\``;

      const result = await compileMDX(content, {});

      expect(result.code).toBeDefined();
      expect(result.code).toContain('hello');
    });

    test('provides development mode compilation', async () => {
      const content = '# Dev Mode';

      // Mock environment
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      try {
        const result = await compileMDX(content, {});
        expect(result.code).toBeDefined();
        // Development mode should include source maps or debugging info
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe('MDXCompiler', () => {
    test('creates compiler with component scope', () => {
      const components = {
        Button: () => null,
        Card: () => null,
      };

      const compiler = createMDXCompiler(components);
      expect(compiler.compile).toBeDefined();
      expect(compiler.compileFile).toBeDefined();
    });

    test('compiles file from disk', async () => {
      const mdxPath = join(tempDir, 'test.mdx');
      const content = `---
title: File Test
---

# Hello from file

<Button>Test</Button>`;

      await writeFile(mdxPath, content);

      const compiler = createMDXCompiler({ Button: () => null });
      const result = await compiler.compileFile(mdxPath);

      expect(result.code).toBeDefined();
      expect(result.metadata.title).toBe('File Test');
    });

    test('handles non-existent file', async () => {
      const compiler = createMDXCompiler({});
      const nonExistentPath = join(tempDir, 'does-not-exist.mdx');

      await expect(compiler.compileFile(nonExistentPath)).rejects.toThrow();
    });

    test('preserves component scope across compilations', async () => {
      const components = {
        SharedButton: () => null,
        SharedCard: () => null,
      };

      const compiler = createMDXCompiler(components);

      const result1 = await compiler.compile('<SharedButton>One</SharedButton>');
      const result2 = await compiler.compile('<SharedCard>Two</SharedCard>');

      expect(result1.code).toContain('SharedButton');
      expect(result2.code).toContain('SharedCard');
    });
  });

  describe('Component injection', () => {
    test('injects all Puck components into scope', async () => {
      const puckComponents = {
        H1: () => null,
        H2: () => null,
        P: () => null,
        Grid: () => null,
        Button: () => null,
        Card: () => null,
      };

      const content = `<Grid>
  <Card>
    <H1>Title</H1>
    <P>Content</P>
    <Button>Action</Button>
  </Card>
</Grid>`;

      const result = await compileMDX(content, puckComponents);

      expect(result.code).toBeDefined();
      // All components should be referenced in the compiled code
      expect(result.code).toContain('Grid');
      expect(result.code).toContain('Card');
      expect(result.code).toContain('H1');
    });

    test('allows HTML element overrides', async () => {
      const components = {
        h1: () => null, // Custom h1
        p: () => null, // Custom paragraph
      };

      const content = `# This uses custom h1

This paragraph uses custom p component.`;

      const result = await compileMDX(content, components);

      expect(result.code).toBeDefined();
      // Should use the custom components
    });
  });

  describe('Error handling', () => {
    test('provides helpful error for missing closing tags', async () => {
      const content = '<Button>Click me';

      try {
        await compileMDX(content, { Button: () => null });
        expect(true).toBe(false); // Should not reach here
      } catch (error: any) {
        expect(error.message).toContain('Button');
      }
    });

    test('handles component not in scope', async () => {
      const content = '<UnknownComponent>Test</UnknownComponent>';

      // Should compile but component won't be available at runtime
      const result = await compileMDX(content, {});
      expect(result.code).toBeDefined();
      expect(result.code).toContain('UnknownComponent');
    });

    test('handles malformed frontmatter', async () => {
      const content = `---
title: Unclosed
description: "Missing quote
---

# Content`;

      await expect(compileMDX(content, {})).rejects.toThrow();
    });
  });

  describe('MDX output format', () => {
    test('returns executable function body', async () => {
      const content = '# Test';
      const result = await compileMDX(content, {});

      expect(result.code).toBeDefined();
      expect(typeof result.code).toBe('string');

      // The code should be a function body that can be executed
      // with new Function('components', code)
      expect(result.code).not.toContain('export');
      expect(result.code).not.toContain('import');
    });

    test('returns metadata and code separately', async () => {
      const content = `---
title: Test
date: 2024-01-01
---

# Content`;

      const result = await compileMDX(content, {});

      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('metadata');
      expect(result.metadata).toEqual({
        title: 'Test',
        date: new Date('2024-01-01T00:00:00.000Z'),
      });
    });
  });

  describe('GFM (GitHub Flavored Markdown) support', () => {
    test('compiles tables', async () => {
      const content = `# Table Example

| Feature | Supported |
|---------|-----------|
| Tables  | Yes       |
| Lists   | Yes       |`;

      const result = await compileMDX(content, {});

      expect(result.code).toBeDefined();
      // Tables should be compiled to table elements
      expect(result.code).toContain('table');
    });

    test('compiles strikethrough text', async () => {
      const content = '~~This text is struck through~~';

      const result = await compileMDX(content, {});

      expect(result.code).toBeDefined();
      // Strikethrough should be compiled
    });

    test('compiles task lists', async () => {
      const content = `# Tasks

- [x] Completed task
- [ ] Uncompleted task
- [ ] Another todo`;

      const result = await compileMDX(content, {});

      expect(result.code).toBeDefined();
      // Task lists should be compiled with checkbox inputs
    });

    test('compiles autolink literals', async () => {
      const content = 'Visit www.example.com or https://mdxjs.com for more info.';

      const result = await compileMDX(content, {});

      expect(result.code).toBeDefined();
      // URLs should be converted to links
    });

    test('compiles footnotes', async () => {
      const content = `Here is a footnote reference[^1].

[^1]: This is the footnote.`;

      const result = await compileMDX(content, {});

      expect(result.code).toBeDefined();
      // Footnotes should be compiled
    });
  });
});
