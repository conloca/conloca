import { AlertCircle } from 'lucide-react';
import { isRouteErrorResponse, Link, useRouteError } from 'react-router-dom';
import { cn } from '../utils/cn.js';
import { Button } from './ui/Button.js';

/**
 * A short, copyable cause for the details block. A thrown non-Error value is
 * stringified, and a value that cannot be stringified (a null-prototype object,
 * a throwing `toString`) falls back to its type tag: this page is the last
 * boundary, so a second throw here would blank the whole screen.
 *
 * The router hands over whatever was thrown, so this is the parsing boundary
 * for that value.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- the router types a route error as unknown; this function narrows it.
function describeRouteError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim();
  try {
    return String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

/**
 * The `errorElement` for every CMS route: replaces react-router's developer
 * screen ("Unexpected Application Error!") with a plain-language message and a
 * way out. The router already logs a render error to the console, so this page
 * does not log it a second time.
 *
 * An address that matches no route arrives here as a 404 route response and
 * gets its own wording; there is nothing to reload in that case.
 */
export function RouteErrorPage() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <div className="flex h-full min-h-[400px] items-center justify-center bg-page p-6">
      <div className="max-w-md text-center">
        <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-04 dark:text-red-08" />
        <h1 className="mb-2 text-xl font-semibold text-grey-01 dark:text-grey-12">
          {notFound ? 'Page not found' : 'Something went wrong'}
        </h1>
        <p className="mb-4 text-grey-04 dark:text-grey-07">
          {notFound
            ? 'This address does not match any screen in the CMS.'
            : 'The CMS could not show this screen. Reloading usually fixes it; changes you had not saved on this screen may be lost.'}
        </p>
        {!notFound && (
          <details className="mb-4 text-left text-sm text-grey-04 dark:text-grey-07">
            <summary className="cursor-pointer text-center">Error details</summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-panel p-3 text-xs">
              {describeRouteError(error)}
            </pre>
          </details>
        )}
        <div className="flex items-center justify-center gap-2">
          {!notFound && <Button onClick={() => window.location.reload()}>Reload</Button>}
          <Link
            to="/"
            className={cn(
              'inline-flex items-center justify-center rounded-md px-4 py-2 transition-colors',
              'border border-line bg-panel text-grey-04 hover:bg-hover hover:text-grey-01',
              'dark:text-grey-07 dark:hover:text-grey-12',
            )}
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
