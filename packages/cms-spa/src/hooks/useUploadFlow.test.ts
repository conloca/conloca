import { describe, expect, it } from 'bun:test';
import { IMAGE_EXTENSION_MIME } from '@conloca/content-api-client';
import { ACCEPTED_TYPES } from './useUploadFlow.js';

/**
 * `ACCEPTED_TYPES` is the `accept` attribute the media pickers hand to the
 * browser's file dialog. It has to stay in step with `IMAGE_EXTENSION_MIME`,
 * the allowlist the upload backends actually enforce: a separately maintained
 * copy drifts, and anything missing here is greyed out in the dialog even
 * though the upload behind it would have succeeded.
 */
describe('ACCEPTED_TYPES', () => {
  const offered = ACCEPTED_TYPES.split(',');

  it('offers every content type the upload allowlist accepts', () => {
    expect(new Set(offered)).toEqual(new Set(Object.values(IMAGE_EXTENSION_MIME)));
  });

  it('offers icons, which both upload backends accept', () => {
    expect(offered).toContain('image/x-icon');
  });

  it('names each content type once, so extensions sharing one do not repeat it', () => {
    // `jpg` and `jpeg` both map to `image/jpeg`.
    expect(offered).toHaveLength(new Set(offered).size);
  });
});
