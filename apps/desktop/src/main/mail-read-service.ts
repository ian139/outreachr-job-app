import type {
  GetMailThreadRequest,
  ListMailThreadsRequest,
  MailThreadListPage,
  MailThreadPage,
} from '../shared/contracts';
import type { ConnectorService } from './connector-service';

export interface MailReadServiceOptions {
  connectors: ConnectorService;
}

const MAX_BODY_BYTES = 1_048_576; // 1MiB

function hasCrLf(value: string): boolean {
  return value.includes('\r') || value.includes('\n');
}

function isValidEmail(email: string): boolean {
  if (email.length > 320 || hasCrLf(email)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateBoundedString(
  value: unknown,
  name: string,
  maxLength: number,
  required = true,
): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${name} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  if (required && !value.trim()) throw new Error(`${name} must be a non-empty string`);
  if (value.length > maxLength) throw new Error(`${name} exceeds maximum length of ${maxLength}`);
  if (hasCrLf(value)) throw new Error(`${name} must not contain CRLF characters`);
  return value;
}

function validateBoundedId(id: unknown, name: string, required = true): string | null {
  if (id === undefined || id === null) {
    if (required) throw new Error(`${name} is required from provider`);
    return null;
  }
  if (typeof id !== 'string') throw new Error(`${name} must be a string`);
  const trimmed = id.trim();
  if (required && !trimmed) throw new Error(`${name} must be a non-empty string`);
  if (trimmed.length > 4096 || hasCrLf(trimmed)) {
    throw new Error(`${name} exceeds maximum length or contains invalid CRLF characters`);
  }
  return trimmed;
}

function validateTimestamp(ts: unknown, name: string): string {
  if (typeof ts !== 'string' || !ts.trim() || ts.length > 100 || hasCrLf(ts)) {
    throw new Error(`Invalid ${name} timestamp from provider`);
  }
  const time = Date.parse(ts);
  if (Number.isNaN(time)) {
    throw new Error(`Invalid ${name} timestamp format from provider`);
  }
  return ts;
}

function validateSourceUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 4096 || hasCrLf(trimmed)) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:') {
      return parsed.toString();
    }
  } catch {
    return null;
  }
  return null;
}

function validateBodyString(body: unknown, name: string): string | null {
  if (body === undefined || body === null) return null;
  if (typeof body !== 'string') throw new Error(`${name} must be a string or null`);
  if (body.length > MAX_BODY_BYTES) {
    throw new Error(`Provider ${name} exceeds 1MiB limit`);
  }
  return body;
}

function mapParticipant(participant: unknown): string {
  if (typeof participant === 'string') {
    const trimmed = participant.trim();
    if (trimmed.length > 500 || hasCrLf(trimmed)) return 'unknown';
    return trimmed;
  }
  if (participant && typeof participant === 'object' && 'email' in participant) {
    const addr = participant as { email: string; name?: string };
    const email = typeof addr.email === 'string' ? addr.email.trim() : '';
    const name = typeof addr.name === 'string' ? addr.name.trim() : '';
    if (name && !hasCrLf(name) && name.length <= 500) {
      return `${name} <${email}>`;
    }
    return email;
  }
  return String(participant);
}

function mapEmailAddress(addr: { email: string; name?: string }): { email: string; name?: string } {
  const email = typeof addr.email === 'string' ? addr.email.trim() : '';
  if (!email || hasCrLf(email) || email.length > 320) {
    throw new Error('Invalid email address in message participant');
  }
  const name = typeof addr.name === 'string' && addr.name.trim() ? addr.name.trim() : undefined;
  if (name && !hasCrLf(name) && name.length <= 500) {
    return { email, name };
  }
  return { email };
}

export class MailReadService {
  readonly #connectors: ConnectorService;
  readonly #activeRequests = new Map<string, AbortController>();

  constructor(options: MailReadServiceOptions) {
    this.#connectors = options.connectors;
  }

  async listMailThreads(request: ListMailThreadsRequest): Promise<MailThreadListPage> {
    this.#validateListRequest(request);

    const existing = this.#activeRequests.get(request.requestId);
    if (existing) {
      existing.abort(new Error('Request replaced by new request with same requestId'));
      this.#activeRequests.delete(request.requestId);
    }

    const controller = new AbortController();
    this.#activeRequests.set(request.requestId, controller);

    try {
      const connector = this.#connectors.getMailConnector(request.provider, request.accountEmail);

      if (typeof connector.listMailboxThreads !== 'function') {
        throw new Error(
          `Mail thread listing is not supported by connector for ${request.provider}`,
        );
      }

      const page = await connector.listMailboxThreads({
        accountEmail: request.accountEmail,
        ...(request.mailViewMode ? { mailViewMode: request.mailViewMode } : {}),
        ...(request.query ? { query: request.query } : {}),
        pageSize: request.limit,
        ...(request.cursor ? { pageToken: request.cursor } : {}),
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        throw new Error('Request cancelled');
      }

      const rawThreads = page.threads ?? [];
      if (rawThreads.length > 50) {
        throw new Error('Contract violation: connector returned more than 50 threads');
      }

      return {
        threads: rawThreads.map((thread) => ({
          provider: request.provider,
          accountEmail: request.accountEmail,
          threadId: validateBoundedId(thread.threadId, 'threadId', true)!,
          subject: validateBoundedString(thread.subject ?? '', 'subject', 4096, false) ?? '',
          snippet: thread.snippet
            ? (validateBoundedString(thread.snippet, 'snippet', 4096, false) ?? null)
            : null,
          participants: (Array.isArray(thread.participants) ? thread.participants : []).map(
            mapParticipant,
          ),
          latestAt: validateTimestamp(thread.latestAt, 'latestAt'),
          messageCount:
            typeof thread.messageCount === 'number' && thread.messageCount >= 0
              ? thread.messageCount
              : 0,
          sourceUrl: validateSourceUrl(thread.sourceUrl),
        })),
        nextCursor: page.nextPageToken
          ? (validateBoundedString(page.nextPageToken, 'nextPageToken', 4096, false) ?? null)
          : null,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Request cancelled', { cause: error });
      }
      throw error;
    } finally {
      if (this.#activeRequests.get(request.requestId) === controller) {
        this.#activeRequests.delete(request.requestId);
      }
    }
  }

  async getMailThread(request: GetMailThreadRequest): Promise<MailThreadPage> {
    this.#validateGetRequest(request);

    const existing = this.#activeRequests.get(request.requestId);
    if (existing) {
      existing.abort(new Error('Request replaced by new request with same requestId'));
      this.#activeRequests.delete(request.requestId);
    }

    const controller = new AbortController();
    this.#activeRequests.set(request.requestId, controller);

    try {
      const connector = this.#connectors.getMailConnector(request.provider, request.accountEmail);

      if (typeof connector.getMailboxThread !== 'function') {
        throw new Error(
          `Mail thread fetching is not supported by connector for ${request.provider}`,
        );
      }

      const page = await connector.getMailboxThread({
        accountEmail: request.accountEmail,
        threadId: request.threadId,
        pageSize: request.limit,
        ...(request.cursor ? { pageToken: request.cursor } : {}),
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        throw new Error('Request cancelled');
      }

      const rawMessages = page.messages ?? [];
      if (rawMessages.length > 50) {
        throw new Error('Contract violation: connector returned more than 50 messages');
      }

      return {
        thread: {
          provider: request.provider,
          accountEmail: request.accountEmail,
          threadId: validateBoundedId(page.thread.threadId, 'threadId', true)!,
          subject: validateBoundedString(page.thread.subject ?? '', 'subject', 4096, false) ?? '',
          snippet: page.thread.snippet
            ? (validateBoundedString(page.thread.snippet, 'snippet', 4096, false) ?? null)
            : null,
          participants: (Array.isArray(page.thread.participants)
            ? page.thread.participants
            : []
          ).map(mapParticipant),
          latestAt: validateTimestamp(page.thread.latestAt, 'latestAt'),
          messageCount:
            typeof page.thread.messageCount === 'number' && page.thread.messageCount >= 0
              ? page.thread.messageCount
              : 0,
          sourceUrl: validateSourceUrl(page.thread.sourceUrl),
        },
        messages: rawMessages.map((msg) => ({
          provider: request.provider,
          accountEmail: request.accountEmail,
          threadId: validateBoundedId(msg.threadId, 'threadId', true)!,
          messageId: validateBoundedId(msg.id, 'messageId', true)!,
          internetMessageId: validateBoundedId(msg.internetMessageId, 'internetMessageId', false),
          subject: validateBoundedString(msg.subject ?? '', 'subject', 4096, false) ?? '',
          from: mapEmailAddress(msg.from),
          to: (msg.to ?? []).map(mapEmailAddress),
          cc: (msg.cc ?? []).map(mapEmailAddress),
          occurredAt: validateTimestamp(msg.occurredAt, 'occurredAt'),
          labels: (Array.isArray(msg.labels) ? msg.labels : []).map((l) =>
            validateBoundedString(l, 'label', 100, true)!,
          ),
          direction:
            msg.direction === 'inbound' || msg.direction === 'outbound' ? msg.direction : null,
          bodyText: validateBodyString(msg.bodyText, 'bodyText'),
          bodyHtml: validateBodyString(msg.bodyHtml, 'bodyHtml'),
          providerTruncated: Boolean(msg.providerTruncated),
          truncationReason: msg.truncationReason
            ? (validateBoundedString(msg.truncationReason, 'truncationReason', 1000, false) ?? null)
            : null,
          sourceUrl: validateSourceUrl(msg.sourceUrl),
          fetchedAt: validateTimestamp(msg.fetchedAt, 'fetchedAt'),
        })),
        nextCursor: page.nextPageToken
          ? (validateBoundedString(page.nextPageToken, 'nextPageToken', 4096, false) ?? null)
          : null,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Request cancelled', { cause: error });
      }
      throw error;
    } finally {
      if (this.#activeRequests.get(request.requestId) === controller) {
        this.#activeRequests.delete(request.requestId);
      }
    }
  }

  cancelMailRequest(requestId: string): void {
    validateBoundedString(requestId, 'requestId', 4096, true);
    const controller = this.#activeRequests.get(requestId);
    if (controller) {
      controller.abort(new Error('Request cancelled'));
      this.#activeRequests.delete(requestId);
    }
  }

  cancelAllRequests(): void {
    for (const controller of this.#activeRequests.values()) {
      controller.abort(new Error('All mail requests cancelled'));
    }
    this.#activeRequests.clear();
  }

  get activeRequestCount(): number {
    return this.#activeRequests.size;
  }

  #validateListRequest(request: ListMailThreadsRequest): void {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid request payload');
    }
    validateBoundedString(request.requestId, 'requestId', 4096, true);
    if (
      (request.provider as unknown) !== 'google' &&
      (request.provider as unknown) !== 'microsoft'
    ) {
      throw new Error(`Unsupported or invalid provider: ${String(request.provider)}`);
    }
    if (typeof request.accountEmail !== 'string' || !isValidEmail(request.accountEmail)) {
      throw new Error(
        'accountEmail must be a valid email address up to 320 characters without CRLF',
      );
    }
    if (
      typeof request.limit !== 'number' ||
      !Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 50
    ) {
      throw new Error('Limit must be an integer between 1 and 50');
    }
    if (request.query !== undefined) {
      validateBoundedString(request.query, 'query', 1000, false);
    }
    if (
      request.mailViewMode !== undefined &&
      request.mailViewMode !== 'job-relevant' &&
      request.mailViewMode !== 'all'
    ) {
      throw new Error('Mail view mode must be job-relevant or all');
    }
    if (request.cursor !== undefined) {
      validateBoundedString(request.cursor, 'cursor', 4096, false);
    }
  }

  #validateGetRequest(request: GetMailThreadRequest): void {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid request payload');
    }
    validateBoundedString(request.requestId, 'requestId', 4096, true);
    if (
      (request.provider as unknown) !== 'google' &&
      (request.provider as unknown) !== 'microsoft'
    ) {
      throw new Error(`Unsupported or invalid provider: ${String(request.provider)}`);
    }
    if (typeof request.accountEmail !== 'string' || !isValidEmail(request.accountEmail)) {
      throw new Error(
        'accountEmail must be a valid email address up to 320 characters without CRLF',
      );
    }
    validateBoundedString(request.threadId, 'threadId', 4096, true);
    if (
      typeof request.limit !== 'number' ||
      !Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 50
    ) {
      throw new Error('Limit must be an integer between 1 and 50');
    }
    if (request.cursor !== undefined) {
      validateBoundedString(request.cursor, 'cursor', 4096, false);
    }
  }
}
