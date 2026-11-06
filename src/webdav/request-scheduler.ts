import { t } from '../i18n';
import {
  DEFAULT_TRANSFER_LIMITS,
  validateTransferLimits,
  type TransferLimits,
} from '../shared/transfer-limits';
import { checkCancellation, SyncCancelled, SyncInterrupted } from '../sync/errors';
import type { HttpResponse } from './client';
import { HTTP_STATUS } from './protocol';
import { NetworkRequestError } from './network-error';

export interface RequestTiming {
  now(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface RetryInfo {
  reason: 'rate-limit' | 'network';
  delayMs: number;
  attempt: number;
  code?: string;
}

export interface RequestOptions extends Partial<TransferLimits> {
  timing?: RequestTiming;
  signal?: AbortSignal;
  onRetry?: (retry: RetryInfo) => void;
  onRequest?: (method: string, path: string) => void;
}

const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_READ_NETWORK_RETRIES = 2;
const INITIAL_RETRY_DELAY_MS = 5000;
const MAX_AUTOMATIC_WAIT_MS = 60_000;
const DELAY_SECONDS = /^\d+$/u;

const SYSTEM_TIMING: RequestTiming = {
  now: () => Date.now(),
  sleep: (milliseconds, signal) =>
    new Promise((resolve, reject) => {
      checkCancellation(signal);
      const abort = () => {
        window.clearTimeout(timer);
        reject(new SyncCancelled());
      };
      const timer = window.setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, milliseconds);
      signal?.addEventListener('abort', abort, { once: true });
    }),
};

export class RequestScheduler {
  private startQueue: Promise<void> = Promise.resolve();
  private nextRequestAt = 0;
  private stopped?: SyncInterrupted;
  private occupiedSlots = 0;
  private readonly slotWaiters: (() => void)[] = [];
  private readonly limits: TransferLimits;

  constructor(
    private readonly timing: RequestTiming = SYSTEM_TIMING,
    private readonly options: RequestOptions = {},
  ) {
    this.limits = {
      concurrentRequests: options.concurrentRequests ?? DEFAULT_TRANSFER_LIMITS.concurrentRequests,
      requestIntervalMs: options.requestIntervalMs ?? DEFAULT_TRANSFER_LIMITS.requestIntervalMs,
    };
    validateTransferLimits(this.limits);
  }

  async run(
    method: string,
    send: () => Promise<HttpResponse>,
    onRetry: (retry: RetryInfo) => void,
  ): Promise<HttpResponse> {
    checkCancellation(this.options.signal);
    if (this.occupiedSlots < this.limits.concurrentRequests) this.occupiedSlots++;
    else await new Promise<void>((resolve) => this.slotWaiters.push(resolve));

    try {
      checkCancellation(this.options.signal);
      return await this.sendWithRetries(method, send, onRetry);
    } finally {
      const next = this.slotWaiters.shift();
      if (next) next();
      else this.occupiedSlots--;
    }
  }

  private scheduleSend(send: () => Promise<HttpResponse>): Promise<HttpResponse> {
    const started = this.startQueue.then(async () => {
      await this.waitForSlot();
      if (this.stopped) throw this.stopped;
      checkCancellation(this.options.signal);
      return { response: send() };
    });
    // Release the start gate while the transport is still running; the active-slot limit remains held.
    this.startQueue = started.then(
      () => {},
      () => {},
    );
    return started.then(({ response }) => response);
  }

  private async sendWithRetries(
    method: string,
    send: () => Promise<HttpResponse>,
    onRetry: (retry: RetryInfo) => void,
  ): Promise<HttpResponse> {
    if (this.stopped) throw this.stopped;

    for (let attempt = 0; ; attempt++) {
      let response: HttpResponse;

      try {
        response = await this.scheduleSend(send);
      } catch (error) {
        this.retryReadFailure(method, error, attempt, onRetry);
        continue;
      }

      if (response.status !== HTTP_STATUS.TOO_MANY_REQUESTS) return response;

      const serverDelay = retryAfterMs(response.headers, this.timing.now());
      const delayMs = Math.max(serverDelay ?? 0, INITIAL_RETRY_DELAY_MS * 2 ** attempt);

      if (attempt >= MAX_RATE_LIMIT_RETRIES || delayMs > MAX_AUTOMATIC_WAIT_MS) {
        const wait = Number.isFinite(delayMs)
          ? t(' Wait at least {0} seconds', { '0': Math.ceil(delayMs / 1000) })
          : t(' Wait for the server cooldown');
        this.stop(
          t(
            'Yandex Disk rate limit (HTTP 429). Sync stopped to avoid more requests.{0} before running sync again.',
            { '0': wait },
          ),
        );
      }

      this.scheduleRetry({ reason: 'rate-limit', delayMs, attempt: attempt + 1 }, onRetry);
    }
  }

  private retryReadFailure(
    method: string,
    error: unknown,
    attempt: number,
    onRetry: (retry: RetryInfo) => void,
  ): void {
    const readOnly = method === 'GET' || method === 'PROPFIND';
    if (!readOnly || !(error instanceof NetworkRequestError)) throw error;

    if (attempt >= MAX_READ_NETWORK_RETRIES) {
      this.stop(
        t(
          'WebDAV read failed after repeated network interruptions ({0}). Sync stopped. Check the connection and run sync again.',
          { '0': error.code },
        ),
      );
    }

    this.scheduleRetry(
      {
        reason: 'network',
        delayMs: INITIAL_RETRY_DELAY_MS * 2 ** attempt,
        attempt: attempt + 1,
        code: error.code,
      },
      onRetry,
    );
  }

  private scheduleRetry(retry: RetryInfo, onRetry: (retry: RetryInfo) => void): void {
    this.nextRequestAt = Math.max(this.nextRequestAt, this.timing.now() + retry.delayMs);
    onRetry(retry);
  }

  private stop(message: string): never {
    this.stopped = new SyncInterrupted(message);
    throw this.stopped;
  }

  private async wait(milliseconds: number): Promise<void> {
    const signal = this.options.signal;
    if (!signal) return this.timing.sleep(milliseconds);
    checkCancellation(signal);

    let removeListener = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(new SyncCancelled());
        signal.addEventListener('abort', abort, { once: true });
        removeListener = () => signal.removeEventListener('abort', abort);
        this.timing.sleep(milliseconds, signal).then(resolve, reject);
      });
    } finally {
      removeListener();
    }
  }

  private async waitForSlot(): Promise<void> {
    checkCancellation(this.options.signal);
    while (this.nextRequestAt > this.timing.now()) {
      if (this.stopped) throw this.stopped;
      await this.wait(this.nextRequestAt - this.timing.now());
    }
    if (this.stopped) throw this.stopped;
    checkCancellation(this.options.signal);
    this.nextRequestAt = this.timing.now() + this.limits.requestIntervalMs;
  }
}

function retryAfterMs(headers: Record<string, string>, now: number): number | undefined {
  const value = Object.entries(headers)
    .find(([name]) => name.toLowerCase() === 'retry-after')?.[1]
    .trim();
  if (!value) return undefined;
  if (DELAY_SECONDS.test(value)) return Number(value) * 1000;

  const date = Date.parse(value);

  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
