import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const databaseName = 'conloca-website-db';
const bindingName = 'DB';
const wranglerVersion = '4.73.0';
const tempConfigFileName = 'wrangler.remote.toml';

type D1Database = {
  uuid: string;
  name: string;
};

function runWrangler(arguments_: string[], cwd: string, quiet = false) {
  const result = Bun.spawnSync(['bunx', `wrangler@${wranglerVersion}`, ...arguments_], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    env: process.env,
  });

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();

  if (result.exitCode !== 0) {
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    throw new Error(`Wrangler command failed: ${arguments_.join(' ')}`);
  }

  if (!quiet && stdout) {
    process.stdout.write(stdout);
  }

  return stdout;
}

function readDatabaseId(databasesJson: string) {
  const databases = JSON.parse(databasesJson) as D1Database[];
  const database = databases.find((entry) => entry.name === databaseName);

  if (!database) {
    throw new Error(`Could not find D1 database named '${databaseName}' in this account.`);
  }

  return database.uuid;
}

function addDatabaseIdToConfig(config: string, databaseId: string) {
  const target = `binding = "${bindingName}"\ndatabase_name = "${databaseName}"`;
  const replacement = `${target}\ndatabase_id = "${databaseId}"`;

  if (!config.includes(target)) {
    throw new Error('Could not locate the D1 binding block in wrangler.toml.');
  }

  return config.replace(target, replacement);
}

async function main() {
  const cwd = process.cwd();
  const configPath = join(cwd, 'wrangler.toml');
  const tempConfigPath = join(cwd, tempConfigFileName);
  const config = await readFile(configPath, 'utf8');

  const databasesJson = runWrangler(['d1', 'list', '--json'], cwd, true);
  const databaseId = readDatabaseId(databasesJson);
  const tempConfig = addDatabaseIdToConfig(config, databaseId);

  await writeFile(tempConfigPath, tempConfig);

  try {
    runWrangler(['d1', 'migrations', 'apply', bindingName, '--remote', '--config', tempConfigFileName], cwd);
  } finally {
    await rm(tempConfigPath, { force: true });
  }
}

await main();
