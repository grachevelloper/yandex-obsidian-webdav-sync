import { isObject } from '../shared/objects';
import type { Conflict, SyncResult } from '../sync/types';
import type { LogEvent, RunLog } from './log';

export function isRunLog(value: unknown): value is RunLog {
  if (!isObject(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.id !== 'string' || typeof value.startedAt !== 'string') return false;
  if (!isRunOutcome(value.outcome)) return false;
  if (typeof value.droppedEvents !== 'number') return false;

  if (value.finishedAt !== undefined && typeof value.finishedAt !== 'string') return false;
  if (value.failure !== undefined && typeof value.failure !== 'string') return false;

  if (!Array.isArray(value.events) || !value.events.every(isLogEvent)) return false;

  return value.result === undefined || isSyncResult(value.result);
}

function isRunOutcome(value: unknown): value is RunLog['outcome'] {
  return (
    value === 'running' ||
    value === 'completed' ||
    value === 'partial' ||
    value === 'failed' ||
    value === 'cancelled'
  );
}

function isLogEvent(value: unknown): value is LogEvent {
  if (!isObject(value)) return false;
  if (typeof value.time !== 'string' || typeof value.message !== 'string') return false;
  if (value.level !== 'info' && value.level !== 'error') return false;

  return value.details === undefined || isLogDetails(value.details);
}

function isLogDetails(value: unknown): value is LogEvent['details'] {
  if (!isObject(value)) return false;

  return Object.values(value).every(
    (detail) => typeof detail === 'string' || typeof detail === 'number',
  );
}

function isSyncResult(value: unknown): value is SyncResult {
  if (!isObject(value)) return false;
  if (typeof value.uploaded !== 'number' || typeof value.downloaded !== 'number') return false;
  for (const key of [
    'resolved',
    'edited',
    'deletedLocal',
    'deletedRemote',
    'merged',
    'moved',
    'renamed',
    'added',
    'updated',
    'restored',
  ]) {
    const count = value[key];
    if (
      count !== undefined &&
      (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0)
    )
      return false;
  }
  if (!Array.isArray(value.conflicts) || !value.conflicts.every(isConflict)) return false;

  return isStringArray(value.skipped) && isStringArray(value.errors);
}

function isConflict(value: unknown): value is Conflict {
  if (!isObject(value)) return false;

  return typeof value.path === 'string' && typeof value.copyPath === 'string';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
