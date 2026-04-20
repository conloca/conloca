import { afterEach, describe, expect, test } from 'bun:test';
import { GenericJsxEditor, type JsxComponentDescriptor } from '@mdxeditor/editor';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MDXEditor, MDXEditorModal } from '../index';

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

  describe('MDXEditorModal component', () => {
    test('renders when isOpen is true', async () => {
      const { findByTestId, queryByTestId } = render(
        <MDXEditorModal
          isOpen={true}
          onClose={() => {}}
          filePath="test.mdx"
          initialContent="# Test Content"
          onSave={() => {}}
        />,
      );

      expect(screen.getByText('Edit: test.mdx')).toBeDefined();

      // Initially shows modal loading
      expect(screen.getByTestId('modal-editor-loading')).toBeDefined();

      // Wait for the DeferredMDXEditor to initialize
      await findByTestId('deferred-editor-ready');

      // Loading indicators should be gone
      expect(queryByTestId('modal-editor-loading')).toBeNull();
      expect(queryByTestId('deferred-editor-loading')).toBeNull();

      // The actual MDXEditor component should be rendered now
      expect(screen.getByTestId('deferred-editor-ready')).toBeDefined();
      expect(screen.getByText('Cancel')).toBeDefined();
      expect(screen.getByText('Save')).toBeDefined();

      // Check that the content is actually rendered
      // MDXEditor renders "# Test Content" as an h1 element
      const editorContainer = screen.getByTestId('deferred-editor-ready');
      expect(editorContainer.querySelector('h1')).toBeDefined();
      expect(editorContainer.textContent).toContain('Test Content');
    });

    test('does not render when isOpen is false', () => {
      const { container } = render(
        <MDXEditorModal
          isOpen={false}
          onClose={() => {}}
          filePath="test.mdx"
          initialContent="# Test Content"
          onSave={() => {}}
        />,
      );

      expect(container.firstChild).toBeNull();
    });

    test('calls onClose when close button is clicked', async () => {
      let closed = false;
      const onClose = () => {
        closed = true;
      };

      render(
        <MDXEditorModal
          isOpen={true}
          onClose={onClose}
          filePath="test.mdx"
          initialContent="# Test Content"
          onSave={() => {}}
        />,
      );

      await screen.findByTestId('deferred-editor-ready');

      const closeButton = screen.getByLabelText('Close');
      fireEvent.click(closeButton);

      expect(closed).toBe(true);
    });

    test('calls onSave with content and closes modal', async () => {
      let savedContent = '';
      let closed = false;

      const onSave = (content: string) => {
        savedContent = content;
      };
      const onClose = () => {
        closed = true;
      };

      render(
        <MDXEditorModal
          isOpen={true}
          onClose={onClose}
          filePath="test.mdx"
          initialContent="# Initial"
          onSave={onSave}
        />,
      );

      await screen.findByTestId('deferred-editor-ready');

      // Find save button
      const saveButton = screen.getByText('Save');
      fireEvent.click(saveButton);

      // Wait for async handleSave to complete
      await waitFor(() => {
        expect(savedContent).toBe('# Initial');
        expect(closed).toBe(true);
      });
    });

    test('shows file path in modal title', () => {
      render(
        <MDXEditorModal
          isOpen={true}
          onClose={() => {}}
          filePath="content/blog/post.mdx"
          initialContent=""
          onSave={() => {}}
        />,
      );

      expect(screen.getByText('Edit: content/blog/post.mdx')).toBeDefined();
    });

    test('handles new file creation without file path', () => {
      render(<MDXEditorModal isOpen={true} onClose={() => {}} initialContent="" onSave={() => {}} />);

      expect(screen.getByText('New MDX File')).toBeDefined();
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
  });
});
