// IMPORTANT: Import gurx hooks from @mdxeditor/editor, NOT from @mdxeditor/gurx directly.
// @mdxeditor/editor re-exports gurx, and using that ensures we get the same module instance
// as the editor internals, avoiding React context isolation issues.
import { closeImageDialog$, imageDialogState$, insertImage$, useCellValue, usePublisher } from '@mdxeditor/editor';
import type { AssetEntry } from '../../hooks/index.js';
import { buildAssetRef } from '../../utils/asset-url.js';
import { ImagePicker } from '../media/ImagePicker.js';

/**
 * MDX-specific thin wrapper around ImagePicker.
 * Bridges MDXEditor gurx signals to the generic ImagePicker component.
 */
export function ImagePickerDialog() {
  const state = useCellValue(imageDialogState$);
  const insertImage = usePublisher(insertImage$);
  const closeDialog = usePublisher(closeImageDialog$);

  const handleSelect = (asset: AssetEntry) => {
    // Insert image at cursor - no alt text per CONTEXT.md
    insertImage({ src: buildAssetRef(asset.folder, asset.filename) });
    closeDialog();
  };

  return <ImagePicker isOpen={state.type !== 'inactive'} onSelect={handleSelect} onClose={() => closeDialog()} />;
}
