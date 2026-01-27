import { useImportAssetUrl, useUploadAsset } from '@conloca/content-api-client';

/** Read image dimensions from a File using the browser Image API */
export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('File is not an image'));
      return;
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image for dimension reading'));
    };

    img.src = url;
  });
}

/** Build FormData for asset upload, reading dimensions client-side */
export async function buildUploadFormData(file: File, alt?: string): Promise<FormData> {
  const formData = new FormData();
  formData.append('file', file);

  if (alt) {
    formData.append('alt', alt);
  }

  try {
    const { width, height } = await getImageDimensions(file);
    formData.append('width', String(width));
    formData.append('height', String(height));
  } catch {
    // Non-image files or unreadable images — skip dimensions
  }

  return formData;
}

export { useUploadAsset as useUpload, useImportAssetUrl as useImportUrl };
