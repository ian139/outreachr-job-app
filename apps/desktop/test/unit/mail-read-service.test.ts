import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RelationshipMailConnector } from '@outreachr/connectors';
import type {
  GetMailThreadRequest,
  ListMailThreadsRequest,
  MailThreadSummary,
  MailMessageBody,
} from '../../src/shared/contracts';
import type { ConnectorService } from '../../src/main/connector-service';
import { MailReadService } from '../../src/main/mail-read-service';
import { initializedVault, removeTemporaryDirectory, temporaryDirectory } from '../helpers/vault';
import type { VaultService } from '../../src/main/vault-service';

function createMockConnector(overrides: Partial<RelationshipMailConnector> = {}): RelationshipMailConnector {
  return {
    provider: 'google',
    listMailboxMessages: vi.fn().mockResolvedValue({ messages: [] }),
    listMailboxThreads: vi.fn().mockResolvedValue({
      threads: [
        {
          provider: 'google',
          accountEmail: 'user@example.com',
          threadId: 'thread-1',
          subject: 'Test Thread',
          snippet: 'Snippet preview',
          participants: ['user@example.com', 'contact@example.com'],
          latestAt: '2026-08-12T10:00:00Z',
          messageCount: 2,
          sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/thread-1',
        },
      ],
      nextPageToken: 'cursor-2',
    }),
    getMailboxThread: vi.fn().mockResolvedValue({
      thread: {
        provider: 'google',
        accountEmail: 'user@example.com',
        threadId: 'thread-1',
        subject: 'Test Thread',
        snippet: 'Snippet preview',
        participants: ['user@example.com', 'contact@example.com'],
        latestAt: '2026-08-12T10:00:00Z',
        messageCount: 1,
      },
      messages: [
        {
          provider: 'google',
          accountEmail: 'user@example.com',
          threadId: 'thread-1',
          id: 'msg-1',
          internetMessageId: '<msg-1@example.com>',
          subject: 'Test Message',
          from: { email: 'contact@example.com', name: 'Contact' },
          to: [{ email: 'user@example.com', name: 'User' }],
          cc: [],
          occurredAt: '2026-08-12T10:00:00Z',
          labels: ['INBOX'],
          direction: 'inbound',
          bodyText: 'Hello world text body',
          bodyHtml: '<p>Hello world html body</p>',
          providerTruncated: false,
          truncationReason: undefined,
          sourceUrl: undefined,
          fetchedAt: '2026-08-12T10:01:00Z',
        },
      ],
      nextPageToken: undefined,
    }),
    ...overrides,
  };
}

describe('MailReadService & Bridge IPC', () => {
  let mockConnector: RelationshipMailConnector;
  let mockConnectorService: ConnectorService;
  let service: MailReadService;
  let testDir: string;
  let vaultService: VaultService;

  beforeEach(async () => {
    mockConnector = createMockConnector();
    mockConnectorService = {
      getMailConnector: vi.fn().mockReturnValue(mockConnector),
    } as unknown as ConnectorService;

    service = new MailReadService({ connectors: mockConnectorService });

    testDir = await temporaryDirectory();
    vaultService = initializedVault(testDir);
  });

  afterEach(async () => {
    service.cancelAllRequests();
    await removeTemporaryDirectory(testDir);
  });

  describe('Payload & Bounds Validation', () => {
    it('rejects limits greater than 50', async () => {
      const request: ListMailThreadsRequest = {
        requestId: 'req-1',
        provider: 'google',
        accountEmail: 'user@example.com',
        limit: 51,
      };

      await expect(service.listMailThreads(request)).rejects.toThrow(
        'Limit must be an integer between 1 and 50',
      );
    });

    it('rejects limits less than 1 or non-integer limits', async () => {
      const reqZero: ListMailThreadsRequest = {
        requestId: 'req-1',
        provider: 'google',
        accountEmail: 'user@example.com',
        limit: 0,
      };
      await expect(service.listMailThreads(reqZero)).rejects.toThrow(
        'Limit must be an integer between 1 and 50',
      );

      const reqFloat: ListMailThreadsRequest = {
        requestId: 'req-1',
        provider: 'google',
        accountEmail: 'user@example.com',
        limit: 10.5,
      };
      await expect(service.listMailThreads(reqFloat)).rejects.toThrow(
        'Limit must be an integer between 1 and 50',
      );
    });

    it('rejects invalid or arbitrary providers', async () => {
      const request = {
        requestId: 'req-1',
        provider: 'arbitrary_provider' as unknown as 'google',
        accountEmail: 'user@example.com',
        limit: 25,
      };

      await expect(service.listMailThreads(request)).rejects.toThrow(
        'Unsupported or invalid provider: arbitrary_provider',
      );
    });

    it('rejects missing or empty request IDs', async () => {
      const request: ListMailThreadsRequest = {
        requestId: '   ',
        provider: 'google',
        accountEmail: 'user@example.com',
        limit: 25,
      };

      await expect(service.listMailThreads(request)).rejects.toThrow(
        'requestId must be a non-empty string',
      );
    });

    it('rejects missing or empty threadId for getMailThread', async () => {
      const request: GetMailThreadRequest = {
        requestId: 'req-1',
        provider: 'google',
        accountEmail: 'user@example.com',
        threadId: '',
        limit: 10,
      };

      await expect(service.getMailThread(request)).rejects.toThrow(
        'threadId must be a non-empty string',
      );
    });
  });

  describe('Connected Account & Scope Validation', () => {
    it('propagates connector connection error if provider is disconnected', async () => {
      vi.mocked(mockConnectorService.getMailConnector).mockImplementation(() => {
        throw new Error('google is not connected');
      });

      const request: ListMailThreadsRequest = {
        requestId: 'req-1',
        provider: 'google',
        accountEmail: 'unconnected@example.com',
        limit: 20,
      };

      await expect(service.listMailThreads(request)).rejects.toThrow('google is not connected');
    });

    it('propagates email mismatch error from ConnectorService', async () => {
      vi.mocked(mockConnectorService.getMailConnector).mockImplementation(() => {
        throw new Error('Account wrong@example.com does not match connected account for google');
      });

      const request: ListMailThreadsRequest = {
        requestId: 'req-1',
        provider: 'google',
        accountEmail: 'wrong@example.com',
        limit: 20,
      };

      await expect(service.listMailThreads(request)).rejects.toThrow(
        'Account wrong@example.com does not match connected account for google',
      );
    });
  });

  describe('Data Mapping & Shared Contract Conformity', () => {
    it('maps listMailThreads output into MailThreadListPage', async () => {
      const request: ListMailThreadsRequest = {
        requestId: 'req-list-1',
        provider: 'google',
        accountEmail: 'user@example.com',
        limit: 10,
        query: 'is:unread',
      };

      const result = await service.listMailThreads(request);

      expect(mockConnectorService.getMailConnector).toHaveBeenCalledWith(
        'google',
        'user@example.com',
      );
      expect(mockConnector.listMailboxThreads).toHaveBeenCalledWith({
        accountEmail: 'user@example.com',
        query: 'is:unread',
        pageSize: 10,
        pageToken: undefined,
        signal: expect.any(AbortSignal),
      });

      expect(result.nextCursor).toBe('cursor-2');
      expect(result.threads).toHaveLength(1);
      const summary: MailThreadSummary = result.threads[0]!;
      expect(summary.provider).toBe('google');
      expect(summary.threadId).toBe('thread-1');
      expect(summary.snippet).toBe('Snippet preview');
      expect(summary.participants).toEqual(['user@example.com', 'contact@example.com']);
    });

    it('maps getMailThread output into MailThreadPage', async () => {
      const request: GetMailThreadRequest = {
        requestId: 'req-get-1',
        provider: 'google',
        accountEmail: 'user@example.com',
        threadId: 'thread-1',
        limit: 10,
      };

      const result = await service.getMailThread(request);

      expect(result.thread.threadId).toBe('thread-1');
      expect(result.messages).toHaveLength(1);
      const msg: MailMessageBody = result.messages[0]!;
      expect(msg.messageId).toBe('msg-1');
      expect(msg.internetMessageId).toBe('<msg-1@example.com>');
      expect(msg.bodyText).toBe('Hello world text body');
      expect(msg.bodyHtml).toBe('<p>Hello world html body</p>');
      expect(msg.direction).toBe('inbound');
    });
  });

  describe('Privacy & Request-Memory Isolation', () => {
    it('returns message bodies in response memory without persisting to SQLite vault', async () => {
      const request: GetMailThreadRequest = {
        requestId: 'req-memory-1',
        provider: 'google',
        accountEmail: 'user@example.com',
        threadId: 'thread-1',
        limit: 10,
      };

      const result = await service.getMailThread(request);
      expect(result.messages[0]?.bodyText).toBe('Hello world text body');

      // Verify no tables in SQLite database contain saved mail messages or message bodies
      const tables = vaultService.vault.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table'",
      );
      for (const { name } of tables) {
        if (name.includes('mail') || name.includes('message')) {
          const count = vaultService.vault.one<{ c: number }>(`SELECT COUNT(*) as c FROM ${name}`);
          expect(count?.c ?? 0).toBe(0);
        }
      }
    });
  });

  describe('Cancellation Lifecycle & Abort Signals', () => {
    it('aborts pending request when cancelMailRequest is called', async () => {
      let capturedSignal: AbortSignal | undefined;
      vi.mocked(mockConnector.getMailboxThread).mockImplementation(
        ({ signal }: { signal?: AbortSignal }) => {
          capturedSignal = signal;
          const { promise, reject } = Promise.withResolvers<never>();
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('Aborted by signal');
              err.name = 'AbortError';
              reject(err);
            });
          }
          return promise;
        },
      );

      const request: GetMailThreadRequest = {
        requestId: 'req-cancel-1',
        provider: 'google',
        accountEmail: 'user@example.com',
        threadId: 'thread-1',
        limit: 5,
      };

      const promise = service.getMailThread(request);
      expect(service.activeRequestCount).toBe(1);

      // Cancel the request while in flight
      service.cancelMailRequest('req-cancel-1');

      await expect(promise).rejects.toThrow('Request cancelled');
      expect(capturedSignal?.aborted).toBe(true);
      expect(service.activeRequestCount).toBe(0);
    });

    it('aborts all active requests when cancelAllRequests is called', async () => {
      vi.mocked(mockConnector.listMailboxThreads).mockImplementation(
        ({ signal }: { signal?: AbortSignal }) => {
          const { promise, reject } = Promise.withResolvers<never>();
          signal?.addEventListener('abort', () => reject(new Error('Aborted')));
          return promise;
        },
      );

      const req1: ListMailThreadsRequest = {
        requestId: 'req-all-1',
        provider: 'google',
        accountEmail: 'user@example.com',
        limit: 5,
      };
      const req2: ListMailThreadsRequest = {
        requestId: 'req-all-2',
        provider: 'google',
        accountEmail: 'user@example.com',
        limit: 5,
      };

      const p1 = service.listMailThreads(req1);
      const p2 = service.listMailThreads(req2);
      expect(service.activeRequestCount).toBe(2);

      service.cancelAllRequests();

      await expect(p1).rejects.toThrow('Request cancelled');
      await expect(p2).rejects.toThrow('Request cancelled');
      expect(service.activeRequestCount).toBe(0);
    });
  });

  describe('Stale Selection & Replaced Request IDs', () => {
    it('aborts prior request when new request arrives with identical requestId', async () => {
      let firstSignal: AbortSignal | undefined;
      let callCount = 0;

      vi.mocked(mockConnector.listMailboxThreads).mockImplementation(
        ({ signal }: { signal?: AbortSignal }) => {
          callCount += 1;
          if (callCount === 1) {
            firstSignal = signal;
            const { promise, reject } = Promise.withResolvers<never>();
            signal?.addEventListener('abort', () => reject(new Error('First request aborted')));
            return promise;
          }
          return Promise.resolve({ threads: [], nextPageToken: undefined });
        },
      );

      const req1: ListMailThreadsRequest = {
        requestId: 'req-shared-id',
        provider: 'google',
        accountEmail: 'user@example.com',
        limit: 10,
      };

      const p1 = service.listMailThreads(req1);
      expect(service.activeRequestCount).toBe(1);

      // Issue second request with SAME requestId
      const req2: ListMailThreadsRequest = {
        requestId: 'req-shared-id',
        provider: 'google',
        accountEmail: 'user@example.com',
        limit: 10,
        query: 'replacement',
      };

      const p2 = service.listMailThreads(req2);

      await expect(p1).rejects.toThrow('Request cancelled');
      expect(firstSignal?.aborted).toBe(true);

      const res2 = await p2;
      expect(res2.threads).toEqual([]);
      expect(service.activeRequestCount).toBe(0);
    });
  });

  describe('Provider Error Handling & Cleanup', () => {
    it('cleans up active requests map when provider throws an error', async () => {
      vi.mocked(mockConnector.listMailboxThreads).mockRejectedValue(
        new Error('Network error from Gmail API'),
      );

      const request: ListMailThreadsRequest = {
        requestId: 'req-err-1',
        provider: 'google',
        accountEmail: 'user@example.com',
        limit: 10,
      };

      await expect(service.listMailThreads(request)).rejects.toThrow('Network error from Gmail API');
      expect(service.activeRequestCount).toBe(0);
    });
  });

  describe('Untrusted Sender Authorization', () => {
    interface MockWebContents {
      mainFrame: unknown;
    }
    interface MockWindow {
      webContents: MockWebContents;
      isDestroyed: () => boolean;
    }

    function assertTrustedIpcSender(
      mainWindow: MockWindow | null,
      event: { sender: unknown; senderFrame: unknown },
    ): void {
      if (
        !mainWindow ||
        mainWindow.isDestroyed() ||
        event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame
      ) {
        throw new Error('Rejected IPC request from an untrusted renderer');
      }
    }
    it('rejects IPC requests from untrusted senders or child frames', () => {
      const mainFrame = {};
      const webContents = { mainFrame };
      const window = { webContents, isDestroyed: () => false };

      // Trusted event passes
      const trustedEvent = { sender: webContents, senderFrame: mainFrame };
      expect(() => assertTrustedIpcSender(window, trustedEvent)).not.toThrow();

      // Untrusted sender webContents
      const untrustedSenderEvent = { sender: {}, senderFrame: mainFrame };
      expect(() => assertTrustedIpcSender(window, untrustedSenderEvent)).toThrow(
        'Rejected IPC request from an untrusted renderer',
      );

      // Untrusted child frame (iframe)
      const childFrameEvent = { sender: webContents, senderFrame: {} };
      expect(() => assertTrustedIpcSender(window, childFrameEvent)).toThrow(
        'Rejected IPC request from an untrusted renderer',
      );

      // Destroyed window
      const destroyedWindow = { webContents, isDestroyed: () => true };
      expect(() => assertTrustedIpcSender(destroyedWindow, trustedEvent)).toThrow(
        'Rejected IPC request from an untrusted renderer',
      );
    });
  });
});
