/**
 * Redacted Google Live-Smoke & Network Audit Mechanic
 *
 * Provides a main-owned acceptance mechanic that:
 * 1. Allows OAuth/token endpoints and Gmail GET list/thread/message/attachment read endpoints.
 * 2. Records only the HTTP method, canonical endpoint class, and status/count.
 * 3. Hard-fails and counts any Gmail POST/PUT/PATCH/DELETE mutation attempt.
 * 4. Never persists or logs tokens, URLs containing identifiers (message IDs, thread IDs, user IDs),
 *    query parameters, email addresses, subjects, correspondents, or request/response bodies.
 * 5. Exposes a clear lifecycle: start audit, consume redacted machine-readable summary,
 *    and assert zero mutations.
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

export interface AuditRequestInput {
  method: string;
  url: string | URL;
  headers?: Record<string, string | string[] | undefined> | Headers;
  body?: unknown;
}

export interface EndpointClassification {
  endpointClass: string;
  isAllowed: boolean;
  isMutation: boolean;
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
  mutationAttempts: number;
  zeroMutations: boolean;
  endpointCounts: Record<string, number>;
  records: GoogleAuditRecordSummary[];
}

export interface GoogleNetworkAuditOptions {
  /** Hard-fail immediately when a Gmail mutation request (POST/PUT/PATCH/DELETE) is intercepted. Default: true */
  throwOnMutation?: boolean;
}

/**
 * Classifies an HTTP method + Google endpoint URL into a canonical endpoint class,
 * determining whether it is an allowed read/token operation or a disallowed mutation.
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

  // 1. OAuth / Token Endpoints
  const isOAuthDomain =
    hostname.includes('oauth2.googleapis.com') ||
    hostname.includes('accounts.google.com') ||
    hostname.includes('openidconnect.googleapis.com');

  if (isOAuthDomain || pathname.endsWith('/token') || pathname.endsWith('/oauth2/v2/auth') || pathname.endsWith('/revoke')) {
    if (pathname.includes('/token')) {
      return { endpointClass: 'oauth.token', isAllowed: true, isMutation: false };
    }
    if (pathname.includes('/auth')) {
      return { endpointClass: 'oauth.authorize', isAllowed: true, isMutation: false };
    }
    if (pathname.includes('/revoke')) {
      return { endpointClass: 'oauth.revoke', isAllowed: true, isMutation: false };
    }
    if (pathname.includes('/userinfo')) {
      return { endpointClass: 'oauth.userinfo', isAllowed: true, isMutation: false };
    }
    return { endpointClass: 'oauth.other', isAllowed: true, isMutation: false };
  }

  // 2. Gmail Endpoints
  const isGmail = hostname.includes('gmail.googleapis.com') || pathname.includes('/gmail/v1/users/') || pathname.includes('/users/');

  if (isGmail) {
    // Gmail Messages
    if (/\/users\/[^/]+\/messages\/send$/i.test(pathname)) {
      return { endpointClass: 'gmail.messages.send', isAllowed: false, isMutation: true };
    }
    if (/\/users\/[^/]+\/messages\/batchDelete$/i.test(pathname)) {
      return { endpointClass: 'gmail.messages.batchDelete', isAllowed: false, isMutation: true };
    }
    if (/\/users\/[^/]+\/messages\/[^/]+\/modify$/i.test(pathname)) {
      return { endpointClass: 'gmail.messages.modify', isAllowed: false, isMutation: true };
    }
    if (/\/users\/[^/]+\/messages\/[^/]+\/attachments\/[^/]+$/i.test(pathname)) {
      if (method === 'GET') {
        return { endpointClass: 'gmail.attachments.get', isAllowed: true, isMutation: false };
      }
      return { endpointClass: 'gmail.attachments.mutation', isAllowed: false, isMutation: true };
    }
    if (/\/users\/[^/]+\/messages\/[^/]+$/i.test(pathname)) {
      if (method === 'GET') {
        return { endpointClass: 'gmail.messages.get', isAllowed: true, isMutation: false };
      }
      if (method === 'DELETE') {
        return { endpointClass: 'gmail.messages.delete', isAllowed: false, isMutation: true };
      }
      return { endpointClass: 'gmail.messages.mutation', isAllowed: false, isMutation: true };
    }
    if (/\/users\/[^/]+\/messages$/i.test(pathname)) {
      if (method === 'GET') {
        return { endpointClass: 'gmail.messages.list', isAllowed: true, isMutation: false };
      }
      if (method === 'POST') {
        return { endpointClass: 'gmail.messages.insert', isAllowed: false, isMutation: true };
      }
      return { endpointClass: 'gmail.messages.mutation', isAllowed: false, isMutation: true };
    }

    // Gmail Threads
    if (/\/users\/[^/]+\/threads\/[^/]+\/modify$/i.test(pathname)) {
      return { endpointClass: 'gmail.threads.modify', isAllowed: false, isMutation: true };
    }
    if (/\/users\/[^/]+\/threads\/[^/]+$/i.test(pathname)) {
      if (method === 'GET') {
        return { endpointClass: 'gmail.threads.get', isAllowed: true, isMutation: false };
      }
      if (method === 'DELETE') {
        return { endpointClass: 'gmail.threads.delete', isAllowed: false, isMutation: true };
      }
      return { endpointClass: 'gmail.threads.mutation', isAllowed: false, isMutation: true };
    }
    if (/\/users\/[^/]+\/threads$/i.test(pathname)) {
      if (method === 'GET') {
        return { endpointClass: 'gmail.threads.list', isAllowed: true, isMutation: false };
      }
      return { endpointClass: 'gmail.threads.mutation', isAllowed: false, isMutation: true };
    }

    // Gmail Drafts
    if (/\/users\/[^/]+\/drafts\/send$/i.test(pathname) || /\/users\/[^/]+\/drafts\/[^/]+\/send$/i.test(pathname)) {
      return { endpointClass: 'gmail.drafts.send', isAllowed: false, isMutation: true };
    }
    if (/\/users\/[^/]+\/drafts\/[^/]+$/i.test(pathname)) {
      if (method === 'GET') {
        return { endpointClass: 'gmail.drafts.get', isAllowed: true, isMutation: false };
      }
      return { endpointClass: 'gmail.drafts.mutation', isAllowed: false, isMutation: true };
    }
    if (/\/users\/[^/]+\/drafts$/i.test(pathname)) {
      if (method === 'GET') {
        return { endpointClass: 'gmail.drafts.list', isAllowed: true, isMutation: false };
      }
      if (method === 'POST') {
        return { endpointClass: 'gmail.drafts.create', isAllowed: false, isMutation: true };
      }
      return { endpointClass: 'gmail.drafts.mutation', isAllowed: false, isMutation: true };
    }

    // Gmail Labels
    if (/\/users\/[^/]+\/labels\/[^/]+$/i.test(pathname)) {
      if (method === 'GET') {
        return { endpointClass: 'gmail.labels.get', isAllowed: true, isMutation: false };
      }
      return { endpointClass: 'gmail.labels.mutation', isAllowed: false, isMutation: true };
    }
    if (/\/users\/[^/]+\/labels$/i.test(pathname)) {
      if (method === 'GET') {
        return { endpointClass: 'gmail.labels.list', isAllowed: true, isMutation: false };
      }
      return { endpointClass: 'gmail.labels.mutation', isAllowed: false, isMutation: true };
    }

    // Gmail Profile
    if (/\/users\/[^/]+\/profile$/i.test(pathname)) {
      if (method === 'GET') {
        return { endpointClass: 'gmail.profile.get', isAllowed: true, isMutation: false };
      }
      return { endpointClass: 'gmail.profile.mutation', isAllowed: false, isMutation: true };
    }

    // Any other Gmail endpoint
    if (method === 'GET') {
      return { endpointClass: 'gmail.read.other', isAllowed: true, isMutation: false };
    }
    return { endpointClass: 'gmail.mutation.other', isAllowed: false, isMutation: true };
  }

  // 3. Calendar / Other Google endpoints
  if (hostname.includes('calendar.googleapis.com') || pathname.includes('/calendar/v3/')) {
    if (pathname.includes('/events')) {
      return {
        endpointClass: method === 'GET' ? 'calendar.events.list' : 'calendar.events.create',
        isAllowed: true,
        isMutation: false,
      };
    }
    return { endpointClass: 'calendar.other', isAllowed: true, isMutation: false };
  }

  return {
    endpointClass: method === 'GET' ? 'google.read.other' : 'google.other',
    isAllowed: method === 'GET',
    isMutation: method !== 'GET',
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
    // If not a full URL, attempt relative parsing with dummy base
    parsed = new URL(typeof rawUrlInput === 'string' ? rawUrlInput : rawUrlInput.toString(), 'https://gmail.googleapis.com');
  }

  // 1. Strip ALL query parameters (tokens, search queries, page tokens, format, code, etc.)
  parsed.search = '';

  // 2. Redact path identifiers (user emails/IDs, message IDs, thread IDs, attachment IDs, draft IDs, label IDs)
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
  private totalRequests = 0;
  private allowedRequests = 0;
  private mutationAttempts = 0;
  private endpointCounts = new Map<string, number>();
  private records: GoogleAuditRecordSummary[] = [];

  constructor(options?: GoogleNetworkAuditOptions) {
    this.throwOnMutation = options?.throwOnMutation ?? true;
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
    this.mutationAttempts = 0;
    this.endpointCounts.clear();
    this.records = [];
  }

  /**
   * Intercept and record an HTTP request.
   * Redacts all sensitive parameters, classifies endpoint, updates counts,
   * and optionally throws GoogleMutationDisallowedError on disallowed Gmail mutations.
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

      if (classification.isMutation || !classification.isAllowed) {
        this.mutationAttempts += 1;
      } else {
        this.allowedRequests += 1;
      }

      // Record MUST contain only method, endpointClass, and status.
      // NO tokens, NO identifiers, NO emails, NO headers, NO bodies.
      this.records.push({
        method,
        endpointClass: classification.endpointClass,
        status,
      });
    }

    const result: AuditRecordResult = {
      ...classification,
      method,
      status,
      redactedUrl,
    };

    if (this.active && (classification.isMutation || !classification.isAllowed) && this.throwOnMutation) {
      throw new GoogleMutationDisallowedError(method, classification.endpointClass, redactedUrl);
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
    return {
      totalRequests: this.totalRequests,
      allowedRequests: this.allowedRequests,
      mutationAttempts: this.mutationAttempts,
      zeroMutations: this.mutationAttempts === 0,
      endpointCounts: countsObj,
      records: [...this.records],
    };
  }

  /**
   * Asserts that zero Gmail mutations occurred. Throws if any mutation attempt was recorded.
   */
  assertZeroMutations(): void {
    if (this.mutationAttempts > 0) {
      throw new Error(
        `Google network audit failure: intercepted ${this.mutationAttempts} disallowed Gmail mutation attempt(s). Zero mutations policy violated.`,
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
