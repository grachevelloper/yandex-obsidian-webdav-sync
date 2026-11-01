export class ChangedDuringSync extends Error {
  constructor(path: string) {
    super(`File changed during synchronization: ${path}. Run sync again.`);
  }
}

export class SyncInterrupted extends Error {}
