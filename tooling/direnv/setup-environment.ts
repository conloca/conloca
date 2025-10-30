#!/usr/bin/env bun
import { $, file } from 'bun';
import { existsSync } from 'fs';
import path from 'path';

const devenvRoot = process.env.DEVENV_ROOT;
const projectRoot = path.resolve(`${devenvRoot}/../..`);

// Go to project root
process.chdir(projectRoot);

try {
  // Install dependencies first so node_modules/.bin tools are available
  if (process.env.CI) {
    try {
      await $`bun install --frozen-lockfile`;
    } catch {
      console.error('! Failed to install dependencies with frozen lockfile');
      await $`bun install`;
      console.error('git diff after install:');
      await $`git diff`;
      process.exit(1);
    }
  } else {
    await $`bun install --no-summary`;
  }

  // Make sure Biome is executable
  await $`chmod +x ${projectRoot}/node_modules/@biomejs/biome/bin/biome`;

  if (!process.env.CI) {
    // Update package.json with current versions from devenv
    const nodeVersion = (await $`node --version`.text()).trim().replace('v', '');
    const bunVersion = (await $`bun --version`.text()).trim();

    const packageJson = await file('package.json').json();

    const expectedNodeEngine = `>=${nodeVersion.split('.')[0]}.0.0`;
    const expectedPkgManager = `bun@${bunVersion}`;
    const expectedTypesNode = `~${nodeVersion.split('.')[0]}.0.0`;

    if (
      packageJson.engines?.node !== expectedNodeEngine ||
      packageJson.packageManager !== expectedPkgManager ||
      packageJson.devDependencies?.['@types/node'] !== expectedTypesNode
    ) {
      packageJson.engines ||= {};
      packageJson.engines.node = expectedNodeEngine;
      packageJson.packageManager = expectedPkgManager;
      packageJson.devDependencies ||= {};
      packageJson.devDependencies['@types/node'] = expectedTypesNode;

      await $`echo ${JSON.stringify(packageJson)} | biome format --stdin-file-path=package.json > package.json`;
    }
  }

  // Apply workspace git configuration
  const gitConfigScript = `${devenvRoot}/apply-workspace-git-config.sh`;
  if (existsSync(gitConfigScript)) {
    await $`${gitConfigScript}`;
  }
} catch (error) {
  console.error(`--- ERROR: setup-environment.ts failed: ${error}`);
  if (error.stderr) {
    process.stderr.write(error.stderr);
    console.error('\n---');
  }
  process.exit(1);
}
