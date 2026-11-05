import { t } from '../i18n';
export interface TransferLimits {
  concurrentRequests: number;
  requestIntervalMs: number;
}

export const DEFAULT_TRANSFER_LIMITS: TransferLimits = {
  concurrentRequests: 8,
  requestIntervalMs: 1000,
};

export const MAX_CONCURRENT_REQUESTS = 16;

export function isConcurrentRequests(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= MAX_CONCURRENT_REQUESTS
  );
}

export function isRequestIntervalMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 60_000;
}

export function validateTransferLimits(limits: TransferLimits): void {
  if (!isConcurrentRequests(limits.concurrentRequests))
    throw new Error(
      t('Concurrent requests must be an integer from 1 to {0}.', { '0': MAX_CONCURRENT_REQUESTS }),
    );
  if (!isRequestIntervalMs(limits.requestIntervalMs))
    throw new Error(
      t('Request start interval must be between 0.1 and 60 seconds, in whole milliseconds.'),
    );
}
