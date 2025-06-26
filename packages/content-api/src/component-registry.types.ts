export interface ComponentEntry {
  displayName: string;
  path: string | null;
}

export interface ComponentEntryWithId extends ComponentEntry {
  id: string;
}

export interface ComponentRegistry {
  [componentId: string]: ComponentEntry;
}
