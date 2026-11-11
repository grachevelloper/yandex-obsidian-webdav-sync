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
  readBaseline?(path: string): Promise<Snapshot | undefined>;
  saveBaseline?(path: string, file: Snapshot): Promise<void>;
  forgetBaseline?(path: string): Promise<void>;
  remove?(path: string, expected: Snapshot): Promise<void>;
  move?(path: string, targetPath: string, expected: Snapshot): Promise<void>;
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
  merged?: number;
  moved?: number;
  renamed?: number;
  added?: number;
  updated?: number;
  restored?: number;
  deletedLocal?: number;
  deletedRemote?: number;
  uploaded: number;
  downloaded: number;
  conflicts: Conflict[];
  skipped: string[];
  errors: string[];
}

export type MergeChunk = { text: string } | { local: string; remote: string; base: string };

export interface PlannedMove {
  targetPath: string;
  localHash?: string;
  remoteHash?: string;
}

export interface PlanEntry {
  merge?: MergeChunk[];
  move?: PlannedMove;
  renameTo?: string;
  resolution?: FileDecision;
  path: string;
  action:
    | 'upload'
    | 'download'
    | 'conflict'
    | 'merge'
    | 'move'
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
