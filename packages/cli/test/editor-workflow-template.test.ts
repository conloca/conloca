import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The published template `conloca editor workflow` renders. */
const TEMPLATE = join(import.meta.dir, '..', 'src', 'templates', 'conloca-editor.yml');

const text = await readFile(TEMPLATE, 'utf8');
const workflow: unknown = Bun.YAML.parse(text);

/** The parsed node at `path`, following mapping keys and sequence indexes; undefined where a hop is absent. */
function nodeAt(path: string[]) {
  let node = workflow;
  for (const key of path) {
    node =
      typeof node === 'object' && node !== null ? Object.entries(node).find(([name]) => name === key)?.[1] : undefined;
  }
  return node;
}

/** The text at `path`, or undefined where there is none; anything else there fails the test. */
function textAt(...path: string[]) {
  const node = nodeAt(path);
  if (node !== undefined && typeof node !== 'string') throw new Error(`${path.join('.')} is not text`);
  return node;
}

/** The keys of the mapping at `path`, or the indexes of the sequence there, in template order. */
function keysAt(...path: string[]) {
  const node = nodeAt(path);
  if (typeof node !== 'object' || node === null) {
    throw new Error(`${path.join('.')} is neither a mapping nor a sequence`);
  }
  return Object.keys(node);
}

/** The steps of `job`, with the text fields these tests read. */
function steps(job: string) {
  return keysAt('jobs', job, 'steps').map((index) => {
    const at = ['jobs', job, 'steps', index];
    const env = nodeAt([...at, 'env']) === undefined ? [] : keysAt(...at, 'env');
    return {
      uses: textAt(...at, 'uses'),
      name: textAt(...at, 'name'),
      run: textAt(...at, 'run'),
      artifact: textAt(...at, 'with', 'name'),
      env: Object.fromEntries(env.map((key) => [key, textAt(...at, 'env', key)])),
    };
  });
}

const actions = (job: string) => steps(job).flatMap((step) => (step.uses ? [step.uses] : []));
const artifactName = (job: string, action: string) =>
  steps(job).find((step) => step.uses?.startsWith(`${action}@`))?.artifact;

describe('the published editor workflow template', () => {
  test('starts with no token rights and gives the identity card to the upload job only', () => {
    expect(workflow).toHaveProperty('permissions', {});
    expect(keysAt('jobs')).toEqual(['build', 'upload']);
    expect(workflow).toHaveProperty('jobs.build.permissions', { contents: 'read' });
    expect(workflow).toHaveProperty('jobs.upload.permissions', { 'id-token': 'write' });
  });

  test("pins every action to a full commit of one of GitHub's own actions, and the upload job installs nothing", () => {
    for (const action of [...actions('build'), ...actions('upload')]) {
      expect(action).toMatch(/^actions\/[a-z-]+@[0-9a-f]{40}$/);
    }
    expect(actions('upload').map((action) => action.split('@')[0])).toEqual(['actions/download-artifact']);
    for (const step of steps('upload')) expect(step.run ?? '').not.toMatch(/\b(?:npm|npx|pnpm|yarn|bunx?)\b/);
  });

  test('holds no secret and sends the files to the editor sign-in address', () => {
    expect(text).not.toContain('secrets.');
    const send = steps('upload').find((step) => step.name === 'Send the editor files to Conloca');
    expect(send?.env).toEqual({ CONLOCA_ENDPOINT: 'https://app.conloca.com' });
    expect(send?.run).toContain('::add-mask::');
    expect(send?.run).toContain('/editor-files/sha256:');
    expect(send?.run).toContain('/api/v1/editor-uploads');
  });

  test('runs on pushes to any branch and by hand, and skips content saves but not the site list or MDX pages', () => {
    expect(keysAt('on')).toEqual(['push', 'workflow_dispatch']);
    expect(workflow).toHaveProperty('on.push.branches', ['**']);
    expect(workflow).toHaveProperty('on.push.paths', [
      '**',
      '!content/**',
      'content/**/sites.json',
      'content/**/*.mdx',
    ]);
  });

  test("skips Dependabot in every job and hands the files by one artifact name to an upload on GitHub's own runner", () => {
    for (const job of keysAt('jobs')) expect(textAt('jobs', job, 'if')).toBe("github.actor != 'dependabot[bot]'");
    expect(workflow).toHaveProperty('jobs.upload.runs-on', 'ubuntu-latest');
    expect(workflow).toHaveProperty('jobs.upload.needs', 'build');
    expect(artifactName('build', 'actions/upload-artifact')).toBe('conloca-editor-files-default');
    expect(artifactName('upload', 'actions/download-artifact')).toBe('conloca-editor-files-default');
  });

  test("ends a stuck job within minutes instead of GitHub's six-hour default", () => {
    expect(workflow).toHaveProperty('jobs.build.timeout-minutes', 30);
    expect(workflow).toHaveProperty('jobs.upload.timeout-minutes', 10);
  });
});
