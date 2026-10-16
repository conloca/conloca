import { buildSandboxSrcdoc, SANDBOX_FRAME_PATH } from '@conloca/mdx/sandbox-frame';
import type { Plugin } from 'vite';

// A directory index gives ordinary static servers an HTML content type for
// the production frame's extensionless URL. Its query-string key is retained.
export const sandboxFrameFileName = `${SANDBOX_FRAME_PATH.slice(1)}/index.html`;

/** The same sandbox document for catalog development, tests, and static builds. */
export function sandboxFramePlugin(): Plugin {
  const html = buildSandboxSrcdoc();
  return {
    name: 'conloca-storybook-sandbox-frame',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url?.split('?', 1)[0];
        if (
          (req.method !== 'GET' && req.method !== 'HEAD') ||
          (pathname !== SANDBOX_FRAME_PATH && pathname !== `${SANDBOX_FRAME_PATH}/`)
        ) {
          return next();
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.statusCode = 200;
        res.end(req.method === 'HEAD' ? undefined : html);
      });
    },
    // `vite preview` finds a directory index only under a trailing slash. Redirect
    // the way directory-index static servers do, so it serves the emitted file.
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? '';
        const queryStart = url.indexOf('?');
        const pathname = queryStart === -1 ? url : url.slice(0, queryStart);
        if ((req.method !== 'GET' && req.method !== 'HEAD') || pathname !== SANDBOX_FRAME_PATH) {
          return next();
        }
        res.statusCode = 301;
        res.setHeader('Location', `${SANDBOX_FRAME_PATH}/${queryStart === -1 ? '' : url.slice(queryStart)}`);
        res.end();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: sandboxFrameFileName, source: html });
    },
  };
}
