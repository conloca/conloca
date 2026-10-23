/// <reference lib="dom" />
/**
 * The Dashboard's New Page button.
 *
 * It used to be a link to the Pages list, so an author who clicked it landed on a list and had to
 * click the list's own New Page button. It now opens the same create-page dialog in place.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { CMSDashboard } from '../src/components/CMSDashboard.js';
import { renderWithProviders, setupTestAPI, testApi } from './test-utils.js';

afterEach(() => {
  cleanup();
  testApi?.clear();
});

beforeEach(() => {
  setupTestAPI();
});

function renderDashboardWithRoutes() {
  renderWithProviders(
    <Routes>
      <Route path="/" element={<CMSDashboard />} />
      <Route path="/pages" element={<div data-testid="pages-route" />} />
      <Route path="/pages/:id" element={<div data-testid="page-editor-route" />} />
    </Routes>,
    {},
    false,
  );
}

describe('Dashboard New Page button', () => {
  test('opens the create-page dialog and stays on the Dashboard', async () => {
    renderDashboardWithRoutes();

    fireEvent.click(await screen.findByRole('button', { name: 'New Page' }));

    expect(await screen.findByTestId('page-title-input')).toBeDefined();
    expect(screen.getByTestId('dashboard-title')).toBeDefined();
    expect(screen.queryByTestId('pages-route')).toBeNull();
  });

  test('creates the page from the dialog and opens its editor', async () => {
    renderDashboardWithRoutes();

    fireEvent.click(await screen.findByRole('button', { name: 'New Page' }));
    fireEvent.change(await screen.findByTestId('page-title-input'), { target: { value: 'Team' } });
    // Create waits for the path check; a short error keeps each poll cheap.
    await waitFor(() => {
      if (screen.getByTestId('create-page-submit').hasAttribute('disabled'))
        throw new Error('Create is still disabled');
    });
    fireEvent.click(screen.getByTestId('create-page-submit'));

    expect(await screen.findByTestId('page-editor-route')).toBeDefined();
    const titles = Array.from(testApi.listAllContent()).map((page) => page.locales.en?.meta.title);
    expect(titles).toEqual(['Team']);
  });
});
