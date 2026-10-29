import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/**
 * What keeps a uv environment location-independent, read and written on the filesystem alone: whether an existing
 * environment is the relocatable one an install leaves (uvEnvironmentRelocatable), and the rewrite of each `.pth`
 * line naming a directory in the checkout as a path relative to its site-packages (relativizeCheckoutPaths).
 * setup-environment.ts's uv installer runs uv and stamps; this module decides nothing about when.
 */

function sitePackagesDirectories(environment: string): string[] {
  const lib = path.join(environment, 'lib');
  const directories: string[] = [];
  for (const python of existsSync(lib) ? readdirSync(lib) : []) {
    if (!python.startsWith('python')) continue;
    const sitePackages = path.join(lib, python, 'site-packages');
    if (existsSync(sitePackages)) directories.push(sitePackages);
  }
  return directories;
}

/** One shell command line as its words: quotes group, backslash escapes, no expansion. */
function shellWords(line: string): string[] {
  const words: string[] = [];
  let word = '';
  let quote: string | null = null;
  let started = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? '';
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === '\\' && quote === '"' && index + 1 < line.length) word += line[++index];
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === '\\' && index + 1 < line.length) {
      word += line[++index];
      started = true;
    } else if (/\s/.test(char)) {
      if (started || word !== '') words.push(word);
      word = '';
      started = false;
    } else {
      word += char;
    }
  }
  if (started || word !== '') words.push(word);
  return words;
}

/**
 * Whether an existing environment is the relocatable one install would leave: its config says
 * so, no launcher or interpreter link names an environment or a checkout (its own, a foreign
 * one, or a checkout's .devenv profile, in a shebang, a wrapper's exec argv, or the link
 * itself), and no `.pth` line is an absolute path. The stamp alone cannot witness this — a
 * copied checkout carries a matching stamp and an old absolute launcher together, and admits
 * the launcher forever.
 */
export function uvEnvironmentRelocatable(environment: string): boolean {
  let config: string;
  try {
    config = readFileSync(path.join(environment, 'pyvenv.cfg'), 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
  if (!/^relocatable\s*=\s*true\s*$/m.test(config)) return false;
  const environmentReal = realpathSync(environment);
  // Whether an absolute interpreter path names an environment or a checkout, as opposed to a
  // store or system interpreter, which names neither: it is inside this environment, inside
  // another environment (its home carries pyvenv.cfg), under a checkout's .devenv state, or
  // it no longer exists at all.
  const namesEnvironment = (interpreter: string): boolean => {
    if (interpreter.startsWith(`${environment}/`) || interpreter.startsWith(`${environmentReal}/`)) return true;
    if (!existsSync(interpreter)) return true;
    if (interpreter.split(path.sep).includes('.devenv')) return true;
    const home = path.dirname(path.dirname(interpreter));
    return existsSync(path.join(home, 'pyvenv.cfg')) && home !== environment && home !== environmentReal;
  };
  const bin = path.join(environment, 'bin');
  if (existsSync(bin)) {
    const buffer = Buffer.alloc(256);
    for (const name of readdirSync(bin)) {
      const file = path.join(bin, name);
      let size: number;
      let isFile: boolean;
      let isLink = false;
      try {
        const stat = statSync(file);
        size = stat.size;
        isFile = stat.isFile();
        isLink = lstatSync(file).isSymbolicLink();
      } catch {
        return false;
      }
      if (!isFile) continue;
      if (isLink) {
        // The interpreter link itself is witnessed lexically, but only when it leaves the
        // environment: a relative alias (bin/python3 -> python) is the layout uv itself
        // writes and stays inside it. An absolute link into another checkout's .devenv
        // state names that checkout even when its final target is a store interpreter,
        // and no shebang reading ever sees it.
        let linkTarget: string;
        try {
          linkTarget = readlinkSync(file);
        } catch {
          return false;
        }
        if (path.isAbsolute(linkTarget)) {
          const lexical = path.resolve(bin, linkTarget);
          if (lexical.split(path.sep).includes('.devenv')) return false;
          const linkHome = path.dirname(path.dirname(lexical));
          if (existsSync(path.join(linkHome, 'pyvenv.cfg')) && linkHome !== environment && linkHome !== environmentReal)
            return false;
        } else {
          // A relative alias that resolves outside the environment is judged by where it
          // lands, like an absolute one; only aliases staying inside are uv's own layout.
          const lexical = path.resolve(bin, linkTarget);
          if (
            !lexical.startsWith(`${environment}${path.sep}`) &&
            !lexical.startsWith(`${environmentReal}${path.sep}`) &&
            namesEnvironment(lexical)
          )
            return false;
        }
      }
      let head: string;
      try {
        const fd = openSync(file, 'r');
        try {
          head = buffer.toString('utf8', 0, readSync(fd, buffer, 0, buffer.length, 0));
        } finally {
          closeSync(fd);
        }
      } catch {
        return false;
      }
      const shebang = /^#!\s*(\/\S+)(?:\s+(.*))?$/.exec(head.split('\n')[0] ?? '');
      if (shebang === null) continue;
      const interpreter = shebang[1] ?? '';
      const program = path.basename(interpreter);
      if (program === 'env') {
        // An env trampoline naming a bare program resolves through PATH; one naming an
        // absolute interpreter (after any flags, -S included) is judged as that interpreter.
        const tokens = shellWords(shebang[2] ?? '');
        let index = 0;
        while (index < tokens.length && tokens[index]?.startsWith('-')) index += tokens[index] === '-u' ? 2 : 1;
        const target = tokens[index];
        if (target !== undefined && target.startsWith('/') && namesEnvironment(target)) return false;
        continue;
      }
      if (['sh', 'bash', 'dash', 'zsh'].includes(program)) {
        // A relocatable wrapper execs a self-locating interpreter; a legacy one execs an
        // absolute environment path. Only exec lines are judged, tokenized as shell words
        // (quotes group, so spaced paths stay whole; a $VAR expansion is not an absolute
        // path and is never classified).
        if (size > 262_144) return false;
        let body: string;
        try {
          body = readFileSync(file, 'utf8');
        } catch {
          return false;
        }
        for (const line of body.split('\n')) {
          // Producer headers are shell words too: a uv console script's polyglot first
          // line tokenizes to the same exec argv as a plain exec line.
          const words = shellWords(line);
          if (words[0] !== 'exec') continue;
          const target = words.find((word) => word.includes('/bin/python')) ?? words[1];
          if (target !== undefined && target.startsWith('/') && namesEnvironment(target)) return false;
        }
        continue;
      }
      if (namesEnvironment(interpreter)) return false;
    }
  }
  for (const sitePackages of sitePackagesDirectories(environment)) {
    for (const name of readdirSync(sitePackages).filter((entry) => entry.endsWith('.pth'))) {
      const content = readFileSync(path.join(sitePackages, name), 'utf8');
      if (content.split('\n').some((line) => path.isAbsolute(line))) return false;
    }
  }
  return true;
}

/**
 * Rewrite every `.pth` line in the environment's site-packages that names a
 * directory inside the checkout at `checkoutRoot` as a path relative to that
 * site-packages, which is how Python's `site` resolves a relative line. Every
 * other line — an `import` line, a path outside the checkout, a directory that
 * does not exist — stays as uv wrote it.
 */
export function relativizeCheckoutPaths(environment: string, checkoutRoot: string): void {
  const root = `${realpathSync(checkoutRoot)}${path.sep}`;
  for (const sitePackages of sitePackagesDirectories(environment)) {
    const site = realpathSync(sitePackages);
    for (const name of readdirSync(site).filter((entry) => entry.endsWith('.pth'))) {
      const file = path.join(site, name);
      const content = readFileSync(file, 'utf8');
      const rewritten = content
        .split('\n')
        .map((line) => {
          const target = path.isAbsolute(line) && existsSync(line) ? realpathSync(line) : null;
          return target?.startsWith(root) ? path.relative(site, target) : line;
        })
        .join('\n');
      if (rewritten !== content) {
        writeFileSync(file, rewritten);
      }
    }
  }
}
