## 0.1.15 (2026-04-20)

### 🚀 Features

- **03-01:** add routing types to types.ts
- **03-01:** create routing-config.ts utility
- **03-01:** create route-utils.ts utility
- **03-02:** create virtual-module-generators.ts
- **03-02:** extend plugin-spa.ts with virtual modules
- **03-02:** create virtual-modules.d.ts type declarations
- **03-03:** create page-api.ts utility
- **03-03:** create page-handler.astro component
- **03-03:** add route injection and package exports
- **04-01:** add siteName and locale to RoutingConfig interface
- **04-01:** wire siteName and locale through plugin pipeline
- **04-02:** export contentOptions from virtual:conloca-page-api
- **04-02:** add MDX block evaluation to page-handler.astro
- **05-01:** add DataBindingConfig types for Puck data injection
- **05-01:** add getDataCollection to virtual:conloca-page-api
- **05-02:** add data collection fetching to page-handler
- **05-02:** integrate resolveAllData for data binding injection
- **10.1-01:** extend types for page data bindings
- **10.1-01:** add getPagesByPrefix to virtual module
- **10.1-01:** update page-handler to inject pages into dataContext
- **10.5-01:** add collectionInference type to RouteConfig
- **10.5-01:** implement collection inference in getAllPages
- **10.6-01:** add viewport configuration to Puck editor
- **10.7-01:** add TemplateConfig type to astro-cms
- **10.7-01:** add templates option to ConlocaCMSOptions
- **10.7-01:** add templates to cms-spa UIConfig
- **10.7-01:** update CreatePageDialog to use dynamic templates
- **10.7-01:** update PageList to use template config for content generation
- **10.7-01:** update path field when template with pathPrefix is selected
- **10.8-01:** add simple-git dependency and git operations module
- **10.8-01:** add git API endpoints to Hono router
- **10.8-02:** add git types and client methods to ContentAPIClient
- **10.8-02:** add React Query hooks for git operations
- **10.8-03:** create GitStatusPanel component
- **10.8-03:** integrate GitStatusPanel in CMS header
- **14-01:** remove collectionInference from config and types
- **16-01:** replace simple-git with GitHub GraphQL API
- **23-01:** add jose dependency to content-api
- **23-01:** create CF Access validation utility
- **23-01:** export CF Access utilities from content-api/node
- **23-02:** add CF Access validation to SPA handler
- **23-02:** add CF Access validation to Content API handler
- **23-02:** add user identity API endpoint
- **24-01:** add @octokit/rest and refactor git-operations for author attribution
- **24-01:** pass CF Access user identity to commit endpoint
- **24-02:** add useCurrentUser hook and client method
- **24-02:** add UserAvatar component to CMS header
- **260330-kxf-01:** add design tokens, Section wrapper, and withLayout HOC
- **260330-kxf-01:** add Puck primitive and layout components
- **260330-kxf-02:** add Hero and FeatureCards section components
- **260330-kxf-02:** add Steps, CTABanner sections and barrel index
- **260330-r3k:** add 6 new Puck section components for CMS page migration
- **260330-r3k:** register new components in puck.config and create VXJSON pages
- **260330-sey:** add hydration to FAQ and HostedComparison, add link field to FeatureCards
- **260330-sey:** restore page-specific JSON-LD structured data for CMS pages
- **31-01:** add HydrationStrategy type to astro-cms
- **31-01:** add hydration detection utilities
- **31-01:** export hydration utilities from astro-cms
- **31-01:** add serializeProps utility for XSS-safe props serialization
- **31-01:** add HydrationWrapper component for hydration markers
- **31-01:** export HydrationWrapper and serializeProps from package
- **31-02:** add browser hydration script
- **31-02:** add hydration virtual modules to plugin-spa
- **31-02:** export initHydration from package
- **31-03:** add RenderWithHydration component
- **31-03:** integrate hydration into page-handler.astro
- **31-03:** export RenderWithHydration from package
- **33-01:** add source exports to cms-spa package.json
- **33-01:** add CMS SPA entry virtual module to plugin-spa
- **33-02:** add dev mode HTML generation with virtual module entry
- **34-01:** add withHydration wrapper function
- **34-01:** add hydration scanner for build-time discovery
- **34-01:** export withHydration and scanner from package
- **34-02:** integrate hydration scanner into plugin
- **34-03:** add hydration support to RenderWithBlocks
- **35-01:** add deriveComponentPaths function to hydration-scanner
- **35-01:** integrate auto-discovery into plugin-spa
- **35-03:** add layout option to ConlocaCMSOptions
- **35-03:** normalizeRoutingConfig accepts topLevelLayout
- **36-01:** add development condition to cms-spa package exports
- **41-01:** enhance loader to include puckData for page collections
- **42-01:** create data-context endpoint handler
- **42-01:** inject data-context route and add package export
- **42-02:** wire DataContext to Puck editor via metadata prop
- **43-01:** add AssetManifest and AssetOperations classes
- **43-01:** add asset REST API routes to middleware
- **43-02:** extend git operations for binary assets and LFS setup
- **43-03:** add React Query hooks for asset CRUD operations
- **43-03:** add Media Library UI with grid view, upload, and picker mode
- **43-04:** add Puck ImageField and wire assetsPath config
- **44:** add asset serving endpoint and refine media library UI
- **44-01:** extend AssetManifest and AssetOperations with folders, metadata, usage
- **44-01:** add REST routes for folders, metadata, usage
- **44-02:** add client methods for folders, metadata, usage
- **44-02:** add React Query hooks for media library features
- **44-03:** add FolderNav, MediaToolbar, AssetDetailSidebar components
- **44-03:** enhance MediaLibrary, AssetCard, UploadZone, Modal
- **44-04:** add /media route, MediaPage, and nav tab
- **44-04:** redesign ImageField with URL input + Browse button
- **45-01:** add filesystem scanning helpers and core builders
- **46-01:** add moveAssets and getFolderTree to AssetOperations
- **46-01:** add move and folder-tree API routes
- **46-02:** add FolderTreeNode type and client methods
- **46-02:** add useFolderTree and useMoveAssets hooks
- **46-03:** add FolderTreeSidebar component
- **46-03:** add BulkActionBar component
- **46-03:** add MoveFolderDialog component
- **46-03:** export new media components and hooks
- **46-04:** update MediaPage with three-panel layout
- **46-04:** update MediaLibrary and AssetCard for toggle selection
- **47-02:** add selection mode toggle to MediaPage
- **47-02:** add Move button to AssetDetailSidebar
- **48-01:** add Media section card to dashboard
- **49-01:** create unified cms-handler with single auth entry point
- **52-02:** create BaseContentIndex class with shared index logic
- **55-01:** add testId prop to SectionCard for integration testing
- **57-01:** export Media Library components from cms-spa
- **57-01:** create ImagePickerDialog component for MDX editor
- **57-01:** integrate imagePlugin with Media Library picker
- **58-01:** extract generic ImagePicker component
- **58-02:** create ImageUrlField and update ImageFieldRender to use ImagePicker
- **58-02:** add text field auto-detection override and delete MediaLibraryModal
- **59-01:** create page-schemas.ts shared state module and add package export
- **59-01:** add pageSchemasPath option and virtual module infrastructure
- **59-02:** create ChipArrayField component and add maxLength to zodIntrospect
- **59-02:** upgrade SchemaForm with ChipArrayField, ImageUrlField, and maxLength
- **59-03:** wire PageEditorWrapper custom meta save flow
- **61-01:** add schemasPath option and unified virtual module to plugin-spa.ts
- **61-01:** conditional script injection and pageMetaSchema passthrough
- **62-01:** create publish.yml workflow with OIDC trusted publishing
- **62-01:** create publish.yml workflow with OIDC trusted publishing
- **64-01:** add cms-spa library build with tsdown
- **68-01:** rewrite git-operations.ts to use local git CLI
- **68-01:** update middleware, remove @octokit/rest, clean build config
- **77-01:** fix sync-public workflow and subtree push scripts
- **77-01:** fix sync-public workflow and subtree push scripts
- **Q003:** add ImagePickerDialog and CMSMDXEditor to cms-spa
- **Q005-01:** add CMS pull endpoint for rebased sync
- **Q005-01:** add pull mutation support in API client
- **Q005-01:** add pull control to git status panel
- **Q164:** add withManifest() promise-based mutex to AssetManifest
- **Q170:** create useUploadFlow hook extracting shared upload logic
- **astro-cms:** simplify LayoutProps to title/description
- **astro-cms:** add /hydration entry for browser-safe imports
- **astro-cms:** auto-enable devtools in dev mode
- **astro-cms:** replace MIME type if/else chain with SPA_MIME_TYPES map (GL-86)
- **astro-cms:** add siteStyles option to inject site CSS into Puck editor iframe
- **astro-cms:** add missing exports, entry points, and virtual module types
- **astro-cms:** route siteStyles to preview iframe via cms-spa registry
- **ci:** add content/docs sync to public repo workflow
- **ci:** add content/docs sync to public repo workflow
- **cms:** add MDX-first content block flow
- **cms-spa:** make page list title and path cells clickable preview links
- **cms-spa:** replace block selector dropdown with searchable combobox
- **cms-spa:** add shared-block warning and render title/subtitle in CBS editor
- **cms-spa:** add ThemeProvider hook with light/dark/system support
- **cms-spa:** add ConlocaLogo component
- **cms-spa:** add sidebar navigation with theme toggle
- **cms-spa:** add RecentActivity dashboard widget
- **cms-spa:** redesign dashboard with compact stats and activity feed
- **cms-spa:** add search, status filter, and sort to page list
- **cms-spa:** mobile sidebar drawer, top bar, and theme label
- **cms-spa:** responsive PageList toolbar, table scroll, and Radix selects
- **cms-spa,mdx:** wire MDX editor dark mode via library's Radix theme
- **cms-spa/editor:** isolate host site CSS to preview iframe
- **cms-spa/editor:** surface block save errors and write conflicts
- **cms-spa/ui:** add dark-mode semantic tokens and primitive components
- **content-api:** add validateFetchUrl utility for SSRF prevention (GL-65)
- **content-api-client:** add DataContext types, client method, and useDataContext hook (GL-81)
- **direnv:** auto-configure push refspecs for mirror tracking refs
- **direnv:** auto-rename origin -> private-repo and add public-repo
- **example:** migrate to routing abstraction
- **mirror:** one-shot bun scripts for private<->public sync
- **scripts:** flatten transparent wrappers in compare-layout
- **sync:** bidirectional mirror sync with public repo
- **tooling:** auto-install git-auto-remote hooks on direnv entry
- **website:** copy landing page and docs from feat/add-landing-page
- **website:** unify Cloudflare website deployment
- **website:** store signup metadata in D1
- **website:** add structured data, meta tags, and definitional content
- **website:** add FAQ page with FAQPage schema and update navbar
- **website:** add CMS comparison page with structured table
- **website:** enhance marketing pages with AI-citable structured data
- **website:** add VxJSON explainer page and navbar link
- **website:** add inline VxJSON links from homepage, FAQ, and docs
- **website:** add light/dark theme infrastructure (GL-116)
- **website:** add theme toggle and light mode adaptation for all components (GL-116)
- **website:** add complete SEO metadata coverage
- **website:** integrate Conloca CMS into conloca.com
- **website:** narrative section merging for /vxjson/ production parity
- **website:** improve Puck editor UX for content editors
- **website:** add icon picker field for FeatureCards
- **website:** add column-count validation to ComparisonTable
- **website:** migrate FAQ and NumberedFlow to richtext fields
- **website:** add collisionAxis to Flex slot for better drag targeting
- **website:** improve Puck editor with resolveData, permissions, and field cleanup
- **website:** improve Puck editor field UX — conditional CTA visibility, label clarity
- **website:** make ComparisonTable differentiators header editable
- **website:** add content page puck components
- **website:** replace VxJSON MDX blocks with inline Puck components
- **website:** add style controls to ProseSection and FeatureList
- **website:** add SectionContainer shared wrapper
- **website:** add Testimonials component
- **website:** add LogoCloud component
- **website:** add Stats component
- **website:** add ArticleHero component
- **website:** add PostGrid component
- **website:** add BlogPostTemplate component
- **website:** add TeamGrid component
- **website:** add PricingTable component
- **website:** add ContactSection component
- **website:** add VideoEmbed component
- **website:** expand ContentPageTemplate with new template variants
- **website:** export all new section components from index
- **website:** register new components and restructure sidebar categories
- **website:** update Flex/Grid disallow lists for new section components
- **website:** add editable terminal command to Hero with typing animation
- **website:** wire CMS image picker into Puck section image fields
- **website, astro-cms:** add startsNewSection toggle to ContentBlockSection
- **website, cms-spa:** improve Puck editor experience with inline editing, accessibility, and shared components
- **website, cms-spa:** Puck editor quick wins
- **website, cms-spa:** second-pass Puck editor UX improvements
- **website-with-cms:** add CMS-managed /about page with layout

### 🩹 Fixes

- skip own injected routes in conflict detection (ISS-011)
- resolve TypeScript errors in content-api
- patch acorn ESM entry with default export for Node 25+
- restore ^/~ version ranges, add versionGroups pins for React
- pin happy-dom to 20.6.1 to avoid SelectorParser regression
- remove //happy-dom-pin comment from devDependencies
- remove //happy-dom-pin comment from devDependencies
- align remaining package type declarations with .d.mts extension
- add explicit query type params to fix tsdown declaration bundling
- **10.7-01:** apply template pathPrefix when generating path from title
- **10.8-03:** disable dts generation in remaining packages
- **10.8-03:** bundle simple-git for better DX
- **10.8-03:** use git repo root for operations
- **11.5-01:** enable DTS generation in all packages
- **11.5-01:** fix TypeScript errors blocking typecheck
- **22-01:** clean up astro-cms package
- **260330-t8w:** restore navbar, reveal CSS, and client scripts in CMSPageLayout
- **260330-t8w:** add terminal mock-up, background effects, microdata, and bounce animation to Hero
- **260330-t8w:** add reveal animations, microdata, and background gradients to sections
- **31-04:** remove React component exports from astro-cms index
- **42:** use configurable API base URL and static import
- **42:** add data-context-handler to build entry points
- **46-02:** add type cast to response.json() in uploadAsset
- **46-04:** add sourceFolder to bulk move mutation
- **48-01:** dashboard grid layout and media count
- **49-02:** resolve TypeScript errors for virtual module imports
- **58:** auto-close picker on image selection in Puck fields
- **64-01:** remove development export conditions and fix package metadata
- **64-02:** simplify plugin-spa.ts PAGE_HANDLER_PATH resolution
- **64-02:** export RenderWithHydration and route utils for page-handler
- **64-02:** convert page-handler.astro to package imports
- **64-02:** remove broken ESLint formatter for .astro files
- **65-01:** replace hardcoded cms-spa/src/main.tsx with conditional detection
- **77-02:** rewrite pull-from-public workflow with correct actions and error handling
- **80-01:** fix private repo sync workflows token and permission bugs
- **80-01:** update package.json repository fields for npm OIDC publishing
- **Q009-01:** correct type exports from .d.mts to .d.ts across all packages
- **Q123:** path traversal protection, debug log removal, buffer type safety
- **Q123:** eliminate layer violations and fix object URL memory leak
- **Q153:** relax react peerDependency from exact 19.2.4 to ^19.0.0
- **Q162:** scope git operations to contentPath directory only (GL-71)
- **Q163:** convert resolveFilename from sync existsSync to async access() (GL-72)
- **Q164:** batch moveAssets manifest updates via single withManifest call
- **Q171:** remove dead customName code from UploadModal (GL-80)
- **Q175:** CFAccessUser email/sub use undefined instead of empty string (GL-84)
- **Q175:** guard X-CF-User-Email/Sub headers -- only set when truthy (GL-84)
- **astro-cms:** resolve routing system bugs
- **astro-cms:** correct virtual module page API content access
- **astro-cms:** resolve TypeScript errors in hydration components
- **astro-cms:** externalize vite in tsdown config
- **astro-cms:** add missing @testing-library/jest-dom dependency
- **astro-cms:** include source components and lib in published package
- **astro-cms:** pass contentRoot to router for git operations
- **astro-cms:** move astro, vite, plugin-react to peerDependencies
- **astro-cms:** disable aggressive caching for CMS assets in dev mode
- **astro-cms:** use no-store cache header for dev-mode assets
- **astro-cms:** escape JSON.stringify output in script tags to prevent XSS (GL-66)
- **astro-cms:** narrow safeJsonStringify return type with overloads
- **astro-cms:** add path traversal protection to handleSpa asset serving (GL-69)
- **astro-cms:** remove debug console.log statements from cms-handler (GL-70)
- **astro-cms:** add display:contents to HydrationWrapper div for layout transparency
- **astro-cms:** gate error details behind import.meta.env.DEV (GL-78)
- **astro-cms:** add assertion and DRY constant for undocumented viteReact.preambleCode API (GL-87)
- **astro-cms:** comprehensive bun link compatibility for SSR and CMS SPA
- **astro-cms:** externalize xxhash platform binaries
- **astro-cms:** keep server-only packages out of SSR bundles
- **astro-cms:** route static pages from Astro collections
- **astro-cms:** lazy-load content api in integration
- **astro-cms:** use dynamic import for content-api/node in loader and collections
- **astro-cms:** refresh content collections after CMS saves
- **astro-cms:** shim acorn for static page builds
- **astro-cms:** externalize native xxhash deps in SSR builds
- **astro-cms:** externalize xxhash native binary subpath
- **astro-cms:** externalize native deps for static builds
- **astro-cms:** externalize native deps for static builds
- **astro-cms:** narrow static content imports
- **astro-cms:** externalize native xxhash in static builds
- **astro-cms:** resolve MDX blocks from stable Astro collection
- **astro-cms:** add clsx to dependencies
- **astro-cms:** resolve TypeScript errors in RenderWithBlocks and spec tsconfig
- **astro-cms:** production renderer parity — mergeDefaultProps, resolveAllData, hydration
- **astro-cms:** use correct prop name for hydration component IDs
- **astro-cms:** render MDX block content in narrative sections and guard against zone data loss
- **astro-cms:** deduplicate publish-date logic and improve production error handling
- **astro-cms:** widen peerDependencies for astro 6 and vite 7
- **astro-cms:** respect width/tone/label in narrative sections
- **astro-cms:** fix ContentBlockSection render order and clean up logging
- **astro-cms:** fix getStaticPaths scope isolation for isPublished
- **astro-cms:** scope conflict detector to project routes only
- **astro-cms:** only strip ./ prefix in siteStylesLoader path conversion
- **astro-cms:** load cms-spa entry via consumer symlink path
- **biome:** remove invalid formatWithErrors key from CSS config
- **build:** make packages/ self-contained for subtree sync (GL-63)
- **ci:** add build dependency order for website-with-cms
- **ci:** add libstdc++ for native Node.js modules
- **ci:** remove extensionless loader from build command
- **ci:** add @node-rs/xxhash as direct dependency
- **ci:** add missing type definitions for tests
- **ci:** add missing @happy-dom/global-registrator to astro-cms
- **ci:** add missing dependencies for tests
- **ci:** standardize bun types across packages
- **ci:** resolve test failures on feat/routing-abstraction branch
- **ci:** remove PUBLIC_REPO_TOKEN from sync-public checkout step
- **ci:** add nix-store verify+repair before NAR export
- **ci:** switch private sync workflows to GitHub App auth
- **ci:** configure git identity for docs sync clone
- **ci:** pin GitHub App token action to valid SHA
- **ci:** add app permission diagnostics for public sync
- **ci:** stop checkout credentials overriding app auth
- **ci:** sync public repo through branch PRs
- **ci:** pin third-party GitHub Actions to commit SHAs
- **ci:** revert package types from .d.mts back to .d.ts
- **ci:** run full test suite on main and patch happy-dom SelectorParser crash
- **ci:** align nx affected SHAs with private base branch
- **ci:** align branch rename across nx SHA resolution
- **ci:** set PR nx SHAs from GitHub event context
- **cms-spa:** show build mode in console output
- **cms-spa:** add Tailwind @source for own directory
- **cms-spa:** load CSS via link tag in dev mode
- **cms-spa:** skip broken integration tests pending UI redesign
- **cms-spa:** add @mdxeditor/editor dependency for ImagePickerDialog
- **cms-spa:** export SPA mounting entry for npm consumers
- **cms-spa:** make Pull button visible with correct bg-blue-500 class
- **cms-spa:** reset stale dialog state on reopen (GL-90)
- **cms-spa:** merge defaultProps when adding components via DrawerItemOverride
- **cms-spa:** add concurrent save guard and improve error handling
- **cms-spa:** align ContentBlockSection editor styles with production tokens
- **cms-spa:** align ImageUrlField folder fallback with ImageField
- **cms-spa:** use imperative MDXEditor API for snippet insert and reset
- **cms-spa:** match CBS editor preview to production render order
- **cms-spa:** add ARIA combobox attributes to ContentBlockSelectorField
- **cms-spa:** return minimal fallback instead of silent first-template
- **cms-spa:** remove debug logging and unused ContentDiff integration
- **cms-spa:** improve accessibility across editor components
- **cms-spa:** add config.components to Puck test mock
- **cms-spa:** update conflict test to match component behavior
- **cms-spa:** prevent dark mode FOUC for system theme preference
- **cms-spa:** AssetDetailSidebar slide-in on mobile
- **cms-spa:** dark mode and responsive layout when CMS is hosted in conloca website
- **cms-spa:** split sidebar git toolbar into 2 rows so labels fit
- **cms-spa:** green CI — revert PageList Radix migration, wrap tests in ThemeProvider
- **cms-spa:** remove unused @ts-expect-error in test-utils
- **cms-spa:** readable page title link in dark mode
- **cms-spa:** legible path link hover in dark mode
- **cms-spa:** lift recent activity path contrast in dark mode
- **cms-spa:** restore visibility in block list and upload zone
- **cms-spa:** isolate styles in cms-admin cascade layer
- **cms-spa:** tint git status badges for light-mode contrast
- **cms-spa:** make useCanvasTheme tolerant of missing provider
- **cms-spa:** make useTheme tolerant of missing provider
- **cms-spa/dialogs:** restore dark-mode field visibility
- **cms-spa/editor:** stop right panel breadcrumbs from overlapping
- **cms-spa/media:** fit toolbar controls on one row
- **content-api:** resolve /assets/move route conflict with /:site/move
- **content-api:** externalize vite in tsdown build config
- **content-api:** harden importFromUrl with SSRF validation, timeout, and size limit (GL-65)
- **content-api:** fix fetch mock preconnect type errors in asset-operations tests
- **content-api:** separate onReindexed callback error handling from reindex
- **content-api:** use node: prefix for path import
- **content-api:** align type declarations with emitted .d.mts extension
- **content-api:** improve type safety and logging
- **content-api-client:** fix Buffer and preconnect type errors in asset-routes test
- **content-api-client:** remove demo-only asset-routes test
- **content-api-client:** align asset endpoint routes with server (GL-96)
- **content-api-client:** simplify asset upload return types
- **dashboard:** count media assets recursively in folder tree
- **devenv:** avoid shell expansion when formatting package.json
- **devenv:** remove Nix git to preserve macOS Keychain credentials
- **docs:** replace @measured/puck with @puckeditor/core and fix asset endpoint URLs
- **docs:** correct enableDevtools default and remove auth from main config examples
- **docs:** correct API response shapes, mark Coming Soon endpoints, fix hook signatures
- **docs:** correct getCurrentUser return type, add missing useBulkDeleteAssets hook
- **docs:** correct inaccurate code examples and option names across documentation
- **editor:** match Puck metadata nesting for resolveData
- **editor:** pre-resolve Puck data to ensure data-bound components render correctly
- **editor:** stabilize Puck overrides reference to prevent field focus loss
- **editor:** add cache-busting timestamp to preview URL
- **git:** include data/\*.json files in GitHub commits
- **mdx:** add missing gray-matter dependency
- **mdx:** resolve CI build failures from circular dependencies
- **mdx:** resolve gurx context isolation in tests
- **mdx:** require dependency builds before running tests in CI
- **mdx:** mock cms-spa imports in tests to fix CI resolution
- **mdx:** move MDX compilation from browser to server
- **mdx:** move MDX compilation from browser to server
- **mdx:** pass development flag to MDX run options
- **mdx:** accept jsxComponentDescriptors to render unknown JSX children
- **media:** remove duplicate Root folder from tree display
- **media:** rename "All Assets" to "Root" for clarity
- **media:** extract shared buildAssetServeUrl to fix sidebar image preview in subfolders
- **media:** replace bulk delete hook with direct client calls for single cache invalidation (GL-97)
- **media-library:** support subfolder assets in thumbnails
- **packages:** add src/ to files arrays and bump versions to 0.1.1
- **release:** add lockfile version sync workaround for bun publish bug
- **security:** add CF Access validation to data-context endpoint
- **sync:** never push private-source tracking refs to public-repo
- **test:** update preview URL assertion for cache-busting timestamp
- **tests:** remove flaky timing assertions
- **tooling:** add --format-with-errors for CSS files with unsupported directives
- **website:** flatten docs into Starlight content collection root
- **website:** fix Starlight docs config and broken internal links
- **website:** add missing Tailwind CSS import to landing page Layout.astro
- **website:** mobile nav backdrop, email a11y, footer touch target
- **website:** hide theme chooser and fix sidebar active link readability
- **website:** fix 3 broken internal links in docs
- **website:** clean up remaining docs mismatches
- **website:** harden signup endpoint and github links
- **website:** point GitHub links to conloca repo
- **website:** use public d1 auto-provisioning
- **website:** simplify signup worker config
- **website:** fix cursor blink, email validation order, and dead code
- **website:** fix broken \_\_cms link, color contrast, and missing autocomplete
- **website:** use link syntax for \_\_cms URL to avoid prettier escaping
- **website:** fix broken \_\_cms link, color contrast, and missing autocomplete
- **website:** use absolute paths for navbar anchor links
- **website:** remove misleading AI SEO claims from marketing text
- **website:** correct wrong GitHub URLs, Bun-only claims, and Decap i18n
- **website:** remove false cache-control claim and wrong dev-branch marker
- **website:** improve light mode contrast for accent colors and code blocks
- **website:** unify theme toggle across landing and docs pages (GL-116)
- **website:** correct VxJSON content-last explanation per GL-115 feedback
- **website:** pin zod 3.25.76 and add Starlight 404 content entry
- **website:** build CMS packages before site build
- **website:** use Conloca routing for content pages
- **website:** move docs index to /overview so CMS homepage serves at /
- **website:** add dark mode support to Puck section components
- **website:** update VxJSON page badge text and add 4K icon text
- **website:** add responsive layouts and arrow icons to Puck components
- **website:** correct heading color and make display.md responsive
- **website:** align section heading sizes and label spacing with production
- **website:** match Hero, RichTextSection, and CTABanner to production
- **website:** align dev site with production — spacing, content, mobile overflow, FAQ
- **website:** add missing @node-rs/xxhash dependency
- **website:** install externalized xxhash runtime dependency
- **website:** remove unnecessary hydration and sync docs routes
- **website:** remove extra landing page top padding
- **website:** preserve safe content section styling
- **website:** conditional FeatureCards header and compact spacing
- **website:** add page bottom padding and dev subscribe endpoint
- **website:** remove mock subscribe endpoint (breaks static build)
- **website:** Puck component data integrity — unique IDs, radio types, resolveData
- **website:** Puck editor UX — field labels, readOnly, React keys, constraints
- **website:** eliminate XSS vector in RichTextSection
- **website:** guard CTA sections against rendering when content is empty
- **website:** fix withLayout grow radio values and compose resolveFields
- **website:** add placeholder to Image alt text field
- **website:** use text type for contentEditable fields instead of textarea
- **website:** sync IconPickerField local state with incoming value prop
- **website:** add IP-based rate limiting to /api/subscribe endpoint
- **website:** remove duplicate typing animation from CMSPageLayout
- **website:** forward readOnly prop to custom Puck field renderers
- **website:** normalize VXJSON files to canonical serializer format
- **website:** replace broken :::note syntax with Aside components in API docs
- **website:** correct docs inaccuracies and add missing content
- **website:** Badge component dark mode support
- **website:** footer year, robots.txt, and CI workflow ordering
- **website:** remove duplicate Google Fonts @import
- **website:** add trailing newline to robots.txt
- **website:** remove circular self-referencing aside in architecture docs
- **website:** add rate limiter eviction and remove unused OPTIONS handler
- **website:** docs accuracy fixes
- **website:** fix Hero contentEditable and Schema.org issues
- **website:** make HostedComparison headers editable and widen field types
- **website:** default headingLevel to h2 and narrow type assertions
- **website:** validate hex color input on blur in ColorField
- **website:** normalize VXJSON files and add missing differentiator props
- **website:** add request body size limit and email length validation
- **website:** show server error messages and persist success state
- **website:** re-observe reveal elements after view transitions
- **website:** support view transitions for typing animation
- **website:** add passive flag to scroll event listener
- **website:** handle multiple ThemeSelect instances via querySelectorAll
- **website:** prevent link navigation in editor for NumberedFlow
- **website:** use semantic color tokens for Divider dark mode support
- **website:** use theme-aware background for Image placeholder
- **website:** improve Puck component editor experience
- **website:** complete truncated MDX block content
- **website:** tone down comparison page copy
- **website:** improve SEO schema accuracy
- **website:** improve signup form and worker reliability
- **website:** revert routing workarounds for Starlight coexistence
- **website:** fix Hero contentEditable crash in CMS editor
- **website:** use crypto.randomUUID for ContentPageHero breadcrumb IDs
- **website:** add puck prop and click prevention to ContentPageHero
- **website:** hide breadcrumb id field from ContentPageHero editor
- **website:** add scroll reveal animation to FeatureList items
- **website:** restore Hero production parity for MinimalHero and MarketingHero
- **website:** simplify CTABanner to match production structure
- **website:** add explicit marketing variant to homepage Hero data
- **website:** add minimal variant to VxJSON page Hero data
- **website:** hide placeholder images on live site in HostedComparison
- **website:** replace arbitrary CSS values with standard Tailwind classes
- **website:** differentiate network vs server errors in newsletter form
- **website:** restore @astrojs/internal-helpers direct dependency
- **website:** render Hero title in CMS editor when contentEditable is active
- **website:** log D1 subscriber insert failures via console.error
- **website:** narrow Puck Field union instead of casting to any
- **website:** load Inter font and declare body defaults

### 🔥 Performance

- **cms-spa:** skip Bun bundling in dev mode
- **cms-spa:** externalize React from production bundle
- **content-api:** cache resolveRepoRoot in createGitOperations closure (GL-83)

### ❤️ Thank You

- Danny Wilson
- Niko Tsiklauri

## 0.1.14 (2026-03-09)

### 🚀 Features

- **62-01:** create publish.yml workflow with OIDC trusted publishing
  ([bcf135b](https://github.com/conloca/private/commit/bcf135b))
- **77-01:** fix sync-public workflow and subtree push scripts
  ([769de64](https://github.com/conloca/private/commit/769de64))
- **Q164:** add withManifest() promise-based mutex to AssetManifest
  ([cd929dc](https://github.com/conloca/private/commit/cd929dc))
- **Q170:** create useUploadFlow hook extracting shared upload logic
  ([97be546](https://github.com/conloca/private/commit/97be546))
- **astro-cms:** replace MIME type if/else chain with SPA_MIME_TYPES map (GL-86)
  ([ea6efdf](https://github.com/conloca/private/commit/ea6efdf))
- **ci:** add content/docs sync to public repo workflow ([08941f2](https://github.com/conloca/private/commit/08941f2))
- **cms-spa:** make page list title and path cells clickable preview links
  ([5611c20](https://github.com/conloca/private/commit/5611c20))
- **content-api:** add validateFetchUrl utility for SSRF prevention (GL-65)
  ([690cd0e](https://github.com/conloca/private/commit/690cd0e))
- **content-api-client:** add DataContext types, client method, and useDataContext hook (GL-81)
  ([ebe9e1a](https://github.com/conloca/private/commit/ebe9e1a))

### 🩹 Fixes

- **77-02:** rewrite pull-from-public workflow with correct actions and error handling
  ([2abdca4](https://github.com/conloca/private/commit/2abdca4))
- **Q153:** relax react peerDependency from exact 19.2.4 to ^19.0.0
  ([ad0d03b](https://github.com/conloca/private/commit/ad0d03b))
- **Q162:** scope git operations to contentPath directory only (GL-71)
  ([2e4a330](https://github.com/conloca/private/commit/2e4a330))
- **Q163:** convert resolveFilename from sync existsSync to async access() (GL-72)
  ([a705965](https://github.com/conloca/private/commit/a705965))
- **Q164:** batch moveAssets manifest updates via single withManifest call
  ([03f33b6](https://github.com/conloca/private/commit/03f33b6))
- **Q171:** remove dead customName code from UploadModal (GL-80)
  ([091c882](https://github.com/conloca/private/commit/091c882))
- **Q175:** CFAccessUser email/sub use undefined instead of empty string (GL-84)
  ([f1b24b4](https://github.com/conloca/private/commit/f1b24b4))
- **Q175:** guard X-CF-User-Email/Sub headers -- only set when truthy (GL-84)
  ([579a460](https://github.com/conloca/private/commit/579a460))
- **astro-cms:** escape JSON.stringify output in script tags to prevent XSS (GL-66)
  ([d060a06](https://github.com/conloca/private/commit/d060a06))
- **astro-cms:** narrow safeJsonStringify return type with overloads
  ([0701c8d](https://github.com/conloca/private/commit/0701c8d))
- **astro-cms:** add path traversal protection to handleSpa asset serving (GL-69)
  ([408634e](https://github.com/conloca/private/commit/408634e))
- **astro-cms:** remove debug console.log statements from cms-handler (GL-70)
  ([378dbeb](https://github.com/conloca/private/commit/378dbeb))
- **astro-cms:** add display:contents to HydrationWrapper div for layout transparency
  ([94c515a](https://github.com/conloca/private/commit/94c515a))
- **astro-cms:** gate error details behind import.meta.env.DEV (GL-78)
  ([4e44c4d](https://github.com/conloca/private/commit/4e44c4d))
- **astro-cms:** add assertion and DRY constant for undocumented viteReact.preambleCode API (GL-87)
  ([76a0c0e](https://github.com/conloca/private/commit/76a0c0e))
- **astro-cms:** comprehensive bun link compatibility for SSR and CMS SPA
  ([53030a5](https://github.com/conloca/private/commit/53030a5))
- **cms-spa:** reset stale dialog state on reopen (GL-90) ([f9de534](https://github.com/conloca/private/commit/f9de534))
- **content-api:** harden importFromUrl with SSRF validation, timeout, and size limit (GL-65)
  ([6bce4ce](https://github.com/conloca/private/commit/6bce4ce))
- **content-api:** fix fetch mock preconnect type errors in asset-operations tests
  ([5b98f01](https://github.com/conloca/private/commit/5b98f01))
- **content-api-client:** fix Buffer and preconnect type errors in asset-routes test
  ([13ce31f](https://github.com/conloca/private/commit/13ce31f))
- **content-api-client:** remove demo-only asset-routes test
  ([2bc8215](https://github.com/conloca/private/commit/2bc8215))
- **content-api-client:** align asset endpoint routes with server (GL-96)
  ([52c115c](https://github.com/conloca/private/commit/52c115c))
- **media:** replace bulk delete hook with direct client calls for single cache invalidation (GL-97)
  ([6bfb4fc](https://github.com/conloca/private/commit/6bfb4fc))

### 🔥 Performance

- **content-api:** cache resolveRepoRoot in createGitOperations closure (GL-83)
  ([14026e8](https://github.com/conloca/private/commit/14026e8))

### ❤️ Thank You

- Niko Tsiklauri

## 0.1.13 (2026-03-04)

### 🩹 Fixes

- **80-01:** fix private repo sync workflows token and permission bugs
  ([923c768](https://github.com/conloca/private/commit/923c768))
- **80-01:** update package.json repository fields for npm OIDC publishing
  ([3a9b92e](https://github.com/conloca/private/commit/3a9b92e))
- **Q123:** path traversal protection, debug log removal, buffer type safety
  ([b139776](https://github.com/conloca/private/commit/b139776))
- **Q123:** eliminate layer violations and fix object URL memory leak
  ([b0cba99](https://github.com/conloca/private/commit/b0cba99))
- **build:** make packages/ self-contained for subtree sync (GL-63)
  ([85592f6](https://github.com/conloca/private/commit/85592f6))
- **ci:** remove PUBLIC_REPO_TOKEN from sync-public checkout step
  ([d3c38cb](https://github.com/conloca/private/commit/d3c38cb))

### ❤️ Thank You

- Niko Tsiklauri

## 0.1.12 (2026-03-02)

### 🚀 Features

- **77-01:** fix sync-public workflow and subtree push scripts
  ([8b124b1](https://github.com/conloca/private/commit/8b124b1))
- **ci:** add content/docs sync to public repo workflow ([9697a62](https://github.com/conloca/private/commit/9697a62))

### 🩹 Fixes

- **77-02:** rewrite pull-from-public workflow with correct actions and error handling
  ([18e77ea](https://github.com/conloca/private/commit/18e77ea))
- **astro-cms:** use no-store cache header for dev-mode assets
  ([8253cfd](https://github.com/conloca/private/commit/8253cfd))
- **dashboard:** count media assets recursively in folder tree
  ([b1c0952](https://github.com/conloca/private/commit/b1c0952))
- **editor:** add cache-busting timestamp to preview URL ([a124631](https://github.com/conloca/private/commit/a124631))
- **test:** update preview URL assertion for cache-busting timestamp
  ([dc18152](https://github.com/conloca/private/commit/dc18152))

### ❤️ Thank You

- Niko Tsiklauri
