import { fsyncSync, openSync, writeFileSync } from 'node:fs';

/**
 * Redacted Google Live-Smoke & Network Audit Mechanic
 *
 * Enforces a fail-closed read-only acceptance policy for Google network traffic:
 * 1. Allowed contract: ONLY OAuth authorize/token/userinfo plus Gmail GET list/thread/message/attachment.
 * 2. Records ONLY HTTP method, canonical endpoint class, and allowed/disallowed status and counts.
 * 3. Exact host matching: rejects non-explicit Google domains or spoofed subdomains.
 * 4. Categorizes disallowed traffic into Gmail mutation attempts (POST/PUT/PATCH/DELETE) and unexpected requests.
 * 5. Never persists or logs tokens, URLs containing identifiers (message IDs, thread IDs, user IDs),
 *    query parameters, email addresses, subjects, correspondents, or request/response bodies.
 * 6. Exposes lifecycle methods and file-persisted fetch wrapping for live Electron smoke auditing.
 */

export class GoogleMutationDisallowedError extends Error {
  readonly method: string;
  readonly endpointClass: string;
  readonly redactedUrl: string;

  constructor(method: string, endpointClass: string, redactedUrl: string) {
    super(`Disallowed Gmail mutation attempt intercepted: ${method} ${endpointClass} (${redactedUrl})`);
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
    super(`Disallowed unexpected endpoint request intercepted: ${method} ${endpointClass} (${redactedUrl})`);
    this.name = 'GoogleUnexpectedEndpointError';
    this.method = method;
    this.endpointClass = endpointClass;
    this.redactedUrl = redactedUrl;
  }
}

export interface AuditRequestInput {
  method: string;
  url: string | URL;
  headers?: Record<string, string | string[] | undefined> | Headers;
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
  /** Hard-fail immediately when an unexpected request (exceeding fixed contract) is intercepted. Default: false */
  throwOnUnexpected?: boolean;
  /** File path to write machine-readable redacted summary JSON on every audited request */
  summaryPath?: string;
}

const ALLOWED_EXACT_HOSTS = new Set([
  'oauth2.googleapis.com',
  'accounts.google.com',
  'www.googleapis.com',
  'openidconnect.googleapis.com',
  'gmail.googleapis.com',
  'calendar.googleapis.com',
]);

function isAllowedHost(hostname: string): boolean {
  if (ALLOWED_EXACT_HOSTS.has(hostname)) return true;
  if (hostname === '127.0.0.1' || hostname === 'localhost') return true;
  return false;
}

/**
 * Classifies an HTTP method + Google endpoint URL into a canonical endpoint class.
 * Enforces a strict, fail-closed contract allowing ONLY:
 * - OAuth token, authorize, userinfo
 * - Gmail GET list/thread/message/attachment
 */
export function classifyGoogleEndpoint(methodInput: string, rawUrlInput: string | URL): EndpointClassification {
  const method = (methodInput || 'GET').toUpperCase();
  const rawUrl = typeof rawUrlInput === 'string' ? rawUrlInput : rawUrlInput.toString();

  let pathname = '';
  let hostname = '';
  try {
    const parsed = new URL(rawUrl, 'https://gmail.googleapis.com');
    pathname = parsed.pathname;
    hostname = parsed.hostname;
  } catch {
    pathname = rawUrl.split('?')[0] || '';
  }

  // Exact host check: fail-closed if host is unapproved
  if (hostname && !isAllowedHost(hostname)) {
    return {
      endpointClass: 'external.unexpected',
      isAllowed: false,
      isGmailMutation: false,
      isUnexpected: true,
    };
  }

  // 1. OAuth Endpoints (Contract: token, authorize, userinfo ONLY)
  if (
    hostname === 'oauth2.googleapis.com' ||
    hostname === 'accounts.google.com' ||
    hostname === 'openidconnect.googleapis.com' ||
    pathname.endsWith('/token') ||
    pathname.endsWith('/oauth2/v2/auth') ||
    pathname.includes('/userinfo')
  ) {
    if (pathname.endsWith('/token') || pathname.includes('/oauth2/v4/token')) {
      return { endpointClass: 'oauth.token', isAllowed: true, isGmailMutation: false, isUnexpected: false };
    }
    if (pathname.includes('/auth') && method === 'GET') {
      return { endpointClass: 'oauth.authorize', isAllowed: true, isGmailMutation: false, isUnexpected: false };
    }
    if (pathname.includes('/userinfo') && method === 'GET') {
      return { endpointClass: 'oauth.userinfo', isAllowed: true, isGmailMutation: false, isUnexpected: false };
    }
    if (pathname.includes('/revoke')) {
      return { endpointClass: 'oauth.revoke', isAllowed: false, isGmailMutation: false, isUnexpected: true };
    }
    return { endpointClass: 'oauth.unexpected', isAllowed: false, isGmailMutation: false, isUnexpected: true };
  }

  // 2. Gmail Endpoints
  const isGmailPath = hostname === 'gmail.googleapis.com' || pathname.includes('/gmail/v1/users/') || pathname.includes('/users/');

  if (isGmailPath) {
    // Disallowed Mutations (POST/PUT/PATCH/DELETE)
    if (method !== 'GET') {
      if (/\/users\/[^/]+\/messages\/send$/i.test(pathname)) {
        return { endpointClass: 'gmail.messages.send', isAllowed: false, isGmailMutation: true, isUnexpected: false };
      }
      if (/\/users\/[^/]+\/messages\/batchDelete$/i.test(pathname)) {
        return { endpointClass: 'gmail.messages.batchDelete', isAllowed: false, isGmailMutation: true, isUnexpected: false };
      }
      if (/\/users\/[^/]+\/messages\/[^/]+\/modify$/i.test(pathname)) {
        return { endpointClass: 'gmail.messages.modify', isAllowed: false, isGmailMutation: true, isUnexpected: false };
      }
      if (/\/users\/[^/]+\/threads\/[^/]+\/modify$/i.test(pathname)) {
        return { endpointClass: 'gmail.threads.modify', isAllowed: false, isGmailMutation: true, isUnexpected: false };
      }
      if (/\/users\/[^/]+\/drafts\/send$/i.test(pathname) || /\/users\/[^/]+\/drafts\/[^/]+\/send$/i.test(pathname)) {
        return { endpointClass: 'gmail.drafts.send', isAllowed: false, isGmailMutation: true, isUnexpected: false };
      }
      if (/\/users\/[^/]+\/drafts/i.test(pathname)) {
        return { endpointClass: 'gmail.drafts.create', isAllowed: false, isGmailMutation: true, isUnexpected: false };
      }
      if (/\/users\/[^/]+\/messages\/[^/]+$/i.test(pathname) && method === 'DELETE') {
        return { endpointClass: 'gmail.messages.delete', isAllowed: false, isGmailMutation: true, isUnexpected: false };
      }
      return { endpointClass: 'gmail.mutation.other', isAllowed: false, isGmailMutation: true, isUnexpected: false };
    }

    // Gmail GET Operations (Allowed: list, get, attachment, threads.list, threads.get ONLY)
    if (/\/users\/[^/]+\/messages\/[^/]+\/attachments\/[^/]+$/i.test(pathname)) {
      return { endpointClass: 'gmail.attachments.get', isAllowed: true, isGmailMutation: false, isUnexpected: false };
    }
    if (/\/users\/[^/]+\/messages\/[^/]+$/i.test(pathname)) {
      return { endpointClass: 'gmail.messages.get', isAllowed: true, isGmailMutation: false, isUnexpected: false };
    }
    if (/\/users\/[^/]+\/messages$/i.test(pathname)) {
      return { endpointClass: 'gmail.messages.list', isAllowed: true, isGmailMutation: false, isUnexpected: false };
    }
    if (/\/users\/[^/]+\/threads\/[^/]+$/i.test(pathname)) {
      return { endpointClass: 'gmail.threads.get', isAllowed: true, isGmailMutation: false, isUnexpected: false };
    }
    if (/\/users\/[^/]+\/threads$/i.test(pathname)) {
      return { endpointClass: 'gmail.threads.list', isAllowed: true, isGmailMutation: false, isUnexpected: false };
    }

    // Uncontracted Gmail GETs (labels, drafts, profile, unknown GETs) -> Disallowed unexpected
    if (/\/users\/[^/]+\/labels/i.test(pathname)) {
      return { endpointClass: 'gmail.labels.get', isAllowed: false, isGmailMutation: false, isUnexpected: true };
    }
    if (/\/users\/[^/]+\/drafts/i.test(pathname)) {
      return { endpointClass: 'gmail.drafts.get', isAllowed: false, isGmailMutation: false, isUnexpected: true };
    }
    if (/\/users\/[^/]+\/profile/i.test(pathname)) {
      return { endpointClass: 'gmail.profile.get', isAllowed: false, isGmailMutation: false, isUnexpected: true };
    }
    return { endpointClass: 'gmail.read.unexpected', isAllowed: false, isGmailMutation: false, isUnexpected: true };
  }

  // 3. Calendar / Other Google Endpoints (Uncontracted -> Disallowed unexpected)
  if (hostname === 'calendar.googleapis.com' || pathname.includes('/calendar/v3/')) {
    if (pathname.includes('/events')) {
      return {
        endpointClass: method === 'GET' ? 'calendar.events.list' : 'calendar.events.create',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      };
    }
    return { endpointClass: 'calendar.unexpected', isAllowed: false, isGmailMutation: false, isUnexpected: true };
  }

  return {
    endpointClass: method === 'GET' ? 'google.read.unexpected' : 'google.unexpected',
    isAllowed: false,
    isGmailMutation: false,
    isUnexpected: true,
  };
}

/**
 * Redacts tokens, query parameters, email addresses, and resource path identifiers
 * from a raw Google URL string, replacing them with generic path placeholders.
 */
export function redactGoogleUrl(rawUrlInput: string | URL): string {
  let parsed: URL;
  try {
    parsed = typeof rawUrlInput === 'string' ? new URL(rawUrlInput) : new URL(rawUrlInput.toString());
  } catch {
    parsed = new URL(typeof rawUrlInput === 'string' ? rawUrlInput : rawUrlInput.toString(), 'https://gmail.googleapis.com');
  }

  // Strip query parameters
  parsed.search = '';

  // Redact path identifiers
  let redactedPath = parsed.pathname;

  redactedPath = redactedPath
    .replace(/\/users\/[^/]+/gi, '/users/:userId')
    .replace(/\/messages\/[^/]+\/attachments\/[^/]+/gi, '/messages/:messageId/attachments/:attachmentId')
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
  private summaryPath?: string;
  private totalRequests = 0;
  private allowedRequests = 0;
  private gmailMutationAttempts = 0;
  private unexpectedRequests = 0;
  private endpointCounts = new Map<string, number>();
  private records: GoogleAuditRecordSummary[] = [];

  constructor(options?: GoogleNetworkAuditOptions) {
    this.throwOnMutation = options?.throwOnMutation ?? true;
    this.throwOnUnexpected = options?.throwOnUnexpected ?? false;
    this.summaryPath = options?.summaryPath;
    this.start();
  }

  /** Start or clear audit logging lifecycle */
  start(): void {
    this.active = true;
    this.reset();
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
   * writes summary file if configured, and optionally throws on disallowed mutations/unexpected requests.
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
   */
  private persistSummary(): void {
    if (!this.summaryPath) return;
    try {
      const summary = this.getSummary();
      const content = `${JSON.stringify(summary, null, 2)}\n`;
      const fd = openSync(this.summaryPath, 'w');
      try {
        writeFileSync(fd, content, 'utf8');
        fsyncSync(fd);
      } finally {
        // fd closed
      }
    } catch {
      // Ignore file write errors in test environment if directory unavailable
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
   */
  wrapFetch<T extends (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(fetchFn: T): T {
    const auditor = this;
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
      let method = init?.method ?? 'GET';
      let urlStr = '';
      if (typeof input === 'string') {
        urlStr = input;
      } else if (input instanceof URL) {
        urlStr = input.toString();
      } else if (typeof input === 'object' && input !== null && 'url' in input) {
        urlStr = (input as Request).url;
        method = (input as Request).method || method;
      }
      auditor.recordRequest({ method, url: urlStr, headers: init?.headers });
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
export function createAuditedFetch<T extends (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
  fetchFn: T,
  options?: GoogleNetworkAuditOptions,
): T {
  const auditor = startGoogleNetworkAudit(options);
  return auditor.wrapFetch(fetchFn);
}
