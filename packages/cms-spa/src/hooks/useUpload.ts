import { useImportAssetUrl, useUploadAsset } from '@conloca/content-api-client';

/** Build FormData for asset upload — the server measures the image itself */
export function buildUploadFormData(file: File, alt?: string, folder?: string): FormData {
  const formData = new FormData();
  formData.append('file', file);

  if (alt) {
    formData.append('alt', alt);
  }

  if (folder && folder !== '/') {
    formData.append('folder', folder);
  }

  return formData;
}

export { useImportAssetUrl as useImportUrl, useUploadAsset as useUpload };
