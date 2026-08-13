import { validateEventInput, validateFreeBusyInput, validateListInput } from './calendar.js';
import { ConnectorError } from './errors.js';
import { authorizedRequest, parseJson, responseRequestId } from './http.js';
import {
  deduplicateAddresses,
  MAX_BODY_SIZE_BYTES,
  MAX_CUMULATIVE_BODY_BYTES,
  providerEmailAddress,
  safeIsoTimestamp,
  truncateUtf8Bytes,
  utf8ByteLength,
  validateGetMailboxThreadInput,
  validateMailboxListInput,
  validateMailboxThreadListInput,
} from './mailbox.js';
import { executeGuardedSend } from './send.js';
import type {
  CalendarAttendee,
  CalendarConnector,
  CalendarDateTime,
  CalendarEvent,
  CalendarEventInput,
  CalendarEventPage,
  ConnectorClientOptions,
  CreateDraftInput,
  EmailAddress,
  EmailConnector,
  EmailDraft,
  EmailMessage,
  FreeBusyInput,
  FreeBusyResult,
  GetMailboxThreadInput,
  ListCalendarEventsInput,
  ListMailboxMessagesInput,
  ListMailboxThreadsInput,
  MailboxMessage,
  MailboxMessageBody,
  MailboxMessagePage,
  MailboxThread,
  MailboxThreadMessagesPage,
  MailboxThreadPage,
  RelationshipMailConnector,
  RetryPolicy,
  SendDraftInput,
  SendEmailInput,
  SendReceipt,
  Sleep,
} from './types.js';
interface GraphMessageJson {
  id?: string;
  conversationId?: string;
  internetMessageId?: string;
  subject?: string;
  from?: GraphRecipientJson;
  toRecipients?: GraphRecipientJson[];
  ccRecipients?: GraphRecipientJson[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isDraft?: boolean;
  webLink?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  parentFolderId?: string;
  internetMessageHeaders?: Array<{ name?: string; value?: string }>;
}

export interface MicrosoftConnectorOptions extends ConnectorClientOptions {
  graphBaseUrl?: string;
}

interface GraphRecipient {
  emailAddress: { address: string; name?: string };
}

interface GraphRecipientJson {
  emailAddress?: { address?: string; name?: string };
}

interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}

interface GraphEventJson {
  id?: string;
  subject?: string;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  start?: GraphDateTime;
  end?: GraphDateTime;
  location?: { displayName?: string };
  attendees?: Array<GraphRecipientJson & { status?: { response?: string }; type?: string }>;
  organizer?: GraphRecipientJson;
  showAs?: string;
  webLink?: string;
}

const defaultNow = (): Date => new Date();

function trimTrailingSlash(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end -= 1;
  return value.slice(0, end);
}

function microsoftMailPageUrl(
  pageToken: string,
  graphBaseUrl: string,
  operation: string,
  allowedPaths: readonly string[],
): URL {
  let url: URL;
  try {
    url = new URL(pageToken);
  } catch (cause) {
    throw new ConnectorError({
      provider: 'microsoft',
      operation,
      code: 'INVALID_REQUEST',
      message: 'Microsoft mail page token was not a valid URL',
      cause,
    });
  }
  const base = new URL(graphBaseUrl);
  if (url.origin !== base.origin || !allowedPaths.includes(url.pathname)) {
    throw new ConnectorError({
      provider: 'microsoft',
      operation,
      code: 'INVALID_REQUEST',
      message: 'Microsoft mail page token did not point to the expected Graph mail collection',
    });
  }
  return url;
}

function graphRecipient(address: EmailAddress): GraphRecipient {
  return { emailAddress: { address: address.email, name: address.name } };
}

function graphMessage(message: EmailMessage, operationKey?: string): Record<string, unknown> {
  return {
    subject: message.subject,
    body: {
      contentType: message.html !== undefined ? 'HTML' : 'Text',
      content: message.html ?? message.text ?? '',
    },
    toRecipients: message.to.map(graphRecipient),
    ccRecipients: message.cc?.map(graphRecipient),
    bccRecipients: message.bcc?.map(graphRecipient),
    replyTo: message.replyTo ? [graphRecipient(message.replyTo)] : undefined,
    internetMessageHeaders: [
      ...(operationKey ? [{ name: 'X-Outreachr-Operation-Key', value: operationKey }] : []),
      ...Object.entries(message.headers ?? {}).map(([name, value]) => ({ name, value })),
      ...(message.inReplyTo ? [{ name: 'In-Reply-To', value: message.inReplyTo }] : []),
      ...(message.references?.length
        ? [{ name: 'References', value: message.references.join(' ') }]
        : []),
    ],
  };
}

function graphDateTime(value: CalendarDateTime, fallbackTimeZone?: string): GraphDateTime {
  if (value.dateTime) {
    return { dateTime: value.dateTime, timeZone: value.timeZone ?? fallbackTimeZone ?? 'UTC' };
  }
  return {
    dateTime: `${value.date}T00:00:00`,
    timeZone: value.timeZone ?? fallbackTimeZone ?? 'UTC',
  };
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function comparableGraphTimestamp(value: string): number | undefined {
  const trimmed = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?$/u.test(trimmed)
  ) {
    return undefined;
  }
  const millisecondPrecision = trimmed.replace(/(\.\d{3})\d+/u, '$1');
  const withZone = /(?:Z|[+-]\d{2}:\d{2})$/u.test(millisecondPrecision)
    ? millisecondPrecision
    : `${millisecondPrecision}Z`;
  const parsed = Date.parse(withZone);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapGraphDateTime(value: GraphDateTime | undefined): CalendarDateTime | undefined {
  if (!value || typeof value.dateTime !== 'string') return undefined;
  if (comparableGraphTimestamp(value.dateTime) === undefined) return undefined;
  return {
    dateTime: value.dateTime.trim(),
    timeZone: typeof value.timeZone === 'string' ? value.timeZone : undefined,
  };
}

function mapGraphAttendee(
  value: NonNullable<GraphEventJson['attendees']>[number] | null | undefined,
): CalendarAttendee | undefined {
  const address = providerEmailAddress(value?.emailAddress?.address, value?.emailAddress?.name);
  if (!address) return undefined;
  const response =
    typeof value?.status?.response === 'string'
      ? value.status.response.toLocaleLowerCase('en-US')
      : 'none';
  const mapped = response === 'organizer' || response === 'notresponded' ? 'none' : response;
  return {
    ...address,
    optional:
      typeof value?.type === 'string' && value.type.toLocaleLowerCase('en-US') === 'optional',
    responseStatus: ['accepted', 'declined', 'tentative'].includes(mapped)
      ? (mapped as CalendarAttendee['responseStatus'])
      : 'none',
  };
}

function mapGraphEvent(event: GraphEventJson, calendarId: string): CalendarEvent | undefined {
  const id = typeof event?.id === 'string' ? event.id.trim() : '';
  const start = mapGraphDateTime(event?.start);
  const end = mapGraphDateTime(event?.end);
  if (
    !id ||
    !start?.dateTime ||
    !end?.dateTime ||
    (comparableGraphTimestamp(end.dateTime) ?? 0) <= (comparableGraphTimestamp(start.dateTime) ?? 0)
  ) {
    return undefined;
  }
  const organizer = providerEmailAddress(
    event.organizer?.emailAddress?.address,
    event.organizer?.emailAddress?.name,
  );
  return {
    provider: 'microsoft',
    id,
    calendarId,
    title: typeof event.subject === 'string' ? event.subject : '(untitled)',
    start,
    end,
    description:
      typeof event.body?.content === 'string'
        ? event.body.content
        : typeof event.bodyPreview === 'string'
          ? event.bodyPreview
          : undefined,
    descriptionType:
      typeof event.body?.contentType === 'string' &&
      event.body.contentType.toLocaleLowerCase('en-US') === 'html'
        ? 'html'
        : 'text',
    location:
      typeof event.location?.displayName === 'string' ? event.location.displayName : undefined,
    attendees: Array.isArray(event.attendees)
      ? event.attendees.map(mapGraphAttendee).filter(isDefined)
      : undefined,
    status: typeof event.showAs === 'string' ? event.showAs : undefined,
    webUrl: typeof event.webLink === 'string' ? event.webLink : undefined,
    organizer,
  };
}

function ambiguousMicrosoftCreateResponse(
  operation: string,
  response: Response,
  message: string,
  details?: unknown,
  cause?: unknown,
): ConnectorError {
  return new ConnectorError({
    provider: 'microsoft',
    operation,
    code: 'AMBIGUOUS_CREATE',
    message,
    httpStatus: response.status,
    providerRequestId: responseRequestId(response),
    mayHaveSucceeded: true,
    retryable: false,
    details,
    cause,
  });
}

function mapGraphMessage(
  message: GraphMessageJson,
  direction?: MailboxMessage['direction'],
): MailboxMessage | undefined {
  const id = typeof message?.id === 'string' ? message.id.trim() : '';
  const from = providerEmailAddress(
    message?.from?.emailAddress?.address,
    message?.from?.emailAddress?.name,
  );
  const occurredAt =
    safeIsoTimestamp(message?.sentDateTime) ?? safeIsoTimestamp(message?.receivedDateTime);
  if (!id || !from || !occurredAt) return undefined;
  const headers = Array.isArray(message.internetMessageHeaders)
    ? message.internetMessageHeaders
    : [];
  const internetMessageId =
    typeof message.internetMessageId === 'string'
      ? message.internetMessageId
      : headers.find((header) => header.name?.toLocaleLowerCase('en-US') === 'message-id')?.value;
  return {
    provider: 'microsoft',
    id,
    threadId: typeof message.conversationId === 'string' ? message.conversationId : undefined,
    internetMessageId,
    operationKey: headers.find(
      (header) =>
        typeof header?.name === 'string' &&
        header.name.toLocaleLowerCase('en-US') ===
          'X-Outreachr-Operation-Key'.toLocaleLowerCase('en-US'),
    )?.value,
    subject: typeof message.subject === 'string' ? message.subject : '',
    from,
    to: (Array.isArray(message.toRecipients) ? message.toRecipients : [])
      .map((recipient) =>
        providerEmailAddress(recipient?.emailAddress?.address, recipient?.emailAddress?.name),
      )
      .filter(isDefined),
    cc: (Array.isArray(message.ccRecipients) ? message.ccRecipients : [])
      .map((recipient) =>
        providerEmailAddress(recipient?.emailAddress?.address, recipient?.emailAddress?.name),
      )
      .filter(isDefined),
    occurredAt,
    direction,
  };
}

function mapGraphThreadSummary(
  msgs: GraphMessageJson[],
  accountEmail: string,
  threadId: string,
): MailboxThread | undefined {
  if (msgs.length === 0) return undefined;

  const mappedMsgs = msgs.map((m) => mapGraphMessage(m)).filter(isDefined);
  const firstMsg = mappedMsgs[0];
  if (!firstMsg) return undefined;

  const allAddresses: EmailAddress[] = [];
  for (const m of mappedMsgs) {
    allAddresses.push(m.from, ...m.to, ...(m.cc ?? []));
  }
  const participants = deduplicateAddresses(allAddresses);

  const subject = mappedMsgs.find((m) => m.subject.trim())?.subject ?? firstMsg.subject ?? '';
  const snippet =
    msgs.find((m) => typeof m.bodyPreview === 'string' && m.bodyPreview.trim())?.bodyPreview ?? '';

  let latestAt = firstMsg.occurredAt;
  for (const m of mappedMsgs) {
    if (Date.parse(m.occurredAt) > Date.parse(latestAt)) {
      latestAt = m.occurredAt;
    }
  }

  const firstWebLink = msgs.find((m) => typeof m.webLink === 'string' && m.webLink.trim())?.webLink;
  const sourceUrl =
    firstWebLink ?? `https://outlook.office.com/mail/id/${encodeURIComponent(threadId)}`;

  return {
    provider: 'microsoft',
    accountEmail,
    threadId,
    subject,
    snippet,
    participants,
    latestAt,
    messageCount: mappedMsgs.length,
    sourceUrl,
  };
}

function mapGraphMessageBody(
  message: GraphMessageJson,
  accountEmail: string,
  fetchedAt: string,
): MailboxMessageBody | undefined {
  let direction: MailboxMessage['direction'] = undefined;
  if (
    typeof message.parentFolderId === 'string' &&
    message.parentFolderId.toLowerCase().includes('sent')
  ) {
    direction = 'outbound';
  }
  const base = mapGraphMessage(message, direction);
  if (!base) return undefined;

  let bodyText: string | undefined = undefined;
  let bodyHtml: string | undefined = undefined;
  let providerTruncated = false;
  let truncationReason: string | undefined = undefined;

  if (message.body && typeof message.body.content === 'string') {
    let content = message.body.content;
    const res = truncateUtf8Bytes(content, MAX_BODY_SIZE_BYTES);
    content = res.text;
    if (res.truncated) {
      providerTruncated = true;
      truncationReason = 'Body content exceeds maximum allowed size';
    }
    const contentType = (message.body.contentType ?? '').toLowerCase();
    if (contentType === 'html') {
      bodyHtml = content;
    } else {
      bodyText = content;
    }
  }

  const sourceUrl =
    typeof message.webLink === 'string' && message.webLink.trim()
      ? message.webLink
      : `https://outlook.office.com/mail/id/${encodeURIComponent(base.id)}`;

  return {
    ...base,
    accountEmail,
    threadId: base.threadId ?? '',
    bodyText,
    bodyHtml,
    providerTruncated,
    truncationReason,
    sourceUrl,
    fetchedAt,
  };
}

export class MicrosoftConnector
  implements EmailConnector, CalendarConnector, RelationshipMailConnector
{
  readonly provider = 'microsoft' as const;
  readonly #fetch: ConnectorClientOptions['fetch'];
  readonly #getAccessToken: ConnectorClientOptions['getAccessToken'];
  readonly #sendLedger: ConnectorClientOptions['sendLedger'];
  readonly #retryPolicy?: Partial<RetryPolicy>;
  readonly #sleep?: Sleep;
  readonly #now: () => Date;
  readonly #graphBaseUrl: string;

  constructor(options: MicrosoftConnectorOptions) {
    this.#fetch = options.fetch;
    this.#getAccessToken = options.getAccessToken;
    this.#sendLedger = options.sendLedger;
    this.#retryPolicy = options.retryPolicy;
    this.#sleep = options.sleep;
    this.#now = options.now ?? defaultNow;
    this.#graphBaseUrl = trimTrailingSlash(
      options.graphBaseUrl ?? 'https://graph.microsoft.com/v1.0',
    );
  }

  #jsonInit(method: string, body: unknown): RequestInit {
    return {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    };
  }

  async #request(
    operation: string,
    url: string,
    init?: RequestInit,
    isSend = false,
    safeToRetry = false,
    isCreate = false,
  ): Promise<Response> {
    return authorizedRequest({
      provider: this.provider,
      operation,
      fetch: this.#fetch,
      getAccessToken: this.#getAccessToken,
      url,
      init,
      retryPolicy: this.#retryPolicy,
      sleep: this.#sleep,
      retryNetworkErrors: safeToRetry,
      retryServerErrors: safeToRetry,
      isSend,
      isCreate,
    });
  }

  async createDraft(input: CreateDraftInput): Promise<EmailDraft> {
    const response = await this.#request(
      'graph.messages.createDraft',
      `${this.#graphBaseUrl}/me/messages`,
      this.#jsonInit('POST', graphMessage(input.message)),
      false,
      false,
      true,
    );
    let draft: { id?: string; conversationId?: string };
    try {
      draft = await parseJson<{ id?: string; conversationId?: string }>(response);
    } catch (cause) {
      throw ambiguousMicrosoftCreateResponse(
        'graph.messages.createDraft',
        response,
        'Microsoft may have created the draft but returned malformed JSON',
        undefined,
        cause,
      );
    }
    if (typeof draft?.id !== 'string' || !draft.id.trim()) {
      throw ambiguousMicrosoftCreateResponse(
        'graph.messages.createDraft',
        response,
        'Microsoft may have created the draft but did not return a usable id',
        draft,
      );
    }
    return {
      provider: this.provider,
      id: draft.id,
      messageId: draft.id,
      threadId: draft.conversationId,
    };
  }

  async sendEmail(input: SendEmailInput): Promise<SendReceipt> {
    return executeGuardedSend({
      provider: this.provider,
      message: input.message,
      context: input.context,
      safety: input.safety,
      ledger: this.#sendLedger,
      now: this.#now,
      perform: async () => {
        const response = await this.#request(
          'graph.sendMail',
          `${this.#graphBaseUrl}/me/sendMail`,
          this.#jsonInit('POST', {
            message: graphMessage(input.message, input.safety.operationKey),
            saveToSentItems: input.saveToSentItems ?? true,
          }),
          true,
        );
        return {
          status: 'accepted',
          providerMessageId: undefined,
          providerThreadId: undefined,
          providerRequestId: responseRequestId(response),
          httpStatus: response.status,
          // Graph 202 means accepted, not delivery-confirmed. Never auto-resend it.
          deliveryConfirmed: false,
        };
      },
    });
  }

  async sendDraft(input: SendDraftInput): Promise<SendReceipt> {
    if (!input.draftId.trim()) throw new TypeError('Microsoft draft id is required');
    return executeGuardedSend({
      provider: this.provider,
      message: input.message,
      context: input.context,
      safety: input.safety,
      ledger: this.#sendLedger,
      now: this.#now,
      perform: async () => {
        const response = await this.#request(
          'graph.messages.sendDraft',
          `${this.#graphBaseUrl}/me/messages/${encodeURIComponent(input.draftId)}/send`,
          { method: 'POST' },
          true,
        );
        return {
          status: 'accepted',
          providerMessageId: input.draftId,
          providerThreadId: undefined,
          providerRequestId: responseRequestId(response),
          httpStatus: response.status,
          deliveryConfirmed: false,
        };
      },
    });
  }

  async listMailboxMessages(input: ListMailboxMessagesInput): Promise<MailboxMessagePage> {
    validateMailboxListInput(input);
    let url: URL;
    if (input.pageToken) {
      const base = new URL(this.#graphBaseUrl);
      url = microsoftMailPageUrl(input.pageToken, this.#graphBaseUrl, 'graph.messages.list', [
        `${base.pathname}/me/messages`,
        `${base.pathname}/me/mailFolders/sentitems/messages`,
      ]);
    } else {
      url = new URL(
        input.mailbox === 'sent'
          ? `${this.#graphBaseUrl}/me/mailFolders/sentitems/messages`
          : `${this.#graphBaseUrl}/me/messages`,
      );
      url.searchParams.set(
        '$select',
        'id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isDraft,internetMessageHeaders',
      );
      const dateField = input.mailbox === 'sent' ? 'sentDateTime' : 'receivedDateTime';
      if (input.since) {
        url.searchParams.set('$filter', `${dateField} ge ${input.since}`);
      }
      url.searchParams.set('$orderby', `${dateField} desc`);
      url.searchParams.set('$top', String(input.pageSize ?? 100));
    }
    const response = await this.#request(
      'graph.messages.list',
      url.toString(),
      {
        headers: { Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' },
        signal: input.signal,
      },
      false,
      true,
    );
    const page = await parseJson<{
      value?: GraphMessageJson[];
      '@odata.nextLink'?: string;
    }>(response);
    return {
      messages: (page.value ?? [])
        .filter((message) => message.isDraft !== true)
        .map((message) =>
          mapGraphMessage(message, input.mailbox === 'sent' ? 'outbound' : undefined),
        )
        .filter(isDefined),
      nextPageToken: page['@odata.nextLink'],
    };
  }

  async listMailboxThreads(input: ListMailboxThreadsInput): Promise<MailboxThreadPage> {
    validateMailboxThreadListInput(input);
    const pageSize = Math.min(input.pageSize ?? 50, 50);

    let url: URL;
    if (input.pageToken) {
      const base = new URL(this.#graphBaseUrl);
      url = microsoftMailPageUrl(input.pageToken, this.#graphBaseUrl, 'graph.threads.list', [
        `${base.pathname}/me/messages`,
      ]);
    } else {
      url = new URL(`${this.#graphBaseUrl}/me/messages`);
      url.searchParams.set(
        '$select',
        'id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isDraft,webLink,bodyPreview',
      );
      if (input.query) {
        url.searchParams.set('$search', `"${input.query.replace(/"/g, '')}"`);
      } else {
        url.searchParams.set('$orderby', 'receivedDateTime desc');
      }
      url.searchParams.set('$top', String(pageSize));
    }

    const response = await this.#request(
      'graph.threads.list',
      url.toString(),
      {
        headers: { Prefer: 'outlook.body-content-type="text", IdType="ImmutableId"' },
        signal: input.signal,
      },
      false,
      true,
    );

    const page = await parseJson<{
      value?: GraphMessageJson[];
      '@odata.nextLink'?: string;
    }>(response);

    const rawMessages = (page.value ?? []).filter((msg) => msg.isDraft !== true);

    const threadMap = new Map<string, GraphMessageJson[]>();
    for (const msg of rawMessages) {
      const threadId =
        (typeof msg.conversationId === 'string' && msg.conversationId.trim()) || msg.id;
      if (!threadId) continue;
      const existing = threadMap.get(threadId);
      if (existing) {
        existing.push(msg);
      } else {
        threadMap.set(threadId, [msg]);
      }
    }

    const threads: MailboxThread[] = [];
    for (const [threadId, msgs] of threadMap.entries()) {
      const thread = mapGraphThreadSummary(msgs, input.accountEmail, threadId);
      if (thread) threads.push(thread);
    }

    return {
      threads,
      nextPageToken: page['@odata.nextLink'],
    };
  }

  async getMailboxThread(input: GetMailboxThreadInput): Promise<MailboxThreadMessagesPage> {
    validateGetMailboxThreadInput(input);
    const pageSize = Math.min(input.pageSize ?? 50, 50);

    let url: URL;
    if (input.pageToken) {
      const base = new URL(this.#graphBaseUrl);
      url = microsoftMailPageUrl(input.pageToken, this.#graphBaseUrl, 'graph.threads.get', [
        `${base.pathname}/me/messages`,
      ]);
    } else {
      url = new URL(`${this.#graphBaseUrl}/me/messages`);
      url.searchParams.set('$filter', `conversationId eq '${input.threadId.replace(/'/g, "''")}'`);
      url.searchParams.set(
        '$select',
        'id,conversationId,internetMessageId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isDraft,webLink,bodyPreview,body,internetMessageHeaders,parentFolderId',
      );
      url.searchParams.set('$orderby', 'receivedDateTime asc');
      url.searchParams.set('$top', String(pageSize));
    }

    const response = await this.#request(
      'graph.threads.get',
      url.toString(),
      {
        headers: { Prefer: 'outlook.body-content-type="html", IdType="ImmutableId"' },
        signal: input.signal,
      },
      false,
      true,
    );

    const page = await parseJson<{
      value?: GraphMessageJson[];
      '@odata.nextLink'?: string;
    }>(response);

    const rawMessages = (page.value ?? []).filter((msg) => msg.isDraft !== true);

    if (rawMessages.length === 0 && !input.pageToken) {
      throw new ConnectorError({
        provider: this.provider,
        operation: 'graph.threads.get',
        code: 'NOT_FOUND',
        message: 'Mailbox thread not found',
      });
    }

    const fetchedAt = new Date().toISOString();
    let cumulativeBytes = 0;
    const messageBodies: MailboxMessageBody[] = [];

    for (const msg of rawMessages) {
      let mapped = mapGraphMessageBody(msg, input.accountEmail, fetchedAt);
      if (mapped) {
        const msgBytes =
          (mapped.bodyText ? utf8ByteLength(mapped.bodyText) : 0) +
          (mapped.bodyHtml ? utf8ByteLength(mapped.bodyHtml) : 0);
        if (cumulativeBytes >= MAX_CUMULATIVE_BODY_BYTES) {
          mapped = {
            ...mapped,
            bodyText: undefined,
            bodyHtml: undefined,
            providerTruncated: true,
            truncationReason: 'Application body safety limit reached',
          };
        } else if (cumulativeBytes + msgBytes > MAX_CUMULATIVE_BODY_BYTES) {
          const remainingBudget = MAX_CUMULATIVE_BODY_BYTES - cumulativeBytes;
          if (mapped.bodyText) {
            const res = truncateUtf8Bytes(mapped.bodyText, remainingBudget);
            mapped.bodyText = res.text;
          }
          if (mapped.bodyHtml) {
            const usedText = mapped.bodyText ? utf8ByteLength(mapped.bodyText) : 0;
            const remainingHtml = Math.max(0, remainingBudget - usedText);
            const res = truncateUtf8Bytes(mapped.bodyHtml, remainingHtml);
            mapped.bodyHtml = res.text;
          }
          mapped.providerTruncated = true;
          mapped.truncationReason = 'Application body safety limit reached';
        }
        const finalBytes =
          (mapped.bodyText ? utf8ByteLength(mapped.bodyText) : 0) +
          (mapped.bodyHtml ? utf8ByteLength(mapped.bodyHtml) : 0);
        cumulativeBytes += finalBytes;
        messageBodies.push(mapped);
      }
    }

    const threadSummary = mapGraphThreadSummary(
      rawMessages,
      input.accountEmail,
      input.threadId,
    ) ?? {
      provider: 'microsoft',
      accountEmail: input.accountEmail,
      threadId: input.threadId,
      subject: '(No subject)',
      snippet: '',
      participants: [],
      latestAt: safeIsoTimestamp(Date.now())!,
      messageCount: messageBodies.length,
      sourceUrl: `https://outlook.office.com/mail/id/${encodeURIComponent(input.threadId)}`,
    };

    return {
      thread: threadSummary,
      messages: messageBodies,
      nextPageToken: page['@odata.nextLink'],
    };
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
    validateEventInput(input);
    const calendarId = input.calendarId ?? 'primary';
    const path =
      calendarId === 'primary'
        ? `${this.#graphBaseUrl}/me/events`
        : `${this.#graphBaseUrl}/me/calendars/${encodeURIComponent(calendarId)}/events`;
    const response = await this.#request(
      'graph.calendar.events.create',
      path,
      this.#jsonInit('POST', {
        subject: input.title,
        body: input.description
          ? {
              contentType: input.descriptionType === 'html' ? 'HTML' : 'Text',
              content: input.description,
            }
          : undefined,
        start: graphDateTime(input.start, input.timeZone),
        end: graphDateTime(input.end, input.timeZone),
        location: input.location ? { displayName: input.location } : undefined,
        attendees: input.attendees?.map((attendee) => ({
          ...graphRecipient(attendee),
          type: attendee.optional ? 'optional' : 'required',
        })),
        transactionId: input.operationKey,
      }),
      false,
      false,
      true,
    );
    let json: GraphEventJson | undefined;
    let event: CalendarEvent | undefined;
    try {
      json = await parseJson<GraphEventJson>(response);
      event = mapGraphEvent(json, calendarId);
    } catch (cause) {
      throw ambiguousMicrosoftCreateResponse(
        'graph.calendar.events.create',
        response,
        'Microsoft may have created the event but returned a malformed response',
        json,
        cause,
      );
    }
    if (!event) {
      throw ambiguousMicrosoftCreateResponse(
        'graph.calendar.events.create',
        response,
        'Microsoft may have created the event but omitted a usable id or event boundary',
        json,
      );
    }
    return event;
  }

  async listEvents(input: ListCalendarEventsInput): Promise<CalendarEventPage> {
    validateListInput(input);
    const calendarId = input.calendarId ?? 'primary';
    let url: URL;
    if (input.pageToken) {
      url = new URL(input.pageToken);
      const base = new URL(this.#graphBaseUrl);
      if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname}/`)) {
        throw new ConnectorError({
          provider: this.provider,
          operation: 'graph.calendar.events.list',
          code: 'INVALID_REQUEST',
          message: 'Microsoft page token did not point to the configured Graph endpoint',
        });
      }
    } else {
      const path =
        calendarId === 'primary'
          ? `${this.#graphBaseUrl}/me/calendarView`
          : `${this.#graphBaseUrl}/me/calendars/${encodeURIComponent(calendarId)}/calendarView`;
      url = new URL(path);
      url.searchParams.set('startDateTime', input.timeMin);
      url.searchParams.set('endDateTime', input.timeMax);
      if (input.pageSize) url.searchParams.set('$top', String(input.pageSize));
    }
    const headers: Record<string, string> = {};
    if (input.timeZone) headers.Prefer = `outlook.timezone="${input.timeZone.replaceAll('"', '')}"`;
    const response = await this.#request(
      'graph.calendar.events.list',
      url.toString(),
      { headers },
      false,
      true,
    );
    const json = await parseJson<{
      value?: GraphEventJson[];
      '@odata.nextLink'?: string;
    }>(response);
    return {
      events: (json.value ?? []).map((event) => mapGraphEvent(event, calendarId)).filter(isDefined),
      nextPageToken: json['@odata.nextLink'],
    };
  }

  async queryFreeBusy(input: FreeBusyInput): Promise<FreeBusyResult> {
    validateFreeBusyInput(input);
    const timeZone = input.timeZone ?? 'UTC';
    const response = await this.#request(
      'graph.calendar.getSchedule',
      `${this.#graphBaseUrl}/me/calendar/getSchedule`,
      this.#jsonInit('POST', {
        schedules: input.calendarIds,
        startTime: { dateTime: input.timeMin, timeZone },
        endTime: { dateTime: input.timeMax, timeZone },
        availabilityViewInterval: 30,
      }),
      false,
      true,
    );
    const json = await parseJson<{
      value?: Array<{
        scheduleId?: string;
        error?: { responseCode?: string; message?: string };
        scheduleItems?: Array<{
          status?: string;
          start?: GraphDateTime;
          end?: GraphDateTime;
        }>;
      }>;
    }>(response);
    const byId = new Map((json.value ?? []).map((entry) => [entry.scheduleId ?? '', entry]));
    return {
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      calendars: input.calendarIds.map((calendarId) => {
        const result = byId.get(calendarId);
        return {
          calendarId,
          busy: (result?.scheduleItems ?? []).map((item) => {
            const start = mapGraphDateTime(item.start)?.dateTime;
            const end = mapGraphDateTime(item.end)?.dateTime;
            if (
              !start ||
              !end ||
              (comparableGraphTimestamp(end) ?? 0) <= (comparableGraphTimestamp(start) ?? 0)
            ) {
              throw new ConnectorError({
                provider: this.provider,
                operation: 'graph.calendar.getSchedule',
                code: 'UNKNOWN',
                message: 'Microsoft returned a schedule item without usable boundaries',
                details: item,
              });
            }
            return { start, end, status: item.status };
          }),
          errors: result?.error
            ? [
                {
                  code: result.error.responseCode,
                  message: result.error.message ?? 'Unknown schedule error',
                },
              ]
            : undefined,
        };
      }),
    };
  }
}
