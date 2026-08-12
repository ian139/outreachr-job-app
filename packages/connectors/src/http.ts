import { ConnectorError, errorCodeForStatus } from './errors.js';
import type {
  AccessTokenProvider,
  ConnectorProvider,
  FetchLike,
  RetryPolicy,
  Sleep,
} from './types.js';

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 5_000,
};

export interface AuthorizedRequestOptions {
  provider: ConnectorProvider;
  operation: string;
  fetch: FetchLike;
  getAccessToken: AccessTokenProvider;
  url: string;
  init?: RequestInit;
  retryPolicy?: Partial<RetryPolicy>;
  sleep?: Sleep;
  /** Reads and explicit throttles are retryable. Sends must set this false. */
  retryNetworkErrors?: boolean;
  /** Enable retries for 5xx responses only for idempotent reads. */
  retryServerErrors?: boolean;
  /** Sends retry only explicit 408/429 responses, never 5xx or network failures. */
  isSend?: boolean;
  /** Creates never retry an ambiguous transport/5xx outcome. */
  isCreate?: boolean;
}

const defaultSleep: Sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const cancellableSleep = (
  milliseconds: number,
  signal?: AbortSignal,
  customSleep?: Sleep,
): Promise<void> => {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new Error('Aborted'));
  }
  if (!signal) {
    return (customSleep ?? defaultSleep)(milliseconds);
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

function mergedRetryPolicy(input?: Partial<RetryPolicy>): RetryPolicy {
  const result = { ...DEFAULT_RETRY_POLICY, ...input };
  if (!Number.isInteger(result.maxAttempts) || result.maxAttempts < 1) {
    throw new RangeError('retryPolicy.maxAttempts must be a positive integer');
  }
  return result;
}

function retryAfterMs(response: Response): number | undefined {
  const millisecondValue = response.headers.get('x-ms-retry-after-ms');
  if (millisecondValue && Number.isFinite(Number(millisecondValue))) {
    return Math.max(0, Number(millisecondValue));
  }
  const value = response.headers.get('retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function retryDelay(attempt: number, response: Response | undefined, policy: RetryPolicy): number {
  const serverDelay = response ? retryAfterMs(response) : undefined;
  if (serverDelay !== undefined) return Math.min(serverDelay, policy.maxDelayMs);
  return Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
}

async function responseDetails(response: Response): Promise<{
  message: string;
  providerCode?: string;
  body?: unknown;
}> {
  const text = await response.text();
  if (!text) return { message: `Provider returned HTTP ${response.status}` };
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    const nested = body.error;
    if (nested && typeof nested === 'object') {
      const error = nested as Record<string, unknown>;
      return {
        message:
          (typeof error.message === 'string' && error.message) ||
          (typeof body.error_description === 'string' && body.error_description) ||
          `Provider returned HTTP ${response.status}`,
        providerCode:
          (typeof error.code === 'string' && error.code) ||
          (typeof error.status === 'string' && error.status) ||
          undefined,
        body,
      };
    }
    return {
      message:
        (typeof body.error_description === 'string' && body.error_description) ||
        (typeof body.message === 'string' && body.message) ||
        `Provider returned HTTP ${response.status}`,
      providerCode: typeof body.error === 'string' ? body.error : undefined,
      body,
    };
  } catch {
    return { message: text.slice(0, 500), body: text };
  }
}

function requestId(response: Response): string | undefined {
  return (
    response.headers.get('request-id') ??
    response.headers.get('x-ms-request-id') ??
    response.headers.get('x-guploader-uploadid') ??
    undefined
  );
}

export async function authorizedRequest(options: AuthorizedRequestOptions): Promise<Response> {
  const policy = mergedRetryPolicy(options.retryPolicy);
  const sleep = options.sleep ?? defaultSleep;
  const ambiguousWriteKind = options.isSend ? 'send' : options.isCreate ? 'create' : null;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    if (options.init?.signal?.aborted) {
      throw options.init.signal.reason ?? new Error('Aborted');
    }
    let response: Response;
    try {
      const token = await options.getAccessToken();
      if (!token.trim()) throw new Error('Access token provider returned an empty token');
      const headers = new Headers(options.init?.headers);
      headers.set('authorization', `Bearer ${token}`);
      headers.set('accept', 'application/json');
      response = await options.fetch(options.url, { ...options.init, headers });
    } catch (cause) {
      if (
        options.init?.signal?.aborted ||
        (cause instanceof Error && cause.name === 'AbortError')
      ) {
        throw cause;
      }
      if (options.retryNetworkErrors && attempt < policy.maxAttempts) {
        await cancellableSleep(
          retryDelay(attempt, undefined, policy),
          options.init?.signal ?? undefined,
          sleep,
        );
        continue;
      }
      throw new ConnectorError({
        provider: options.provider,
        operation: options.operation,
        code:
          ambiguousWriteKind === 'send'
            ? 'AMBIGUOUS_SEND'
            : ambiguousWriteKind === 'create'
              ? 'AMBIGUOUS_CREATE'
              : 'NETWORK_ERROR',
        message:
          ambiguousWriteKind === 'send'
            ? 'Connection ended during send; the provider may have accepted the message'
            : ambiguousWriteKind === 'create'
              ? 'Connection ended during create; the provider may have created the object'
              : 'Provider could not be reached',
        retryable: ambiguousWriteKind === null,
        mayHaveSucceeded: ambiguousWriteKind !== null,
        cause,
      });
    }

    if (response.ok) return response;

    const explicitRetry =
      response.status === 429 || (response.status === 408 && !ambiguousWriteKind);
    const safeOperationRetry = Boolean(options.retryServerErrors && response.status >= 500);
    if ((explicitRetry || safeOperationRetry) && attempt < policy.maxAttempts) {
      await response.arrayBuffer().catch(() => undefined);
      await cancellableSleep(
        retryDelay(attempt, response, policy),
        options.init?.signal ?? undefined,
        sleep,
      );
      continue;
    }

    const details = await responseDetails(response);
    const isAmbiguousWrite = Boolean(
      ambiguousWriteKind && (response.status === 408 || response.status >= 500),
    );
    throw new ConnectorError({
      provider: options.provider,
      operation: options.operation,
      code: isAmbiguousWrite
        ? ambiguousWriteKind === 'send'
          ? 'AMBIGUOUS_SEND'
          : 'AMBIGUOUS_CREATE'
        : errorCodeForStatus(response.status),
      message: isAmbiguousWrite
        ? `${details.message}. The provider may have committed this ${ambiguousWriteKind} request; reconcile provider state before trying again.`
        : details.message,
      httpStatus: response.status,
      retryable: !isAmbiguousWrite && (explicitRetry || safeOperationRetry),
      retryAfterMs: retryAfterMs(response),
      mayHaveSucceeded: isAmbiguousWrite,
      providerCode: details.providerCode,
      providerRequestId: requestId(response),
      details: details.body,
    });
  }
  throw new Error('unreachable');
}

export async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export function responseRequestId(response: Response): string | undefined {
  return requestId(response);
}
