import { t } from '../i18n';
import { isObject } from '../shared/objects';

const KNOWN_NETWORK_CODES = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_ABORTED',
  'ERR_TIMED_OUT',
  'ERR_CONNECTION_TIMED_OUT',
  'ERR_NETWORK_CHANGED',
  'ERR_INTERNET_DISCONNECTED',
  'ERR_NAME_NOT_RESOLVED',
];
const MAX_CAUSE_DEPTH = 4;
const APPLE_NETWORK_CODE_PATTERN = /(?:Code=|error\s+)(-1001|-1005|-1009)\b/iu;

export class NetworkRequestError extends Error {
  constructor(
    method: string,
    readonly code: string,
  ) {
    super(
      t('WebDAV network error ({0}, {1}). Check your connection and run sync again.', {
        '0': method,
        '1': code,
      }),
    );
  }
}

export function networkErrorCode(error: unknown): string {
  let current = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (typeof current === 'string') return codeInMessage(current) ?? 'NETWORK_ERROR';
    if (!isObject(current)) break;

    if (typeof current.code === 'string' && KNOWN_NETWORK_CODES.includes(current.code))
      return current.code;
    if (current.name === 'TimeoutError') return 'TIMEOUT';
    if (current.name === 'AbortError') return 'ABORTED';

    if (current.domain === 'NSURLErrorDomain') {
      const code = appleNetworkCode(current.code);
      if (code) return code;
    }

    if (typeof current.message === 'string') {
      const code = codeInMessage(current.message);
      if (code) return code;
    }

    current = current.cause;
  }

  return 'NETWORK_ERROR';
}

function codeInMessage(message: string): string | undefined {
  const code = KNOWN_NETWORK_CODES.find((value) => message.includes(value));
  if (code) return code;

  if (message.includes('NSURLErrorDomain')) {
    const appleCode = APPLE_NETWORK_CODE_PATTERN.exec(message)?.[1];
    return appleNetworkCode(Number(appleCode));
  }

  return undefined;
}

function appleNetworkCode(code: unknown): string | undefined {
  switch (code) {
    case -1001:
      return 'NSURLErrorTimedOut';
    case -1005:
      return 'NSURLErrorNetworkConnectionLost';
    case -1009:
      return 'NSURLErrorNotConnectedToInternet';
    default:
      return undefined;
  }
}
