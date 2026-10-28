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
3. **Mock Config**: Mock components are installed with `setPuckConfig()` from `src/puck-config.ts`
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

## Running inside a parent frame

An editor page can run inside a parent frame that owns the address bar, the credentials and the save control. The page
waits for the parent's hello with `awaitParentHello(window, acceptsOrigin, { repo, siteId })` (`acceptsParentOrigin`
from `@conloca/cms-spa/frame-protocol` implements the origin rule), then calls `connectEditorFrame(port)`. That resolves
on the parent's `init` with an `EditorFrame`:

- `init`: the parent's settings (first route, read-only refusal, preview capability, theme, locales, whether media loads
  through the parent).
- `config`: the `UIConfig` part to pass to `configureUI` before mounting `<CmsSpaApp/>`, with an `RpcContentClient` that
  sends every content call to the parent.
- `ready()`, `reportStale()` and `reportLoadFailed(stage, message)`: messages to the parent.

While connected, the parent can flush the open editor, and the page reports dirty state, Cmd/Ctrl+S (also inside the
editing canvas) and route changes to it.

Four `UIConfig` fields make this work; without them nothing changes:

- `memoryRouter`: route in memory and report each route to the parent.
- `previewTab: 'parent'`: the parent opens the preview tab; the editor only asks through `openPreview`.
- `loadMedia`: media surfaces show object URLs of loaded bytes instead of media URLs.
- `sandboxFramePath`: where the MDX sandbox frame loads from.

The parent side imports the message contract from `@conloca/cms-spa/frame-protocol` and the port channel from
`@conloca/cms-spa/frame-channel`.
