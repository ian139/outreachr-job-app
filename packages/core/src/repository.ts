import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CoreVault } from './database.js';
import {
  AgentProposalSchema,
  AgentRunSchema,
  ApplicationDraftCreateSchema,
  ApplicationNoteCreateSchema,
  ApplicationNoteUpdateSchema,
  ApplicationStageSchema,
  ApplicationStageTransitionSetSchema,
  ApplicationTaskCreateSchema,
  ApplicationTaskUpdateSchema,
  ClaimSchema,
  CompanySchema,
  ConnectorConfigSchema,
  ContactMethodSchema,
  ContactSchema,
  CreateJobApplicationSchema,
  FirmSchema,
  FounderProfileSchema,
  FundSchema,
  IdSchema,
  KnowledgeItemSchema,
  LinkApplicationContactSchema,
  LinkApplicationThreadSchema,
  ListJobApplicationsSchema,
  ListSchema,
  MeetingSchema,
  MessageDraftSchema,
  normalizeDomain,
  normalizeEmail,
  NoteSchema,
  PersonSchema,
  RoundSchema,
  SourceSchema,
  stableJson,
  SuppressionSchema,
  TargetSchema,
  TaskSchema,
  TransitionJobApplicationSchema,
  UnlinkApplicationContactSchema,
  UnlinkApplicationThreadSchema,
  UpdateJobApplicationSchema,
  WorkspaceSetupSchema,
  type AgentProposalInput,
  type AgentRunInput,
  type ApplicationDraftCreateInput,
  type ApplicationNoteCreateInput,
  type ApplicationNoteUpdateInput,
  type ApplicationStageInput,
  type ApplicationStageTransitionSetInput,
  type ApplicationTaskCreateInput,
  type ApplicationTaskUpdateInput,
  type ClaimInput,
  type CompanyInput,
  type ConnectorConfigInput,
  type ContactInput,
  type ContactMethodInput,
  type CreateJobApplicationInput,
  type FirmInput,
  type FounderProfileInput,
  type FundInput,
  type KnowledgeItemInput,
  type LinkApplicationContactInput,
  type LinkApplicationThreadInput,
  type ListInput,
  type ListJobApplicationsInput,
  type MeetingInput,
  type MessageDraftInput,
  type NoteInput,
  type PersonInput,
  type RoundInput,
  type SourceInput,
  type SuppressionInput,
  type TargetInput,
  type TaskInput,
  type TransitionJobApplicationInput,
  type UnlinkApplicationContactInput,
  type UnlinkApplicationThreadInput,
  type UpdateJobApplicationInput,
  type WorkspaceSetupInput,
} from './validation.js';

const TagInputSchema = z.object({
  id: IdSchema,
  kind: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(1000),
  isPublic: z.boolean().default(false),
  contributionEligible: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

const TagAssignmentSchema = z.object({
  entityType: z.enum(['firm', 'person', 'fund']),
  entityId: IdSchema,
  tagId: IdSchema,
  sourceId: IdSchema.nullable().default(null),
  isPublic: z.boolean().default(false),
  contributionEligible: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }),
});

const SourceAssignmentSchema = z.object({
  entityType: z.enum(['firm', 'person', 'fund']),
  entityId: IdSchema,
  sourceId: IdSchema,
  sourceRole: z.string().trim().min(1).max(200),
  evidenceGranularity: z.string().trim().min(1).max(200),
  isPublic: z.boolean().default(false),
  contributionEligible: z.boolean().default(false),
  createdAt: z.string().datetime({ offset: true }),
});

export interface ApprovalRecord {
  id: string;
  messageId: string;
  contentSha256: string;
  provider: 'google' | 'microsoft';
  senderAddress: string;
  senderNormalized: string;
  messageKind: 'initial' | 'follow_up' | 'intro_request' | 'reply';
  providerThreadId: string | null;
  approvedAt: string;
  expiresAt: string | null;
  status: string;
}

export interface SendReservation {
  id: string;
  messageId: string;
  recipientAddress: string;
  recipientNormalized: string;
  recipientPersonId: string;
  provider: 'google' | 'microsoft';
  senderAddress: string;
  senderNormalized: string;
  messageKind: 'initial' | 'follow_up' | 'intro_request' | 'reply';
  providerThreadId: string | null;
  status: 'reserved';
}

const MailboxSendReconciliationSchema = z.object({
  operationKey: IdSchema.refine((value) => value.startsWith('send:'), {
    message: 'Mailbox send operation keys must use the send: namespace',
  }),
  provider: z.enum(['google', 'microsoft']),
  providerMessageId: z.string().trim().min(1).max(4_096),
  providerThreadId: z.string().trim().min(1).max(4_096).nullable().default(null),
  recipientAddresses: z.array(z.string().trim().email().max(320)).min(1).max(500),
  subject: z.string().max(10_000),
  occurredAt: z.string().datetime({ offset: true }),
  reconciledAt: z.string().datetime({ offset: true }),
});

export const DEFAULT_OPT_OUT_TEXT =
  'If you prefer no further email from me, reply "opt out" and I will not contact you again.';

const CommunicationSettingsSchema = z.object({
  sendingPaused: z.boolean(),
  dailySendLimit: z.number().int().min(1).max(50),
  hourlySendLimit: z.number().int().min(1).max(20),
  recipientDomainDailyLimit: z.number().int().min(1).max(20),
  recipientDomainCooldownMinutes: z.number().int().min(1).max(1_440),
  postalAddress: z.string().trim().min(1).max(1_000).nullable(),
  optOutText: z.string().trim().min(1).max(1_000),
});

export interface CommunicationSettings {
  sendingPaused: boolean;
  dailySendLimit: number;
  hourlySendLimit: number;
  recipientDomainDailyLimit: number;
  recipientDomainCooldownMinutes: number;
  postalAddress: string | null;
  optOutText: string;
}

export function buildCommunicationFooter(input: {
  founderName?: string | null;
  companyName?: string | null;
  postalAddress: string;
  optOutText: string;
}): string {
  return [
    '—',
    input.founderName?.trim(),
    input.companyName?.trim(),
    input.postalAddress.trim(),
    input.optOutText.trim(),
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

export function appendCommunicationFooter(
  bodyText: string,
  input: Parameters<typeof buildCommunicationFooter>[0],
): string {
  const postalAddress = input.postalAddress.trim();
  const optOutText = input.optOutText.trim();
  if (bodyText.includes(postalAddress) && bodyText.includes(optOutText)) return bodyText;
  return `${bodyText.trimEnd()}\n\n${buildCommunicationFooter(input)}`;
}

export interface TargetListItem {
  id: string;
  roundId: string;
  stage: string;
  disposition: 'not_now' | null;
  priority: number;
  fitScore: number | null;
  expectedCheckUsd: number | null;
  firmId: string | null;
  firmName: string | null;
  personId: string | null;
  personName: string | null;
  nextActionAt: string | null;
}

function bool(value: boolean): number {
  return value ? 1 : 0;
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

interface AuditEntryInput {
  occurredAt: string;
  actorType: string;
  actorId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  detail?: unknown;
}

interface AuditRow {
  id: number;
  occurred_at: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  detail_json: string;
}

function auditEntryHash(row: AuditRow, previousHash: string | null): string {
  return sha256(
    stableJson({
      version: 1,
      previousHash,
      auditId: row.id,
      occurredAt: row.occurred_at,
      actorType: row.actor_type,
      actorId: row.actor_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      detailJson: row.detail_json,
    }),
  );
}

export function appendAuditEntry(vault: CoreVault, input: AuditEntryInput): number {
  const detailJson = stableJson(input.detail ?? {});
  vault.run('SAVEPOINT outreachr_audit_append');
  try {
    vault.run(
      'INSERT INTO audit_log(occurred_at,actor_type,actor_id,action,entity_type,entity_id,detail_json) VALUES (?,?,?,?,?,?,?)',
      [
        input.occurredAt,
        input.actorType,
        input.actorId ?? null,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        detailJson,
      ],
    );
    const auditId = Number(vault.scalar('SELECT last_insert_rowid()'));
    const previousHash = vault.scalar(
      'SELECT entry_hash FROM audit_chain ORDER BY sequence DESC LIMIT 1',
    );
    const row: AuditRow = {
      id: auditId,
      occurred_at: input.occurredAt,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      detail_json: detailJson,
    };
    vault.run(
      'INSERT INTO audit_chain(audit_id,previous_hash,entry_hash,created_at) VALUES (?,?,?,?)',
      [
        auditId,
        typeof previousHash === 'string' ? previousHash : null,
        auditEntryHash(row, typeof previousHash === 'string' ? previousHash : null),
        input.occurredAt,
      ],
    );
    vault.run('RELEASE SAVEPOINT outreachr_audit_append');
    return auditId;
  } catch (error) {
    vault.run('ROLLBACK TO SAVEPOINT outreachr_audit_append');
    vault.run('RELEASE SAVEPOINT outreachr_audit_append');
    throw error;
  }
}

export function backfillAuditChain(vault: CoreVault): void {
  const rows =
    vault.all<AuditRow>(`SELECT a.id,a.occurred_at,a.actor_type,a.actor_id,a.action,a.entity_type,a.entity_id,a.detail_json
    FROM audit_log a LEFT JOIN audit_chain c ON c.audit_id=a.id
    WHERE c.audit_id IS NULL ORDER BY a.id`);
  let previousHash = vault.scalar(
    'SELECT entry_hash FROM audit_chain ORDER BY sequence DESC LIMIT 1',
  );
  for (const row of rows) {
    const previous = typeof previousHash === 'string' ? previousHash : null;
    const entryHash = auditEntryHash(row, previous);
    vault.run(
      'INSERT INTO audit_chain(audit_id,previous_hash,entry_hash,created_at) VALUES (?,?,?,?)',
      [row.id, previous, entryHash, row.occurred_at],
    );
    previousHash = entryHash;
  }
}

export function verifyAuditChain(vault: CoreVault): {
  ok: boolean;
  entries: number;
  errorAt: number | null;
} {
  const rows = vault.all<
    AuditRow & { sequence: number; previous_hash: string | null; entry_hash: string }
  >(`SELECT c.sequence,c.previous_hash,c.entry_hash,
    a.id,a.occurred_at,a.actor_type,a.actor_id,a.action,a.entity_type,a.entity_id,a.detail_json
    FROM audit_chain c JOIN audit_log a ON a.id=c.audit_id ORDER BY c.sequence`);
  let previousHash: string | null = null;
  for (const row of rows) {
    if (
      row.previous_hash !== previousHash ||
      row.entry_hash !== auditEntryHash(row, previousHash)
    ) {
      return { ok: false, entries: rows.length, errorAt: row.sequence };
    }
    previousHash = row.entry_hash;
  }
  const auditCount = Number(vault.scalar('SELECT COUNT(*) FROM audit_log') ?? 0);
  return {
    ok: rows.length === auditCount,
    entries: rows.length,
    errorAt: rows.length === auditCount ? null : rows.length + 1,
  };
}

function nullableJson(value: unknown): string {
  return stableJson(value);
}

export function approvalContentHash(message: {
  recipientAddress: string;
  recipientPersonId?: string | null;
  provider: 'google' | 'microsoft';
  senderAddress: string;
  messageKind: 'initial' | 'follow_up' | 'intro_request' | 'reply';
  providerThreadId?: string | null;
  subject: string;
  bodyText: string;
  attachments: unknown;
}): string {
  return sha256(
    stableJson({
      version: 2,
      recipientAddress: normalizeEmail(message.recipientAddress),
      recipientPersonId: message.recipientPersonId ?? null,
      provider: message.provider,
      senderAddress: normalizeEmail(message.senderAddress),
      messageKind: message.messageKind,
      providerThreadId: message.providerThreadId?.trim() || null,
      subject: message.subject,
      bodyText: message.bodyText,
      attachments: message.attachments,
    }),
  );
}

export interface WorkspaceProfile {
  id: string;
  displayName: string;
  primaryEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSetupResult {
  profile: WorkspaceProfile;
  stages: ApplicationStageRecord[];
}

export interface CompanyRecord {
  id: string;
  name: string;
  website: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactRecord {
  id: string;
  companyId: string | null;
  name: string;
  title: string | null;
  primaryEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApplicationStageRecord {
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
  provider: 'google' | 'microsoft';
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

export interface ApplicationContactLink {
  contact: ContactRecord;
  relationship: string;
  primary: boolean;
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
  company: CompanyRecord;
  contacts: Array<ContactRecord & { relationship: string; primary: boolean }>;
  threads: ApplicationThreadLink[];
  notes: ApplicationNote[];
  tasks: ApplicationTask[];
  stageHistory: ApplicationStageHistoryItem[];
}

export interface ApplicationListPage {
  applications: ApplicationSummary[];
  nextCursor: string | null;
}

export interface ApplicationDraftRecord {
  id: string;
  applicationId: string;
  contactId: string;
  provider: 'google' | 'microsoft';
  accountEmail: string;
  recipientName: string;
  recipientEmail: string;
  kind: 'initial' | 'reply';
  subject: string;
  bodyText: string;
  threadId: string | null;
  replyToMessageId: string | null;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

function likeEscaped(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function encodeApplicationCursor(updatedAt: string, id: string): string {
  return Buffer.from(stableJson({ u: updatedAt, i: id })).toString('base64url');
}

function decodeApplicationCursor(cursor: string): { updatedAt: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      u?: unknown;
      i?: unknown;
    };
    if (typeof parsed.u !== 'string' || typeof parsed.i !== 'string') return null;
    return { updatedAt: parsed.u, id: parsed.i };
  } catch {
    return null;
  }
}

interface ApplicationSummaryRow {
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

const APPLICATION_SUMMARY_SELECT = `SELECT j.id,j.company_id AS companyId,c.name AS companyName,j.role,j.stage_id AS stageId,
  s.name AS stageName,j.source_url AS sourceUrl,j.applied_at AS appliedAt,j.next_event_at AS nextEventAt,
  j.created_at AS createdAt,j.updated_at AS updatedAt
FROM job_applications j
JOIN companies c ON c.id=j.company_id
JOIN application_stages s ON s.id=j.stage_id`;

export class OutreachrRepository {
  constructor(readonly vault: CoreVault) {}

  private audit(
    action: string,
    entityType: string | null,
    entityId: string | null,
    detail: unknown,
    at: string,
    actorType = 'founder',
    actorId: string | null = null,
  ): void {
    appendAuditEntry(this.vault, {
      occurredAt: at,
      actorType,
      actorId,
      action,
      entityType,
      entityId,
      detail,
    });
  }

  upsertFounderProfile(input: FounderProfileInput): void {
    const value = FounderProfileSchema.parse(input);
    this.vault.run(
      `INSERT INTO founder_profiles(id,full_name,preferred_name,work_email,company_name,company_url,location,bio,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      full_name=excluded.full_name,preferred_name=excluded.preferred_name,work_email=excluded.work_email,
      company_name=excluded.company_name,company_url=excluded.company_url,location=excluded.location,bio=excluded.bio,updated_at=excluded.updated_at`,
      [
        value.id,
        value.fullName,
        value.preferredName,
        value.workEmail,
        value.companyName,
        value.companyUrl,
        value.location,
        value.bio,
        value.createdAt,
        value.updatedAt,
      ],
    );
    this.audit('founder_profile.upsert', 'founder_profile', value.id, {}, value.updatedAt);
  }

  communicationSettings(): CommunicationSettings {
    const row = this.vault.one<{
      sending_paused: number;
      daily_send_limit: number;
      hourly_send_limit: number;
      recipient_domain_daily_limit: number;
      recipient_domain_cooldown_minutes: number;
      postal_address: string | null;
      opt_out_text: string;
    }>(
      `SELECT sending_paused,daily_send_limit,hourly_send_limit,
      recipient_domain_daily_limit,recipient_domain_cooldown_minutes,
      postal_address,opt_out_text FROM communication_settings WHERE id='global'`,
    );
    if (!row) throw new Error('Global communication settings are missing');
    return {
      sendingPaused: row.sending_paused === 1,
      dailySendLimit: row.daily_send_limit,
      hourlySendLimit: row.hourly_send_limit,
      recipientDomainDailyLimit: row.recipient_domain_daily_limit,
      recipientDomainCooldownMinutes: row.recipient_domain_cooldown_minutes,
      postalAddress: row.postal_address,
      optOutText: row.opt_out_text,
    };
  }

  updateCommunicationSettings(input: CommunicationSettings, updatedAt: string): void {
    const value = CommunicationSettingsSchema.parse(input);
    const normalized = {
      ...value,
      postalAddress: value.postalAddress?.trim() || null,
      optOutText: value.optOutText.trim(),
    };
    this.vault.transaction(() => {
      this.vault.run(
        `UPDATE communication_settings SET sending_paused=?,daily_send_limit=?,
        hourly_send_limit=?,recipient_domain_daily_limit=?,
        recipient_domain_cooldown_minutes=?,postal_address=?,opt_out_text=?,updated_at=?
        WHERE id='global'`,
        [
          bool(normalized.sendingPaused),
          normalized.dailySendLimit,
          normalized.hourlySendLimit,
          normalized.recipientDomainDailyLimit,
          normalized.recipientDomainCooldownMinutes,
          normalized.postalAddress,
          normalized.optOutText,
          updatedAt,
        ],
      );
      this.audit(
        'communication.policy_updated',
        'communication_settings',
        'global',
        {
          sendingPaused: normalized.sendingPaused,
          dailySendLimit: normalized.dailySendLimit,
          hourlySendLimit: normalized.hourlySendLimit,
          recipientDomainDailyLimit: normalized.recipientDomainDailyLimit,
          recipientDomainCooldownMinutes: normalized.recipientDomainCooldownMinutes,
          postalAddressConfigured: Boolean(normalized.postalAddress),
          optOutTextConfigured: Boolean(normalized.optOutText),
        },
        updatedAt,
      );
    });
  }

  messageComplianceIssues(messageId: string): string[] {
    IdSchema.parse(messageId);
    const message = this.vault.one<{
      message_kind: string | null;
      provider_thread_id: string | null;
      body_text: string;
      attachments_json: string;
    }>(
      'SELECT message_kind,provider_thread_id,body_text,attachments_json FROM messages WHERE id=?',
      [messageId],
    );
    if (!message) return [`Message ${messageId} does not exist`];
    const policy = this.communicationSettings();
    const issues: string[] = [];
    if (!policy.postalAddress) {
      issues.push('Add a complete sender postal address in Communication safety before approval.');
    } else if (!message.body_text.includes(policy.postalAddress)) {
      issues.push('The message body must include the exact configured sender postal address.');
    }
    if (!policy.optOutText) {
      issues.push('Configure opt-out wording in Communication safety before approval.');
    } else if (!message.body_text.includes(policy.optOutText)) {
      issues.push('The message body must include the exact configured opt-out wording.');
    }
    if (message.message_kind === 'initial' && message.provider_thread_id) {
      issues.push('Initial outreach must not be attached to an existing provider thread.');
    }
    let attachments: unknown;
    try {
      attachments = JSON.parse(message.attachments_json) as unknown;
    } catch {
      issues.push('The draft attachment manifest is invalid.');
    }
    if (message.message_kind === 'initial' && (!Array.isArray(attachments) || attachments.length)) {
      issues.push('Initial outreach cannot include attachments.');
    }
    return issues;
  }

  upsertRound(input: RoundInput): void {
    const value = RoundSchema.parse(input);
    this.vault.run(
      `INSERT INTO rounds(id,founder_profile_id,name,stage,target_amount_usd,minimum_check_usd,maximum_check_usd,status,thesis,opened_on,closed_on,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,stage=excluded.stage,target_amount_usd=excluded.target_amount_usd,minimum_check_usd=excluded.minimum_check_usd,
      maximum_check_usd=excluded.maximum_check_usd,status=excluded.status,thesis=excluded.thesis,opened_on=excluded.opened_on,closed_on=excluded.closed_on,updated_at=excluded.updated_at`,
      [
        value.id,
        value.founderProfileId,
        value.name,
        value.stage,
        value.targetAmountUsd,
        value.minimumCheckUsd,
        value.maximumCheckUsd,
        value.status,
        value.thesis,
        value.openedOn,
        value.closedOn,
        value.createdAt,
        value.updatedAt,
      ],
    );
    this.audit(
      'round.upsert',
      'round',
      value.id,
      { stage: value.stage, status: value.status },
      value.updatedAt,
    );
  }

  upsertFirm(input: FirmInput): void {
    const value = FirmSchema.parse(input);
    this.vault.run(
      `INSERT INTO firms(id,name,normalized_name,website,investor_type,headquarters,description,is_public,contribution_eligible,origin,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,normalized_name=excluded.normalized_name,website=excluded.website,investor_type=excluded.investor_type,
      headquarters=excluded.headquarters,description=excluded.description,is_public=excluded.is_public,
      contribution_eligible=excluded.contribution_eligible,origin=excluded.origin,updated_at=excluded.updated_at`,
      [
        value.id,
        value.name,
        normalizedName(value.name),
        value.website,
        value.investorType,
        value.headquarters,
        value.description,
        bool(value.isPublic),
        bool(value.contributionEligible),
        value.origin,
        value.createdAt,
        value.updatedAt,
      ],
    );
  }

  upsertPerson(input: PersonInput): void {
    const value = PersonSchema.parse(input);
    this.vault.run(
      `INSERT INTO people(id,firm_id,full_name,normalized_name,title,city,bio,is_investor,is_public,contribution_eligible,origin,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      firm_id=excluded.firm_id,full_name=excluded.full_name,normalized_name=excluded.normalized_name,title=excluded.title,city=excluded.city,bio=excluded.bio,
      is_investor=excluded.is_investor,is_public=excluded.is_public,contribution_eligible=excluded.contribution_eligible,origin=excluded.origin,updated_at=excluded.updated_at`,
      [
        value.id,
        value.firmId,
        value.fullName,
        normalizedName(value.fullName),
        value.title,
        value.city,
        value.bio,
        bool(value.isInvestor),
        bool(value.isPublic),
        bool(value.contributionEligible),
        value.origin,
        value.createdAt,
        value.updatedAt,
      ],
    );
  }

  upsertFund(input: FundInput): void {
    const value = FundSchema.parse(input);
    this.vault.run(
      `INSERT INTO funds(id,firm_id,name,vintage_year,size_usd,announced_on,is_public,contribution_eligible,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET firm_id=excluded.firm_id,name=excluded.name,vintage_year=excluded.vintage_year,
      size_usd=excluded.size_usd,announced_on=excluded.announced_on,is_public=excluded.is_public,contribution_eligible=excluded.contribution_eligible,updated_at=excluded.updated_at`,
      [
        value.id,
        value.firmId,
        value.name,
        value.vintageYear,
        value.sizeUsd,
        value.announcedOn,
        bool(value.isPublic),
        bool(value.contributionEligible),
        value.createdAt,
        value.updatedAt,
      ],
    );
  }

  upsertSource(input: SourceInput): void {
    const value = SourceSchema.parse(input);
    this.vault.run(
      `INSERT INTO sources(id,canonical_url,title,publisher,source_type,retrieved_at,published_on,rights_class,redistribution_status,attribution,excerpt,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical_url=excluded.canonical_url,title=excluded.title,publisher=excluded.publisher,
      source_type=excluded.source_type,retrieved_at=excluded.retrieved_at,published_on=excluded.published_on,rights_class=excluded.rights_class,
      redistribution_status=excluded.redistribution_status,attribution=excluded.attribution,excerpt=excluded.excerpt,updated_at=excluded.updated_at`,
      [
        value.id,
        value.canonicalUrl,
        value.title,
        value.publisher,
        value.sourceType,
        value.retrievedAt,
        value.publishedOn,
        value.rightsClass,
        value.redistributionStatus,
        value.attribution,
        value.excerpt,
        value.createdAt,
        value.updatedAt,
      ],
    );
  }

  upsertClaim(input: ClaimInput): void {
    const value = ClaimSchema.parse(input);
    this.vault.run(
      `INSERT INTO claims(id,entity_type,entity_id,field,value_json,source_id,confidence,observed_at,status,is_public,contribution_eligible,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET entity_type=excluded.entity_type,entity_id=excluded.entity_id,field=excluded.field,
      value_json=excluded.value_json,source_id=excluded.source_id,confidence=excluded.confidence,observed_at=excluded.observed_at,status=excluded.status,
      is_public=excluded.is_public,contribution_eligible=excluded.contribution_eligible,updated_at=excluded.updated_at`,
      [
        value.id,
        value.entityType,
        value.entityId,
        value.field,
        nullableJson(value.valueJson),
        value.sourceId,
        value.confidence,
        value.observedAt,
        value.status,
        bool(value.isPublic),
        bool(value.contributionEligible),
        value.createdAt,
        value.updatedAt,
      ],
    );
  }

  attachSource(input: z.input<typeof SourceAssignmentSchema>): void {
    const value = SourceAssignmentSchema.parse(input);
    this.vault.run(
      `INSERT INTO entity_sources(entity_type,entity_id,source_id,source_role,evidence_granularity,is_public,contribution_eligible,created_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(entity_type,entity_id,source_id,source_role) DO UPDATE SET
      evidence_granularity=excluded.evidence_granularity,is_public=excluded.is_public,contribution_eligible=excluded.contribution_eligible`,
      [
        value.entityType,
        value.entityId,
        value.sourceId,
        value.sourceRole,
        value.evidenceGranularity,
        bool(value.isPublic),
        bool(value.contributionEligible),
        value.createdAt,
      ],
    );
  }

  upsertContactMethod(input: ContactMethodInput): void {
    const value = ContactMethodSchema.parse(input);
    const normalized = value.kind.endsWith('email')
      ? normalizeEmail(value.value)
      : value.value.trim().toLocaleLowerCase('en-US');
    this.vault.run(
      `INSERT INTO contact_methods(id,person_id,kind,value,normalized_value,label,source_id,visibility,contribution_eligible,is_primary,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET person_id=excluded.person_id,kind=excluded.kind,value=excluded.value,
      normalized_value=excluded.normalized_value,label=excluded.label,source_id=excluded.source_id,visibility=excluded.visibility,
      contribution_eligible=excluded.contribution_eligible,is_primary=excluded.is_primary,updated_at=excluded.updated_at`,
      [
        value.id,
        value.personId,
        value.kind,
        value.value,
        normalized,
        value.label,
        value.sourceId,
        value.visibility,
        bool(value.contributionEligible),
        bool(value.isPrimary),
        value.createdAt,
        value.updatedAt,
      ],
    );
  }

  upsertTag(input: z.input<typeof TagInputSchema>): void {
    const value = TagInputSchema.parse(input);
    this.vault.run(
      `INSERT INTO tags(id,kind,value,normalized_value,is_public,contribution_eligible,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,value=excluded.value,normalized_value=excluded.normalized_value,
      is_public=excluded.is_public,contribution_eligible=excluded.contribution_eligible,updated_at=excluded.updated_at`,
      [
        value.id,
        value.kind,
        value.value,
        normalizedName(value.value),
        bool(value.isPublic),
        bool(value.contributionEligible),
        value.createdAt,
        value.updatedAt,
      ],
    );
  }

  attachTag(input: z.input<typeof TagAssignmentSchema>): void {
    const value = TagAssignmentSchema.parse(input);
    this.vault.run(
      `INSERT INTO entity_tags(entity_type,entity_id,tag_id,source_id,is_public,contribution_eligible,created_at)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(entity_type,entity_id,tag_id) DO UPDATE SET source_id=excluded.source_id,is_public=excluded.is_public,contribution_eligible=excluded.contribution_eligible`,
      [
        value.entityType,
        value.entityId,
        value.tagId,
        value.sourceId,
        bool(value.isPublic),
        bool(value.contributionEligible),
        value.createdAt,
      ],
    );
  }

  upsertTarget(input: TargetInput): void {
    const value = TargetSchema.parse(input);
    const prior = this.vault.one<{ stage: string }>('SELECT stage FROM targets WHERE id = ?', [
      value.id,
    ]);
    this.vault.transaction(() => {
      this.vault.run(
        `INSERT INTO targets(id,round_id,firm_id,person_id,stage,disposition,priority,fit_score,expected_check_usd,owner_note,next_action_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET round_id=excluded.round_id,firm_id=excluded.firm_id,person_id=excluded.person_id,
        stage=excluded.stage,disposition=excluded.disposition,priority=excluded.priority,fit_score=excluded.fit_score,expected_check_usd=excluded.expected_check_usd,
        owner_note=excluded.owner_note,next_action_at=excluded.next_action_at,updated_at=excluded.updated_at`,
        [
          value.id,
          value.roundId,
          value.firmId,
          value.personId,
          value.stage,
          value.disposition,
          value.priority,
          value.fitScore,
          value.expectedCheckUsd,
          value.ownerNote,
          value.nextActionAt,
          value.createdAt,
          value.updatedAt,
        ],
      );
      if (!prior || prior.stage !== value.stage) {
        this.vault.run(
          'INSERT INTO pipeline_events(id,target_id,from_stage,to_stage,reason,occurred_at) VALUES (?,?,?,?,?,?)',
          [
            randomUUID(),
            value.id,
            prior?.stage ?? null,
            value.stage,
            prior ? 'stage update' : 'target created',
            value.updatedAt,
          ],
        );
      }
      this.audit('target.upsert', 'target', value.id, { stage: value.stage }, value.updatedAt);
    });
  }

  listTargets(roundId: string): TargetListItem[] {
    return this.vault.all<TargetListItem>(
      `SELECT t.id,t.round_id AS roundId,t.stage,t.disposition,t.priority,t.fit_score AS fitScore,t.expected_check_usd AS expectedCheckUsd,
      t.firm_id AS firmId,f.name AS firmName,t.person_id AS personId,p.full_name AS personName,t.next_action_at AS nextActionAt
      FROM targets t LEFT JOIN firms f ON f.id=t.firm_id LEFT JOIN people p ON p.id=t.person_id
      WHERE t.round_id=? ORDER BY t.priority DESC, COALESCE(t.fit_score,-1) DESC, t.created_at`,
      [IdSchema.parse(roundId)],
    );
  }

  createMessageDraft(input: MessageDraftInput): void {
    const value = MessageDraftSchema.parse(input);
    const normalized = normalizeEmail(value.recipientAddress);
    this.vault.run(
      `INSERT INTO messages(id,round_id,target_id,recipient_person_id,recipient_address,recipient_normalized,provider,sender_address,sender_normalized,message_kind,provider_thread_id,subject,body_text,attachments_json,state,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft',?,?) ON CONFLICT(id) DO UPDATE SET round_id=excluded.round_id,target_id=excluded.target_id,
      recipient_person_id=excluded.recipient_person_id,recipient_address=excluded.recipient_address,recipient_normalized=excluded.recipient_normalized,
      provider=excluded.provider,sender_address=excluded.sender_address,sender_normalized=excluded.sender_normalized,
      message_kind=excluded.message_kind,provider_thread_id=excluded.provider_thread_id,
      subject=excluded.subject,body_text=excluded.body_text,attachments_json=excluded.attachments_json,updated_at=excluded.updated_at`,
      [
        value.id,
        value.roundId,
        value.targetId,
        value.recipientPersonId,
        value.recipientAddress,
        normalized,
        value.provider,
        value.senderAddress,
        normalizeEmail(value.senderAddress),
        value.messageKind,
        value.providerThreadId,
        value.subject,
        value.bodyText,
        stableJson(value.attachments),
        value.createdAt,
        value.updatedAt,
      ],
    );
    this.audit(
      'message.draft_saved',
      'message',
      value.id,
      {
        recipient: normalized,
        provider: value.provider,
        sender: normalizeEmail(value.senderAddress),
        messageKind: value.messageKind,
        providerThreadId: value.providerThreadId,
      },
      value.updatedAt,
    );
  }

  approveMessage(
    messageId: string,
    approvedAt: string,
    options: { approvedBy?: string; expiresAt?: string | null; approvalId?: string } = {},
  ): ApprovalRecord {
    IdSchema.parse(messageId);
    const message = this.vault.one<{
      id: string;
      recipient_address: string;
      recipient_person_id: string | null;
      provider: 'google' | 'microsoft' | null;
      sender_address: string | null;
      sender_normalized: string | null;
      message_kind: 'initial' | 'follow_up' | 'intro_request' | 'reply' | null;
      provider_thread_id: string | null;
      subject: string;
      body_text: string;
      attachments_json: string;
    }>(
      'SELECT id,recipient_address,recipient_person_id,provider,sender_address,sender_normalized,message_kind,provider_thread_id,subject,body_text,attachments_json FROM messages WHERE id=?',
      [messageId],
    );
    if (!message) throw new Error(`Message ${messageId} does not exist`);
    if (
      !message.provider ||
      !message.sender_address ||
      !message.sender_normalized ||
      !message.message_kind
    ) {
      throw new Error('Message delivery identity is incomplete');
    }
    if (normalizeEmail(message.sender_address) !== message.sender_normalized) {
      throw new Error('Message sender identity is not canonical');
    }
    const complianceIssues = this.messageComplianceIssues(messageId);
    if (complianceIssues.length) {
      throw new Error(`Message is not ready for approval: ${complianceIssues.join(' ')}`);
    }
    const attachments = JSON.parse(message.attachments_json) as unknown;
    const contentSha256 = approvalContentHash({
      recipientAddress: message.recipient_address,
      recipientPersonId: message.recipient_person_id,
      provider: message.provider,
      senderAddress: message.sender_address,
      messageKind: message.message_kind,
      providerThreadId: message.provider_thread_id,
      subject: message.subject,
      bodyText: message.body_text,
      attachments,
    });
    const approvalId = options.approvalId ?? `approval:${randomUUID()}`;
    this.vault.transaction(() => {
      this.vault.run(
        "UPDATE approvals SET status='revoked',revoked_at=? WHERE message_id=? AND status='active'",
        [approvedAt, messageId],
      );
      this.vault.run(
        "INSERT INTO approvals(id,message_id,content_sha256,provider,sender_address,sender_normalized,message_kind,provider_thread_id,approved_by,approved_at,expires_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,'active')",
        [
          approvalId,
          messageId,
          contentSha256,
          message.provider,
          message.sender_address,
          message.sender_normalized,
          message.message_kind,
          message.provider_thread_id,
          options.approvedBy ?? 'founder',
          approvedAt,
          options.expiresAt ?? null,
        ],
      );
      this.vault.run("UPDATE messages SET state='approved',updated_at=? WHERE id=?", [
        approvedAt,
        messageId,
      ]);
      this.audit(
        'message.approved',
        'message',
        messageId,
        {
          approvalId,
          contentSha256,
          provider: message.provider,
          sender: message.sender_normalized,
          messageKind: message.message_kind,
          providerThreadId: message.provider_thread_id,
        },
        approvedAt,
      );
    });
    return {
      id: approvalId,
      messageId,
      contentSha256,
      provider: message.provider,
      senderAddress: message.sender_address,
      senderNormalized: message.sender_normalized,
      messageKind: message.message_kind,
      providerThreadId: message.provider_thread_id,
      approvedAt,
      expiresAt: options.expiresAt ?? null,
      status: 'active',
    };
  }

  addSuppression(input: SuppressionInput): void {
    const value = SuppressionSchema.parse(input);
    const normalized =
      value.scope === 'email'
        ? normalizeEmail(value.value)
        : value.scope === 'domain'
          ? normalizeDomain(value.value)
          : value.value.trim();
    this.vault.run(
      `INSERT INTO suppressions(id,scope,value,normalized_value,reason,source,active,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(scope,normalized_value) DO UPDATE SET value=excluded.value,reason=excluded.reason,source=excluded.source,active=excluded.active,updated_at=excluded.updated_at`,
      [
        value.id,
        value.scope,
        value.value,
        normalized,
        value.reason,
        value.source,
        bool(value.active),
        value.createdAt,
        value.updatedAt,
      ],
    );
    this.audit(
      'suppression.upsert',
      'suppression',
      value.id,
      { scope: value.scope, value: normalized, active: value.active },
      value.updatedAt,
    );
  }

  reserveApprovedSend(
    messageId: string,
    provider: 'google' | 'microsoft',
    authenticatedSenderAddress: string,
    reservedAt: string,
    ledgerId = `send:${randomUUID()}`,
  ): SendReservation {
    IdSchema.parse(messageId);
    const ProviderSchema = z.enum(['google', 'microsoft']);
    ProviderSchema.parse(provider);
    const authenticatedSenderNormalized = normalizeEmail(authenticatedSenderAddress);
    const message = this.vault.one<{
      id: string;
      recipient_address: string;
      recipient_normalized: string;
      recipient_person_id: string | null;
      provider: 'google' | 'microsoft' | null;
      sender_address: string | null;
      sender_normalized: string | null;
      message_kind: 'initial' | 'follow_up' | 'intro_request' | 'reply' | null;
      provider_thread_id: string | null;
      subject: string;
      body_text: string;
      attachments_json: string;
    }>(
      'SELECT id,recipient_address,recipient_normalized,recipient_person_id,provider,sender_address,sender_normalized,message_kind,provider_thread_id,subject,body_text,attachments_json FROM messages WHERE id=?',
      [messageId],
    );
    if (!message) throw new Error(`Message ${messageId} does not exist`);
    if (!message.recipient_person_id)
      throw new Error(
        'Approved sends must be linked to a person so lifetime deduplication is enforceable',
      );
    const complianceIssues = this.messageComplianceIssues(messageId);
    if (complianceIssues.length) {
      throw new Error(`Message is not ready to send: ${complianceIssues.join(' ')}`);
    }
    if (
      !message.provider ||
      !message.sender_address ||
      !message.sender_normalized ||
      !message.message_kind ||
      message.provider !== provider ||
      message.sender_normalized !== authenticatedSenderNormalized
    ) {
      throw new Error('Provider or authenticated sender changed after approval');
    }
    const approval = this.vault.one<{
      id: string;
      content_sha256: string;
      provider: string;
      sender_normalized: string;
      message_kind: string;
      provider_thread_id: string | null;
    }>(
      "SELECT id,content_sha256,provider,sender_normalized,message_kind,provider_thread_id FROM approvals WHERE message_id=? AND status='active'",
      [messageId],
    );
    if (!approval) throw new Error('Message has no active approval');
    if (
      approval.provider !== provider ||
      approval.sender_normalized !== authenticatedSenderNormalized ||
      approval.message_kind !== message.message_kind ||
      (approval.provider_thread_id ?? null) !== (message.provider_thread_id ?? null)
    ) {
      throw new Error('Approved delivery identity no longer matches this send');
    }
    const currentHash = approvalContentHash({
      recipientAddress: message.recipient_address,
      recipientPersonId: message.recipient_person_id,
      provider: message.provider,
      senderAddress: message.sender_address,
      messageKind: message.message_kind,
      providerThreadId: message.provider_thread_id,
      subject: message.subject,
      bodyText: message.body_text,
      attachments: JSON.parse(message.attachments_json),
    });
    if (currentHash !== approval.content_sha256)
      throw new Error('Message content changed after approval');

    this.vault.transaction(() => {
      this.vault.run(
        `INSERT INTO send_ledger(id,message_id,approval_id,approval_sha256,recipient_person_id,recipient_address,recipient_normalized,provider,sender_address,sender_normalized,message_kind,approved_provider_thread_id,dispatch_status,reserved_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'reserved',?)`,
        [
          ledgerId,
          messageId,
          approval.id,
          currentHash,
          message.recipient_person_id,
          message.recipient_address,
          message.recipient_normalized,
          provider,
          message.sender_address,
          message.sender_normalized,
          message.message_kind,
          message.provider_thread_id,
          reservedAt,
        ],
      );
      this.audit(
        'send.reserved',
        'send',
        ledgerId,
        { messageId, provider, recipient: message.recipient_normalized },
        reservedAt,
        'system',
      );
    });
    return {
      id: ledgerId,
      messageId,
      recipientAddress: message.recipient_address,
      recipientNormalized: message.recipient_normalized,
      recipientPersonId: message.recipient_person_id,
      provider,
      senderAddress: message.sender_address,
      senderNormalized: message.sender_normalized,
      messageKind: message.message_kind,
      providerThreadId: message.provider_thread_id,
      status: 'reserved',
    };
  }

  markDispatchStarted(ledgerId: string, at: string): void {
    this.vault.run(
      "UPDATE send_ledger SET dispatch_status='dispatching',dispatch_started_at=? WHERE id=? AND dispatch_status='reserved'",
      [at, IdSchema.parse(ledgerId)],
    );
    if (this.vault.db.getRowsModified() !== 1)
      throw new Error('Send reservation is not available for dispatch');
    this.audit('send.dispatch_started', 'send', ledgerId, {}, at, 'connector');
  }

  markSendSucceeded(
    ledgerId: string,
    providerMessageId: string,
    at: string,
    providerThreadId: string | null = null,
  ): void {
    this.vault.transaction(() => {
      this.vault.run(
        "UPDATE send_ledger SET dispatch_status='sent',provider_message_id=?,provider_thread_id=?,completed_at=? WHERE id=? AND dispatch_status IN ('reserved','dispatching')",
        [providerMessageId, providerThreadId, at, IdSchema.parse(ledgerId)],
      );
      if (this.vault.db.getRowsModified() !== 1)
        throw new Error('Send is not in a completable state');
      this.vault.run(
        "UPDATE messages SET state='sent',updated_at=? WHERE id=(SELECT message_id FROM send_ledger WHERE id=?)",
        [at, ledgerId],
      );
      this.audit(
        'send.succeeded',
        'send',
        ledgerId,
        { providerMessageId, providerThreadId },
        at,
        'connector',
      );
    });
  }

  markSendAmbiguous(ledgerId: string, errorCode: string, detail: string, at: string): void {
    this.vault.run(
      "UPDATE send_ledger SET dispatch_status='ambiguous',completed_at=?,error_code=?,error_detail=? WHERE id=? AND dispatch_status IN ('reserved','dispatching')",
      [at, errorCode, detail, IdSchema.parse(ledgerId)],
    );
    if (this.vault.db.getRowsModified() !== 1)
      throw new Error('Send is not in an ambiguous-completable state');
    this.audit('send.ambiguous_no_retry', 'send', ledgerId, { errorCode }, at, 'connector');
  }

  /**
   * Confirm an unconfirmed operation only from a provider-authoritative sent
   * observation. Mailbox data is untrusted input: malformed or mismatched
   * observations are ignored, and this method never creates or retries a send.
   */
  reconcileUnconfirmedSendFromMailbox(input: {
    operationKey: string;
    provider: 'google' | 'microsoft';
    providerMessageId: string;
    providerThreadId?: string | null;
    recipientAddresses: readonly string[];
    subject: string;
    occurredAt: string;
    reconciledAt: string;
  }): boolean {
    const parsed = MailboxSendReconciliationSchema.safeParse(input);
    if (!parsed.success) return false;
    const value = parsed.data;
    const row = this.vault.one<{
      provider: string;
      recipient_normalized: string;
      reserved_at: string;
      dispatch_status: 'dispatching' | 'ambiguous';
      subject: string;
    }>(
      `SELECT sl.provider,sl.recipient_normalized,sl.reserved_at,sl.dispatch_status,m.subject
       FROM send_ledger sl JOIN messages m ON m.id=sl.message_id
       WHERE sl.id=? AND sl.dispatch_status IN ('dispatching','ambiguous')`,
      [value.operationKey],
    );
    if (!row || row.provider !== value.provider || row.subject !== value.subject) return false;

    const recipients = [...new Set(value.recipientAddresses.map(normalizeEmail))];
    if (recipients.length !== 1 || recipients[0] !== row.recipient_normalized) return false;
    const reservedAt = Date.parse(row.reserved_at);
    const occurredAt = Date.parse(value.occurredAt);
    const reconciledAt = Date.parse(value.reconciledAt);
    const maximumProviderDelayMs = 30 * 24 * 60 * 60 * 1_000;
    const maximumClockSkewMs = 5 * 60 * 1_000;
    if (
      !Number.isFinite(reservedAt) ||
      occurredAt < reservedAt - maximumClockSkewMs ||
      occurredAt > reservedAt + maximumProviderDelayMs ||
      reconciledAt < occurredAt - maximumClockSkewMs
    ) {
      return false;
    }

    this.vault.run('SAVEPOINT outreachr_send_mailbox_reconcile');
    try {
      this.vault.run(
        `UPDATE send_ledger SET dispatch_status='sent',provider_message_id=?,
         provider_thread_id=COALESCE(?,provider_thread_id),completed_at=?,
         error_code=NULL,error_detail=NULL
         WHERE id=? AND dispatch_status IN ('dispatching','ambiguous')`,
        [value.providerMessageId, value.providerThreadId, value.occurredAt, value.operationKey],
      );
      if (this.vault.db.getRowsModified() !== 1) {
        this.vault.run('ROLLBACK TO SAVEPOINT outreachr_send_mailbox_reconcile');
        this.vault.run('RELEASE SAVEPOINT outreachr_send_mailbox_reconcile');
        return false;
      }
      this.vault.run(
        "UPDATE messages SET state='sent',updated_at=? WHERE id=(SELECT message_id FROM send_ledger WHERE id=?)",
        [value.reconciledAt, value.operationKey],
      );
      this.audit(
        'send.reconciled_from_mailbox',
        'send',
        value.operationKey,
        {
          provider: value.provider,
          providerMessageId: value.providerMessageId,
          providerThreadId: value.providerThreadId,
          providerOccurredAt: value.occurredAt,
          previousStatus: row.dispatch_status,
        },
        value.reconciledAt,
        'connector',
      );
      this.vault.run('RELEASE SAVEPOINT outreachr_send_mailbox_reconcile');
      return true;
    } catch (error) {
      this.vault.run('ROLLBACK TO SAVEPOINT outreachr_send_mailbox_reconcile');
      this.vault.run('RELEASE SAVEPOINT outreachr_send_mailbox_reconcile');
      throw error;
    }
  }

  markFailedBeforeDispatch(ledgerId: string, errorCode: string, detail: string, at: string): void {
    this.vault.run(
      "UPDATE send_ledger SET dispatch_status='failed_pre_dispatch',completed_at=?,error_code=?,error_detail=? WHERE id=? AND dispatch_status='reserved'",
      [at, errorCode, detail, IdSchema.parse(ledgerId)],
    );
    if (this.vault.db.getRowsModified() !== 1)
      throw new Error('Only a never-dispatched reservation can be marked failed_pre_dispatch');
    this.vault.run(
      "UPDATE messages SET state='failed_safe',updated_at=? WHERE id=(SELECT message_id FROM send_ledger WHERE id=?)",
      [at, ledgerId],
    );
    this.audit('send.failed_before_dispatch', 'send', ledgerId, { errorCode }, at, 'connector');
  }

  upsertMeeting(input: MeetingInput): void {
    const value = MeetingSchema.parse(input);
    this.vault.run(
      `INSERT INTO meetings(id,round_id,target_id,external_calendar_id,title,starts_at,ends_at,location,attendee_json,agenda,notes,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET round_id=excluded.round_id,target_id=excluded.target_id,external_calendar_id=excluded.external_calendar_id,
      title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,location=excluded.location,attendee_json=excluded.attendee_json,
      agenda=excluded.agenda,notes=excluded.notes,status=excluded.status,updated_at=excluded.updated_at`,
      [
        value.id,
        value.roundId,
        value.targetId,
        value.externalCalendarId,
        value.title,
        value.startsAt,
        value.endsAt,
        value.location,
        stableJson(value.attendees),
        value.agenda,
        value.notes,
        value.status,
        value.createdAt,
        value.updatedAt,
      ],
    );
  }

  upsertTask(input: TaskInput): void {
    const value = TaskSchema.parse(input);
    this.vault.run(
      `INSERT INTO tasks(id,round_id,target_id,title,description,due_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET round_id=excluded.round_id,target_id=excluded.target_id,title=excluded.title,description=excluded.description,due_at=excluded.due_at,status=excluded.status,updated_at=excluded.updated_at`,
      [
        value.id,
        value.roundId,
        value.targetId,
        value.title,
        value.description,
        value.dueAt,
        value.status,
        value.createdAt,
        value.updatedAt,
      ],
    );
  }

  upsertNote(input: NoteInput): void {
    const value = NoteSchema.parse(input);
    this.vault.run(
      `INSERT INTO notes(id,round_id,target_id,person_id,firm_id,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET round_id=excluded.round_id,target_id=excluded.target_id,person_id=excluded.person_id,firm_id=excluded.firm_id,body=excluded.body,updated_at=excluded.updated_at`,
      [
        value.id,
        value.roundId,
        value.targetId,
        value.personId,
        value.firmId,
        value.body,
        value.createdAt,
        value.updatedAt,
      ],
    );
  }

  upsertKnowledgeItem(input: KnowledgeItemInput): void {
    const value = KnowledgeItemSchema.parse(input);
    this.vault.run(
      `INSERT INTO knowledge_items(id,kind,title,content,source_url,content_sha256,created_at,updated_at,share_policy) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,title=excluded.title,content=excluded.content,source_url=excluded.source_url,content_sha256=excluded.content_sha256,share_policy=excluded.share_policy,updated_at=excluded.updated_at`,
      [
        value.id,
        value.kind,
        value.title,
        value.content,
        value.sourceUrl,
        sha256(value.content),
        value.createdAt,
        value.updatedAt,
        value.sharePolicy,
      ],
    );
  }

  upsertList(input: ListInput): void {
    const value = ListSchema.parse(input);
    this.vault.run(
      `INSERT INTO lists(id,name,description,created_at,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,updated_at=excluded.updated_at`,
      [value.id, value.name, value.description, value.createdAt, value.updatedAt],
    );
  }

  addListMember(
    listId: string,
    entityType: 'firm' | 'person' | 'fund' | 'target',
    entityId: string,
    addedAt: string,
    rank: number | null = null,
  ): void {
    this.vault.run(
      'INSERT INTO list_members(list_id,entity_type,entity_id,rank,added_at) VALUES (?,?,?,?,?) ON CONFLICT(list_id,entity_type,entity_id) DO UPDATE SET rank=excluded.rank',
      [IdSchema.parse(listId), entityType, IdSchema.parse(entityId), rank, addedAt],
    );
  }

  upsertConnectorConfig(input: ConnectorConfigInput): void {
    const value = ConnectorConfigSchema.parse(input);
    this.vault.run(
      `INSERT INTO connector_configs(id,provider,account_label,public_config_json,secret_ref,scopes_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,account_label=excluded.account_label,public_config_json=excluded.public_config_json,
      secret_ref=excluded.secret_ref,scopes_json=excluded.scopes_json,status=excluded.status,updated_at=excluded.updated_at`,
      [
        value.id,
        value.provider,
        value.accountLabel,
        stableJson(value.publicConfig),
        value.secretRef,
        stableJson(value.scopes),
        value.status,
        value.createdAt,
        value.updatedAt,
      ],
    );
    this.audit(
      'connector.config_upsert',
      'connector',
      value.id,
      { provider: value.provider, scopes: value.scopes, secretRef: value.secretRef },
      value.updatedAt,
    );
  }

  createAgentRun(input: AgentRunInput): void {
    const value = AgentRunSchema.parse(input);
    this.vault.run(
      'INSERT INTO agent_runs(id,provider,model,purpose,context_policy_json,status,started_at,completed_at,error_detail,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [
        value.id,
        value.provider,
        value.model,
        value.purpose,
        stableJson(value.contextPolicy),
        value.status,
        value.startedAt,
        value.completedAt,
        value.errorDetail,
        value.createdAt,
      ],
    );
    this.audit(
      'agent.run_created',
      'agent_run',
      value.id,
      { provider: value.provider, purpose: value.purpose },
      value.createdAt,
      'agent',
      value.id,
    );
  }

  createAgentProposal(input: AgentProposalInput): void {
    const value = AgentProposalSchema.parse(input);
    const payloadJson = stableJson(value.payload);
    this.vault.run(
      'INSERT INTO agent_proposals(id,agent_run_id,proposal_type,payload_json,payload_sha256,status,reviewed_at,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [
        value.id,
        value.agentRunId,
        value.proposalType,
        payloadJson,
        sha256(payloadJson),
        value.status,
        value.reviewedAt,
        value.createdAt,
      ],
    );
    this.audit(
      'agent.proposal_created',
      'agent_proposal',
      value.id,
      { runId: value.agentRunId, type: value.proposalType },
      value.createdAt,
      'agent',
      value.agentRunId,
    );
  }

  reviewAgentProposal(
    proposalId: string,
    decision: 'accepted' | 'rejected',
    reviewedAt: string,
  ): void {
    this.vault.run(
      "UPDATE agent_proposals SET status=?,reviewed_at=? WHERE id=? AND status='pending'",
      [decision, reviewedAt, IdSchema.parse(proposalId)],
    );
    if (this.vault.db.getRowsModified() !== 1) throw new Error('Proposal is not pending');
    this.audit(`agent.proposal_${decision}`, 'agent_proposal', proposalId, {}, reviewedAt);
  }

  getRoundSummary(roundId: string): Record<string, number> {
    const rows = this.vault.all<{ stage: string; count: number }>(
      'SELECT stage,COUNT(*) AS count FROM targets WHERE round_id=? GROUP BY stage',
      [IdSchema.parse(roundId)],
    );
    return Object.fromEntries(rows.map((row) => [row.stage, Number(row.count)]));
  }

  // ---- Job application workspace ----

  workspaceProfile(): WorkspaceProfile {
    const row = this.vault.one<{
      id: string;
      display_name: string;
      primary_email: string;
      created_at: string;
      updated_at: string;
    }>('SELECT id,display_name,primary_email,created_at,updated_at FROM workspace_profile');
    if (!row) throw new Error('Workspace is not set up');
    return {
      id: row.id,
      displayName: row.display_name,
      primaryEmail: row.primary_email,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  setupWorkspace(input: WorkspaceSetupInput, at: string): WorkspaceSetupResult {
    const value = WorkspaceSetupSchema.parse(input);
    if (this.vault.one('SELECT id FROM workspace_profile')) {
      throw new Error('Workspace is already set up');
    }
    const seen = new Set<string>();
    for (const stage of value.stages) {
      const key = stage.name.trim().toLocaleLowerCase('en-US');
      if (seen.has(key)) throw new Error('Stage names must be unique');
      seen.add(key);
    }
    const profileId = 'workspace';
    this.vault.transaction(() => {
      this.vault.run(
        'INSERT INTO workspace_profile(id,display_name,primary_email,created_at,updated_at) VALUES (?,?,?,?,?)',
        [profileId, value.displayName, value.primaryEmail, at, at],
      );
      const stageIds: string[] = [];
      value.stages.forEach((stage, index) => {
        const stageId = `stage:${randomUUID()}`;
        stageIds.push(stageId);
        this.vault.run(
          'INSERT INTO application_stages(id,name,position,terminal,archived,created_at,updated_at) VALUES (?,?,?,?,0,?,?)',
          [stageId, stage.name, index, bool(stage.terminal), at, at],
        );
      });
      for (let index = 0; index < stageIds.length - 1; index += 1) {
        const fromStageId = stageIds[index];
        const toStageId = stageIds[index + 1];
        const source = value.stages[index];
        if (!fromStageId || !toStageId || !source || source.terminal) continue;
        this.vault.run(
          'INSERT INTO application_stage_transitions(from_stage_id,to_stage_id) VALUES (?,?)',
          [fromStageId, toStageId],
        );
      }
      this.audit(
        'workspace.setup',
        'workspace',
        profileId,
        { displayName: value.displayName, stages: value.stages.map((stage) => stage.name) },
        at,
      );
    });
    return { profile: this.workspaceProfile(), stages: this.listApplicationStages() };
  }

  // ---- Companies ----

  listCompanies(): CompanyRecord[] {
    return this.vault.all<CompanyRecord>(
      'SELECT id,name,website,location,created_at AS createdAt,updated_at AS updatedAt FROM companies ORDER BY lower(trim(name)),id',
    );
  }

  createCompany(input: CompanyInput, at: string): CompanyRecord {
    const value = CompanySchema.parse(input);
    const id = value.id ?? `company:${randomUUID()}`;
    this.vault.run(
      'INSERT INTO companies(id,name,website,location,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      [id, value.name, value.website ?? null, value.location ?? null, at, at],
    );
    this.audit('company.create', 'company', id, { name: value.name }, at);
    return this.company(id);
  }

  updateCompany(input: CompanyInput & { id: string }, at: string): CompanyRecord {
    const value = CompanySchema.parse(input);
    if (!value.id) throw new Error('Company id is required');
    if (!this.vault.one('SELECT id FROM companies WHERE id=?', [value.id])) {
      throw new Error(`Company ${value.id} does not exist`);
    }
    this.vault.run('UPDATE companies SET name=?,website=?,location=?,updated_at=? WHERE id=?', [
      value.name,
      value.website ?? null,
      value.location ?? null,
      at,
      value.id,
    ]);
    this.audit('company.update', 'company', value.id, { name: value.name }, at);
    return this.company(value.id);
  }

  private company(id: string): CompanyRecord {
    const row = this.vault.one<CompanyRecord>(
      'SELECT id,name,website,location,created_at AS createdAt,updated_at AS updatedAt FROM companies WHERE id=?',
      [id],
    );
    if (!row) throw new Error(`Company ${id} does not exist`);
    return row;
  }

  // ---- Contacts ----

  listContacts(): ContactRecord[] {
    return this.vault.all<ContactRecord>(
      'SELECT id,company_id AS companyId,name,title,primary_email AS primaryEmail,created_at AS createdAt,updated_at AS updatedAt FROM contacts ORDER BY lower(trim(name)),id',
    );
  }

  createContact(input: ContactInput, at: string): ContactRecord {
    const value = ContactSchema.parse(input);
    const id = value.id ?? `contact:${randomUUID()}`;
    this.vault.run(
      'INSERT INTO contacts(id,company_id,name,title,primary_email,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      [id, value.companyId ?? null, value.name, value.title ?? null, value.primaryEmail ?? null, at, at],
    );
    this.audit('contact.create', 'contact', id, { name: value.name }, at);
    return this.contact(id);
  }

  updateContact(input: ContactInput & { id: string }, at: string): ContactRecord {
    const value = ContactSchema.parse(input);
    if (!value.id) throw new Error('Contact id is required');
    if (!this.vault.one('SELECT id FROM contacts WHERE id=?', [value.id])) {
      throw new Error(`Contact ${value.id} does not exist`);
    }
    this.vault.run(
      'UPDATE contacts SET company_id=?,name=?,title=?,primary_email=?,updated_at=? WHERE id=?',
      [value.companyId ?? null, value.name, value.title ?? null, value.primaryEmail ?? null, at, value.id],
    );
    this.audit('contact.update', 'contact', value.id, { name: value.name }, at);
    return this.contact(value.id);
  }

  private contact(id: string): ContactRecord {
    const row = this.vault.one<ContactRecord>(
      'SELECT id,company_id AS companyId,name,title,primary_email AS primaryEmail,created_at AS createdAt,updated_at AS updatedAt FROM contacts WHERE id=?',
      [id],
    );
    if (!row) throw new Error(`Contact ${id} does not exist`);
    return row;
  }

  // ---- Application stages ----

  listApplicationStages(): ApplicationStageRecord[] {
    const rows = this.vault.all<{
      id: string;
      name: string;
      position: number;
      terminal: number;
      archived: number;
      createdAt: string;
      updatedAt: string;
    }>(
      'SELECT id,name,position,terminal,archived,created_at AS createdAt,updated_at AS updatedAt FROM application_stages ORDER BY position,id',
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      position: row.position,
      terminal: row.terminal === 1,
      archived: row.archived === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  createApplicationStage(input: ApplicationStageInput, at: string): ApplicationStageRecord {
    const value = ApplicationStageSchema.parse(input);
    const id = value.id ?? `stage:${randomUUID()}`;
    this.vault.run(
      'INSERT INTO application_stages(id,name,position,terminal,archived,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      [id, value.name, value.position, bool(value.terminal), bool(value.archived ?? false), at, at],
    );
    this.audit(
      'application_stage.create',
      'application_stage',
      id,
      { name: value.name, position: value.position, terminal: value.terminal },
      at,
    );
    return this.applicationStage(id);
  }

  updateApplicationStage(input: ApplicationStageInput & { id: string }, at: string): ApplicationStageRecord {
    const value = ApplicationStageSchema.parse(input);
    if (!value.id) throw new Error('Application stage id is required');
    if (!this.vault.one('SELECT id FROM application_stages WHERE id=?', [value.id])) {
      throw new Error(`Application stage ${value.id} does not exist`);
    }
    this.vault.run(
      'UPDATE application_stages SET name=?,position=?,terminal=?,archived=?,updated_at=? WHERE id=?',
      [value.name, value.position, bool(value.terminal), bool(value.archived ?? false), at, value.id],
    );
    this.audit(
      'application_stage.update',
      'application_stage',
      value.id,
      { name: value.name, position: value.position, terminal: value.terminal, archived: value.archived ?? false },
      at,
    );
    return this.applicationStage(value.id);
  }

  private applicationStage(id: string): ApplicationStageRecord {
    const row = this.vault.one<{
      id: string;
      name: string;
      position: number;
      terminal: number;
      archived: number;
      createdAt: string;
      updatedAt: string;
    }>(
      'SELECT id,name,position,terminal,archived,created_at AS createdAt,updated_at AS updatedAt FROM application_stages WHERE id=?',
      [id],
    );
    if (!row) throw new Error(`Application stage ${id} does not exist`);
    return {
      id: row.id,
      name: row.name,
      position: row.position,
      terminal: row.terminal === 1,
      archived: row.archived === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  setApplicationStageTransition(
    input: ApplicationStageTransitionSetInput,
    at: string,
  ): { allowed: boolean } {
    const value = ApplicationStageTransitionSetSchema.parse(input);
    const from = this.vault.one<{ terminal: number }>(
      'SELECT terminal FROM application_stages WHERE id=?',
      [value.fromStageId],
    );
    if (!from) throw new Error(`Application stage ${value.fromStageId} does not exist`);
    if (!this.vault.one('SELECT id FROM application_stages WHERE id=?', [value.toStageId])) {
      throw new Error(`Application stage ${value.toStageId} does not exist`);
    }
    if (value.allowed) {
      if (from.terminal === 1) {
        throw new Error('Terminal stages cannot have outgoing transitions');
      }
      this.vault.run(
        'INSERT INTO application_stage_transitions(from_stage_id,to_stage_id) VALUES (?,?) ON CONFLICT(from_stage_id,to_stage_id) DO NOTHING',
        [value.fromStageId, value.toStageId],
      );
    } else {
      this.vault.run(
        'DELETE FROM application_stage_transitions WHERE from_stage_id=? AND to_stage_id=?',
        [value.fromStageId, value.toStageId],
      );
    }
    this.audit(
      'application_stage.transition.set',
      'application_stage',
      value.fromStageId,
      { fromStageId: value.fromStageId, toStageId: value.toStageId, allowed: value.allowed },
      at,
    );
    return { allowed: value.allowed };
  }

  // ---- Job applications ----

  createJobApplication(input: CreateJobApplicationInput, at: string): ApplicationDetail {
    const value = CreateJobApplicationSchema.parse(input);
    if (!this.vault.one('SELECT id FROM workspace_profile')) {
      throw new Error('Workspace must be set up before creating applications');
    }
    const stage = this.vault.one<{ archived: number }>(
      'SELECT archived FROM application_stages WHERE id=?',
      [value.stageId],
    );
    if (!stage) throw new Error(`Application stage ${value.stageId} does not exist`);
    if (stage.archived === 1) throw new Error('Cannot create an application in an archived stage');
    if (!this.vault.one('SELECT id FROM companies WHERE id=?', [value.companyId])) {
      throw new Error(`Company ${value.companyId} does not exist`);
    }
    const id = value.id ?? `application:${randomUUID()}`;
    this.vault.transaction(() => {
      this.vault.run(
        'INSERT INTO job_applications(id,company_id,role,stage_id,source_url,applied_at,next_event_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          id,
          value.companyId,
          value.role,
          value.stageId,
          value.sourceUrl ?? null,
          value.appliedAt ?? null,
          value.nextEventAt ?? null,
          at,
          at,
        ],
      );
      this.vault.run(
        'INSERT INTO application_stage_history(id,application_id,from_stage_id,to_stage_id,changed_at,note) VALUES (?,?,NULL,?,?,NULL)',
        [`history:${randomUUID()}`, id, value.stageId, at],
      );
      this.audit(
        'application.create',
        'application',
        id,
        { companyId: value.companyId, stageId: value.stageId, role: value.role },
        at,
      );
    });
    return this.loadApplicationDetail(id);
  }

  getJobApplication(id: string): ApplicationDetail {
    const value = IdSchema.parse(id);
    return this.loadApplicationDetail(value);
  }

  listJobApplications(input: ListJobApplicationsInput): ApplicationListPage {
    const value = ListJobApplicationsSchema.parse(input);
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (value.query) {
      const pattern = `%${likeEscaped(value.query.toLocaleLowerCase('en-US'))}%`;
      conditions.push("(lower(c.name) LIKE ? ESCAPE '\\' OR lower(j.role) LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern);
    }
    if (value.stageIds && value.stageIds.length > 0) {
      conditions.push(`j.stage_id IN (${value.stageIds.map(() => '?').join(',')})`);
      params.push(...value.stageIds);
    }
    if (value.companyId) {
      conditions.push('j.company_id=?');
      params.push(value.companyId);
    }
    if (value.taskStatus) {
      conditions.push(
        'EXISTS (SELECT 1 FROM application_tasks t WHERE t.application_id=j.id AND t.status=?)',
      );
      params.push(value.taskStatus);
    }
    if (value.cursor) {
      const cursor = decodeApplicationCursor(value.cursor);
      if (!cursor) throw new Error('Invalid application list cursor');
      conditions.push('(j.updated_at < ? OR (j.updated_at = ? AND j.id < ?))');
      params.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.vault.all<ApplicationSummaryRow>(
      `${APPLICATION_SUMMARY_SELECT} ${where} ORDER BY j.updated_at DESC,j.id DESC LIMIT ?`,
      [...params, value.limit + 1],
    );
    const hasMore = rows.length > value.limit;
    const page = hasMore ? rows.slice(0, value.limit) : rows;
    const applications = page.map((row) => this.summaryFromRow(row));
    const last = page[page.length - 1];
    return {
      applications,
      nextCursor: hasMore && last ? encodeApplicationCursor(last.updatedAt, last.id) : null,
    };
  }

  updateJobApplication(input: UpdateJobApplicationInput, at: string): ApplicationDetail {
    const value = UpdateJobApplicationSchema.parse(input);
    if (!this.vault.one('SELECT id FROM job_applications WHERE id=?', [value.id])) {
      throw new Error(`Job application ${value.id} does not exist`);
    }
    const updates: string[] = [];
    const params: Array<string | number | null> = [];
    const changed: string[] = [];
    if (value.companyId !== undefined) {
      updates.push('company_id=?');
      params.push(value.companyId);
      changed.push('companyId');
    }
    if (value.role !== undefined) {
      updates.push('role=?');
      params.push(value.role);
      changed.push('role');
    }
    if (value.sourceUrl !== undefined) {
      updates.push('source_url=?');
      params.push(value.sourceUrl);
      changed.push('sourceUrl');
    }
    if (value.appliedAt !== undefined) {
      updates.push('applied_at=?');
      params.push(value.appliedAt);
      changed.push('appliedAt');
    }
    if (value.nextEventAt !== undefined) {
      updates.push('next_event_at=?');
      params.push(value.nextEventAt);
      changed.push('nextEventAt');
    }
    if (updates.length === 0) throw new Error('No application fields to update');
    updates.push('updated_at=?');
    params.push(at, value.id);
    this.vault.run(`UPDATE job_applications SET ${updates.join(',')} WHERE id=?`, params);
    this.audit('application.update', 'application', value.id, { updated: changed }, at);
    return this.loadApplicationDetail(value.id);
  }

  transitionJobApplication(input: TransitionJobApplicationInput, at: string): ApplicationDetail {
    const value = TransitionJobApplicationSchema.parse(input);
    const application = this.vault.one<{ stage_id: string }>(
      'SELECT stage_id FROM job_applications WHERE id=?',
      [value.id],
    );
    if (!application) throw new Error(`Job application ${value.id} does not exist`);
    if (application.stage_id === value.toStageId) {
      throw new Error('Job application is already in that stage');
    }
    const target = this.vault.one<{ archived: number }>(
      'SELECT archived FROM application_stages WHERE id=?',
      [value.toStageId],
    );
    if (!target) throw new Error(`Application stage ${value.toStageId} does not exist`);
    if (target.archived === 1) throw new Error('Cannot transition into an archived stage');
    if (
      !this.vault.one(
        'SELECT 1 FROM application_stage_transitions WHERE from_stage_id=? AND to_stage_id=?',
        [application.stage_id, value.toStageId],
      )
    ) {
      throw new Error('Stage transition is not allowed');
    }
    this.vault.transaction(() => {
      this.vault.run('UPDATE job_applications SET stage_id=?,updated_at=? WHERE id=?', [
        value.toStageId,
        at,
        value.id,
      ]);
      this.vault.run(
        'INSERT INTO application_stage_history(id,application_id,from_stage_id,to_stage_id,changed_at,note) VALUES (?,?,?,?,?,?)',
        [`history:${randomUUID()}`, value.id, application.stage_id, value.toStageId, at, value.note ?? null],
      );
      this.audit(
        'application.transition',
        'application',
        value.id,
        { fromStageId: application.stage_id, toStageId: value.toStageId },
        at,
      );
    });
    return this.loadApplicationDetail(value.id);
  }

  // ---- Application relationships ----

  linkApplicationContact(input: LinkApplicationContactInput, at: string): ApplicationDetail {
    const value = LinkApplicationContactSchema.parse(input);
    if (!this.vault.one('SELECT id FROM job_applications WHERE id=?', [value.applicationId])) {
      throw new Error(`Job application ${value.applicationId} does not exist`);
    }
    if (!this.vault.one('SELECT id FROM contacts WHERE id=?', [value.contactId])) {
      throw new Error(`Contact ${value.contactId} does not exist`);
    }
    this.vault.transaction(() => {
      if (value.primary) {
        this.vault.run(
          'UPDATE application_contacts SET primary_contact=0 WHERE application_id=?',
          [value.applicationId],
        );
      }
      this.vault.run(
        `INSERT INTO application_contacts(application_id,contact_id,relationship,primary_contact) VALUES (?,?,?,?)
         ON CONFLICT(application_id,contact_id) DO UPDATE SET relationship=excluded.relationship,primary_contact=excluded.primary_contact`,
        [value.applicationId, value.contactId, value.relationship, bool(value.primary)],
      );
      this.audit(
        'application.contact.link',
        'application',
        value.applicationId,
        { contactId: value.contactId, primary: value.primary },
        at,
      );
    });
    return this.loadApplicationDetail(value.applicationId);
  }

  unlinkApplicationContact(input: UnlinkApplicationContactInput, at: string): ApplicationDetail {
    const value = UnlinkApplicationContactSchema.parse(input);
    if (!this.vault.one('SELECT id FROM job_applications WHERE id=?', [value.applicationId])) {
      throw new Error(`Job application ${value.applicationId} does not exist`);
    }
    this.vault.run(
      'DELETE FROM application_contacts WHERE application_id=? AND contact_id=?',
      [value.applicationId, value.contactId],
    );
    this.audit(
      'application.contact.unlink',
      'application',
      value.applicationId,
      { contactId: value.contactId },
      at,
    );
    return this.loadApplicationDetail(value.applicationId);
  }

  linkApplicationThread(input: LinkApplicationThreadInput, at: string): ApplicationDetail {
    const value = LinkApplicationThreadSchema.parse(input);
    if (!this.vault.one('SELECT id FROM job_applications WHERE id=?', [value.applicationId])) {
      throw new Error(`Job application ${value.applicationId} does not exist`);
    }
    if (
      this.vault.one(
        'SELECT 1 FROM application_threads WHERE application_id=? AND provider=? AND account_email=? AND provider_thread_id=?',
        [value.applicationId, value.provider, value.accountEmail, value.providerThreadId],
      )
    ) {
      throw new Error('Thread is already linked to this application');
    }
    this.vault.run(
      'INSERT INTO application_threads(application_id,provider,account_email,provider_thread_id,subject_snapshot,linked_at) VALUES (?,?,?,?,?,?)',
      [
        value.applicationId,
        value.provider,
        value.accountEmail,
        value.providerThreadId,
        value.subjectSnapshot ?? null,
        at,
      ],
    );
    this.audit(
      'application.thread.link',
      'application',
      value.applicationId,
      { provider: value.provider, providerThreadId: value.providerThreadId },
      at,
    );
    return this.loadApplicationDetail(value.applicationId);
  }

  unlinkApplicationThread(input: UnlinkApplicationThreadInput, at: string): ApplicationDetail {
    const value = UnlinkApplicationThreadSchema.parse(input);
    if (!this.vault.one('SELECT id FROM job_applications WHERE id=?', [value.applicationId])) {
      throw new Error(`Job application ${value.applicationId} does not exist`);
    }
    this.vault.run(
      'DELETE FROM application_threads WHERE application_id=? AND provider=? AND account_email=? AND provider_thread_id=?',
      [value.applicationId, value.provider, value.accountEmail, value.providerThreadId],
    );
    this.audit(
      'application.thread.unlink',
      'application',
      value.applicationId,
      { provider: value.provider, providerThreadId: value.providerThreadId },
      at,
    );
    return this.loadApplicationDetail(value.applicationId);
  }

  // ---- Application notes ----

  createApplicationNote(input: ApplicationNoteCreateInput, at: string): ApplicationNote {
    const value = ApplicationNoteCreateSchema.parse(input);
    if (!this.vault.one('SELECT id FROM job_applications WHERE id=?', [value.applicationId])) {
      throw new Error(`Job application ${value.applicationId} does not exist`);
    }
    const id = value.id ?? `note:${randomUUID()}`;
    this.vault.run(
      'INSERT INTO application_notes(id,application_id,body,created_at,updated_at) VALUES (?,?,?,?,?)',
      [id, value.applicationId, value.body, at, at],
    );
    this.audit('application.note.create', 'application_note', id, { applicationId: value.applicationId }, at);
    return this.applicationNote(id);
  }

  updateApplicationNote(input: ApplicationNoteUpdateInput, at: string): ApplicationNote {
    const value = ApplicationNoteUpdateSchema.parse(input);
    if (!this.vault.one('SELECT id FROM application_notes WHERE id=?', [value.id])) {
      throw new Error(`Application note ${value.id} does not exist`);
    }
    this.vault.run('UPDATE application_notes SET body=?,updated_at=? WHERE id=?', [
      value.body,
      at,
      value.id,
    ]);
    this.audit('application.note.update', 'application_note', value.id, {}, at);
    return this.applicationNote(value.id);
  }

  private applicationNote(id: string): ApplicationNote {
    const row = this.vault.one<ApplicationNote>(
      'SELECT id,application_id AS applicationId,body,created_at AS createdAt,updated_at AS updatedAt FROM application_notes WHERE id=?',
      [id],
    );
    if (!row) throw new Error(`Application note ${id} does not exist`);
    return row;
  }

  // ---- Application tasks ----

  createApplicationTask(input: ApplicationTaskCreateInput, at: string): ApplicationTask {
    const value = ApplicationTaskCreateSchema.parse(input);
    if (!this.vault.one('SELECT id FROM job_applications WHERE id=?', [value.applicationId])) {
      throw new Error(`Job application ${value.applicationId} does not exist`);
    }
    const id = value.id ?? `task:${randomUUID()}`;
    this.vault.run(
      'INSERT INTO application_tasks(id,application_id,title,notes,due_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, value.applicationId, value.title, value.notes ?? null, value.dueAt ?? null, value.status, at, at],
    );
    this.audit('application.task.create', 'application_task', id, { applicationId: value.applicationId }, at);
    return this.applicationTask(id);
  }

  updateApplicationTask(input: ApplicationTaskUpdateInput, at: string): ApplicationTask {
    const value = ApplicationTaskUpdateSchema.parse(input);
    if (!this.vault.one('SELECT id FROM application_tasks WHERE id=?', [value.id])) {
      throw new Error(`Application task ${value.id} does not exist`);
    }
    const updates: string[] = [];
    const params: Array<string | number | null> = [];
    if (value.title !== undefined) {
      updates.push('title=?');
      params.push(value.title);
    }
    if (value.notes !== undefined) {
      updates.push('notes=?');
      params.push(value.notes);
    }
    if (value.dueAt !== undefined) {
      updates.push('due_at=?');
      params.push(value.dueAt);
    }
    if (value.status !== undefined) {
      updates.push('status=?');
      params.push(value.status);
    }
    if (updates.length === 0) throw new Error('No application task fields to update');
    updates.push('updated_at=?');
    params.push(at, value.id);
    this.vault.run(`UPDATE application_tasks SET ${updates.join(',')} WHERE id=?`, params);
    this.audit('application.task.update', 'application_task', value.id, {}, at);
    return this.applicationTask(value.id);
  }

  private applicationTask(id: string): ApplicationTask {
    const row = this.vault.one<ApplicationTask>(
      'SELECT id,application_id AS applicationId,title,notes,due_at AS dueAt,status,created_at AS createdAt,updated_at AS updatedAt FROM application_tasks WHERE id=?',
      [id],
    );
    if (!row) throw new Error(`Application task ${id} does not exist`);
    return row;
  }

  // ---- Application-bound drafts ----

  createApplicationDraft(input: ApplicationDraftCreateInput, at: string): ApplicationDraftRecord {
    const value = ApplicationDraftCreateSchema.parse(input);
    if (!this.vault.one('SELECT id FROM job_applications WHERE id=?', [value.applicationId])) {
      throw new Error(`Job application ${value.applicationId} does not exist`);
    }
    if (
      !this.vault.one(
        'SELECT 1 FROM application_contacts WHERE application_id=? AND contact_id=?',
        [value.applicationId, value.contactId],
      )
    ) {
      throw new Error('Draft contact is not linked to this application');
    }
    const contact = this.vault.one<{ name: string; primary_email: string | null }>(
      'SELECT name,primary_email FROM contacts WHERE id=?',
      [value.contactId],
    );
    if (!contact) throw new Error(`Contact ${value.contactId} does not exist`);
    if (!contact.primary_email) throw new Error('Draft contact must have a primary email');
    const id = value.id ?? `draft:${randomUUID()}`;
    const recipientEmail = normalizeEmail(contact.primary_email);
    const senderNormalized = normalizeEmail(value.accountEmail);
    const threadId = value.threadId ?? null;
    const contentHash = approvalContentHash({
      recipientAddress: recipientEmail,
      recipientPersonId: null,
      provider: value.provider,
      senderAddress: value.accountEmail,
      messageKind: value.kind,
      providerThreadId: threadId,
      subject: value.subject,
      bodyText: value.bodyText,
      attachments: [],
    });
    this.vault.run(
      `INSERT INTO messages(id,round_id,target_id,recipient_person_id,recipient_address,recipient_normalized,provider,sender_address,sender_normalized,message_kind,provider_thread_id,reply_to_message_id,subject,body_text,attachments_json,state,application_id,application_contact_id,created_at,updated_at)
       VALUES (?,NULL,NULL,NULL,?,?,?,?,?,?,?,?,?,?, '[]','draft',?,?,?,?)`,
      [
        id,
        recipientEmail,
        recipientEmail,
        value.provider,
        value.accountEmail,
        senderNormalized,
        value.kind,
        threadId,
        value.replyToMessageId ?? null,
        value.subject,
        value.bodyText,
        value.applicationId,
        value.contactId,
        at,
        at,
      ],
    );
    this.audit(
      'application.draft.create',
      'application',
      value.applicationId,
      { draftId: id, contactId: value.contactId, provider: value.provider, kind: value.kind },
      at,
    );
    return {
      id,
      applicationId: value.applicationId,
      contactId: value.contactId,
      provider: value.provider,
      accountEmail: value.accountEmail,
      recipientName: contact.name,
      recipientEmail,
      kind: value.kind,
      subject: value.subject,
      bodyText: value.bodyText,
      threadId,
      replyToMessageId: value.replyToMessageId ?? null,
      contentHash,
      createdAt: at,
      updatedAt: at,
    };
  }

  // ---- Shared application loading ----

  private summaryFromRow(row: ApplicationSummaryRow): ApplicationSummary {
    return {
      id: row.id,
      companyId: row.companyId,
      companyName: row.companyName,
      role: row.role,
      stageId: row.stageId,
      stageName: row.stageName,
      sourceUrl: row.sourceUrl ?? null,
      appliedAt: row.appliedAt ?? null,
      nextEventAt: row.nextEventAt ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private loadApplicationDetail(id: string): ApplicationDetail {
    const summary = this.vault.one<ApplicationSummaryRow>(
      `${APPLICATION_SUMMARY_SELECT} WHERE j.id=?`,
      [id],
    );
    if (!summary) throw new Error(`Job application ${id} does not exist`);
    const company = this.company(summary.companyId);
    const contactRows = this.vault.all<{
      id: string;
      companyId: string | null;
      name: string;
      title: string | null;
      primaryEmail: string | null;
      createdAt: string;
      updatedAt: string;
      relationship: string;
      isPrimary: number;
    }>(
      `SELECT c.id,c.company_id AS companyId,c.name,c.title,c.primary_email AS primaryEmail,c.created_at AS createdAt,c.updated_at AS updatedAt,
        ac.relationship,ac.primary_contact AS isPrimary
       FROM application_contacts ac JOIN contacts c ON c.id=ac.contact_id
       WHERE ac.application_id=? ORDER BY ac.primary_contact DESC,c.name,c.id`,
      [id],
    );
    const contacts = contactRows.map((row) => {
      const { relationship, isPrimary, ...contact } = row;
      return {
        ...contact,
        companyId: contact.companyId ?? null,
        title: contact.title ?? null,
        primaryEmail: contact.primaryEmail ?? null,
        relationship,
        primary: isPrimary === 1,
      };
    });
    const threads = this.vault
      .all<ApplicationThreadLink>(
        `SELECT application_id AS applicationId,provider,account_email AS accountEmail,provider_thread_id AS providerThreadId,
          subject_snapshot AS subjectSnapshot,linked_at AS linkedAt
         FROM application_threads WHERE application_id=? ORDER BY linked_at,provider,provider_thread_id`,
        [id],
      )
      .map((row) => ({ ...row, subjectSnapshot: row.subjectSnapshot ?? null }));
    const notes = this.vault.all<ApplicationNote>(
      'SELECT id,application_id AS applicationId,body,created_at AS createdAt,updated_at AS updatedAt FROM application_notes WHERE application_id=? ORDER BY created_at,id',
      [id],
    );
    const tasks = this.vault.all<ApplicationTask>(
      'SELECT id,application_id AS applicationId,title,notes,due_at AS dueAt,status,created_at AS createdAt,updated_at AS updatedAt FROM application_tasks WHERE application_id=? ORDER BY created_at,id',
      [id],
    );
    const stageHistory = this.vault
      .all<ApplicationStageHistoryItem>(
        `SELECT id,application_id AS applicationId,from_stage_id AS fromStageId,to_stage_id AS toStageId,changed_at AS changedAt,note
         FROM application_stage_history WHERE application_id=? ORDER BY changed_at,id`,
        [id],
      )
      .map((row) => ({ ...row, fromStageId: row.fromStageId ?? null, note: row.note ?? null }));
    return {
      ...this.summaryFromRow(summary),
      company,
      contacts,
      threads,
      notes,
      tasks,
      stageHistory,
    };
  }
}
