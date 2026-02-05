import { mock } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

// Mock @conloca/cms-spa to avoid circular dependency resolution issues in tests.
// The ImagePickerDialog component uses these, but tests don't need them to actually render.
mock.module('@conloca/cms-spa', () => ({
  FolderTreeSidebar: () => null,
  MediaLibrary: () => null,
  UploadModal: () => null,
}));
