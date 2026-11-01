import type { SyncResult } from '../sync/types';

export interface LogEvent {
  time: string;
  level: 'info' | 'error';
  message: string;
  details?: Record<string, string | number>;
}

export interface RunLog {
  version: 1;
  id: string;
  startedAt: string;
  finishedAt?: string;
  outcome: 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  events: LogEvent[];
  droppedEvents: number;
  result?: SyncResult;
  failure?: string;
}

export type LogSink = (
  level: LogEvent['level'],
  message: string,
  details?: LogEvent['details'],
) => void;

const MAX_LOG_EVENTS = 2000;

export class SyncLog {
  readonly data: RunLog = {
    version: 1,
    id: `run-${new Date().toISOString().replace(/[:.]/gu, '-')}-${crypto.randomUUID()}`,
    startedAt: new Date().toISOString(),
    outcome: 'running',
    events: [],
    droppedEvents: 0,
  };

  readonly record: LogSink = (level, message, details) => {
    if (this.data.events.length >= MAX_LOG_EVENTS) {
      this.data.droppedEvents++;
      return;
    }
    this.data.events.push({ time: new Date().toISOString(), level, message, details });
  };

  complete(result: SyncResult): void {
    this.data.result = result;
    this.data.outcome = result.errors.length || result.skipped.length ? 'partial' : 'completed';
    this.data.finishedAt = new Date().toISOString();
  }

  cancel(): void {
    this.record('info', 'Sync preview cancelled; no files transferred');
    this.data.outcome = 'cancelled';
    this.data.finishedAt = new Date().toISOString();
  }

  fail(message: string): void {
    this.record('error', message);
    this.data.failure = message;
    this.data.outcome = 'failed';
    this.data.finishedAt = new Date().toISOString();
  }
}
