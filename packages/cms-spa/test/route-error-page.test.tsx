/// <reference lib="dom" />
/**
 * What a user sees when a route fails to render.
 *
 * With no `errorElement` on any route, react-router replaced the whole CMS
 * with its developer screen ("Unexpected Application Error!" plus a "Hey
 * developer" hint) and the user had no way back. Every route must instead show
 * the CMS's own error page.
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, createRoutesFromElements, RouterProvider } from 'react-router-dom';
import { routeElements } from '../src/App.js';
import { RouteErrorPage } from '../src/components/RouteErrorPage.js';
import { ThemeProvider } from '../src/hooks/useTheme.js';
import { renderAppWithDataRouter, testApi } from './test-utils.js';

// React and react-router both log a caught render error to console.error. The
// logging is expected here; silence it so the run stays pristine.
beforeEach(() => {
  spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  mock.restore();
  cleanup();
  testApi?.clear();
});

/**
 * Renders the production route config WITHOUT a QueryClientProvider. Every
 * data-backed screen then throws "No QueryClient set" while rendering — a real
 * render-time failure of the real route components, so the routes need no
 * test-only hook to be made to fail. Addresses that match no route never reach
 * a component, so the missing provider does not matter for them.
 */
function renderProductionRoutes(initialEntry: string) {
  const router = createMemoryRouter(
    createRoutesFromElements(routeElements({ puckConfig: { components: {} }, dataSchemas: {} })),
    { initialEntries: [initialEntry] },
  );
  return render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

function expectNoDeveloperScreen() {
  expect(document.body.textContent).not.toContain('Unexpected Application Error');
  expect(document.body.textContent).not.toContain('Hey developer');
}

describe('route render failure', () => {
  test.each([
    { where: 'the dashboard', entry: '/' },
    { where: 'the data list', entry: '/data' },
    { where: 'the page editor', entry: '/pages/vx-any-page' },
    { where: 'the fragment editor', entry: '/fragments/vx-any-fragment' },
  ])('shows the CMS error page instead of the developer screen when $where throws', async ({ entry }) => {
    renderProductionRoutes(entry);

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' }).getAttribute('href')).toBe('/');
    // The cause is available for a bug report, tucked away from the main message.
    expect(screen.getByText(/No QueryClient set/)).toBeInTheDocument();
    expectNoDeveloperScreen();
  });

  test('reloads the page when Reload is pressed', async () => {
    // happy-dom's `reload` is an ordinary method, so it can be spied on directly.
    const reload = spyOn(window.location, 'reload').mockImplementation(() => {});
    renderProductionRoutes('/data');

    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }));

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

// A null-prototype object has no toString, so String() on it throws.
function ThrowsNullPrototypeObject(): never {
  throw Object.create(null);
}

describe('route that throws a value with no string form', () => {
  test('still shows the error page rather than failing inside it', async () => {
    const router = createMemoryRouter([
      { path: '/', element: <ThrowsNullPrototypeObject />, errorElement: <RouteErrorPage /> },
    ]);
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('heading', { name: 'Something went wrong' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument();
  });
});

describe('unknown address', () => {
  test('says the page does not exist instead of showing the developer screen', async () => {
    renderProductionRoutes('/no-such-screen');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to dashboard' })).toBeInTheDocument();
    expectNoDeveloperScreen();
  });

  test('leads back to a working dashboard through the link', async () => {
    renderAppWithDataRouter(['/no-such-screen']);

    fireEvent.click(await screen.findByRole('link', { name: 'Back to dashboard' }));

    expect(await screen.findByTestId('dashboard-title')).toBeInTheDocument();
  });
});
