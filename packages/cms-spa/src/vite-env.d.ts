/// <reference types="vite/client" />

// Vite HMR types
interface ImportMetaHot {
  on(event: string, callback: (data: any) => void): void;
}

interface ImportMeta {
  hot?: ImportMetaHot;
}
