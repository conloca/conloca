import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Connect } from 'vite';
import { componentsEndpointBody, type ReadPuckConfigOptions } from './read-config.js';

/**
 * Where the endpoint reads from: the config itself, and the host tsconfig that
 * makes the config's imports resolve. Both are taken against the one project
 * root, so a relative `puckConfigPath` and the tsconfig can never come from
 * two different directories. A build that publishes the components reads
 * through the same options, so what it publishes is what dev serves.
 *
 * The tsconfig is handed over only when it is really there. Naming a file that
 * does not exist would silence the reader's own search for the nearest
 * tsconfig above the config, and a project with no `jsx` option resolves an
 * import of a `.tsx` file to nothing at all with no error — the site would
 * read as every component unresolved and nothing would say why.
 */
export function endpointReaderOptions(paths: { puckConfigPath: string; projectRoot: string }): ReadPuckConfigOptions {
  const hostTsConfig = join(paths.projectRoot, 'tsconfig.json');
  return {
    configPath: resolve(paths.projectRoot, paths.puckConfigPath),
    ...(existsSync(hostTsConfig) && { tsConfigFilePath: hostTsConfig }),
  };
}

/**
 * Vite middleware that returns the Puck component vocabulary as JSON: every
 * component the config declares and what each accepts, read from source and
 * never executed.
 *
 * The config is read per request — a few hundred milliseconds cold — so an
 * edit to it shows up without a dev-server restart, the way the registry
 * rescan does.
 */
export function createComponentsEndpoint(options: ReadPuckConfigOptions): Connect.NextHandleFunction {
  return (_req, res, _next) => {
    try {
      const body = componentsEndpointBody(options);
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.end(body);
    } catch (err) {
      // A config that cannot be read is answered with an empty manifest rather
      // than an error, so anything arriving here is a fault in the reader
      // itself and worth saying out loud.
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[conloca:puck-manifest] components endpoint failed:', message);
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: message }));
    }
  };
}
