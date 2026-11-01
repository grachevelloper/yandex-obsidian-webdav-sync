export interface SyncProgress {
  phase: 'listing' | 'preview' | 'sync';
  processed: number;
  total?: number;
  activePaths: string[];
}

export type ProgressSink = (value: SyncProgress) => void;

export class FileProgress {
  private processed = 0;
  private readonly active = new Set<string>();

  constructor(
    private readonly phase: 'preview' | 'sync',
    private readonly total: number,
    private readonly report: ProgressSink,
  ) {
    this.emit();
  }

  start(path: string): void {
    this.active.add(path);
    this.emit();
  }

  finish(path: string): void {
    if (this.active.delete(path)) this.processed++;
    this.emit();
  }

  private emit(): void {
    this.report({
      phase: this.phase,
      processed: this.processed,
      total: this.total,
      activePaths: [...this.active],
    });
  }
}
