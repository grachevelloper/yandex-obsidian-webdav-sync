import type { DataAdapter } from 'obsidian';
import { isObject } from '../shared/objects';
import type { RunLog } from './log';

const MAX_SAVED_RUNS = 10;
type LogStorage = Pick<DataAdapter, 'exists' | 'mkdir' | 'list' | 'read' | 'write' | 'remove'>;

export class LogRepository {
  constructor(
    private readonly storage: LogStorage,
    readonly folder: string,
  ) {}

  async save(log: RunLog): Promise<void> {
    await this.ensureFolder();
    const content = JSON.stringify(log, null, 2);
    await this.storage.write(`${this.folder}/${log.id}.json`, content);
    await this.storage.write(`${this.folder}/latest.json`, content);
    const listing = await this.storage.list(this.folder);
    const history = listing.files
      .filter((path) => path.startsWith(`${this.folder}/run-`) && path.endsWith('.json'))
      .sort();

    for (const path of history.slice(0, Math.max(0, history.length - MAX_SAVED_RUNS))) {
      await this.storage.remove(path);
    }
  }

  async latest(): Promise<RunLog | undefined> {
    const path = `${this.folder}/latest.json`;
    if (!(await this.storage.exists(path))) return undefined;
    const value: unknown = JSON.parse(await this.storage.read(path));
    if (!isRunLog(value))
      throw new Error('Invalid sync log. Preserve the file before troubleshooting.');
    return value;
  }

  private async ensureFolder(): Promise<void> {
    let current = '';

    for (const part of this.folder.split('/')) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.storage.exists(current))) await this.storage.mkdir(current);
    }
  }
}

function isRunLog(value: unknown): value is RunLog {
  if (
    !isObject(value) ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.startedAt !== 'string' ||
    !['running', 'completed', 'partial', 'failed'].includes(String(value.outcome)) ||
    !Array.isArray(value.events) ||
    typeof value.droppedEvents !== 'number'
  )
    return false;
  if (value.finishedAt !== undefined && typeof value.finishedAt !== 'string') return false;
  if (value.failure !== undefined && typeof value.failure !== 'string') return false;
  if (
    !value.events.every(
      (event: unknown) =>
        isObject(event) &&
        typeof event.time === 'string' &&
        ['info', 'error'].includes(String(event.level)) &&
        typeof event.message === 'string' &&
        (event.details === undefined ||
          (isObject(event.details) &&
            Object.values(event.details).every(
              (detail) => typeof detail === 'string' || typeof detail === 'number',
            ))),
    )
  )
    return false;
  if (value.result === undefined) return true;
  const result = value.result;
  return (
    isObject(result) &&
    typeof result.uploaded === 'number' &&
    typeof result.downloaded === 'number' &&
    Array.isArray(result.conflicts) &&
    result.conflicts.every(
      (conflict: unknown) =>
        isObject(conflict) &&
        typeof conflict.path === 'string' &&
        typeof conflict.copyPath === 'string',
    ) &&
    Array.isArray(result.skipped) &&
    result.skipped.every((path: unknown) => typeof path === 'string') &&
    Array.isArray(result.errors) &&
    result.errors.every((message: unknown) => typeof message === 'string')
  );
}
