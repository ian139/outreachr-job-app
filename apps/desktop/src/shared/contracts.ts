export const IPC_CHANNELS = {
  bootstrap: 'outreachr:bootstrap',
  command: 'outreachr:command',
  listMailThreads: 'outreachr:list-mail-threads',
  getMailThread: 'outreachr:get-mail-thread',
  cancelMailRequest: 'outreachr:cancel-mail-request',
  selectFile: 'outreachr:select-file',
  selectDirectory: 'outreachr:select-directory',
  openExternal: 'outreachr:open-external',
  revealPath: 'outreachr:reveal-path',
  copyText: 'outreachr:copy-text',
  openLegal: 'outreachr:open-legal',
  oauthCallback: 'outreachr:oauth-callback',
  agentEvent: 'outreachr:agent-event',
} as const;

export type InvestorKind =
  | 'venture_capital'
  | 'micro_vc'
  | 'angel'
  | 'angel_network'
  | 'scout'
  | 'accelerator'
  | 'venture_studio'
  | 'corporate_vc'
  | 'family_office'
  | 'syndicate'
  | 'crypto_fund'
  | 'solo_gp';

export type PipelineStage =
  | 'researching'
  | 'ready'
  | 'intro_requested'
  | 'contacted'
  | 'meeting'
  | 'diligence'
  | 'partner_meeting'
  | 'soft_circle'
  | 'committed'
  | 'passed'
  | 'not_now';

export type Confidence = 'verified' | 'supported' | 'inferred' | 'unknown' | 'stale';
export type ConnectorProvider = 'google' | 'microsoft';
/**
 * Explicit mail view mode. `job-relevant` (the default) filters the thread
 * list to job-application conversations using provider-side list metadata
 * only; `all` is the explicit escape hatch that lists the raw mailbox
 * unfiltered. The mode never affects exhaustive relationship sync/audit,
 * which continue to use the raw provider message stream.
 */
export type MailViewMode = 'job-relevant' | 'all';
export type AgentProvider = 'codex' | 'claude';

/**
 * Provider-neutral connector access profile. `read-only` grants inbox reading
 * only (Google: openid, userinfo.email, gmail.readonly) and is never
 * send-ready; `relationship-sync` additionally grants inbox reads on top of
 * the send-capable `minimum` profile.
 */
export type ScopeProfile = 'read-only' | 'minimum' | 'relationship-sync';

/** Provider-neutral capability summary persisted and exposed with the profile. */
export interface ConnectorCapabilities {
  canReadInbox: boolean;
  canSyncRelationships: boolean;
  canDraft: boolean;
  canSend: boolean;
  canReadCalendar: boolean;
  canWriteCalendar: boolean;
}
export interface WorkspaceProfile {
  id: string;
  displayName: string;
  primaryEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  name: string;
  website: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  companyId: string | null;
  name: string;
  title: string | null;
  primaryEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationStage {
  id: string;
  name: string;
  position: number;
  terminal: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationStageHistoryItem {
  id: string;
  applicationId: string;
  fromStageId: string | null;
  toStageId: string;
  changedAt: string;
  note: string | null;
}

export interface ApplicationThreadLink {
  applicationId: string;
  provider: ConnectorProvider;
  accountEmail: string;
  providerThreadId: string;
  subjectSnapshot: string | null;
  linkedAt: string;
}

export interface ApplicationNote {
  id: string;
  applicationId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationTask {
  id: string;
  applicationId: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  status: 'open' | 'done' | 'dismissed';
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationSummary {
  id: string;
  companyId: string;
  companyName: string;
  role: string;
  stageId: string;
  stageName: string;
  sourceUrl: string | null;
  appliedAt: string | null;
  nextEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationDetail extends ApplicationSummary {
  company: Company;
  contacts: Array<Contact & { relationship: string; primary: boolean }>;
  threads: ApplicationThreadLink[];
  notes: ApplicationNote[];
  tasks: ApplicationTask[];
  stageHistory: ApplicationStageHistoryItem[];
}

export interface MailThreadSummary {
  provider: ConnectorProvider;
  accountEmail: string;
  threadId: string;
  subject: string;
  snippet: string | null;
  participants: string[];
  latestAt: string;
  messageCount: number;
  sourceUrl: string | null;
}

export interface MailMessageBody {
  provider: ConnectorProvider;
  accountEmail: string;
  threadId: string;
  messageId: string;
  internetMessageId: string | null;
  subject: string;
  from: { email: string; name?: string };
  to: Array<{ email: string; name?: string }>;
  cc: Array<{ email: string; name?: string }>;
  occurredAt: string;
  labels: string[];
  direction: 'inbound' | 'outbound' | null;
  bodyText: string | null;
  bodyHtml: string | null;
  providerTruncated: boolean;
  truncationReason: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
}

export interface MailThreadPage {
  thread: MailThreadSummary;
  messages: MailMessageBody[];
  nextCursor: string | null;
}

export interface ListMailThreadsRequest {
  requestId: string;
  provider: ConnectorProvider;
  accountEmail: string;
  /** Defaults to `job-relevant`; `all` is the explicit raw-mail escape hatch. */
  mailViewMode?: MailViewMode;
  query?: string;
  limit: number;
  cursor?: string;
}

export interface GetMailThreadRequest {
  requestId: string;
  provider: ConnectorProvider;
  accountEmail: string;
  threadId: string;
  limit: number;
  cursor?: string;
}

export interface MailThreadListPage {
  threads: MailThreadSummary[];
  nextCursor: string | null;
}

export interface MoneyRange {
  currency: 'USD';
  minimum: number | null;
  maximum: number | null;
  typical: number | null;
}

export interface SourceRef {
  id: string;
  title: string;
  url: string;
  publisher: string;
  observedAt: string;
  confidence: Confidence;
  rights: 'redistributable' | 'link_only' | 'local_research' | 'unknown';
}

export interface InvestorSummary {
  id: string;
  name: string;
  kind: InvestorKind;
  additionalKinds: InvestorKind[];
  headquarters: string | null;
  geographies: string[];
  stages: string[];
  sectors: string[];
  check: MoneyRange;
  fitScore: number;
  fitReasons: string[];
  expectedCheckUsd: number | null;
  confidence: Confidence;
  sourceCount: number;
  peopleCount: number;
  portfolioCount: number;
  target: boolean;
  pipelineStage: PipelineStage | null;
  nextAction: string | null;
  nextActionAt: string | null;
  conflict: 'none' | 'possible' | 'direct';
  updatedAt: string;
}

export interface PersonSummary {
  id: string;
  name: string;
  firmId: string | null;
  firmName: string | null;
  title: string | null;
  investorKinds: InvestorKind[];
  sectors: string[];
  workEmail: string | null;
  personalEmail: string | null;
  email: string | null;
  emailConfidence: Confidence;
  linkedinUrl: string | null;
  xUrl: string | null;
  target: boolean;
  contacted: boolean;
  replied: boolean;
  canSendInitial: boolean;
  suppressionReason: string | null;
  lastInteractionAt: string | null;
  nextAction: string | null;
}

export interface PortfolioExample {
  id: string;
  investorId: string;
  companyName: string;
  sector: string | null;
  round: string | null;
  announcedAt: string | null;
  source: SourceRef;
}

export interface InvestorDetail extends InvestorSummary {
  website: string | null;
  description: string | null;
  thesis: string | null;
  applicationUrl: string | null;
  contactEmail: string | null;
  leadBehavior: string | null;
  currentFund: string | null;
  people: PersonSummary[];
  portfolio: PortfolioExample[];
  sources: SourceRef[];
  activity: ActivityItem[];
}

export interface RoundState {
  id: string;
  companyName: string;
  companyOneLiner: string;
  stage: 'pre_seed' | 'seed' | 'series_a';
  targetAmount: number;
  committedAmount: number;
  softCircleAmount: number;
  targetCheck: MoneyRange;
  sectors: string[];
  geographies: string[];
  leadRequired: boolean;
  launchDate: string | null;
  targetCloseDate: string | null;
  narrative: string;
  status: 'planning' | 'active' | 'paused' | 'closed';
}

export interface PipelineColumn {
  stage: PipelineStage;
  label: string;
  targetIds: string[];
}

export interface WorkItem {
  id: string;
  kind: 'task' | 'approval' | 'meeting' | 'follow_up' | 'research' | 'source_review';
  title: string;
  detail: string;
  dueAt: string | null;
  investorId: string | null;
  personId: string | null;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  status: 'open' | 'done' | 'dismissed';
}

export interface TaskItem {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  status: 'open' | 'done' | 'dismissed';
  investorId: string | null;
  personId: string | null;
  createdAt: string;
}

export interface MeetingItem {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  provider: ConnectorProvider | 'manual';
  investorId: string | null;
  personIds: string[];
  location: string | null;
  agenda: string | null;
  notes: string | null;
  status: 'upcoming' | 'completed' | 'cancelled';
}

export interface ActivityItem {
  id: string;
  kind: 'email' | 'meeting' | 'note' | 'task' | 'stage' | 'source' | 'agent';
  title: string;
  detail: string | null;
  occurredAt: string;
  actor: 'founder' | 'system' | 'agent' | 'provider';
}

export interface MailEventItem {
  id: string;
  provider: ConnectorProvider;
  personId: string;
  personName: string;
  investorId: string | null;
  direction: 'inbound' | 'outbound';
  kind: 'message' | 'reply' | 'bounce' | 'hard_bounce' | 'complaint' | 'unsubscribe';
  subject: string;
  occurredAt: string;
  reviewedAt: string | null;
}

export interface SuppressionItem {
  id: string;
  scope: 'global' | 'email' | 'domain' | 'person' | 'firm';
  value: string;
  reason: string;
  source: 'founder' | 'unsubscribe' | 'bounce' | 'complaint' | 'policy' | 'import';
  active: boolean;
  updatedAt: string;
}

export interface CommunicationPolicy {
  sendingPaused: boolean;
  dailySendLimit: number;
  reservedToday: number;
  hourlySendLimit: number;
  reservedThisHour: number;
  recipientDomainDailyLimit: number;
  recipientDomainCooldownMinutes: number;
  postalAddress: string | null;
  optOutText: string;
}

export interface AuditIntegrityStatus {
  ok: boolean;
  entries: number;
  errorAt: number | null;
}

export interface DraftMessage {
  id: string;
  provider: ConnectorProvider;
  accountEmail: string;
  applicationId: string;
  contactId: string;
  recipientName: string;
  recipientEmail: string;
  subject: string;
  bodyText: string;
  threadId: string | null;
  replyToMessageId: string | null;
  kind: 'initial' | 'reply';
  contentHash: string;
  approvalState: 'draft' | 'approved' | 'sending' | 'sent' | 'blocked' | 'failed' | 'ambiguous';
  blockReason: string | null;
  canApprove: boolean;
  canSend: boolean;
  approvalBlockReasons: string[];
  sendBlockReasons: string[];
  approvedAt: string | null;
  sentAt: string | null;
  providerMessageId: string | null;
}

export interface KnowledgeItem {
  id: string;
  title: string;
  category: 'company' | 'round' | 'narrative' | 'metrics' | 'disclosure' | 'other';
  content: string;
  updatedAt: string;
  sharePolicy: 'internal' | 'safe_for_outreach' | 'meeting_only' | 'diligence_only';
}

export interface ListItem {
  id: string;
  name: string;
  description: string | null;
  count: number;
  memberFirmIds: string[];
}

export interface ConnectorStatus {
  provider: ConnectorProvider;
  state: 'not_configured' | 'configured' | 'connecting' | 'connected' | 'error';
  accountEmail: string | null;
  scopes: string[];
  /** Explicitly selected profile; never derived from the granted scope list. */
  scopeProfile: ScopeProfile;
  capabilities: ConnectorCapabilities;
  lastSyncAt: string | null;
  error: string | null;
  encryptionAvailable: boolean;
}

export interface AgentStatus {
  provider: AgentProvider;
  state: 'not_installed' | 'signed_out' | 'ready' | 'running' | 'error';
  version: string | null;
  accountLabel: string | null;
  mode: 'embedded' | 'mcp_companion';
  /** True only after the founder explicitly confirms Anthropic approval on this device. */
  subscriptionAuthApproved: boolean;
  error: string | null;
}

export interface AgentContextGrant {
  provider: AgentProvider;
  contextClass: 'round' | 'company' | 'investors' | 'activity';
  grantedAt: string;
}

export type AgentProposalKind = 'draft' | 'task' | 'pipeline_move' | 'note' | 'research';

export interface AgentProposalPayload {
  kind: AgentProposalKind;
  title: string;
  rationale: string;
  investorId: string | null;
  payload: Record<string, unknown>;
}

export interface AgentEvent {
  runId: string;
  type: 'started' | 'message' | 'tool_proposal' | 'completed' | 'error';
  text: string;
  proposalId?: string;
  proposal?: AgentProposalPayload;
}

export interface AgentProposalItem extends AgentProposalPayload {
  id: string;
  agentRunId: string;
  provider: AgentProvider;
  status: 'pending';
  createdAt: string;
}

export interface AgentProposalReviewResult {
  id: string;
  status: 'accepted' | 'rejected';
  operation: 'applied' | 'rejected' | 'converted_to_task';
  appliedEntityType: 'task' | 'message' | 'target' | null;
  appliedEntityId: string | null;
}

export interface SourceReviewItem {
  id: string;
  entityName: string;
  field: string;
  currentValue: string | null;
  proposedValue: string;
  source: SourceRef;
  status: 'pending' | 'accepted' | 'rejected';
}

export interface AppBootstrap {
  appVersion: string;
  platform: 'darwin' | 'win32' | 'linux' | 'other';
  vaultPath: string;
  isFirstRun: boolean;
  seedVersion: string;
  seedSignatureStatus: string;
  round: RoundState | null;
  investors: InvestorSummary[];
  people: PersonSummary[];
  pipeline: PipelineColumn[];
  workItems: WorkItem[];
  tasks: TaskItem[];
  meetings: MeetingItem[];
  mailEvents: MailEventItem[];
  drafts: DraftMessage[];
  knowledge: KnowledgeItem[];
  lists: ListItem[];
  sourceReview: SourceReviewItem[];
  connectors: ConnectorStatus[];
  agents: AgentStatus[];
  agentContextGrants: AgentContextGrant[];
  agentProposals: AgentProposalItem[];
  suppressions: SuppressionItem[];
  communicationPolicy: CommunicationPolicy;
  auditIntegrity: AuditIntegrityStatus;
  workspaceProfile: WorkspaceProfile | null;
  companies: Company[];
  contacts: Contact[];
  applicationStages: ApplicationStage[];
  applications: ApplicationSummary[];
  counts: {
    firms: number;
    people: number;
    targeted: number;
    contacted: number;
    meetings: number;
    commitments: number;
  };
}

export interface FounderSetupInput {
  founderName: string;
  founderEmail: string;
  companyName: string;
  companyOneLiner: string;
  stage: RoundState['stage'];
  targetAmount: number;
  targetCheckMinimum: number | null;
  targetCheckMaximum: number | null;
  sectors: string[];
  geographies: string[];
  narrative: string;
  postalAddress?: string;
}

export interface CommandMap {
  'workspace.setup': Pick<WorkspaceProfile, 'displayName' | 'primaryEmail'> & {
    stages: Array<Pick<ApplicationStage, 'name' | 'terminal'>>;
  };
  'company.create': Pick<Company, 'name' | 'website' | 'location'>;
  'company.update': Pick<Company, 'id' | 'name' | 'website' | 'location'>;
  'contact.create': Pick<Contact, 'companyId' | 'name' | 'title' | 'primaryEmail'>;
  'contact.update': Pick<Contact, 'id' | 'companyId' | 'name' | 'title' | 'primaryEmail'>;
  'applicationStage.create': Pick<ApplicationStage, 'name' | 'position' | 'terminal'>;
  'applicationStage.update': Pick<
    ApplicationStage,
    'id' | 'name' | 'position' | 'terminal' | 'archived'
  >;
  'applicationStage.transition.set': {
    fromStageId: string;
    toStageId: string;
    allowed: boolean;
  };
  'application.create': {
    companyId: string;
    role: string;
    stageId: string;
    sourceUrl?: string | null;
    appliedAt?: string | null;
    nextEventAt?: string | null;
  };
  'application.get': { id: string };
  'application.list': {
    query?: string;
    stageIds?: string[];
    companyId?: string;
    taskStatus?: ApplicationTask['status'];
    limit: number;
    cursor?: string;
  };
  'application.update': {
    id: string;
    companyId?: string;
    role?: string;
    sourceUrl?: string | null;
    appliedAt?: string | null;
    nextEventAt?: string | null;
  };
  'application.transition': {
    id: string;
    toStageId: string;
    note?: string | null;
  };
  'application.contact.link': {
    applicationId: string;
    contactId: string;
    relationship: string;
    primary: boolean;
  };
  'application.contact.unlink': { applicationId: string; contactId: string };
  'application.thread.link': Omit<ApplicationThreadLink, 'linkedAt'>;
  'application.thread.unlink': {
    applicationId: string;
    provider: ConnectorProvider;
    accountEmail: string;
    providerThreadId: string;
  };
  'application.note.create': Pick<ApplicationNote, 'applicationId' | 'body'>;
  'application.note.update': Pick<ApplicationNote, 'id' | 'body'>;
  'application.task.create': Omit<ApplicationTask, 'id' | 'createdAt' | 'updatedAt'>;
  'application.task.update': {
    id: string;
    title?: string;
    notes?: string | null;
    dueAt?: string | null;
    status?: ApplicationTask['status'];
  };
  'onboarding.complete': FounderSetupInput;
  'investor.get': { id: string };
  'investor.create': {
    name: string;
    kind: InvestorKind;
    website?: string;
    headquarters?: string;
    description?: string;
  };
  'investor.target': { id: string; target: boolean };
  'person.contact.add':
    | {
        personId: string;
        kind: 'work_email' | 'linkedin' | 'x';
        value: string;
        visibility: 'private' | 'public';
        sourceUrl?: string;
        contributionEligible: boolean;
      }
    | {
        personId: string;
        kind: 'personal_email';
        value: string;
        visibility: 'private';
        contributionEligible: false;
      };
  'pipeline.move': { investorId: string; stage: PipelineStage };
  'pipeline.amount': { investorId: string; expectedCheckUsd: number | null };
  'round.update': {
    stage: RoundState['stage'];
    targetAmount: number;
    targetCheckMinimum: number | null;
    targetCheckMaximum: number | null;
    sectors: string[];
    geographies: string[];
    narrative: string;
    status: RoundState['status'];
  };
  'task.create': Omit<TaskItem, 'id' | 'createdAt'>;
  'task.update': { id: string; status?: TaskItem['status']; title?: string; dueAt?: string | null };
  'meeting.create': Omit<MeetingItem, 'id'>;
  'meeting.update': { id: string; agenda: string | null; notes: string | null };
  'knowledge.save': Omit<KnowledgeItem, 'id' | 'updatedAt'> & { id?: string };
  'list.create': {
    name: string;
    description: string | null;
    memberFirmIds?: string[];
  };
  'list.update': {
    id: string;
    name: string;
    description: string | null;
    memberFirmIds: string[];
  };
  'draft.create': Pick<
    DraftMessage,
    'applicationId' | 'contactId' | 'provider' | 'accountEmail' | 'kind' | 'subject' | 'bodyText'
  > & {
    threadId?: string | null;
    replyToMessageId?: string | null;
  };
  'draft.update': { id: string; subject?: string; bodyText?: string };
  'draft.approve': { id: string; expectedContentHash: string };
  'draft.send': { id: string; expectedContentHash: string };
  'source.review': { id: string; decision: 'accept' | 'reject' };
  'connector.configure': {
    provider: ConnectorProvider;
    clientId: string;
    tenantId?: string;
    /** Optional Google confidential-client secret; sent only in this command payload. */
    clientSecret?: string;
    scopeProfile: ScopeProfile;
  };
  'connector.connect': { provider: ConnectorProvider };
  'connector.disconnect': { provider: ConnectorProvider };
  'connector.test': { provider: ConnectorProvider };
  'connector.syncCalendar': { provider: ConnectorProvider };
  'connector.syncMail': { provider: ConnectorProvider };
  'mail.review': { id: string };
  'communications.policy.update': {
    sendingPaused: boolean;
    dailySendLimit: number;
    hourlySendLimit: number;
    recipientDomainDailyLimit: number;
    recipientDomainCooldownMinutes: number;
    postalAddress: string | null;
    optOutText: string;
  };
  'suppression.add': {
    scope: SuppressionItem['scope'];
    value: string;
    reason: string;
  };
  'suppression.remove': { id: string };
  'agent.detect': { provider: AgentProvider };
  'agent.login': { provider: AgentProvider };
  'agent.logout': { provider: AgentProvider };
  'agent.credential.set': { provider: 'claude'; credential: string };
  'agent.credential.remove': { provider: 'claude' };
  'agent.subscription.set':
    | { provider: 'claude'; approved: true; approvalConfirmed: true }
    | { provider: 'claude'; approved: false };
  'agent.contextGrant.set': {
    provider: AgentProvider;
    contextClass: AgentContextGrant['contextClass'];
    granted: boolean;
  };
  'agent.run': { provider: AgentProvider; prompt: string; disclosedContextIds: string[] };
  'agent.cancel': { runId: string };
  'agent.proposal.review': {
    id: string;
    decision: 'apply' | 'reject' | 'convert_to_task';
  };
  'backup.export': { directory: string; password: string };
  'backup.restore': { path: string; password: string };
  'contribution.export': { directory: string };
  'data.importSeed': { path: string };
  'data.exportCsv': { directory: string; kind: 'investors' | 'people' | 'pipeline' | 'activity' };
  'data.reset': { confirmation: 'DELETE' };
  search: { query: string };
}

export interface CommandResultMap {
  'workspace.setup': AppBootstrap;
  'company.create': Company;
  'company.update': Company;
  'contact.create': Contact;
  'contact.update': Contact;
  'applicationStage.create': ApplicationStage;
  'applicationStage.update': ApplicationStage;
  'applicationStage.transition.set': { allowed: boolean };
  'application.create': ApplicationDetail;
  'application.get': ApplicationDetail;
  'application.list': { applications: ApplicationSummary[]; nextCursor: string | null };
  'application.update': ApplicationDetail;
  'application.transition': ApplicationDetail;
  'application.contact.link': ApplicationDetail;
  'application.contact.unlink': ApplicationDetail;
  'application.thread.link': ApplicationDetail;
  'application.thread.unlink': ApplicationDetail;
  'application.note.create': ApplicationNote;
  'application.note.update': ApplicationNote;
  'application.task.create': ApplicationTask;
  'application.task.update': ApplicationTask;
  'onboarding.complete': AppBootstrap;
  'investor.get': InvestorDetail;
  'investor.create': InvestorSummary;
  'investor.target': AppBootstrap;
  'person.contact.add': PersonSummary;
  'pipeline.move': AppBootstrap;
  'pipeline.amount': InvestorSummary;
  'round.update': RoundState;
  'task.create': TaskItem;
  'task.update': TaskItem;
  'meeting.create': MeetingItem;
  'meeting.update': MeetingItem;
  'knowledge.save': KnowledgeItem;
  'list.create': ListItem;
  'list.update': ListItem;
  'draft.create': DraftMessage;
  'draft.update': DraftMessage;
  'draft.approve': DraftMessage;
  'draft.send': DraftMessage;
  'source.review': SourceReviewItem;
  'connector.configure': ConnectorStatus;
  'connector.connect': ConnectorStatus;
  'connector.disconnect': ConnectorStatus;
  'connector.test': ConnectorStatus;
  'connector.syncCalendar': AppBootstrap;
  'connector.syncMail': AppBootstrap;
  'mail.review': MailEventItem;
  'communications.policy.update': CommunicationPolicy;
  'suppression.add': SuppressionItem;
  'suppression.remove': SuppressionItem;
  'agent.detect': AgentStatus;
  'agent.login': AgentStatus;
  'agent.logout': AgentStatus;
  'agent.credential.set': AgentStatus;
  'agent.credential.remove': AgentStatus;
  'agent.subscription.set': AgentStatus;
  'agent.contextGrant.set': AgentContextGrant[];
  'agent.run': { runId: string };
  'agent.cancel': { cancelled: boolean };
  'agent.proposal.review': AgentProposalReviewResult;
  'backup.export': { path: string };
  'backup.restore': AppBootstrap;
  'contribution.export': { databasePath: string; diffPath: string };
  'data.importSeed': { imported: number; skipped: number; updated: number };
  'data.exportCsv': { path: string };
  'data.reset': { scheduled: true };
  search: Array<{
    id: string;
    kind: 'investor' | 'person' | 'task' | 'meeting' | 'knowledge';
    title: string;
    subtitle: string;
    href: string;
  }>;
}

export interface OutreachrBridge {
  bootstrap: () => Promise<AppBootstrap>;
  command: <K extends keyof CommandMap>(
    command: K,
    payload: CommandMap[K],
  ) => Promise<CommandResultMap[K]>;
  listMailThreads: (request: ListMailThreadsRequest) => Promise<MailThreadListPage>;
  getMailThread: (request: GetMailThreadRequest) => Promise<MailThreadPage>;
  cancelMailRequest: (requestId: string) => Promise<void>;
  selectFile: (filters?: Array<{ name: string; extensions: string[] }>) => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
  revealPath: (path: string) => Promise<void>;
  copyText: (text: string) => Promise<void>;
  openLegal: (document: 'license' | 'notice' | 'third-party') => Promise<void>;
  onAgentEvent: (listener: (event: AgentEvent) => void) => () => void;
}

declare global {
  interface Window {
    outreachr: OutreachrBridge;
  }
}
