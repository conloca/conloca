import { ContentAPIClient, setContentAPIClient } from '@conloca/content-api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { getUIConfig } from './ui-config';

// Get configuration
const config = getUIConfig();

// Initialize the Content API client with the configured base URL
const contentAPIClient = new ContentAPIClient({
  baseUrl: config.apiBaseUrl,
});
setContentAPIClient(contentAPIClient);

// Create QueryClient with configurable options
const queryClient = new QueryClient(config.queryClientOptions);

const root = createRoot(document.getElementById('root')!);
root.render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter basename={config.basename}>
      <App />
    </BrowserRouter>
    {config.enableDevtools && <ReactQueryDevtools initialIsOpen={false} />}
  </QueryClientProvider>,
);
