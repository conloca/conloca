import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { endpointReaderOptions, type PuckManifest, readPuckConfig } from '@conloca/astro-cms/puck-manifest';
import { COMPONENT_MANIFEST_LIMITS, measureJson } from '@conloca/content-api/component-vocabulary';

/** The emitted manifest: its site-relative URL, its file name and the full sha-256 hex of its bytes. */
export interface ComponentManifestArtifact {
  url: string;
  filename: string;
  hash: string;
}

/** Metadata transport ceiling; larger metadata must not ship as a usable artifact. */
const MAX_MANIFEST_BYTES = COMPONENT_MANIFEST_LIMITS.bytes;

type Logger = { info(message: string): void; warn(message: string): void };

/**
 * Writes the site's component vocabulary — every Puck component the config
 * declares and what each accepts, read from source and never executed — as a
 * content-addressed artifact beside the editor bundle:
 * `<folder>/component-manifest.<hash16>.json`.
 *
 * Fail-soft: the manifest is metadata for agents, so a failure costs the
 * manifest and warns — never the build. A config the reader cannot fully read
 * still ships its manifest, because the admissions are the answer, and the
 * build log names what could not be read, where the developer looks.
 */
export async function emitComponentManifest(input: {
  dir: string;
  /** Folder below `dir` to write into; `_conloca` unless given. */
  folder?: string;
  puckConfigPath: string;
  projectRoot: string;
  logger: Logger;
}): Promise<ComponentManifestArtifact | undefined> {
  const folder = input.folder ?? '_conloca';
  try {
    const manifest = readPuckConfig(
      endpointReaderOptions({ puckConfigPath: input.puckConfigPath, projectRoot: input.projectRoot }),
    );
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    if (bytes.byteLength > MAX_MANIFEST_BYTES) {
      input.logger.warn(
        `component manifest skipped — ${bytes.byteLength} bytes exceeds the metadata limit of ${MAX_MANIFEST_BYTES} bytes`,
      );
      return undefined;
    }
    measureJson(manifest, COMPONENT_MANIFEST_LIMITS);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const filename = `component-manifest.${hash.slice(0, 16)}.json`;
    await mkdir(join(input.dir, folder), { recursive: true });
    await writeFile(join(input.dir, folder, filename), bytes);
    reportManifest(manifest, `/${folder}/${filename}`, input.logger);
    return { url: `/${folder}/${filename}`, filename, hash };
  } catch (error) {
    input.logger.warn(
      'component manifest skipped — agents get no component vocabulary from this build ' +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
    return undefined;
  }
}

/** One info line for the artifact, and a warning for everything the reader could not read. */
function reportManifest(manifest: PuckManifest, url: string, logger: Logger): void {
  logger.info(`component manifest written: ${url} (${Object.keys(manifest.components).length} components)`);
  if (manifest.unreadable) {
    logger.warn(
      `component manifest is incomplete: ${manifest.unreadableReason ?? 'the config could not be fully read'}`,
    );
  }
  for (const name of manifest.unresolved) {
    const reason = manifest.unresolvedReasons?.[name];
    logger.warn(`component ${name} could not be read${reason === undefined ? '' : `: ${reason}`}`);
  }
}
