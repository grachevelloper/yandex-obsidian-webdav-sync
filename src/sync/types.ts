export type SyncMode = 'two-way' | 'device-wins' | 'cloud-wins';

export type FileDecision =
  | { kind: 'delete' }
  | { kind: 'text'; text: string }
  | { kind: 'local' }
  | { kind: 'remote' }
  | { kind: 'skip' };

export interface FileEntry {
  path: string;
  size: number;
  revision?: string;
}

export interface FileVersion {
  hash: string;
  revision?: string;
}

export interface Snapshot extends FileVersion {
  data: ArrayBuffer;
}

export interface SyncStore {
  list(): Promise<FileEntry[]>;
  read(path: string): Promise<Snapshot | undefined>;
  preserve?(file: Snapshot): Promise<void>;
  remove?(path: string, expected: Snapshot): Promise<void>;
  inspect?(path: string): Promise<FileVersion | undefined>;
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
  resolved?: number;
  edited?: number;
  deletedLocal?: number;
  deletedRemote?: number;
  uploaded: number;
  downloaded: number;
  conflicts: Conflict[];
  skipped: string[];
  errors: string[];
}

export interface PlanEntry {
  resolution?: FileDecision;
  path: string;
  action:
    | 'upload'
    | 'download'
    | 'conflict'
    | 'unchanged'
    | 'missing'
    | 'skip'
    | 'error'
    | 'delete-local'
    | 'delete-remote';
  baseline?: string;
  localHash?: string;
  remoteHash?: string;
  copyPath?: string;
  message?: string;
}

export interface SyncPlan {
  mode?: SyncMode;
  scope: string;
  entries: PlanEntry[];
}
