import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';

/**
 * Redacted Google Live-Smoke & Network Audit Mechanic (Fail-Closed)
 *
 * Main process production-owned acceptance module that:
 * 1. Enforces a strict fail-closed contract allowing ONLY:
 *    - OAuth token (POST only)
 *    - OAuth authorize (GET only)
 *    - OAuth userinfo (GET only)
 *    - Gmail GET list, message get, attachment get, thread list, thread get
 * 2. Records ONLY HTTP method, canonical endpoint class, and status/counts.
 * 3. Enforces exact host matching against explicit Google domains and loopback test hosts.
 * 4. Categorizes disallowed traffic into Gmail mutation attempts (POST/PUT/PATCH/DELETE)
 *    and unexpected endpoint requests.
 * 5. Never persists or logs tokens, URLs containing identifiers, query parameters,
 *    email addresses, subjects, correspondents, or request/response bodies.
 * 6. Safely handles summary persistence (closing file descriptors in finally blocks and failing closed on write errors).
 * 7. Blocks fetch invocation prior to network dispatch if a request is disallowed.
 */

export class GoogleMutationDisallowedError extends Error {
  readonly method: string;
  readonly endpointClass: string;
  readonly redactedUrl: string;

  constructor(method: string, endpointClass: string, redactedUrl: string) {
    super(
      `Disallowed Gmail mutation attempt intercepted: ${method} ${endpointClass} (${redactedUrl})`,
    );
    this.name = 'GoogleMutationDisallowedError';
    this.method = method;
    this.endpointClass = endpointClass;
    this.redactedUrl = redactedUrl;
  }
}

export class GoogleUnexpectedEndpointError extends Error {
  readonly method: string;
  readonly endpointClass: string;
  readonly redactedUrl: string;

  constructor(method: string, endpointClass: string, redactedUrl: string) {
    super(
      `Disallowed unexpected endpoint request intercepted: ${method} ${endpointClass} (${redactedUrl})`,
    );
    this.name = 'GoogleUnexpectedEndpointError';
    this.method = method;
    this.endpointClass = endpointClass;
    this.redactedUrl = redactedUrl;
  }
}

export interface AuditRequestInput {
  method: string;
  url: string | URL;
  headers?: HeadersInit;
  body?: unknown;
}

export interface EndpointClassification {
  endpointClass: string;
  isAllowed: boolean;
  isGmailMutation: boolean;
  isUnexpected: boolean;
}

export interface AuditRecordResult extends EndpointClassification {
  method: string;
  status: 'allowed' | 'disallowed';
  redactedUrl: string;
}

export interface GoogleAuditRecordSummary {
  readonly method: string;
  readonly endpointClass: string;
  readonly status: 'allowed' | 'disallowed';
}

export interface GoogleAuditSummary {
  totalRequests: number;
  allowedRequests: number;
  disallowedRequests: number;
  gmailMutationAttempts: number;
  unexpectedRequests: number;
  zeroMutations: boolean;
  zeroUnexpected: boolean;
  endpointCounts: Record<string, number>;
  records: GoogleAuditRecordSummary[];
}

export interface GoogleNetworkAuditOptions {
  /** Hard-fail immediately when a Gmail mutation request (POST/PUT/PATCH/DELETE) is intercepted. Default: true */
  throwOnMutation?: boolean;
  /** Hard-fail immediately when an unexpected request (exceeding fixed contract) is intercepted. Default: true */
  throwOnUnexpected?: boolean;
  /** File path to write machine-readable redacted summary JSON on every audited request */
  summaryPath?: string;
}

/**
 * Classifies an HTTP method + Google endpoint URL into a canonical endpoint class.
 * Enforces a strict, fail-closed contract allowing ONLY:
 * - OAuth token (POST only)
 * - OAuth authorize (GET only)
 * - OAuth userinfo (GET only)
 * - Gmail GET list/thread/message/attachment
 */
export function classifyGoogleEndpoint(
  methodInput: string,
  rawUrlInput: string | URL,
): EndpointClassification {
  const method = (methodInput || 'GET').toUpperCase();
  const rawUrl = typeof rawUrlInput === 'string' ? rawUrlInput : rawUrlInput.toString();
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      endpointClass: 'external.unexpected',
      isAllowed: false,
      isGmailMutation: false,
      isUnexpected: true,
    };
  }

  const { hostname, pathname } = parsed;
  const allowed = (endpointClass: string): EndpointClassification => ({
    endpointClass,
    isAllowed: true,
    isGmailMutation: false,
    isUnexpected: false,
  });
  const unexpected = (endpointClass: string): EndpointClassification => ({
    endpointClass,
    isAllowed: false,
    isGmailMutation: false,
    isUnexpected: true,
  });

  if (hostname === 'oauth2.googleapis.com') {
    if (pathname === '/token') {
      return method === 'POST'
        ? allowed('oauth.token')
        : unexpected('oauth.token.unexpected_method');
    }
    if (pathname === '/revoke') return unexpected('oauth.revoke');
    return unexpected('oauth.unexpected');
  }

  if (hostname === 'accounts.google.com') {
    if (pathname === '/o/oauth2/v2/auth') {
      return method === 'GET'
        ? allowed('oauth.authorize')
        : unexpected('oauth.authorize.unexpected_method');
    }
    return unexpected('oauth.unexpected');
  }

  const isUserInfo =
    (hostname === 'openidconnect.googleapis.com' && pathname === '/v1/userinfo') ||
    (hostname === 'www.googleapis.com' && pathname === '/oauth2/v2/userinfo');
  if (isUserInfo) {
    return method === 'GET'
      ? allowed('oauth.userinfo')
      : unexpected('oauth.userinfo.unexpected_method');
  }

  if (hostname === 'gmail.googleapis.com') {
    if (!pathname.startsWith('/gmail/v1/users/')) {
      return unexpected('gmail.read.unexpected');
    }

    if (method !== 'GET') {
      let endpointClass = 'gmail.mutation.other';
      if (/\/users\/[^/]+\/messages\/send$/i.test(pathname)) {
        endpointClass = 'gmail.messages.send';
      } else if (/\/users\/[^/]+\/messages\/batchDelete$/i.test(pathname)) {
        endpointClass = 'gmail.messages.batchDelete';
      } else if (/\/users\/[^/]+\/messages\/[^/]+\/modify$/i.test(pathname)) {
        endpointClass = 'gmail.messages.modify';
      } else if (/\/users\/[^/]+\/threads\/[^/]+\/modify$/i.test(pathname)) {
        endpointClass = 'gmail.threads.modify';
      } else if (
        /\/users\/[^/]+\/drafts\/send$/i.test(pathname) ||
        /\/users\/[^/]+\/drafts\/[^/]+\/send$/i.test(pathname)
      ) {
        endpointClass = 'gmail.drafts.send';
      } else if (/\/users\/[^/]+\/drafts/i.test(pathname)) {
        endpointClass = 'gmail.drafts.create';
      } else if (/\/users\/[^/]+\/messages\/[^/]+$/i.test(pathname) && method === 'DELETE') {
        endpointClass = 'gmail.messages.delete';
      }
      return {
        endpointClass,
        isAllowed: false,
        isGmailMutation: true,
        isUnexpected: false,
      };
    }

    if (/\/users\/[^/]+\/messages\/[^/]+\/attachments\/[^/]+$/i.test(pathname)) {
      return allowed('gmail.attachments.get');
    }
    if (/\/users\/[^/]+\/messages\/[^/]+$/i.test(pathname)) {
      return allowed('gmail.messages.get');
    }
    if (/\/users\/[^/]+\/messages$/i.test(pathname)) {
      return allowed('gmail.messages.list');
    }
    if (/\/users\/[^/]+\/threads\/[^/]+$/i.test(pathname)) {
      return allowed('gmail.threads.get');
    }
    if (/\/users\/[^/]+\/threads$/i.test(pathname)) {
      return allowed('gmail.threads.list');
    }
    if (/\/users\/[^/]+\/labels/i.test(pathname)) {
      return unexpected('gmail.labels.get');
    }
    if (/\/users\/[^/]+\/drafts/i.test(pathname)) {
      return unexpected('gmail.drafts.get');
    }
    if (/\/users\/[^/]+\/profile/i.test(pathname)) {
      return unexpected('gmail.profile.get');
    }
    return unexpected('gmail.read.unexpected');
  }

  if (hostname === 'calendar.googleapis.com') {
    return unexpected(
      pathname.includes('/events')
        ? method === 'GET'
          ? 'calendar.events.list'
          : 'calendar.events.create'
        : 'calendar.unexpected',
    );
  }

  return unexpected('external.unexpected');
}

/**
 * Redacts tokens, query parameters, email addresses, and resource path identifiers
 * from a raw Google URL string, replacing them with generic path placeholders.
 */
export function redactGoogleUrl(rawUrlInput: string | URL): string {
  let parsed: URL;
  try {
    parsed =
      typeof rawUrlInput === 'string' ? new URL(rawUrlInput) : new URL(rawUrlInput.toString());
  } catch {
    parsed = new URL(
      typeof rawUrlInput === 'string' ? rawUrlInput : rawUrlInput.toString(),
      'https://gmail.googleapis.com',
    );
  }

  // Strip query parameters
  parsed.search = '';

  // Redact path identifiers
  let redactedPath = parsed.pathname;

  redactedPath = redactedPath
    .replace(/\/users\/[^/]+/gi, '/users/:userId')
    .replace(
      /\/messages\/[^/]+\/attachments\/[^/]+/gi,
      '/messages/:messageId/attachments/:attachmentId',
    )
    .replace(/\/messages\/[^/]+\/modify/gi, '/messages/:messageId/modify')
    .replace(/\/messages\/(send|batchDelete)/gi, '/messages/$1')
    .replace(/\/messages\/[^/]+/gi, '/messages/:messageId')
    .replace(/\/threads\/[^/]+\/modify/gi, '/threads/:threadId/modify')
    .replace(/\/threads\/[^/]+/gi, '/threads/:threadId')
    .replace(/\/drafts\/[^/]+\/send/gi, '/drafts/:draftId/send')
    .replace(/\/drafts\/[^/]+/gi, '/drafts/:draftId')
    .replace(/\/labels\/[^/]+/gi, '/labels/:labelId');

  parsed.pathname = redactedPath;
  return parsed.toString();
}

/**
 * Main Google Network Auditor instance class.
 */
export class GoogleNetworkAuditor {
  private active = false;
  private throwOnMutation: boolean;
  private throwOnUnexpected: boolean;
  private summaryPath: string | undefined;
  private totalRequests = 0;
  private allowedRequests = 0;
  private gmailMutationAttempts = 0;
  private unexpectedRequests = 0;
  private endpointCounts = new Map<string, number>();
  private records: GoogleAuditRecordSummary[] = [];

  constructor(options?: GoogleNetworkAuditOptions) {
    this.throwOnMutation = options?.throwOnMutation ?? true;
    this.throwOnUnexpected = options?.throwOnUnexpected ?? true;
    this.summaryPath = options?.summaryPath;
    this.start();
  }

  /** Start or clear audit logging lifecycle */
  start(): void {
    this.active = true;
    this.reset();
    if (this.summaryPath) {
      this.persistSummary();
    }
  }

  /** Stop auditing */
  stop(): void {
    this.active = false;
  }

  /** Reset audit state */
  reset(): void {
    this.totalRequests = 0;
    this.allowedRequests = 0;
    this.gmailMutationAttempts = 0;
    this.unexpectedRequests = 0;
    this.endpointCounts.clear();
    this.records = [];
  }

  /**
   * Intercept and record an HTTP request.
   * Redacts all sensitive parameters, classifies endpoint, updates counts,
   * writes summary file if configured, and throws on disallowed mutations/unexpected requests if enabled.
   */
  recordRequest(input: AuditRequestInput): AuditRecordResult {
    const method = (input.method || 'GET').toUpperCase();
    const rawUrl = typeof input.url === 'string' ? input.url : input.url.toString();

    const classification = classifyGoogleEndpoint(method, rawUrl);
    const redactedUrl = redactGoogleUrl(rawUrl);

    const status: 'allowed' | 'disallowed' = classification.isAllowed ? 'allowed' : 'disallowed';

    if (this.active) {
      this.totalRequests += 1;
      const key = `${method} ${classification.endpointClass}`;
      this.endpointCounts.set(key, (this.endpointCounts.get(key) ?? 0) + 1);

      if (classification.isAllowed) {
        this.allowedRequests += 1;
      } else if (classification.isGmailMutation) {
        this.gmailMutationAttempts += 1;
      } else {
        this.unexpectedRequests += 1;
      }

      // Record MUST contain only method, endpointClass, and status.
      // NO tokens, NO identifiers, NO emails, NO headers, NO bodies.
      this.records.push({
        method,
        endpointClass: classification.endpointClass,
        status,
      });

      if (this.summaryPath) {
        this.persistSummary();
      }
    }

    const result: AuditRecordResult = {
      ...classification,
      method,
      status,
      redactedUrl,
    };

    if (this.active && classification.isGmailMutation && this.throwOnMutation) {
      throw new GoogleMutationDisallowedError(method, classification.endpointClass, redactedUrl);
    }

    if (this.active && classification.isUnexpected && this.throwOnUnexpected) {
      throw new GoogleUnexpectedEndpointError(method, classification.endpointClass, redactedUrl);
    }

    return result;
  }

  /**
   * Returns a redacted machine-readable summary object.
   */
  getSummary(): GoogleAuditSummary {
    const countsObj: Record<string, number> = {};
    for (const [k, v] of this.endpointCounts.entries()) {
      countsObj[k] = v;
    }
    const disallowedRequests = this.gmailMutationAttempts + this.unexpectedRequests;
    return {
      totalRequests: this.totalRequests,
      allowedRequests: this.allowedRequests,
      disallowedRequests,
      gmailMutationAttempts: this.gmailMutationAttempts,
      unexpectedRequests: this.unexpectedRequests,
      zeroMutations: this.gmailMutationAttempts === 0,
      zeroUnexpected: this.unexpectedRequests === 0,
      endpointCounts: countsObj,
      records: [...this.records],
    };
  }

  /**
   * Writes the machine-readable summary JSON to summaryPath if specified.
   * Uses try...finally to guarantee file descriptor closure (no leaks) and fails closed on write errors.
   */
  private persistSummary(): void {
    if (!this.summaryPath) return;
    const summary = this.getSummary();
    const content = `${JSON.stringify(summary, null, 2)}\n`;
    const fd = openSync(this.summaryPath, 'w');
    try {
      writeFileSync(fd, content, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /**
   * Asserts that zero Gmail mutations occurred. Throws if any mutation attempt was recorded.
   */
  assertZeroMutations(): void {
    if (this.gmailMutationAttempts > 0) {
      throw new Error(
        `Google network audit failure: intercepted ${this.gmailMutationAttempts} disallowed Gmail mutation attempt(s). Zero mutations policy violated.`,
      );
    }
  }

  /**
   * Asserts that zero unexpected requests (outside fixed allowed contract) occurred.
   */
  assertZeroUnexpected(): void {
    if (this.unexpectedRequests > 0) {
      throw new Error(
        `Google network audit failure: intercepted ${this.unexpectedRequests} unexpected endpoint request(s) exceeding fixed allowed contract.`,
      );
    }
  }

  /**
   * Reusable fetch wrapper for live-smoke or fetch patching.
   * Audits request BEFORE invoking fetchFn. Disallowed requests throw and prevent network dispatch.
   */
  wrapFetch<T extends (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
    fetchFn: T,
  ): T {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      this.recordRequest({
        method,
        url,
        ...(init?.headers === undefined ? {} : { headers: init.headers }),
      });
      return fetchFn(input, init);
    }) as T;
  }
}

/**
 * Creates and starts a GoogleNetworkAuditor instance.
 */
export function startGoogleNetworkAudit(options?: GoogleNetworkAuditOptions): GoogleNetworkAuditor {
  return new GoogleNetworkAuditor(options);
}

/**
 * Helper to wrap any fetch function with opt-in summary persistence for live Electron process auditing.
 */
export function createAuditedFetch<
  T extends (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
>(fetchFn: T, options?: GoogleNetworkAuditOptions): T {
  const auditor = startGoogleNetworkAudit({
    throwOnMutation: true,
    throwOnUnexpected: true,
    ...options,
  });
  return auditor.wrapFetch(fetchFn);
}
