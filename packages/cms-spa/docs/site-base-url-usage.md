# Site Base URL Configuration

The CMS supports configuring a site base URL to handle cases where your content is served from a subdirectory or a
different domain.

## Configuration

### In Astro

```typescript
import { conlocaCMS } from '@conloca/astro-cms';

export default defineConfig({
  integrations: [
    conlocaCMS({
      contentRoot: './content',
      puckConfigPath: './puck.config.tsx',
      siteBaseUrl: '/docs', // Relative path
      // or
      siteBaseUrl: 'https://example.com/docs', // Absolute URL
    }),
  ],
});
```

### Programmatically

```typescript
import { configureUI } from '@conloca/cms-spa';

configureUI({
  siteBaseUrl: '/docs',
  // or
  siteBaseUrl: 'https://staging.example.com',
});
```

## Usage in Components

### Using the Hook

```typescript
import { useSiteBaseUrl } from '@conloca/cms-spa';

function MyComponent() {
  const { siteBaseUrl, buildUrl, extractPath } = useSiteBaseUrl();

  // Build a full URL
  const pageUrl = buildUrl('/about'); // '/docs/about' or 'https://example.com/docs/about'

  // Extract path from URL
  const path = extractPath('/docs/about'); // '/about'

  return <a href={pageUrl}>About</a>;
}
```

### Preview URLs

The preview functionality automatically uses the site base URL to open the actual page:

```typescript
// If siteBaseUrl is '/docs' and page pathname is '/about'
// Preview URL will be: /docs/about

// If siteBaseUrl is 'https://staging.example.com'
// Preview URL will be: https://staging.example.com/about
```

Since the CMS runs as an Astro plugin in dev mode, the preview simply opens the actual site page.

## Use Cases

1. **Subdirectory Deployment**: When your site is deployed at `/docs` or `/blog`
2. **Multi-environment Preview**: Different base URLs for staging vs production
3. **Cross-domain Preview**: When the CMS and site are on different domains

## Important Notes

- The `siteBaseUrl` is only used for display/preview purposes
- Content is still stored with relative paths for portability
- Both relative (`/docs`) and absolute (`https://example.com/docs`) URLs are supported
- Trailing slashes are automatically handled
