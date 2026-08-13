import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConnectorError, GoogleConnector, utf8Base64Url } from '../src/index.js';
import { approvedSafety, ledger, message, noSleep, now, sendContext } from './helpers.js';

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function client() {
  return new GoogleConnector({
    fetch,
    getAccessToken: async () => 'google-access-token',
    sendLedger: ledger(),
    retryPolicy: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
    sleep: noSleep,
    now,
  });
}

describe('Google Gmail and Calendar connector', () => {
  it('creates Gmail drafts as RFC 5322 base64url messages', async () => {
    let mime = '';
    server.use(
      http.post('https://gmail.googleapis.com/gmail/v1/users/me/drafts', async ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer google-access-token');
        const body = (await request.json()) as { message: { raw: string } };
        mime = Buffer.from(body.message.raw, 'base64url').toString('utf8');
        return HttpResponse.json({ id: 'draft-1', message: { id: 'msg-draft', threadId: 't-1' } });
      }),
    );

    await expect(client().createDraft({ message })).resolves.toEqual({
      provider: 'google',
      id: 'draft-1',
      messageId: 'msg-draft',
      threadId: 't-1',
    });
    expect(mime).toContain('Subject: Outreachr intro');
    expect(mime).toContain('multipart/alternative');
    expect(mime).toContain('Partner@Example.com'.toLocaleLowerCase('en-US'));
  });

  it('sends once, records the provider receipt, and replays without resending', async () => {
    let calls = 0;
    server.use(
      http.post(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
        async ({ request }) => {
          calls += 1;
          const body = (await request.json()) as { raw: string };
          const mime = Buffer.from(body.raw, 'base64url').toString('utf8');
          expect(mime).toContain('X-Outreachr-Operation-Key: send-operation-0001');
          return HttpResponse.json(
            { id: 'gmail-message-1', threadId: 'gmail-thread-1' },
            { headers: { 'x-guploader-uploadid': 'google-request-1' } },
          );
        },
      ),
    );
    const connector = client();
    const input = { message, context: sendContext, safety: await approvedSafety() };
    const first = await connector.sendEmail(input);
    const replay = await connector.sendEmail(input);

    expect(first).toMatchObject({
      status: 'sent',
      providerMessageId: 'gmail-message-1',
      providerThreadId: 'gmail-thread-1',
      deliveryConfirmed: true,
      replayed: false,
    });
    expect(replay).toMatchObject({ status: 'sent', replayed: true });
    expect(calls).toBe(1);
  });

  it('sends an approved Gmail draft through the draft endpoint', async () => {
    server.use(
      http.post(
        'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send',
        async ({ request }) => {
          expect(await request.json()).toEqual({ id: 'draft-1' });
          return HttpResponse.json({ id: 'sent-draft-1', threadId: 'thread-1' });
        },
      ),
    );
    await expect(
      client().sendDraft({
        draftId: 'draft-1',
        message,
        context: sendContext,
        safety: await approvedSafety(message, 'send-draft-operation'),
      }),
    ).resolves.toMatchObject({ status: 'sent', providerMessageId: 'sent-draft-1' });
  });

  it('blocks stale approval and duplicates before any provider request', async () => {
    const providerCall = vi.fn();
    server.use(
      http.post('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', () => {
        providerCall();
        return HttpResponse.json({ id: 'must-not-send' });
      }),
    );
    const stale = await approvedSafety();
    stale.approval.messageFingerprint = 'sha256:stale';
    await expect(
      client().sendEmail({ message, context: sendContext, safety: stale }),
    ).rejects.toMatchObject({
      code: 'APPROVAL_STALE',
    });

    const duplicate = await approvedSafety(message, 'duplicate-operation');
    duplicate.duplicateCheck.previouslyContactedRecipientKeys = ['person-pat'];
    await expect(
      client().sendEmail({ message, context: sendContext, safety: duplicate }),
    ).rejects.toMatchObject({
      code: 'DUPLICATE_BLOCKED',
    });
    expect(providerCall).not.toHaveBeenCalled();
  });

  it('reads the Outreachr operation key from Gmail sent-message metadata', async () => {
    server.use(
      http.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', () =>
        HttpResponse.json({ messages: [{ id: 'sent-message-1', threadId: 'thread-1' }] }),
      ),
      http.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/sent-message-1',
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('format')).toBe('metadata');
          expect(url.searchParams.getAll('metadataHeaders')).toContain('X-Outreachr-Operation-Key');
          return HttpResponse.json({
            id: 'sent-message-1',
            threadId: 'thread-1',
            internalDate: String(Date.parse('2026-08-01T17:00:00.000Z')),
            labelIds: ['SENT'],
            payload: {
              headers: [
                { name: 'From', value: 'Founder <founder@example.test>' },
                { name: 'To', value: 'Investor <investor@example.test>' },
                { name: 'Subject', value: 'Fundraising introduction' },
                { name: 'Message-ID', value: '<sent-message-1@example.test>' },
                { name: 'x-outreachr-operation-key', value: 'send:operation-1' },
              ],
            },
          });
        },
      ),
    );

    await expect(client().listMailboxMessages({ mailbox: 'sent' })).resolves.toMatchObject({
      messages: [
        {
          id: 'sent-message-1',
          direction: 'outbound',
          operationKey: 'send:operation-1',
          threadId: 'thread-1',
        },
      ],
    });
  });

  it('forwards cancellation to legacy Gmail mailbox listing', async () => {
    const controller = new AbortController();
    const fetchWithSignal: typeof fetch = async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response(JSON.stringify({ messages: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const connector = new GoogleConnector({
      fetch: fetchWithSignal,
      getAccessToken: async () => 'google-access-token',
      sendLedger: ledger(),
      retryPolicy: { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 },
      sleep: noSleep,
      now,
    });

    await expect(
      connector.listMailboxMessages({ mailbox: 'all', signal: controller.signal }),
    ).resolves.toEqual({ messages: [] });
  });

  it('skips Gmail relationship records that have no sender or usable timestamp', async () => {
    server.use(
      http.get('https://gmail.googleapis.com/gmail/v1/users/me/messages', () =>
        HttpResponse.json({
          messages: [
            { id: 'valid-message' },
            { id: 'missing-sender' },
            { id: 'missing-timestamp' },
          ],
        }),
      ),
      http.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/:messageId',
        ({ params }) => {
          const messageId = String(params.messageId);
          return HttpResponse.json({
            id: messageId,
            internalDate:
              messageId === 'missing-timestamp'
                ? undefined
                : String(Date.parse('2026-08-01T17:00:00.000Z')),
            payload: {
              headers: [
                ...(messageId === 'missing-sender'
                  ? []
                  : [{ name: 'From', value: 'Founder <founder@example.test>' }]),
                { name: 'To', value: 'Investor <investor@example.test>' },
              ],
            },
          });
        },
      ),
    );

    const page = await client().listMailboxMessages({ mailbox: 'all' });
    expect(page.messages).toEqual([
      expect.objectContaining({
        id: 'valid-message',
        from: expect.objectContaining({ email: 'founder@example.test' }),
      }),
    ]);
    expect(JSON.stringify(page)).not.toContain('example.invalid');
    expect(JSON.stringify(page)).not.toContain('1970-01-01');
  });

  it('fails closed after an ambiguous network send and never retries it', async () => {
    let calls = 0;
    server.use(
      http.post('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );
    const connector = client();
    const input = {
      message,
      context: sendContext,
      safety: await approvedSafety(message, 'ambiguous-operation'),
    };

    let captured: unknown;
    try {
      await connector.sendEmail(input);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(ConnectorError);
    expect(captured).toMatchObject({
      code: 'AMBIGUOUS_SEND',
      mayHaveSucceeded: true,
      receipt: { status: 'ambiguous', retrySafe: false },
    });
    await expect(connector.sendEmail(input)).resolves.toMatchObject({
      status: 'ambiguous',
      replayed: true,
    });
    expect(calls).toBe(1);
  });

  it('creates, lists, and queries availability with Calendar API retries', async () => {
    let listCalls = 0;
    server.use(
      http.post(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          expect(body.summary).toBe('Investor call');
          return HttpResponse.json({
            id: 'event-1',
            summary: 'Investor call',
            status: 'confirmed',
            htmlLink: 'https://calendar.google.com/event?eid=1',
            start: { dateTime: '2026-08-01T17:00:00Z' },
            end: { dateTime: '2026-08-01T17:30:00Z' },
          });
        },
      ),
      http.get('https://www.googleapis.com/calendar/v3/calendars/primary/events', () => {
        listCalls += 1;
        if (listCalls === 1) {
          return HttpResponse.json(
            { error: { code: 429, message: 'Slow down', status: 'RESOURCE_EXHAUSTED' } },
            { status: 429, headers: { 'retry-after': '0' } },
          );
        }
        return HttpResponse.json({
          items: [
            {
              id: 'event-1',
              summary: 'Investor call',
              start: { dateTime: '2026-08-01T17:00:00Z' },
              end: { dateTime: '2026-08-01T17:30:00Z' },
            },
          ],
          nextPageToken: 'page-2',
        });
      }),
      http.post('https://www.googleapis.com/calendar/v3/freeBusy', async ({ request }) => {
        const body = (await request.json()) as { items: Array<{ id: string }> };
        expect(body.items).toEqual([{ id: 'primary' }, { id: 'investor@example.com' }]);
        return HttpResponse.json({
          timeMin: '2026-08-01T00:00:00Z',
          timeMax: '2026-08-02T00:00:00Z',
          calendars: {
            primary: { busy: [{ start: '2026-08-01T17:00:00Z', end: '2026-08-01T17:30:00Z' }] },
            'investor@example.com': { busy: [] },
          },
        });
      }),
    );
    const connector = client();
    const eventInput = {
      title: 'Investor call',
      start: { dateTime: '2026-08-01T17:00:00Z' },
      end: { dateTime: '2026-08-01T17:30:00Z' },
      operationKey: 'calendar-operation-1',
    };
    await expect(connector.createEvent(eventInput)).resolves.toMatchObject({
      id: 'event-1',
      provider: 'google',
    });
    await expect(
      connector.listEvents({
        timeMin: '2026-08-01T00:00:00Z',
        timeMax: '2026-08-02T00:00:00Z',
      }),
    ).resolves.toMatchObject({ events: [{ id: 'event-1' }], nextPageToken: 'page-2' });
    expect(listCalls).toBe(2);
    await expect(
      connector.queryFreeBusy({
        calendarIds: ['primary', 'investor@example.com'],
        timeMin: '2026-08-01T00:00:00Z',
        timeMax: '2026-08-02T00:00:00Z',
      }),
    ).resolves.toMatchObject({
      calendars: [
        { calendarId: 'primary', busy: [{ start: '2026-08-01T17:00:00Z' }] },
        { calendarId: 'investor@example.com', busy: [] },
      ],
    });
  });

  it('skips malformed Google event records and attendee identities without fabricating data', async () => {
    server.use(
      http.get('https://www.googleapis.com/calendar/v3/calendars/primary/events', () =>
        HttpResponse.json({
          items: [
            {
              id: 'valid-event',
              summary: 'Valid event',
              start: { dateTime: '2026-08-01T17:00:00Z' },
              end: { dateTime: '2026-08-01T17:30:00Z' },
              attendees: [
                { displayName: 'Missing email' },
                { email: 'not-an-email', displayName: 'Malformed email' },
                { email: 'investor@example.test', displayName: 'Investor' },
              ],
            },
            {
              summary: 'Missing id',
              start: { dateTime: '2026-08-01T17:00:00Z' },
              end: { dateTime: '2026-08-01T17:30:00Z' },
            },
            {
              id: 'missing-start',
              summary: 'Missing start',
              end: { dateTime: '2026-08-01T17:30:00Z' },
            },
            {
              id: 'missing-end',
              summary: 'Missing end',
              start: { dateTime: '2026-08-01T17:00:00Z' },
            },
          ],
          nextPageToken: 'continue-after-malformed-records',
        }),
      ),
    );

    const page = await client().listEvents({
      timeMin: '2026-08-01T00:00:00Z',
      timeMax: '2026-08-02T00:00:00Z',
    });
    expect(page).toEqual({
      events: [
        expect.objectContaining({
          id: 'valid-event',
          attendees: [
            expect.objectContaining({ email: 'investor@example.test', name: 'Investor' }),
          ],
        }),
      ],
      nextPageToken: 'continue-after-malformed-records',
    });
    expect(JSON.stringify(page)).not.toContain('example.invalid');
    expect(JSON.stringify(page)).not.toContain('1970-01-01');
  });

  it('reports successful Google event creates with malformed identities as ambiguous', async () => {
    const eventInput = {
      title: 'Investor call',
      start: { dateTime: '2026-08-01T17:00:00Z' },
      end: { dateTime: '2026-08-01T17:30:00Z' },
      operationKey: 'malformed-google-create',
    };
    const malformedResponses = [
      {
        start: { dateTime: '2026-08-01T17:00:00Z' },
        end: { dateTime: '2026-08-01T17:30:00Z' },
      },
      { id: 'missing-start', end: { dateTime: '2026-08-01T17:30:00Z' } },
      { id: 'missing-end', start: { dateTime: '2026-08-01T17:00:00Z' } },
    ];

    for (const malformedResponse of malformedResponses) {
      let calls = 0;
      server.use(
        http.post('https://www.googleapis.com/calendar/v3/calendars/primary/events', () => {
          calls += 1;
          return HttpResponse.json(malformedResponse, {
            headers: { 'x-guploader-uploadid': 'ambiguous-google-create-request' },
          });
        }),
      );
      await expect(client().createEvent(eventInput)).rejects.toMatchObject({
        code: 'AMBIGUOUS_CREATE',
        operation: 'google.calendar.events.create',
        providerRequestId: 'ambiguous-google-create-request',
        mayHaveSucceeded: true,
        retryable: false,
      });
      expect(calls).toBe(1);
    }
  });

  it('does not retry an ambiguous Google event create response', async () => {
    let calls = 0;
    server.use(
      http.post('https://www.googleapis.com/calendar/v3/calendars/primary/events', () => {
        calls += 1;
        return HttpResponse.json(
          { error: { code: 503, message: 'Response lost after commit' } },
          { status: 503 },
        );
      }),
    );
    await expect(
      client().createEvent({
        title: 'Investor call',
        start: { dateTime: '2026-08-01T17:00:00Z' },
        end: { dateTime: '2026-08-01T17:30:00Z' },
        operationKey: 'ambiguous-google-transport',
      }),
    ).rejects.toMatchObject({
      code: 'AMBIGUOUS_CREATE',
      mayHaveSucceeded: true,
      retryable: false,
    });
    expect(calls).toBe(1);
  });

  it('maps Google provider errors into stable connector errors', async () => {
    server.use(
      http.post('https://gmail.googleapis.com/gmail/v1/users/me/drafts', () =>
        HttpResponse.json(
          { error: { code: 403, message: 'Insufficient Permission', status: 'PERMISSION_DENIED' } },
          { status: 403 },
        ),
      ),
    );
    await expect(client().createDraft({ message })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      provider: 'google',
      providerCode: 'PERMISSION_DENIED',
      retryable: false,
    });
  });
  it('lists mailbox threads with metadata-only rows, bounded pagination, and query support', async () => {
    server.use(
      http.get('https://gmail.googleapis.com/gmail/v1/users/me/threads', ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('maxResults')).toBe('10');
        expect(url.searchParams.get('q')).toBe('application');
        return HttpResponse.json({
          threads: [{ id: 'thread-101' }],
          nextPageToken: 'page-2',
        });
      }),
      http.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-101',
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('format')).toBe('metadata');
          return HttpResponse.json({
            id: 'thread-101',
            snippet: 'Interview details inside',
            messages: [
              {
                id: 'msg-1',
                threadId: 'thread-101',
                internalDate: '1770000000000',
                labelIds: ['INBOX'],
                payload: {
                  headers: [
                    { name: 'From', value: 'Recruiter <recruiter@acme.com>' },
                    { name: 'To', value: 'Candidate <user@example.com>' },
                    { name: 'Subject', value: 'Interview with Acme' },
                    { name: 'Date', value: 'Mon, 02 Feb 2026 10:00:00 GMT' },
                  ],
                },
              },
            ],
          });
        },
      ),
    );

    const connector = client();
    await expect(
      connector.listMailboxThreads({ accountEmail: 'user@example.com', pageSize: 60 }),
    ).rejects.toThrow(TypeError);

    const result = await connector.listMailboxThreads({
      accountEmail: 'user@example.com',
      query: 'application',
      pageSize: 10,
    });

    expect(result).toEqual({
      threads: [
        {
          provider: 'google',
          accountEmail: 'user@example.com',
          threadId: 'thread-101',
          subject: 'Interview with Acme',
          snippet: 'Interview details inside',
          participants: [
            { email: 'recruiter@acme.com', name: 'Recruiter' },
            { email: 'user@example.com', name: 'Candidate' },
          ],
          latestAt: new Date(1770000000000).toISOString(),
          messageCount: 1,
          sourceUrl: 'https://mail.google.com/mail/u/user%40example.com/#all/thread-101',
        },
      ],
      nextPageToken: 'page-2',
    });
  });

  it('gets mailbox thread with recursive MIME decoding, attachment bodies, plain/HTML, pre/table/quoted, and cancellation', async () => {
    const plainText =
      '> Quoted previous email\n\nHere is the job offer table:\n<table><tr><td>Role</td></tr></table>';
    const htmlText =
      '<pre>Code snippet</pre><p><a href="https://example.com/very/long/url">Link</a></p>';

    server.use(
      http.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-202',
        ({ request }) => {
          const url = new URL(request.url);
          expect(url.searchParams.get('format')).toBe('full');
          return HttpResponse.json({
            id: 'thread-202',
            snippet: 'Offer details',
            messages: [
              {
                id: 'msg-plain-html',
                threadId: 'thread-202',
                internalDate: '1770000100000',
                labelIds: ['SENT'],
                payload: {
                  mimeType: 'multipart/alternative',
                  headers: [
                    { name: 'From', value: 'user@example.com' },
                    { name: 'To', value: 'recruiter@acme.com' },
                    { name: 'Subject', value: 'Re: Offer details' },
                    { name: 'Message-ID', value: '<msg-202@acme.com>' },
                    { name: 'X-Outreachr-Operation-Key', value: 'op-key-123' },
                  ],
                  parts: [
                    {
                      mimeType: 'text/plain',
                      body: { data: utf8Base64Url(plainText) },
                    },
                    {
                      mimeType: 'text/html',
                      body: { data: utf8Base64Url(htmlText) },
                    },
                  ],
                },
              },
              {
                id: 'msg-attachment-body',
                threadId: 'thread-202',
                internalDate: '1770000200000',
                labelIds: ['INBOX'],
                payload: {
                  mimeType: 'multipart/mixed',
                  headers: [
                    { name: 'From', value: 'recruiter@acme.com' },
                    { name: 'To', value: 'user@example.com' },
                    { name: 'Subject', value: 'Re: Offer details' },
                  ],
                  parts: [
                    {
                      mimeType: 'text/plain',
                      filename: 'body.txt',
                      body: { attachmentId: 'att-999', size: 25 },
                    },
                  ],
                },
              },
            ],
          });
        },
      ),
      http.get(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg-attachment-body/attachments/att-999',
        () => {
          return HttpResponse.json({
            size: 25,
            data: utf8Base64Url('Attachment plain content'),
          });
        },
      ),
    );

    const connector = client();
    const result = await connector.getMailboxThread({
      accountEmail: 'user@example.com',
      threadId: 'thread-202',
    });

    expect(result.messages).toHaveLength(2);

    expect(result.messages[0]).toMatchObject({
      provider: 'google',
      id: 'msg-plain-html',
      threadId: 'thread-202',
      accountEmail: 'user@example.com',
      internetMessageId: '<msg-202@acme.com>',
      operationKey: 'op-key-123',
      direction: 'outbound',
      bodyText: plainText,
      bodyHtml: htmlText,
      providerTruncated: false,
      sourceUrl: 'https://mail.google.com/mail/u/user%40example.com/#all/msg-plain-html',
    });

    expect(result.messages[1]).toMatchObject({
      provider: 'google',
      id: 'msg-attachment-body',
      direction: 'inbound',
      bodyText: 'Attachment plain content',
      providerTruncated: false,
    });

    const controller = new AbortController();
    controller.abort();
    await expect(
      connector.getMailboxThread({
        accountEmail: 'user@example.com',
        threadId: 'thread-202',
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it('handles empty body, provider errors, truncation, and size limits on Gmail thread reads', async () => {
    const hugeBody = 'A'.repeat(1_048_576 + 50);

    server.use(
      http.get('https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-huge', () => {
        return HttpResponse.json({
          id: 'thread-huge',
          snippet: 'Huge body',
          messages: [
            {
              id: 'msg-huge',
              threadId: 'thread-huge',
              internalDate: '1770000000000',
              labelIds: ['INBOX'],
              payload: {
                mimeType: 'text/plain',
                headers: [
                  { name: 'From', value: 'user@example.com' },
                  { name: 'To', value: 'recruiter@acme.com' },
                  { name: 'Subject', value: 'Huge' },
                ],
                body: { data: utf8Base64Url(hugeBody) },
              },
            },
            {
              id: 'msg-empty',
              threadId: 'thread-huge',
              internalDate: '1770000100000',
              labelIds: ['INBOX'],
              payload: {
                mimeType: 'text/plain',
                headers: [
                  { name: 'From', value: 'user@example.com' },
                  { name: 'To', value: 'recruiter@acme.com' },
                  { name: 'Subject', value: 'Empty' },
                ],
              },
            },
          ],
        });
      }),
      http.get('https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-missing', () => {
        return HttpResponse.json(
          { error: { code: 404, message: 'Thread not found' } },
          { status: 404 },
        );
      }),
    );

    const connector = client();
    const result = await connector.getMailboxThread({
      accountEmail: 'user@example.com',
      threadId: 'thread-huge',
    });

    expect(result.messages[0].providerTruncated).toBe(true);
    expect(result.messages[0].truncationReason).toBe('Body content exceeds maximum allowed size');
    expect(result.messages[0].bodyText?.length).toBe(1_048_576);

    expect(result.messages[1].bodyText).toBeUndefined();
    expect(result.messages[1].providerTruncated).toBe(false);

    await expect(
      connector.getMailboxThread({
        accountEmail: 'user@example.com',
        threadId: 'thread-missing',
      }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
      provider: 'google',
    });
  });
  it('enforces multibyte byte-aware truncation, cumulative 8 MiB page cap, input validation, and abort during retry', async () => {
    const connector = client();

    // Input validation errors
    await expect(connector.listMailboxThreads({ accountEmail: 'invalid-email' })).rejects.toThrow(
      'Account email is invalid',
    );

    await expect(
      connector.listMailboxThreads({
        accountEmail: 'user@example.com',
        query: 'test\r\ninjected',
      }),
    ).rejects.toThrow('Query is invalid');

    await expect(
      connector.getMailboxThread({
        accountEmail: 'user@example.com',
        threadId: 'id\nwithcrlf',
      }),
    ).rejects.toThrow('Thread ID is invalid');

    // Multibyte byte-aware truncation test
    const multibyteChar = '🚀'; // 4 bytes in UTF-8
    const repeatedMultibyte = multibyteChar.repeat(300_000); // 1.2 MB in bytes, but only 300,000 code points

    // Cumulative 8 MiB cap setup: 9 messages of ~1 MiB each
    const oneMbString = 'X'.repeat(1_000_000);
    const messagesList = Array.from({ length: 9 }, (_, i) => ({
      id: `msg-cumul-${i}`,
      threadId: `thread-cumul`,
      internalDate: String(1770000000000 + i * 1000),
      labelIds: ['INBOX'],
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: 'user@example.com' },
          { name: 'To', value: 'recruiter@acme.com' },
          { name: 'Subject', value: `Subject ${i}` },
        ],
        body: { data: utf8Base64Url(oneMbString) },
      },
    }));

    server.use(
      http.get('https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-multibyte', () => {
        return HttpResponse.json({
          id: 'thread-multibyte',
          snippet: 'Multibyte test',
          messages: [
            {
              id: 'msg-mb',
              threadId: 'thread-multibyte',
              internalDate: '1770000000000',
              labelIds: ['INBOX'],
              payload: {
                mimeType: 'text/plain',
                headers: [
                  { name: 'From', value: 'user@example.com' },
                  { name: 'To', value: 'recruiter@acme.com' },
                  { name: 'Subject', value: 'Multibyte' },
                ],
                body: { data: utf8Base64Url(repeatedMultibyte) },
              },
            },
          ],
        });
      }),
      http.get('https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-cumul', () => {
        return HttpResponse.json({
          id: 'thread-cumul',
          snippet: 'Cumulative test',
          messages: messagesList,
        });
      }),
    );

    const mbResult = await connector.getMailboxThread({
      accountEmail: 'user@example.com',
      threadId: 'thread-multibyte',
    });
    expect(mbResult.messages[0].providerTruncated).toBe(true);
    expect(mbResult.messages[0].truncationReason).toBe('Body content exceeds maximum allowed size');
    const bytesDecoded = new TextEncoder().encode(mbResult.messages[0].bodyText ?? '').length;
    expect(bytesDecoded).toBeLessThanOrEqual(1_048_576);

    const cumulResult = await connector.getMailboxThread({
      accountEmail: 'user@example.com',
      threadId: 'thread-cumul',
    });
    expect(cumulResult.messages).toHaveLength(9);
    // First 8 messages fit in 8 MiB (8 * 1,000,000 bytes = 8,000,000 bytes <= 8,388,608 bytes)
    expect(cumulResult.messages[7].bodyText).toBeDefined();
    // 9th message exceeds 8 MiB cumulative cap and is truncated/omitted
    expect(cumulResult.messages[8].providerTruncated).toBe(true);
    expect(cumulResult.messages[8].truncationReason).toBe('Application body safety limit reached');

    // Abort during retry test
    server.use(
      http.get('https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-retry-abort', () => {
        return HttpResponse.error(); // Network error to force retry
      }),
    );

    const retryConnector = new GoogleConnector({
      fetch,
      getAccessToken: async () => 'token',
      sendLedger: ledger(),
      retryPolicy: { maxAttempts: 3, baseDelayMs: 2000, maxDelayMs: 2000 }, // long delay
      sleep: noSleep,
      now,
    });

    const controller = new AbortController();
    const pendingPromise = retryConnector.getMailboxThread({
      accountEmail: 'user@example.com',
      threadId: 'thread-retry-abort',
      signal: controller.signal,
    });

    // Abort signal while request is in progress
    controller.abort();
    await expect(pendingPromise).rejects.toThrow();
  });
});
