import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { CanvasPageContext, EditorFrameBoundary, FramedContent } from '../src/components/editor/EditorFrame.js';
import { setSiteRender } from '../src/site-render.js';
import { setDataBindings } from '../src/ui-config.js';

const ENTRIES = [
  { name: 'blog', collection: 'blog', frame: 'blog' },
  { name: 'blog2', collection: 'blog', frame: 'other' },
  { name: 'pages', collection: 'pages' },
];

const BlogFrame = ({ children }: { children: ReactNode }) => <div className="page-shell">{children}</div>;
const OtherFrame = ({ children }: { children: ReactNode }) => <div className="other-page">{children}</div>;

function canvas(pathname: string, collection: string | undefined) {
  return render(
    <CanvasPageContext.Provider value={{ pathname, collection }}>
      <EditorFrameBoundary>
        <p data-testid="content">content</p>
      </EditorFrameBoundary>
    </CanvasPageContext.Provider>,
  );
}

/** Catches what passes the frame, handing it to `onCatch`. */
class Outer extends Component<{ children: ReactNode; onCatch: (error: unknown) => void }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(e: unknown) {
    this.props.onCatch(e);
  }
  override render() {
    return this.state.failed ? <p data-testid="outer">outer</p> : this.props.children;
  }
}

const frameLogs = (calls: unknown[][]) =>
  calls.filter((call) => String(call[0]).includes('editor frame of route')).length;

const ThrowsString = () => {
  // oxlint-disable-next-line no-throw-literal -- the case under test: a block throwing a non-Error.
  throw 'boom';
};

const PathFrame = ({ pathname, children }: { pathname: string; children: ReactNode }) => (
  <div className="f" data-path={pathname}>
    {children}
  </div>
);

describe('the editor frame in the canvas', () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, '__SITE_RENDER_STATE__');
    setSiteRender({ frames: { blog: BlogFrame, other: OtherFrame } });
    setDataBindings({ siteName: 'default', locale: 'en', routes: {}, entries: ENTRIES });
  });
  afterEach(() => {
    cleanup();
    setDataBindings(undefined);
    Reflect.deleteProperty(window, '__SITE_RENDER_STATE__');
  });

  test("wraps a page in its collection's first entry's frame, around the page-root marker", () => {
    const { getByTestId, container } = canvas('/blog/a', 'blog');
    expect(getByTestId('content').closest('.page-shell > [data-conloca-page-root]')).not.toBeNull();
    expect(container.querySelector('.other-page')).toBeNull();
  });

  test('frames a collection index page', () => {
    const { getByTestId } = canvas('/blog', 'blog');
    expect(getByTestId('content').closest('.page-shell > [data-conloca-page-root]')).not.toBeNull();
  });

  test('leaves a page whose entry declares no frame bare', () => {
    const { container } = canvas('/', 'pages');
    expect(container.querySelector('.page-shell')).toBeNull();
    expect(container.querySelector('[data-conloca-page-root]')).toBeNull();
  });

  test('leaves a page no entry serves bare', () => {
    const { container, getByTestId } = canvas('/x', 'docs');
    expect(getByTestId('content')).toBeTruthy();
    expect(container.querySelector('[data-conloca-page-root]')).toBeNull();
  });

  test('a frame that throws leaves the content bare and logs one error naming the route', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    setSiteRender({
      frames: {
        blog: () => {
          throw new Error('broken frame');
        },
      },
    });
    try {
      const { getByTestId, container } = canvas('/blog/a', 'blog');
      expect(getByTestId('content')).toBeTruthy();
      expect(container.querySelector('[data-conloca-page-root]')).toBeNull();
      const ours = error.mock.calls.filter((call) => String(call[0]).includes('editor frame'));
      expect(ours.length).toBe(1);
      expect(String(ours[0]?.[0])).toContain('blog');
    } finally {
      error.mockRestore();
    }
  });

  test('a block that throws on a framed page propagates past the frame, which is not blamed', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    const thrown = new Error('broken block');
    const Broken = () => {
      throw thrown;
    };
    let caught: unknown;
    try {
      const { getByTestId } = render(
        <Outer onCatch={(e) => (caught = e)}>
          <CanvasPageContext.Provider value={{ pathname: '/blog/a', collection: 'blog' }}>
            <EditorFrameBoundary>
              <Broken />
            </EditorFrameBoundary>
          </CanvasPageContext.Provider>
        </Outer>,
      );
      expect(getByTestId('outer')).toBeTruthy();
      expect(caught).toBe(thrown);
      expect(error.mock.calls.filter((call) => String(call[0]).includes('editor frame')).length).toBe(0);
    } finally {
      error.mockRestore();
    }
  });

  test('a replaced frame is tried again after one failed', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    setSiteRender({
      frames: {
        blog: () => {
          throw new Error('broken frame');
        },
      },
    });
    try {
      const { container } = canvas('/blog/a', 'blog');
      expect(container.querySelector('[data-conloca-page-root]')).toBeNull();
      act(() => setSiteRender({ frames: { blog: BlogFrame } }));
      expect(container.querySelector('.page-shell > [data-conloca-page-root]')).not.toBeNull();
    } finally {
      error.mockRestore();
    }
  });

  test('without entries the canvas is as today', () => {
    setDataBindings({ siteName: 'default', locale: 'en', routes: {} });
    const { container, getByTestId } = canvas('/blog/a', 'blog');
    expect(getByTestId('content')).toBeTruthy();
    expect(container.querySelector('[data-conloca-page-root]')).toBeNull();
  });

  test('a block that throws a string on a framed page propagates past the frame, which is not blamed', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    let caught: unknown;
    try {
      const { getByTestId } = render(
        <Outer onCatch={(e) => (caught = e)}>
          <CanvasPageContext.Provider value={{ pathname: '/blog/a', collection: 'blog' }}>
            <EditorFrameBoundary>
              <ThrowsString />
            </EditorFrameBoundary>
          </CanvasPageContext.Provider>
        </Outer>,
      );
      expect(getByTestId('outer')).toBeTruthy();
      // Wrapped in an Error so the route error page reads "boom", not "[object Object]".
      expect(caught).toEqual(new Error('boom'));
      expect(frameLogs(error.mock.calls)).toBe(0);
    } finally {
      error.mockRestore();
    }
  });

  test('after a frame failed, a later block error is not logged as a frame failure again', () => {
    const error = spyOn(console, 'error').mockImplementation(() => {});
    setSiteRender({
      frames: {
        blog: () => {
          throw new Error('broken frame');
        },
      },
    });
    const thrown = new Error('broken block');
    const Broken = () => {
      throw thrown;
    };
    let caught: unknown;
    const page = (child: ReactNode) => (
      <Outer onCatch={(e) => (caught = e)}>
        <CanvasPageContext.Provider value={{ pathname: '/blog/a', collection: 'blog' }}>
          <EditorFrameBoundary>{child}</EditorFrameBoundary>
        </CanvasPageContext.Provider>
      </Outer>
    );
    try {
      const { rerender, getByTestId } = render(page(<p>content</p>));
      expect(frameLogs(error.mock.calls)).toBe(1);
      rerender(page(<Broken />));
      expect(getByTestId('outer')).toBeTruthy();
      expect(caught).toBe(thrown);
      expect(frameLogs(error.mock.calls)).toBe(1);
    } finally {
      error.mockRestore();
    }
  });

  test('FramedContent wraps children in the frame around the page-root marker', () => {
    const { container } = render(
      <FramedContent route="blog" Frame={PathFrame} pathname="/blog/x">
        <p>x</p>
      </FramedContent>,
    );
    expect(container.innerHTML).toBe(
      '<div class="f" data-path="/blog/x"><div data-conloca-page-root=""><p>x</p></div></div>',
    );
  });
});
