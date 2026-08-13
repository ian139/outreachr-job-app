import type { MailViewMode } from './types.js';

/**
 * Deterministic, provider-side Gmail relevance filter for the job-relevant
 * mail view. The terms are narrowly scoped to job applications, recruiters,
 * interviews, offers/rejections, scheduling, hiring, and follow-ups. They are
 * matched against list metadata only (subject/sender), never message bodies.
 *
 * This is a view filter: the explicit `all` mode and exhaustive relationship
 * sync (which reads the raw message stream through `listMailboxMessages`)
 * always see the unfiltered mailbox.
 */
export const JOB_RELEVANT_SUBJECT_TERMS = [
  'application',
  'applied',
  'applying',
  'applicant',
  'interview',
  'interviewer',
  'recruiter',
  'offer',
  'rejection',
  'rejected',
  'follow up',
  'follow-up',
  'schedule',
  'scheduling',
  'hiring',
  'onboarding',
  'offer letter',
  'application status',
] as const;

/** Sender display-name/address terms that typically identify recruiting mail. */
export const JOB_RELEVANT_SENDER_TERMS = [
  'jobs',
  'careers',
  'recruiting',
  'recruiter',
  'talent',
  'hr',
  'hiring',
  'people team',
  'people operations',
  'talent acquisition',
] as const;

/** All relevance terms used by local (Microsoft) metadata filtering. */
export const JOB_RELEVANT_TERMS: readonly string[] = [
  ...JOB_RELEVANT_SUBJECT_TERMS,
  ...JOB_RELEVANT_SENDER_TERMS,
];

function gmailTerm(term: string): string {
  return /\s/u.test(term) ? `"${term}"` : term;
}

/**
 * Fixed Gmail search query for the job-relevant view. Built only from the
 * constant term lists above; never from user input.
 */
export const JOB_RELEVANT_GMAIL_QUERY: string = `(subject:(${JOB_RELEVANT_SUBJECT_TERMS.map(
  gmailTerm,
).join(' OR ')}) OR from:(${JOB_RELEVANT_SENDER_TERMS.map(gmailTerm).join(' OR ')}))`;

/**
 * Escape user search text into safe, literal Gmail query tokens. Double
 * quotes and backslashes are removed and every whitespace-delimited token is
 * wrapped in quotes so Gmail operators (`in:`, `from:`, `has:`, `OR`, ...)
 * cannot change the shape of the composed query. This is the only path user
 * text can take into a provider query.
 */
export function escapeGmailQueryTokens(userQuery: string): string {
  return userQuery
    .replace(/["\\]/g, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => `"${token}"`)
    .join(' ');
}

/**
 * Compose the Gmail `q` parameter for a thread listing. The job-relevant
 * default ANDs the fixed relevance query with the user's (escaped) search;
 * `all` mode sends only the escaped user search, leaving the raw mailbox
 * unfiltered.
 */
export function composeGmailThreadQuery(
  mailViewMode: MailViewMode | undefined,
  userQuery: string | undefined,
): string | undefined {
  const parts: string[] = [];
  if (mailViewMode !== 'all') {
    parts.push(JOB_RELEVANT_GMAIL_QUERY);
  }
  const user = userQuery?.trim();
  if (user) {
    parts.push(escapeGmailQueryTokens(user));
  }
  return parts.length > 0 ? parts.join(' ') : undefined;
}

/** Split and normalize user search text into required literal tokens. */
export function parseUserSearchTokens(userQuery: string | undefined): string[] {
  if (!userQuery) return [];
  return userQuery
    .replace(/["\\]/g, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Local metadata-only relevance predicate used by Microsoft Graph, which has
 * no server-side term search for arbitrary OR sets. Word-boundary matching
 * with a plural/verb suffix avoids false positives inside unrelated words
 * (e.g. "hr" inside "through"). Only list metadata (subject, sender,
 * bodyPreview) is inspected; never full bodies.
 */
export function isJobRelevantMailMetadata(
  subject: string,
  fromName: string | undefined,
  fromAddress: string | undefined,
  bodyPreview: string | undefined,
): boolean {
  const haystack = [subject, fromName, fromAddress, bodyPreview]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!haystack) return false;
  for (const term of JOB_RELEVANT_TERMS) {
    if (term.includes(' ')) {
      if (haystack.includes(term)) return true;
    } else if (new RegExp(`\\b${escapeRegExp(term)}[a-z]*\\b`, 'u').test(haystack)) {
      return true;
    }
  }
  return false;
}

/**
 * Whether metadata matches every normalized user-search token. Used for the
 * Microsoft job-relevant path so user text is never interpolated into a
 * provider query language.
 */
export function matchesUserSearchTokens(
  metadata: { subject: string; fromName?: string; fromAddress?: string; bodyPreview?: string },
  userQuery: string | undefined,
): boolean {
  const tokens = parseUserSearchTokens(userQuery);
  if (tokens.length === 0) return true;
  const haystack = [metadata.subject, metadata.fromName, metadata.fromAddress, metadata.bodyPreview]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Bounded scan cap for Microsoft's local relevance filtering. A view call
 * scans at most this many metadata pages before returning the current
 * results and the nextLink of the last consumed page, so pagination stays
 * continuous (nothing is skipped or dropped) without unbounded provider
 * traffic.
 */
export const MAX_LOCAL_FILTER_SCAN_PAGES = 5;
