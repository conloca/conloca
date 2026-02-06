// IMPORTANT: Import gurx hooks from @mdxeditor/editor, NOT from @mdxeditor/gurx directly.
// @mdxeditor/editor re-exports gurx, and using that ensures we get the same module instance
// as the editor internals, avoiding React context isolation issues.
import { closeImageDialog$, imageDialogState$, insertImage$, useCellValue, usePublisher } from '@mdxeditor/editor';
import type { AssetEntry } from '../../hooks';
import { ImagePicker } from '../media/ImagePicker';

/**
 * MDX-specific thin wrapper around ImagePicker.
 * Bridges MDXEditor gurx signals to the generic ImagePicker component.
 */
export function ImagePickerDialog() {
  const state = useCellValue(imageDialogState$);
  const insertImage = usePublisher(insertImage$);
  const closeDialog = usePublisher(closeImageDialog$);

  const handleSelect = (asset: AssetEntry) => {
    // Build path per CONTEXT.md decision
    const folder = asset.folder && asset.folder !== '/' ? asset.folder : '';
    const path = `/assets${folder}/${asset.filename}`;

    // Insert image at cursor - no alt text per CONTEXT.md
    insertImage({ src: path });
    closeDialog();
  };

  return <ImagePicker isOpen={state.type !== 'inactive'} onSelect={handleSelect} onClose={() => closeDialog()} />;
}
