import React from 'react';
import { type EditorFrame, useSiteRender } from '../../site-render.js';
import { getUIConfig } from '../../ui-config.js';

/** The page on the canvas, for the editor frame; provided by `PageEditor`, read inside Puck's iframe override. */
export const CanvasPageContext = React.createContext<{ pathname: string; collection: string | undefined }>({
  pathname: '/',
  collection: undefined,
});

/** Errors thrown by the page inside a frame, so the frame's boundary passes them on instead of blaming the frame. */
const pageErrors = new WeakSet();

interface PageErrorTagState {
  error: object | undefined;
}

/** Tags an error from the page's own blocks, then rethrows it to the boundaries above. */
class PageErrorTag extends React.Component<{ children: React.ReactNode }, PageErrorTagState> {
  override state: PageErrorTagState = { error: undefined };

  static getDerivedStateFromError(error: unknown): PageErrorTagState {
    // A thrown primitive cannot sit in a WeakSet, so it is wrapped once in an Error that reads as the primitive; an
    // already-tagged error passes as is.
    const tagged = typeof error === 'object' && error !== null ? error : new Error(String(error));
    pageErrors.add(tagged);
    return { error: tagged };
  }

  override render() {
    if (this.state.error !== undefined) throw this.state.error;
    return this.props.children;
  }
}

interface FrameErrorBoundaryState {
  error: unknown;
  failed: boolean;
}

const isPageError = (error: unknown) => typeof error === 'object' && error !== null && pageErrors.has(error);

/** Renders the page bare once the site's frame throws, naming the route in one error; page errors pass through. */
class FrameErrorBoundary extends React.Component<
  { route: string; Frame: EditorFrame; pathname: string; children: React.ReactNode },
  FrameErrorBoundaryState
> {
  override state: FrameErrorBoundaryState = { error: undefined, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return isPageError(error) ? { error } : { error: undefined, failed: true };
  }

  override componentDidCatch(error: unknown) {
    if (isPageError(error)) return;
    console.error(
      `[conloca] The editor frame of route '${this.props.route}' failed; showing the page unframed.`,
      error,
    );
  }

  override componentDidUpdate(previous: { Frame: EditorFrame }) {
    // A replaced frame (HMR) gets another try.
    if (previous.Frame !== this.props.Frame && this.state.failed) this.setState({ failed: false });
  }

  override render() {
    const { Frame, pathname, children } = this.props;
    if (this.state.error !== undefined) throw this.state.error;
    // Still tagged once the frame failed, so later page errors pass on instead of counting as frame failures.
    if (this.state.failed) return <PageErrorTag>{children}</PageErrorTag>;
    return (
      <Frame pathname={pathname}>
        <div data-conloca-page-root="">
          <PageErrorTag>{children}</PageErrorTag>
        </div>
      </Frame>
    );
  }
}

/** The page inside `Frame`, around the published page's `data-conloca-page-root` marker; bare if the frame throws. */
export function FramedContent({
  route,
  Frame,
  pathname,
  children,
}: {
  route: string;
  Frame: EditorFrame;
  pathname: string;
  children: React.ReactNode;
}) {
  return (
    <FrameErrorBoundary route={route} Frame={Frame} pathname={pathname}>
      {children}
    </FrameErrorBoundary>
  );
}

/**
 * Shows the page inside the editor frame of the first routing entry serving its collection; bare when no entry or
 * frame applies.
 */
export function EditorFrameBoundary({ children }: { children: React.ReactNode }) {
  const { pathname, collection } = React.useContext(CanvasPageContext);
  const { frames } = useSiteRender();
  const route = getUIConfig().dataBindings?.entries?.find((e) => e.collection === collection)?.frame;
  const Frame = route === undefined ? undefined : frames[route];
  if (route === undefined || Frame === undefined) return <>{children}</>;
  return (
    <FramedContent route={route} Frame={Frame} pathname={pathname}>
      {children}
    </FramedContent>
  );
}
