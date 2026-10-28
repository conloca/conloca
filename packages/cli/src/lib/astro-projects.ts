import { execFile as execFileCallback } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';
import { promisify } from 'node:util';
import { callOptions, stripComments } from './config-text.js';

const execFile = promisify(execFileCallback);

const ASTRO_CONFIG = /(?:^|\/)astro\.config\.(?:mjs|js|ts|mts|cjs)$/;

/** One Astro project in a repository, and which Conloca integrations its config calls. */
export interface AstroProject {
  /** The project folder as a repository path, `'.'` for the root. */
  dir: string;
  /** The config file as a repository path. */
  configFile: string;
  /** The config calls `conlocaCMS()`. */
  hasCms: boolean;
  /** The config calls `conlocaCloud()`, the integration that serves the editor page. */
  hasEditorIntegration: boolean;
}

/** Every astro.config.{mjs,js,ts,mts,cjs} git tracks or would add, outside node_modules, sorted by dir. */
export async function listAstroProjects(repoRoot: string): Promise<AstroProject[]> {
  const root = resolve(repoRoot);
  const { stdout } = await execFile('git', ['ls-files', '-co', '--exclude-standard', '-z'], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  });
  const configFiles = stdout
    .split('\0')
    .filter((path) => ASTRO_CONFIG.test(path) && !path.split('/').includes('node_modules'));
  const projects = await Promise.all(
    configFiles.map(async (configFile): Promise<AstroProject | null> => {
      // git still lists a tracked file deleted from the working tree; that one is no project.
      const source = await readFile(join(root, configFile), 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (source === null) return null;
      const text = stripComments(source);
      return {
        dir: posix.dirname(configFile),
        configFile,
        hasCms: callOptions(text, 'conlocaCMS').state !== 'no-call',
        hasEditorIntegration: callOptions(text, 'conlocaCloud').state !== 'no-call',
      };
    }),
  );
  const found = projects.filter((project) => project !== null);
  found.sort((a, b) => (a.dir < b.dir || (a.dir === b.dir && a.configFile < b.configFile) ? -1 : 1));
  return found;
}
