import { GenericJsxEditor, type JsxComponentDescriptor } from '@mdxeditor/editor';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { MDXEditor } from '../index';

describe('MDXEditor', () => {
  afterEach(() => {
    cleanup();
  });

  describe('MDXEditor component', () => {
    test('renders with initial value', () => {
      const initialValue = '# Hello MDX\n\nThis is a test.';
      render(<MDXEditor value={initialValue} onChange={() => {}} />);

      // The MDX editor should render with the initial content
      return screen.findByText('Hello MDX').then((element) => {
        expect(element).toBeDefined();
      });
    });

    test('calls onChange when content changes', async () => {
      let capturedValue = '';
      const onChange = (value: string) => {
        capturedValue = value;
      };

      const { container } = render(<MDXEditor value="# Initial" onChange={onChange} />);

      const editor = await waitFor(() => {
        const contentEditable = container.querySelector('[contenteditable="true"]');
        expect(contentEditable).toBeDefined();
        return contentEditable as HTMLElement;
      });

      // Focus the editor first
      fireEvent.focus(editor);

      // Clear existing content
      fireEvent.keyDown(editor, { key: 'a', ctrlKey: true });

      // Type new content
      fireEvent.input(editor, {
        target: { innerHTML: '<p># Updated Content</p>' },
        data: '# Updated Content',
      });

      await waitFor(() => {
        expect(capturedValue).toContain('Updated Content');
      });
    });

    test('renders in read-only mode', async () => {
      const { container } = render(<MDXEditor value="# Read Only Content" onChange={() => {}} readOnly={true} />);

      const editor = await waitFor(() => {
        const contentEditable = container.querySelector('[contenteditable]');
        expect(contentEditable).toBeDefined();
        return contentEditable;
      });

      expect(editor?.getAttribute('contenteditable')).toBe('false');
    });

    test('calls onSave when provided', async () => {
      let savedValue = '';
      const onSave = (value: string) => {
        savedValue = value;
      };

      render(<MDXEditor value="# Content to Save" onChange={() => {}} onSave={onSave} />);

      await screen.findByText('Content to Save');

      // Simulate Ctrl+S
      fireEvent.keyDown(document, {
        key: 's',
        code: 'KeyS',
        ctrlKey: true,
        preventDefault: () => {},
      });

      await waitFor(() => {
        expect(savedValue).toBe('# Content to Save');
      });
    });
  });

  describe('MDX editor plugins', () => {
    const buttonDescriptor: JsxComponentDescriptor = {
      name: 'Button',
      kind: 'text',
      hasChildren: true,
      props: [{ name: 'variant', type: 'string' }],
      Editor: GenericJsxEditor,
    };

    test('includes essential markdown plugins', async () => {
      const { container } = render(<MDXEditor value="# Test" onChange={() => {}} />);

      // Check for toolbar buttons that indicate plugin presence
      const toolbar = await waitFor(() => {
        const toolbarElement = container.querySelector('[role="toolbar"]');
        expect(toolbarElement).toBeDefined();
        return toolbarElement;
      });

      expect(toolbar).toBeDefined();

      // Check for specific toolbar buttons by aria-label
      const boldButton = container.querySelector('[aria-label="Bold"]');
      const italicButton = container.querySelector('[aria-label="Italic"]');
      const insertCodeButton = container.querySelector('[aria-label="Insert Code Block"]');
      const linkButton = container.querySelector('[aria-label="Link"]');

      expect(boldButton).toBeDefined();
      expect(italicButton).toBeDefined();
      expect(insertCodeButton).toBeDefined();
      expect(linkButton).toBeDefined();
    });

    test('supports MDX JSX components', async () => {
      const mdxContent = `# Hello

<Button variant="primary">Click me</Button>

Some regular markdown.`;

      render(<MDXEditor value={mdxContent} onChange={() => {}} jsxComponentDescriptors={[buttonDescriptor]} />);

      // The editor should render JSX components without errors
      expect(await screen.findByText('Hello')).toBeDefined();
      expect(await screen.findByText('Click me')).toBeDefined();
    });

    test('wildcard fallback accepts unknown JSX without descriptors', async () => {
      const mdxContent = `# Doc

<Aside type="note">Heads up</Aside>

Trailing paragraph.`;

      const { container } = render(<MDXEditor value={mdxContent} onChange={() => {}} />);

      // No descriptors passed → wildcard fallback should accept the unknown
      // <Aside> tag instead of crashing the importer with the
      // "Parsing of the following markdown structure failed" error.
      expect(await screen.findByText('Doc')).toBeDefined();
      expect(await screen.findByText('Trailing paragraph.')).toBeDefined();
      expect(container.textContent || '').not.toContain('Parsing of the following markdown structure failed');
    });
  });
});
