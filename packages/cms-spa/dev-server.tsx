import { $ } from 'bun';
import index from './src/dev.html';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

declare global {
  var __watchersStarted: boolean;
}

// Keep track of whether we've already started the watchers (use global to persist across hot reloads)
if (!globalThis.__watchersStarted) {
  globalThis.__watchersStarted = true;

  // Process Tailwind CSS
  console.log(`${colors.cyan}🎨 Processing CSS with Tailwind...${colors.reset}`);
  await $`bunx @tailwindcss/cli -i ./src/main.css -o ./src/main.processed.css`;

  // Shared output buffer system
  const processBuffers = new Map<string, { output: string; hasError: boolean }>();
  let flushTimer: Timer;

  const flushOutput = () => {
    // Print each process's buffered output
    processBuffers.forEach(({ output, hasError }, processName) => {
      // Trim trailing whitespace for tsc
      const trimmed = processName === 'tsc' ? output.trimEnd() : output.trim();

      if (trimmed) {
        const color = hasError ? colors.red : colors.green;
        const lines = trimmed.split('\n');
        console.log(`${color}[${processName}]${colors.reset} ${lines[0]}`);
        lines.slice(1).forEach((line) => console.log(line));
        console.log(`${colors.dim}${'─'.repeat(80)}${colors.reset}`);
      }
    });

    // Clear all buffers
    processBuffers.clear();
  };

  // Helper function to create a buffered output handler for processes
  function createProcessOutputHandler(processName: string) {
    return (chunk: Uint8Array, isStderr = false) => {
      const text = new TextDecoder().decode(chunk);

      // Get or create buffer for this process
      const buffer = processBuffers.get(processName) || { output: '', hasError: false };
      buffer.output += text;
      if (isStderr) buffer.hasError = true;
      processBuffers.set(processName, buffer);

      // Reset flush timer
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(flushOutput, 100);
    };
  }

  // Helper to spawn and monitor a process
  function spawnWatcher(name: string, cmd: string[], options?: any) {
    const handler = createProcessOutputHandler(name);
    const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', ...options });

    // Connect output streams
    proc.stdout.pipeTo(new WritableStream({ write: (chunk) => handler(chunk, false) }));
    proc.stderr.pipeTo(new WritableStream({ write: (chunk) => handler(chunk, true) }));

    // Monitor exit
    proc.exited.then((code) => {
      const msg = code === 0 ? `!  ${name} watch ended` : `❌ ${name} watch exited with code ${code}`;
      console.log(`${code === 0 ? colors.yellow : colors.red}${msg}${colors.reset}`);
    });

    return proc;
  }

  // Start Tailwind watch
  console.log(`${colors.cyan}👁  Starting Tailwind watch process...${colors.reset}`);
  spawnWatcher(
    'tailwind',
    ['bunx', '@tailwindcss/cli', '-i', './src/main.css', '-o', './src/main.processed.css', '--watch=always'],
    { env: { ...process.env, FORCE_COLOR: '1' } },
  );

  // Start TypeScript watch
  console.log(`${colors.blue}🔍 Starting TypeScript watch process...${colors.reset}`);
  spawnWatcher('tsc', ['tsc', '--build', 'tsconfig.lib.json', '--watch', '--preserveWatchOutput', '--pretty']);
} else {
  console.log(`${colors.dim}Reloading dev server (watch processes still running)...${colors.reset}`);
}

// Bun fullstack dev server
Bun.serve({
  port: 3000,
  development: {
    hmr: true,
    console: true,
  },
  routes: {
    '/': index,
  },
});

console.log(
  `${colors.green}${colors.bright}✨ CMS dev server running at ${colors.cyan}http://localhost:3000${colors.reset}`,
);
console.log(`${colors.green}🔥 Hot Module Replacement enabled!${colors.reset}`);
console.log(`${colors.dim}Press Ctrl+C to stop${colors.reset}\n`);
