export interface FileEntry {
  path: string;
  size: number;
}

export interface Snapshot {
  data: ArrayBuffer;
  hash: string;
  revision?: string;
}

export interface SyncStore {
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<Snapshot | undefined>;
  write(path: string, data: ArrayBuffer, expected: Snapshot | undefined): Promise<void>;
}

export interface SyncState {
  version: 1;
  scope: string;
  hashes: Record<string, string>;
}

export interface Conflict {
  path: string;
  copyPath: string;
}

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: Conflict[];
  skipped: string[];
  errors: string[];
}

export interface PlanEntry {
  path: string;
  action: 'upload' | 'download' | 'conflict' | 'unchanged' | 'missing' | 'skip' | 'error';
  baseline?: string;
  localHash?: string;
  remoteHash?: string;
  copyPath?: string;
  message?: string;
}

export interface SyncPlan {
  scope: string;
  entries: PlanEntry[];
}
