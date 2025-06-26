# @conloca/cms-spa

The React-based UI for Conloca CMS, featuring Puck's visual page builder.

## Development

### Running the Development Server

```bash
bun run serve
```

This starts a development server at http://localhost:3000 with:

- Hot Module Replacement (HMR) via Bun
- Tailwind CSS processing with watch mode
- Mock Puck configuration with sample components
- WebSocket-based live reload

### Development Features

The dev server includes a comprehensive mock Puck config with these components:

- **Hero**: Full-width hero section with background image support
- **Card**: Content card with image, title, description, and link
- **Grid**: Responsive grid layout with configurable columns
- **Text**: Rich text component with alignment and size options
- **Button**: Customizable button with variants
- **Spacer**: Vertical spacing component

### How It Works

1. **CSS Processing**: Tailwind CSS is processed in watch mode
2. **HMR**: File changes trigger automatic browser reload via WebSocket
3. **Mock Config**: Components are injected as `window.__PUCK_CONFIG__`
4. **Static Serving**: Bun serves the SPA with proper MIME types

### Building for Production

```bash
bun run build
```

This creates:

- Bundled SPA in `dist/spa/` with hashed assets
- TypeScript definitions in `dist/`
- Minified CSS with Tailwind optimizations

### Integration with Astro

In production (when used as an Astro plugin), the CMS:

1. Loads the actual Puck config from the host website
2. Uses Astro's content API for data persistence
3. Leverages Vite's HMR for component updates
