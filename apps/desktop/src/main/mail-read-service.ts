import type { ConnectorProvider } from '@outreachr/connectors';
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
      const connector = this.#connectors.getMailConnector(
        request.provider,
        request.accountEmail,
      );

      if (typeof connector.listMailboxThreads !== 'function') {
        throw new Error(
          `Mail thread listing is not supported by connector for ${request.provider}`,
        );
      }

      const page = await connector.listMailboxThreads({
        accountEmail: request.accountEmail,
        query: request.query,
        pageSize: request.limit,
        pageToken: request.cursor,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        throw new Error('Request cancelled');
      }

      return {
        threads: (page.threads ?? []).map((thread) => ({
          provider: thread.provider,
          accountEmail: thread.accountEmail,
          threadId: thread.threadId,
          subject: thread.subject ?? '',
          snippet: thread.snippet ?? null,
          participants: Array.isArray(thread.participants) ? thread.participants : [],
          latestAt: thread.latestAt,
          messageCount: typeof thread.messageCount === 'number' ? thread.messageCount : 0,
          sourceUrl: thread.sourceUrl ?? null,
        })),
        nextCursor: page.nextPageToken ?? null,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Request cancelled');
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
      const connector = this.#connectors.getMailConnector(
        request.provider,
        request.accountEmail,
      );

      if (typeof connector.getMailboxThread !== 'function') {
        throw new Error(
          `Mail thread fetching is not supported by connector for ${request.provider}`,
        );
      }

      const page = await connector.getMailboxThread({
        accountEmail: request.accountEmail,
        threadId: request.threadId,
        pageSize: request.limit,
        pageToken: request.cursor,
        signal: controller.signal,
      });

      if (controller.signal.aborted) {
        throw new Error('Request cancelled');
      }

      return {
        thread: {
          provider: page.thread.provider,
          accountEmail: page.thread.accountEmail,
          threadId: page.thread.threadId,
          subject: page.thread.subject ?? '',
          snippet: page.thread.snippet ?? null,
          participants: Array.isArray(page.thread.participants) ? page.thread.participants : [],
          latestAt: page.thread.latestAt,
          messageCount: typeof page.thread.messageCount === 'number' ? page.thread.messageCount : 0,
          sourceUrl: page.thread.sourceUrl ?? null,
        },
        messages: (page.messages ?? []).map((msg) => ({
          provider: msg.provider,
          accountEmail: msg.accountEmail,
          threadId: msg.threadId,
          messageId: msg.id,
          internetMessageId: msg.internetMessageId ?? null,
          subject: msg.subject ?? '',
          from: { email: msg.from.email, name: msg.from.name },
          to: (msg.to ?? []).map((addr) => ({ email: addr.email, name: addr.name })),
          cc: (msg.cc ?? []).map((addr) => ({ email: addr.email, name: addr.name })),
          occurredAt: msg.occurredAt,
          labels: Array.isArray(msg.labels) ? msg.labels : [],
          direction: msg.direction ?? null,
          bodyText: msg.bodyText ?? null,
          bodyHtml: msg.bodyHtml ?? null,
          providerTruncated: Boolean(msg.providerTruncated),
          truncationReason: msg.truncationReason ?? null,
          sourceUrl: msg.sourceUrl ?? null,
          fetchedAt: msg.fetchedAt,
        })),
        nextCursor: page.nextPageToken ?? null,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error('Request cancelled');
      }
      throw error;
    } finally {
      if (this.#activeRequests.get(request.requestId) === controller) {
        this.#activeRequests.delete(request.requestId);
      }
    }
  }

  cancelMailRequest(requestId: string): void {
    if (typeof requestId !== 'string' || !requestId.trim()) {
      throw new Error('requestId must be a non-empty string');
    }
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
    if (typeof request.requestId !== 'string' || !request.requestId.trim()) {
      throw new Error('requestId must be a non-empty string');
    }
    if (
      (request.provider as unknown) !== 'google' &&
      (request.provider as unknown) !== 'microsoft'
    ) {
      throw new Error(`Unsupported or invalid provider: ${String(request.provider)}`);
    }
    if (typeof request.accountEmail !== 'string' || !request.accountEmail.trim()) {
      throw new Error('accountEmail must be a non-empty string');
    }
    if (
      typeof request.limit !== 'number' ||
      !Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 50
    ) {
      throw new Error('Limit must be an integer between 1 and 50');
    }
    if (request.query !== undefined && typeof request.query !== 'string') {
      throw new Error('query must be a string if provided');
    }
    if (request.cursor !== undefined && typeof request.cursor !== 'string') {
      throw new Error('cursor must be a string if provided');
    }
  }

  #validateGetRequest(request: GetMailThreadRequest): void {
    if (!request || typeof request !== 'object') {
      throw new Error('Invalid request payload');
    }
    if (typeof request.requestId !== 'string' || !request.requestId.trim()) {
      throw new Error('requestId must be a non-empty string');
    }
    if (
      (request.provider as unknown) !== 'google' &&
      (request.provider as unknown) !== 'microsoft'
    ) {
      throw new Error(`Unsupported or invalid provider: ${String(request.provider)}`);
    }
    if (typeof request.accountEmail !== 'string' || !request.accountEmail.trim()) {
      throw new Error('accountEmail must be a non-empty string');
    }
    if (typeof request.threadId !== 'string' || !request.threadId.trim()) {
      throw new Error('threadId must be a non-empty string');
    }
    if (
      typeof request.limit !== 'number' ||
      !Number.isInteger(request.limit) ||
      request.limit < 1 ||
      request.limit > 50
    ) {
      throw new Error('Limit must be an integer between 1 and 50');
    }
    if (request.cursor !== undefined && typeof request.cursor !== 'string') {
      throw new Error('cursor must be a string if provided');
    }
  }
}
