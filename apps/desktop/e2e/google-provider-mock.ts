import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { getResponse, HttpResponse, http, type RequestHandler } from 'msw';
import { startGoogleNetworkAudit } from '../src/main/google-network-audit';
import type { GoogleNetworkAuditor } from '../src/main/google-network-audit';

export interface GoogleProviderMockState {
  readonly baseUrl: string;
  readonly requests: string[];
  readonly gmailListQueries: string[];
  readonly gmailMetadataIds: string[];
  readonly calendarPageTokens: Array<string | null>;
  readonly tokenRequestBodies: string[];
  readonly authorizationHeaders: Array<string | null>;
  readonly sentRawMessages: string[];
  readonly calendarCreateBodies: Array<Record<string, unknown>>;
  readonly auditor: GoogleNetworkAuditor;
  gmailSendCalls: number;
  calendarCreateCalls: number;
}

export interface GoogleProviderMock {
  readonly state: GoogleProviderMockState;
  close(): Promise<void>;
}

const googleAccount = 'ada@local.test';

function gmailMessage(id: string): Record<string, unknown> {
  const values: Record<string, Record<string, unknown>> = {
    'outbound-page-one': {
      id: 'outbound-page-one',
      threadId: 'history-thread-one',
      internalDate: '1735689600000',
      labelIds: ['SENT'],
      payload: {
        headers: [
          { name: 'From', value: `Ada Founder <${googleAccount}>` },
          { name: 'To', value: 'Historical One <history.one@example.test>' },
          { name: 'Subject', value: 'Historical page one' },
          { name: 'Message-ID', value: '<history-one@example.test>' },
        ],
      },
    },
    'ignored-inbound': {
      id: 'ignored-inbound',
      threadId: 'ignored-inbound-thread',
      internalDate: '1735776000000',
      labelIds: ['INBOX'],
      payload: {
        headers: [
          { name: 'From', value: 'Unrelated Sender <unrelated@example.test>' },
          { name: 'To', value: `Ada Founder <${googleAccount}>` },
          { name: 'Subject', value: 'Unrelated inbound must be discarded' },
          { name: 'Message-ID', value: '<ignored-inbound@example.test>' },
        ],
      },
    },
    'outbound-page-two': {
      id: 'outbound-page-two',
      threadId: 'history-thread-two',
      internalDate: '1735862400000',
      labelIds: ['SENT'],
      payload: {
        headers: [
          { name: 'From', value: `Ada Founder <${googleAccount}>` },
          { name: 'To', value: 'Historical Two <history.two@example.test>' },
          { name: 'Subject', value: 'Historical page two' },
          { name: 'Message-ID', value: '<history-two@example.test>' },
        ],
      },
    },
  };
  return values[id] ?? {};
}

function gmailThread(id: string): Record<string, unknown> {
  const threads: Record<string, Record<string, unknown>> = {
    'thread-plain-text': {
      id: 'thread-plain-text',
      historyId: '1001',
      messages: [
        {
          id: 'msg-plain-text',
          threadId: 'thread-plain-text',
          internalDate: '1735689600000',
          snippet: 'Plain text body content for senior software engineer interview.',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'Jane Recruiter <jane.recruiter@techcorp.test>' },
              { name: 'To', value: `Ada Candidate <${googleAccount}>` },
              { name: 'Subject', value: 'Senior Software Engineer Interview' },
              { name: 'Date', value: 'Wed, 01 Jan 2026 12:00:00 GMT' },
              { name: 'Message-ID', value: '<plain-text@techcorp.test>' },
            ],
            body: {
              data: Buffer.from(
                [
                  '# Senior Software Engineer Interview',
                  '',
                  'Plain text body content for senior software engineer interview.',
                  '',
                  '- Review the role brief',
                  '- [Choose an interview slot](https://jobs.techcorp.test/interview)',
                  '',
                  '> Please bring questions for the team.',
                  '',
                  '```ts',
                  'const interviewConfirmed = true;',
                  '```',
                  '',
                  '<img src="https://tracking.techcorp.test/pixel" onerror="alert(1)">',
                ].join('\n'),
              ).toString('base64url'),
            },
          },
        },
      ],
    },
    'thread-sanitized-html': {
      id: 'thread-sanitized-html',
      historyId: '1002',
      messages: [
        {
          id: 'msg-sanitized-html',
          threadId: 'thread-sanitized-html',
          internalDate: '1735776000000',
          snippet: 'Welcome to Acme Corp! View Careers details.',
          payload: {
            mimeType: 'text/html',
            headers: [
              { name: 'From', value: 'Hiring Manager <hiring@acme.test>' },
              { name: 'To', value: `Ada Candidate <${googleAccount}>` },
              { name: 'Subject', value: 'Job Offer Details' },
              { name: 'Date', value: 'Thu, 02 Jan 2026 12:00:00 GMT' },
              { name: 'Message-ID', value: '<offer@acme.test>' },
            ],
            body: {
              data: Buffer.from(
                '<p>Welcome to Acme Corp!</p><img src="https://tracking.acme.test/pixel" alt="Acme logo"><script>alert("xss")</script><style>body { color: red; }</style><a href="https://acme.test/careers">View Careers</a>',
              ).toString('base64url'),
            },
          },
        },
      ],
    },
    'thread-quoted-reply': {
      id: 'thread-quoted-reply',
      historyId: '1003',
      messages: [
        {
          id: 'msg-quoted-reply',
          threadId: 'thread-quoted-reply',
          internalDate: '1735862400000',
          snippet: 'Thank you for sending your resume...',
          payload: {
            mimeType: 'text/html',
            headers: [
              { name: 'From', value: 'Recruiter <recruiter@acme.test>' },
              { name: 'To', value: `Ada Candidate <${googleAccount}>` },
              { name: 'Subject', value: 'Re: Application Status Update' },
              { name: 'Date', value: 'Fri, 03 Jan 2026 12:00:00 GMT' },
              { name: 'Message-ID', value: '<quoted@acme.test>' },
            ],
            body: {
              data: Buffer.from(
                '<div>Thank you for sending your resume. We would love to set up an interview.</div><blockquote type="cite"><div>On Mon, Jan 5, 2026, Ada Candidate wrote:</div><div>Submitting application for Senior Engineer role.</div></blockquote>',
              ).toString('base64url'),
            },
          },
        },
      ],
    },
    'thread-long-url': {
      id: 'thread-long-url',
      historyId: '1004',
      messages: [
        {
          id: 'msg-long-url',
          threadId: 'thread-long-url',
          internalDate: '1735948800000',
          snippet: 'Please complete your application portal access...',
          payload: {
            mimeType: 'text/html',
            headers: [
              { name: 'From', value: 'Portal Support <support@acme.test>' },
              { name: 'To', value: `Ada Candidate <${googleAccount}>` },
              { name: 'Subject', value: 'Application Portal Access' },
              { name: 'Date', value: 'Sat, 04 Jan 2026 12:00:00 GMT' },
              { name: 'Message-ID', value: '<portal@acme.test>' },
            ],
            body: {
              data: Buffer.from(
                '<p>Please access your portal at: <a href="https://example.test/portal/' +
                  'a'.repeat(600) +
                  '">https://example.test/portal/' +
                  'a'.repeat(600) +
                  '</a></p>',
              ).toString('base64url'),
            },
          },
        },
      ],
    },
    'thread-pre-table': {
      id: 'thread-pre-table',
      historyId: '1005',
      messages: [
        {
          id: 'msg-pre-table',
          threadId: 'thread-pre-table',
          internalDate: '1736035200000',
          snippet: 'Technical Interview Code Sample and Compensation Table',
          payload: {
            mimeType: 'text/html',
            headers: [
              { name: 'From', value: 'Lead Tech <tech@acme.test>' },
              { name: 'To', value: `Ada Candidate <${googleAccount}>` },
              { name: 'Subject', value: 'Technical Interview Code Sample and Compensation Table' },
              { name: 'Date', value: 'Sun, 05 Jan 2026 12:00:00 GMT' },
              { name: 'Message-ID', value: '<tech-sample@acme.test>' },
            ],
            body: {
              data: Buffer.from(
                '<div>Code structure:</div><pre>function test() {\n  return true;\n}</pre><table><thead><tr><th>Role</th><th>Salary</th></tr></thead><tbody><tr><td>Staff Engineer</td><td>$220,000</td></tr></tbody></table>',
              ).toString('base64url'),
            },
          },
        },
      ],
    },
    'thread-empty': {
      id: 'thread-empty',
      historyId: '1006',
      messages: [
        {
          id: 'msg-empty',
          threadId: 'thread-empty',
          internalDate: '1736121600000',
          snippet: '',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'HR Admin <hr@acme.test>' },
              { name: 'To', value: `Ada Candidate <${googleAccount}>` },
              { name: 'Subject', value: 'Blank Message Test' },
              { name: 'Date', value: 'Mon, 06 Jan 2026 12:00:00 GMT' },
              { name: 'Message-ID', value: '<blank@acme.test>' },
            ],
            body: { data: '' },
          },
        },
      ],
    },
    'thread-truncated': {
      id: 'thread-truncated',
      historyId: '1007',
      messages: [
        {
          id: 'msg-truncated',
          threadId: 'thread-truncated',
          internalDate: '1736208000000',
          snippet: 'Diagnostic Export Attachment',
          providerTruncated: true,
          truncationReason: 'size_limit',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'DevOps <devops@acme.test>' },
              { name: 'To', value: `Ada Candidate <${googleAccount}>` },
              { name: 'Subject', value: 'Large Diagnostic Export Attachment' },
              { name: 'Date', value: 'Tue, 07 Jan 2026 12:00:00 GMT' },
              { name: 'Message-ID', value: '<truncated@acme.test>' },
            ],
            body: { data: Buffer.alloc(1_048_577, 65).toString('base64url') },
          },
        },
      ],
    },
    'thread-stale': {
      id: 'thread-stale',
      historyId: '1008',
      messages: [
        {
          id: 'msg-stale',
          threadId: 'thread-stale',
          internalDate: '1736294400000',
          snippet: 'Slow Recruiter Response Thread',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'Acme Recruiter <recruiting@acme.test>' },
              { name: 'To', value: `Ada Candidate <${googleAccount}>` },
              { name: 'Subject', value: 'Slow Recruiter Response Thread' },
              { name: 'Date', value: 'Wed, 08 Jan 2026 12:00:00 GMT' },
              { name: 'Message-ID', value: '<slow@acme.test>' },
            ],
            body: { data: Buffer.from('Delayed response body content.').toString('base64url') },
          },
        },
      ],
    },
    'thread-error': {
      id: 'thread-error',
      historyId: '1009',
      messages: [
        {
          id: 'msg-error',
          threadId: 'thread-error',
          internalDate: '1736380800000',
          snippet: 'Provider Error Failure',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: 'Provider Monitor <monitor@acme.test>' },
              { name: 'To', value: `Ada Candidate <${googleAccount}>` },
              { name: 'Subject', value: 'Provider Error Failure' },
              { name: 'Date', value: 'Thu, 09 Jan 2026 12:00:00 GMT' },
              { name: 'Message-ID', value: '<provider-error@acme.test>' },
            ],
            body: { data: Buffer.from('This full-body request must fail.').toString('base64url') },
          },
        },
      ],
    },
    'outbound-page-two': {
      id: 'outbound-page-two',
      historyId: '1010',
      messages: [
        {
          id: 'outbound-page-two',
          threadId: 'outbound-page-two',
          internalDate: '1736467200000',
          snippet: 'Historical page two',
          payload: {
            mimeType: 'text/plain',
            headers: [
              { name: 'From', value: `Ada Candidate <${googleAccount}>` },
              { name: 'To', value: 'History <history@acme.test>' },
              { name: 'Subject', value: 'Historical page two' },
              { name: 'Date', value: 'Fri, 10 Jan 2026 12:00:00 GMT' },
              { name: 'Message-ID', value: '<history-page-two@acme.test>' },
            ],
            body: { data: Buffer.from('Historical page two').toString('base64url') },
          },
        },
      ],
    },
  };
  return threads[id] ?? {};
}

function mockHandlers(baseUrl: string, state: GoogleProviderMockState): RequestHandler[] {
  const firstEventStart = new Date(Date.now() + 2 * 86_400_000);
  firstEventStart.setUTCHours(17, 0, 0, 0);
  const secondEventStart = new Date(Date.now() + 4 * 86_400_000);
  secondEventStart.setUTCHours(18, 0, 0, 0);
  const event = (id: string, title: string, start: Date) => ({
    id,
    status: 'confirmed',
    htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`,
    summary: title,
    description: 'Mocked provider metadata imported through the built Electron process.',
    location: 'Video call',
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(start.getTime() + 30 * 60_000).toISOString() },
    organizer: { email: googleAccount, displayName: 'Ada Founder' },
  });

  const requireAccessToken = (request: Request): Response | null => {
    const authorization = request.headers.get('authorization');
    state.authorizationHeaders.push(authorization);
    return authorization === 'Bearer e2e-google-access'
      ? null
      : HttpResponse.json({ error: 'missing test bearer token' }, { status: 401 });
  };

  return [
    http.post(`${baseUrl}/token`, async ({ request }) => {
      const body = await request.text();
      state.tokenRequestBodies.push(body);
      const params = new URLSearchParams(body);
      if (
        params.get('grant_type') !== 'authorization_code' ||
        params.get('code') !== 'outreachr-e2e-google-code' ||
        !/^[A-Za-z0-9_-]{43,128}$/u.test(params.get('code_verifier') ?? '') ||
        params.has('client_secret')
      ) {
        return HttpResponse.json({ error: 'invalid test PKCE exchange' }, { status: 400 });
      }
      return HttpResponse.json({
        access_token: 'e2e-google-access',
        refresh_token: 'e2e-google-refresh',
        token_type: 'Bearer',
        expires_in: 3_600,
      });
    }),
    http.get(`${baseUrl}/v1/userinfo`, ({ request }) => {
      const denied = requireAccessToken(request);
      return denied ?? HttpResponse.json({ email: googleAccount });
    }),
    http.get(`${baseUrl}/gmail/v1/users/me/messages`, ({ request }) => {
      const denied = requireAccessToken(request);
      if (denied) return denied;
      const url = new URL(request.url);
      const query = url.searchParams.get('q') ?? '';
      state.gmailListQueries.push(query);
      // Incremental overlap scans happen before a provider send. The exhaustive
      // two-page history is returned only for the initial full reconciliation.
      if (query) return HttpResponse.json({ messages: [] });
      const pageToken = url.searchParams.get('pageToken');
      if (pageToken === 'gmail-page-two') {
        return HttpResponse.json({ messages: [{ id: 'outbound-page-two' }] });
      }
      return HttpResponse.json({
        messages: [{ id: 'outbound-page-one' }, { id: 'ignored-inbound' }],
        nextPageToken: 'gmail-page-two',
      });
    }),
    http.get(`${baseUrl}/gmail/v1/users/me/threads`, ({ request }) => {
      const denied = requireAccessToken(request);
      if (denied) return denied;
      const url = new URL(request.url);
      const pageToken = url.searchParams.get('pageToken');
      if (pageToken === 'thread-page-two') {
        return HttpResponse.json({
          threads: [{ id: 'outbound-page-two', snippet: 'Historical page two' }],
        });
      }
      return HttpResponse.json({
        threads: [
          {
            id: 'thread-plain-text',
            snippet: 'Plain text body content for senior software engineer interview.',
          },
          { id: 'thread-sanitized-html', snippet: 'Welcome to Acme Corp! View Careers details.' },
          { id: 'thread-quoted-reply', snippet: 'Thank you for sending your resume...' },
          { id: 'thread-long-url', snippet: 'Please complete your application portal access...' },
          {
            id: 'thread-pre-table',
            snippet: 'Technical Interview Code Sample and Compensation Table',
          },
          { id: 'thread-empty', snippet: '' },
          { id: 'thread-error', snippet: 'Provider Error Failure' },
          { id: 'thread-truncated', snippet: 'Diagnostic Export Attachment' },
          { id: 'thread-stale', snippet: 'Slow Recruiter Response Thread' },
        ],
        nextPageToken: 'thread-page-two',
      });
    }),
    http.get(`${baseUrl}/gmail/v1/users/me/threads/:threadId`, async ({ params, request }) => {
      const denied = requireAccessToken(request);
      if (denied) return denied;
      const threadId = String(params.threadId);
      if (
        threadId === 'thread-error' &&
        new URL(request.url).searchParams.get('format') !== 'metadata'
      ) {
        return HttpResponse.json({ error: 'Internal provider failure' }, { status: 500 });
      }
      if (
        threadId === 'thread-pre-table' &&
        new URL(request.url).searchParams.get('format') !== 'metadata'
      ) {
        await new Promise<void>((resolve) => setTimeout(resolve, 800));
      }
      const data = gmailThread(threadId);
      if (!data.id) return HttpResponse.json({ error: 'Thread not found' }, { status: 404 });
      return HttpResponse.json(data);
    }),
    http.get(`${baseUrl}/gmail/v1/users/me/messages/:messageId`, ({ params, request }) => {
      const denied = requireAccessToken(request);
      if (denied) return denied;
      const messageId = String(params.messageId);
      state.gmailMetadataIds.push(messageId);
      return HttpResponse.json(gmailMessage(messageId));
    }),
    http.post(`${baseUrl}/gmail/v1/users/me/messages/send`, async ({ request }) => {
      const denied = requireAccessToken(request);
      if (denied) return denied;
      const body = (await request.json()) as { raw?: string };
      if (!body.raw || !/^[A-Za-z0-9_-]+$/u.test(body.raw)) {
        return HttpResponse.json({ error: 'invalid RFC 2822 payload' }, { status: 400 });
      }
      state.gmailSendCalls += 1;
      state.sentRawMessages.push(body.raw);
      return HttpResponse.json(
        { id: `e2e-provider-message-${state.gmailSendCalls}`, threadId: 'e2e-provider-thread' },
        { headers: { 'x-request-id': `e2e-send-request-${state.gmailSendCalls}` } },
      );
    }),
    http.get(`${baseUrl}/calendar/v3/calendars/primary/events`, ({ request }) => {
      const denied = requireAccessToken(request);
      if (denied) return denied;
      const pageToken = new URL(request.url).searchParams.get('pageToken');
      state.calendarPageTokens.push(pageToken);
      if (pageToken === 'calendar-page-two') {
        return HttpResponse.json({
          items: [event('e2e-calendar-two', 'Mock investor follow-up', secondEventStart)],
        });
      }
      return HttpResponse.json({
        items: [event('e2e-calendar-one', 'Mock investor introduction', firstEventStart)],
        nextPageToken: 'calendar-page-two',
      });
    }),
    http.post(`${baseUrl}/calendar/v3/calendars/primary/events`, async ({ request }) => {
      const denied = requireAccessToken(request);
      if (denied) return denied;
      const body = (await request.json()) as Record<string, unknown>;
      state.calendarCreateCalls += 1;
      state.calendarCreateBodies.push(body);
      return HttpResponse.json({
        id: `e2e-created-calendar-${state.calendarCreateCalls}`,
        status: 'confirmed',
        htmlLink: 'https://calendar.google.com/calendar/event?eid=e2e-created',
        summary: body.summary,
        description: body.description,
        location: body.location,
        start: body.start,
        end: body.end,
        attendees: body.attendees,
        organizer: { email: googleAccount, displayName: 'Ada Founder' },
      });
    }),
  ];
}

async function requestFromNode(request: IncomingMessage, baseUrl: string): Promise<Request> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 2_000_000) throw new Error('Mock provider request exceeded two megabytes');
    chunks.push(bytes);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = request.method ?? 'GET';
  return new Request(new URL(request.url ?? '/', baseUrl), {
    method,
    headers,
    ...(!['GET', 'HEAD'].includes(method) && size > 0 ? { body: Buffer.concat(chunks) } : {}),
  });
}

export async function startGoogleProviderMock(options?: {
  throwOnMutation?: boolean;
}): Promise<GoogleProviderMock> {
  const sockets = new Set<Socket>();
  let baseUrl = '';
  let handlers: RequestHandler[] = [];
  const auditor = startGoogleNetworkAudit({
    throwOnMutation: options?.throwOnMutation ?? false,
    throwOnUnexpected: false,
  });
  const state: GoogleProviderMockState = {
    get baseUrl() {
      return baseUrl;
    },
    requests: [],
    gmailListQueries: [],
    gmailMetadataIds: [],
    calendarPageTokens: [],
    tokenRequestBodies: [],
    authorizationHeaders: [],
    sentRawMessages: [],
    calendarCreateBodies: [],
    auditor,
    gmailSendCalls: 0,
    calendarCreateCalls: 0,
  };
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const request = await requestFromNode(incoming, baseUrl);
      const providerUrl = new URL(request.url);
      if (providerUrl.pathname === '/token') {
        providerUrl.protocol = 'https:';
        providerUrl.host = 'oauth2.googleapis.com';
      } else if (providerUrl.pathname === '/v1/userinfo') {
        providerUrl.protocol = 'https:';
        providerUrl.host = 'openidconnect.googleapis.com';
      } else if (providerUrl.pathname.startsWith('/gmail/v1/')) {
        providerUrl.protocol = 'https:';
        providerUrl.host = 'gmail.googleapis.com';
      } else if (providerUrl.pathname.startsWith('/calendar/v3/')) {
        providerUrl.protocol = 'https:';
        providerUrl.host = 'calendar.googleapis.com';
      }
      state.requests.push(`${request.method} ${providerUrl.pathname}`);
      auditor.recordRequest({
        method: request.method ?? 'GET',
        url: providerUrl,
        headers: request.headers,
      });
      const response = await getResponse(handlers, request);
      if (!response) {
        outgoing.writeHead(500, { 'content-type': 'application/json' });
        outgoing.end(
          JSON.stringify({ error: `Unhandled MSW request: ${request.method} ${request.url}` }),
        );
        return;
      }
      const headers: Record<string, string> = {};
      response.headers.forEach((value, name) => {
        headers[name] = value;
      });
      outgoing.writeHead(response.status, headers);
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch((error: unknown) => {
      if (outgoing.headersSent) {
        outgoing.destroy(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      outgoing.writeHead(500, { 'content-type': 'application/json' });
      outgoing.end(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Mock provider failure' }),
      );
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  handlers = mockHandlers(baseUrl, state);

  return {
    state,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
