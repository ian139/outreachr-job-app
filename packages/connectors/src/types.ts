export type ConnectorProvider = 'google' | 'microsoft';

/**
 * Explicit mail view mode. `job-relevant` (the default) restricts the thread
 * list to job-application conversations (applications, recruiters,
 * interviews, offers/rejections, scheduling, hiring, follow-ups) using list
 * metadata/search semantics only; `all` lists the raw mailbox unfiltered.
 * The mode must never mutate or delete provider mail and must never affect
 * exhaustive relationship sync, which uses `listMailboxMessages` directly.
 */
export type MailViewMode = 'job-relevant' | 'all';

/**
 * Provider-neutral capability summary for a connector scope profile. The
 * profile is persisted and exposed explicitly so inbox reading is never
 * conflated with send-ready relationship sync: read-only grants inbox reads
 * without any draft/send or calendar-write capability.
 */
export interface ConnectorCapabilities {
  /** Inbox and thread reading (Gmail readonly or Mail.ReadBasic) is granted. */
  canReadInbox: boolean;
  /** Complete mailbox reconciliation for relationship history is granted. */
  canSyncRelationships: boolean;
  /** Composing drafts for this provider is available. */
  canDraft: boolean;
  /** Exact-content approved sending is available. */
  canSend: boolean;
  /** Calendar reads (events and free-busy) are available. */
  canReadCalendar: boolean;
  /** Calendar writes (event creation) are available. */
  canWriteCalendar: boolean;
}

export type EmailMessageKind = 'initial' | 'follow_up' | 'intro_request' | 'reply';

/**
 * Delivery identity reviewed by the founder. The provider is not enough: the
 * authenticated account, semantic message kind, and provider conversation are
 * all part of the exact external action.
 */
export interface SendContext {
  provider: ConnectorProvider;
  senderAddress: string;
  messageKind: EmailMessageKind;
  providerThreadId?: string;
}

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type AccessTokenProvider = () => string | Promise<string>;

export interface RetryPolicy {
  /** Total attempts, including the first request. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export type Sleep = (milliseconds: number) => Promise<void>;

export interface EmailAddress {
  email: string;
  name?: string;
  /** Stable local person id. Falls back to the normalized email address. */
  recipientKey?: string;
}

export interface EmailMessage {
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  replyTo?: EmailAddress;
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  /** Custom RFC 5322 headers. Newlines are rejected. */
  headers?: Record<string, string>;
}

export interface SendApproval {
  approved: boolean;
  approvalId: string;
  approvedAt: string;
  /** Produced by fingerprintEmail after the founder reviewed the final content. */
  messageFingerprint: string;
  /** Canonical delivery identity shown during founder review. */
  context: SendContext;
}

export interface DuplicateCheck {
  checkedAt: string;
  /** Every current recipientKey (or normalized email fallback) must be present. */
  checkedRecipientKeys: string[];
  /** Any intersection with current recipients blocks the send. */
  previouslyContactedRecipientKeys: string[];
}

export interface SendSafety {
  /** Durable, unique id for this one approved send attempt. */
  operationKey: string;
  approval: SendApproval;
  duplicateCheck: DuplicateCheck;
}

export interface SendEmailInput {
  message: EmailMessage;
  /** Recomputed from current local/provider state immediately before dispatch. */
  context: SendContext;
  safety: SendSafety;
  saveToSentItems?: boolean;
}

export interface CreateDraftInput {
  message: EmailMessage;
}

export interface SendDraftInput {
  draftId: string;
  /** Exact content the founder approved; draft mutation is the caller's concern. */
  message: EmailMessage;
  /** Recomputed from current local/provider state immediately before dispatch. */
  context: SendContext;
  safety: SendSafety;
}

export interface EmailDraft {
  provider: ConnectorProvider;
  id: string;
  messageId?: string;
  threadId?: string;
}

export type SendStatus = 'pending' | 'sent' | 'accepted' | 'ambiguous' | 'rejected';

export interface SendReceipt {
  provider: ConnectorProvider;
  operationKey: string;
  messageFingerprint: string;
  status: SendStatus;
  attemptedAt: string;
  updatedAt: string;
  providerMessageId?: string;
  providerThreadId?: string;
  providerRequestId?: string;
  httpStatus?: number;
  /** True only when the provider returned a definitive message id. */
  deliveryConfirmed: boolean;
  /** True when the result came from the local ledger instead of a new request. */
  replayed: boolean;
  retrySafe: boolean;
  errorCode?: string;
}

export interface SendClaimResult {
  claimed: boolean;
  receipt: SendReceipt;
}

/**
 * The app implements this against SQLite with an atomic unique operationKey.
 * claim must never replace an existing row.
 */
export interface SendAttemptLedger {
  claim(receipt: SendReceipt): Promise<SendClaimResult>;
  update(receipt: SendReceipt): Promise<void>;
  get(operationKey: string): Promise<SendReceipt | undefined>;
}

export interface EmailConnector {
  readonly provider: ConnectorProvider;
  createDraft(input: CreateDraftInput): Promise<EmailDraft>;
  sendDraft(input: SendDraftInput): Promise<SendReceipt>;
  sendEmail(input: SendEmailInput): Promise<SendReceipt>;
}

export interface MailboxMessage {
  provider: ConnectorProvider;
  id: string;
  threadId?: string;
  internetMessageId?: string;
  /**
   * Outreachr's opaque, per-send idempotency key when the provider preserved
   * the custom message header. This is used only to reconcile a previously
   * ambiguous local send with an authoritative sent-mail observation.
   */
  operationKey?: string;
  subject: string;
  from: EmailAddress;
  to: EmailAddress[];
  cc?: EmailAddress[];
  occurredAt: string;
  labels?: string[];
  /**
   * Provider-authoritative direction when available. Gmail derives this from
   * the SENT system label; Microsoft derives outbound only from the sent-items
   * folder endpoint. Callers must not infer outbound from the From address,
   * because send-as aliases need not equal the connected account address.
   */
  direction?: 'inbound' | 'outbound';
}
export interface MailboxThread {
  provider: ConnectorProvider;
  accountEmail: string;
  threadId: string;
  subject: string;
  snippet?: string;
  participants: EmailAddress[];
  latestAt: string;
  messageCount: number;
  sourceUrl?: string;
}

export interface MailboxMessageBody extends MailboxMessage {
  accountEmail: string;
  threadId: string;
  bodyText?: string;
  bodyHtml?: string;
  providerTruncated: boolean;
  truncationReason?: string;
  sourceUrl?: string;
  fetchedAt: string;
}

export interface ListMailboxThreadsInput {
  accountEmail: string;
  /** Defaults to `job-relevant`; `all` lists the raw mailbox unfiltered. */
  mailViewMode?: MailViewMode;
  query?: string;
  pageSize?: number;
  pageToken?: string;
  signal?: AbortSignal;
}

export interface MailboxThreadPage {
  threads: MailboxThread[];
  nextPageToken?: string;
}

export interface GetMailboxThreadInput {
  accountEmail: string;
  threadId: string;
  pageSize?: number;
  pageToken?: string;
  signal?: AbortSignal;
}

export interface MailboxThreadMessagesPage {
  thread: MailboxThread;
  messages: MailboxMessageBody[];
  nextPageToken?: string;
}

export interface ListMailboxMessagesInput {
  /** Only messages at or after this ISO timestamp are requested. Omit for all history. */
  since?: string;
  /**
   * `sent` selects a provider-authoritative sent-items stream. Gmail's `all`
   * stream already carries system labels, while Microsoft callers should scan
   * both `sent` and `all` to preserve authoritative outbound direction.
   */
  mailbox?: 'all' | 'sent';
  pageSize?: number;
  /** Opaque value returned by a previous call. */
  pageToken?: string;
  signal?: AbortSignal;
}

export interface MailboxMessagePage {
  messages: MailboxMessage[];
  nextPageToken?: string;
}

export interface RelationshipMailConnector {
  readonly provider: ConnectorProvider;
  listMailboxMessages(input: ListMailboxMessagesInput): Promise<MailboxMessagePage>;
  listMailboxThreads(input: ListMailboxThreadsInput): Promise<MailboxThreadPage>;
  getMailboxThread(input: GetMailboxThreadInput): Promise<MailboxThreadMessagesPage>;
}

export interface CalendarDateTime {
  /** ISO 8601 timestamp. Exactly one of dateTime or date is required. */
  dateTime?: string;
  /** YYYY-MM-DD for an all-day boundary. */
  date?: string;
  timeZone?: string;
}

export interface CalendarAttendee extends EmailAddress {
  responseStatus?: 'none' | 'accepted' | 'declined' | 'tentative';
  optional?: boolean;
}

export interface CalendarEventInput {
  calendarId?: string;
  title: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
  description?: string;
  descriptionType?: 'text' | 'html';
  location?: string;
  attendees?: CalendarAttendee[];
  timeZone?: string;
  /** Mapped to Microsoft Graph transactionId where available. */
  operationKey?: string;
}

export interface CalendarEvent extends CalendarEventInput {
  provider: ConnectorProvider;
  id: string;
  status?: string;
  webUrl?: string;
  organizer?: EmailAddress;
}

export interface ListCalendarEventsInput {
  calendarId?: string;
  timeMin: string;
  timeMax: string;
  timeZone?: string;
  pageSize?: number;
  /** Opaque value returned by a previous call. */
  pageToken?: string;
}

export interface CalendarEventPage {
  events: CalendarEvent[];
  nextPageToken?: string;
}

export interface FreeBusyInput {
  calendarIds: string[];
  timeMin: string;
  timeMax: string;
  timeZone?: string;
}

export interface BusyPeriod {
  start: string;
  end: string;
  status?: string;
}

export interface CalendarFreeBusy {
  calendarId: string;
  busy: BusyPeriod[];
  errors?: Array<{ code?: string; message: string }>;
}

export interface FreeBusyResult {
  timeMin: string;
  timeMax: string;
  calendars: CalendarFreeBusy[];
}

export interface CalendarConnector {
  readonly provider: ConnectorProvider;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  listEvents(input: ListCalendarEventsInput): Promise<CalendarEventPage>;
  queryFreeBusy(input: FreeBusyInput): Promise<FreeBusyResult>;
}

export interface ConnectorClientOptions {
  fetch: FetchLike;
  getAccessToken: AccessTokenProvider;
  sendLedger: SendAttemptLedger;
  retryPolicy?: Partial<RetryPolicy>;
  sleep?: Sleep;
  now?: () => Date;
}
