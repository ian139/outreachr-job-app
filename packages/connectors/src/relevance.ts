import type { MailViewMode } from './types.js';

/**
 * Precision-first relevance filter for the job-relevant mail view.
 *
 * The classifier is structured rather than any-term: strong personal
 * correspondence (interview / application status / offer letter / rejection)
 * always passes; recruiting identity (recruiter/recruiting) passes unless a
 * promotional signal is present; generic words (offer, schedule, application,
 * jobs, careers, hr, ...) pass only when corroborated by a signal from the
 * other field (sender signals corroborate subject words and vice versa).
 * Sports/promotional/newsletter/ticket/discount/unsubscribe signals override
 * weak and recruiting positives, but never unambiguous personal
 * interview/application-status correspondence. Occupational terms
 * (`marketing`, `sales`) are never promotional on their own; they reject
 * only when promotional corroboration (discount, coupon, promo, deal, sale)
 * is also present.
 *
 * Matching uses list metadata only (subject, sender, body preview) — never
 * full bodies — and word-boundary rules so short terms such as `hr` or `jobs`
 * cannot match inside unrelated words (`through`, `notjobs`).
 *
 * This is a view filter: the explicit `all` mode and exhaustive relationship
 * sync (which reads the raw message stream through `listMailboxMessages`)
 * always see the unfiltered mailbox.
 */

/** Strong personal correspondence (subject): unambiguous and non-overridable. */
export const PERSONAL_SUBJECT_TERMS = [
  'interview',
  'interviews',
  'interviewer',
  'interviewers',
  'interviewing',
  'interviewed',
  'rejected',
  'rejection',
  'rejections',
  'application status',
  'application statuses',
  'offer letter',
  'offer letters',
] as const;

/** Recruiting identity in the subject; overridable by promotional signals. */
export const RECRUITING_SUBJECT_TERMS = [
  'recruiter',
  'recruiters',
  'recruiting',
  'recruitment',
] as const;

/** Recruiting identity in the sender; overridable by promotional signals. */
export const RECRUITING_SENDER_TERMS = [
  'recruiter',
  'recruiters',
  'recruiting',
  'recruitment',
] as const;

/**
 * Weak positives (subject). A weak subject word is relevant only when the
 * sender carries a recruiting or weak-recruiting signal, so a lone "Offer",
 * "Schedule", or "Application" never qualifies.
 *
 * Gmail does not stem words, so every local matcher variant is listed here.
 */
export const WEAK_SUBJECT_TERMS = [
  'application',
  'applications',
  'applied',
  'applying',
  'applicant',
  'applicants',
  'offer',
  'offers',
  'schedule',
  'schedules',
  'scheduled',
  'scheduling',
  'hiring',
  'hire',
  'hires',
  'hired',
  'onboarding',
  'onboard',
  'onboarded',
  'follow-up',
  'follow-ups',
  'follow up',
  'following up',
  'next step',
  'next steps',
  'position',
  'positions',
  'role',
  'roles',
  'opportunity',
  'opportunities',
  'candidate',
  'candidates',
  'job',
  'jobs',
  'career',
  'careers',
] as const;

/**
 * Weak positives (sender). A weak sender word alone never qualifies; it only
 * corroborates a weak/strong subject signal. `talent` and people-team phrases
 * are deliberately here rather than standalone acceptors so talent/newsletter
 * senders cannot qualify on identity alone.
 */
export const WEAK_SENDER_TERMS = [
  'job',
  'jobs',
  'career',
  'careers',
  'hr',
  'hiring',
  'hire',
  'hires',
  'hired',
  'talent',
  'talent acquisition',
  'people team',
  'people operations',
] as const;

/**
 * Negative override signals. Matched across subject, sender, and body
 * preview, these override weak and recruiting positives but never the
 * personal-correspondence terms above.
 *
 * `marketing` and `sales` are intentionally absent: they are occupational
 * terms, not promotions on their own. The classifier applies them only with
 * an additional promotional corroboration signal.
 */
export const NEGATIVE_TERMS = [
  'nba',
  'sport',
  'sports',
  'ticket',
  'tickets',
  'discount',
  'discounts',
  'unsubscribe',
  'unsubscribed',
  'unsubscribing',
  'newsletter',
  'newsletters',
  'coupon',
  'coupons',
  'promo',
  'promos',
  'promotion',
  'promotions',
  'deal',
  'deals',
  'subscribe',
  'subscribed',
  'subscribing',
  'subscription',
  'subscriptions',
  'sale',
] as const;

/** Occupational terms that need a separate promotional corroboration. */
const PROMOTIONAL_OCCUPATIONAL_TERMS = ['marketing', 'sales'] as const;

/**
 * Strong enough promotional language to corroborate an occupational sender or
 * subject term. Generic job language such as `offer` is deliberately omitted
 * because it is common in genuine recruiting correspondence.
 */
const PROMOTIONAL_CORROBORATION_TERMS = [
  'discount',
  'discounts',
  'coupon',
  'coupons',
  'promo',
  'promos',
  'promotion',
  'promotions',
  'deal',
  'deals',
] as const;

/**
 * Promotional sender terms excluded from the Gmail query's from: field.
 * Separate from NEGATIVE_TERMS because Gmail cannot inspect body previews,
 * so the sender identity carries the exclusion server-side. Occupational
 * `marketing`/`sales` terms are not included without promo corroboration.
 */
export const NEGATIVE_FROM_TERMS = [
  'nba',
  'sport',
  'sports',
  'ticket',
  'tickets',
  'discount',
  'discounts',
  'coupon',
  'coupons',
  'newsletter',
  'newsletters',
  'promo',
  'promos',
  'promotion',
  'promotions',
  'deal',
  'deals',
  'sale',
  'unsubscribe',
  'unsubscribed',
  'subscribe',
  'subscribed',
  'subscription',
  'subscriptions',
] as const;

/** All subject terms (strong recruiting + weak + personal), for corroboration. */
const ALL_SUBJECT_TERMS: readonly string[] = [
  ...PERSONAL_SUBJECT_TERMS,
  ...RECRUITING_SUBJECT_TERMS,
  ...WEAK_SUBJECT_TERMS,
];

/** All sender terms (recruiting + weak), for corroboration. */
const ALL_SENDER_TERMS: readonly string[] = [...RECRUITING_SENDER_TERMS, ...WEAK_SENDER_TERMS];

function gmailTerm(term: string): string {
  return /\s/u.test(term) ? `"${term}"` : term;
}

function gmailGroup(terms: readonly string[]): string {
  return `(${terms.map(gmailTerm).join(' OR ')})`;
}

/**
 * Fixed Gmail search query for the job-relevant view. Built only from the
 * constant term lists above; never from user input.
 *
 * Structure mirrors the local classifier as closely as Gmail's query grammar
 * allows:
 *  1. personal correspondence (subject) — no exclusions;
 *  2. recruiting identity (subject or from) — scoped promotional exclusions;
 *  3. weak positives corroborated across fields — scoped exclusions.
 *
 * Gmail performs word matching without stemming, so every local plural/verb
 * variant is listed explicitly in the term lists above. `-` exclusions are
 * scoped to their parenthesized branch.
 */
export const JOB_RELEVANT_GMAIL_QUERY: string = `(${[
  `subject:${gmailGroup(PERSONAL_SUBJECT_TERMS)}`,
  `((subject:${gmailGroup(RECRUITING_SUBJECT_TERMS)} OR from:${gmailGroup(RECRUITING_SENDER_TERMS)}) -subject:${gmailGroup(NEGATIVE_TERMS)} -from:${gmailGroup(NEGATIVE_FROM_TERMS)})`,
  `(((subject:${gmailGroup(WEAK_SUBJECT_TERMS)} AND from:${gmailGroup(ALL_SENDER_TERMS)}) OR (from:${gmailGroup(WEAK_SENDER_TERMS)} AND subject:${gmailGroup(ALL_SUBJECT_TERMS)})) -subject:${gmailGroup(NEGATIVE_TERMS)} -from:${gmailGroup(NEGATIVE_FROM_TERMS)})`,
].join(' OR ')})`;

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
 * Build a precompiled word-boundary matcher for one term. Terms match as
 * whole words only: `hr` never matches inside `through`/`chrome`, `jobs`
 * never matches inside `notjobs`, and `sale` never matches `sales` (which is
 * an occupational term, handled separately). Plural/verb inflections are
 * listed explicitly per term list because Gmail does not stem; the local
 * classifier uses the same explicit variants for parity. No RegExp is built
 * at match time.
 */
export function compileTermMatcher(term: string): RegExp {
  const escaped = escapeRegExp(term).replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`, 'iu');
}

/** Precompiled matchers; no per-call RegExp allocation in the hot path. */
export const PERSONAL_SUBJECT_MATCHER = compileTermMatcherList(PERSONAL_SUBJECT_TERMS);
export const RECRUITING_SUBJECT_MATCHER = compileTermMatcherList(RECRUITING_SUBJECT_TERMS);
export const RECRUITING_SENDER_MATCHER = compileTermMatcherList(RECRUITING_SENDER_TERMS);
export const WEAK_SUBJECT_MATCHER = compileTermMatcherList(WEAK_SUBJECT_TERMS);
export const WEAK_SENDER_MATCHER = compileTermMatcherList(WEAK_SENDER_TERMS);
export const NEGATIVE_MATCHER = compileTermMatcherList(NEGATIVE_TERMS);
export const OCCUPATIONAL_MATCHER = compileTermMatcherList(PROMOTIONAL_OCCUPATIONAL_TERMS);
export const PROMOTIONAL_CORROBORATION_MATCHER = compileTermMatcherList(
  PROMOTIONAL_CORROBORATION_TERMS,
);

function compileTermMatcherList(terms: readonly string[]): RegExp {
  return new RegExp(
    terms
      .map(compileTermMatcher)
      .map((matcher) => matcher.source)
      .join('|'),
    'iu',
  );
}

function matchAny(text: string, matcher: RegExp): boolean {
  return matcher.test(text);
}

/**
 * Local metadata-only relevance predicate used by Microsoft Graph, which has
 * no server-side term search for arbitrary OR sets. Only list metadata
 * (subject, sender, bodyPreview) is inspected; never full bodies.
 *
 * Precedence (see file header): personal correspondence wins over everything;
 * otherwise any negative signal rejects; otherwise an occupational term
 * (`marketing`, `sales`) rejects only when promotional corroboration
 * (discount, coupon, promo, deal, sale) is also present; otherwise
 * recruiting identity passes; otherwise a weak subject word passes only when
 * the sender carries a recruiting/weak-recruiting signal.
 */
export function isJobRelevantMailMetadata(
  subject: string,
  fromName: string | undefined,
  fromAddress: string | undefined,
  bodyPreview: string | undefined,
): boolean {
  const subjectText = (subject ?? '').toLowerCase();
  const senderText = [fromName, fromAddress].filter(Boolean).join(' ').toLowerCase();
  const negativeText = [subjectText, senderText, (bodyPreview ?? '').toLowerCase()].join(' ');

  // 1. Unambiguous personal interview/application-status correspondence.
  if (matchAny(subjectText, PERSONAL_SUBJECT_MATCHER)) return true;

  // 2. Sports/promotional/newsletter/ticket/discount/unsubscribe override.
  if (matchAny(negativeText, NEGATIVE_MATCHER)) return false;

  // 3. Occupational terms reject only with promotional corroboration.
  if (
    matchAny(negativeText, OCCUPATIONAL_MATCHER) &&
    matchAny(negativeText, PROMOTIONAL_CORROBORATION_MATCHER)
  ) {
    return false;
  }

  // 4. Recruiting identity (subject or sender).
  if (
    matchAny(subjectText, RECRUITING_SUBJECT_MATCHER) ||
    matchAny(senderText, RECRUITING_SENDER_MATCHER)
  ) {
    return true;
  }

  // 5. Weak positives require corroboration from the other field.
  const subjectWeak = matchAny(subjectText, WEAK_SUBJECT_MATCHER);
  const senderSignal = matchAny(senderText, WEAK_SENDER_MATCHER);
  return subjectWeak && senderSignal;
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
