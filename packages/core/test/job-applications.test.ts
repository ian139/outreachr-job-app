import { createRequire } from 'node:module';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  CoreVault,
  MIGRATIONS,
  OutreachrRepository,
  SCHEMA_VERSION,
  type ApplicationDetail,
  type ApplicationStageRecord,
  type CompanyRecord,
  type ContactRecord,
  verifyAuditChain,
} from '../src/index.js';

const NOW = '2026-07-31T12:00:00.000Z';
const LATER = '2026-07-31T12:05:00.000Z';
let SQL: SqlJsStatic;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
  SQL = await initSqlJs({ locateFile: () => wasm });
});

function vault(): CoreVault {
  return new CoreVault(SQL, { appliedAt: NOW });
}

function tableNames(db: Database): string[] {
  const result = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")[0];
  return result?.values.map((value) => String(value[0])) ?? [];
}

function setUpWorkspace(repo: OutreachrRepository, at: string): ApplicationStageRecord[] {
  const result = repo.setupWorkspace(
    {
      displayName: 'Test Workspace',
      primaryEmail: 'founder@example.test',
      stages: [
        { name: 'Applied', terminal: false },
        { name: 'Screen', terminal: false },
        { name: 'Interview', terminal: false },
        { name: 'Offer', terminal: false },
        { name: 'Rejected', terminal: true },
      ],
    },
    at,
  );
  return result.stages;
}

function addCompany(repo: OutreachrRepository, at: string): CompanyRecord {
  return repo.createCompany(
    { id: 'company-acme', name: 'Acme', website: 'https://acme.example', location: 'London' },
    at,
  );
}

function addContact(
  repo: OutreachrRepository,
  id: string,
  email: string,
  at: string,
): ContactRecord {
  return repo.createContact(
    { id, companyId: 'company-acme', name: `Contact ${id}`, title: 'Hiring Manager', primaryEmail: email },
    at,
  );
}

function addApplication(
  repo: OutreachrRepository,
  id: string,
  stageId: string,
  at: string,
): ApplicationDetail {
  return repo.createJobApplication(
    { id, companyId: 'company-acme', role: `Engineer ${id}`, stageId },
    at,
  );
}

function stageByName(stages: ApplicationStageRecord[], name: string): ApplicationStageRecord {
  const stage = stages.find((item) => item.name === name);
  if (!stage) throw new Error(`Stage ${name} missing`);
  return stage;
}

describe('job application workspace setup', () => {
  it('creates the v10 schema, ordered supplied stages, and explicit adjacent forward edges', () => {
    const core = vault();
    expect(core.schemaVersion).toBe(SCHEMA_VERSION);
    expect(tableNames(core.db)).toEqual(
      expect.arrayContaining([
        'workspace_profile',
        'companies',
        'contacts',
        'application_stages',
        'application_stage_transitions',
        'job_applications',
        'application_stage_history',
        'application_contacts',
        'application_threads',
        'application_notes',
        'application_tasks',
      ]),
    );
    const repo = new OutreachrRepository(core);
    const stages = setUpWorkspace(repo, NOW);
    expect(stages.map((stage) => stage.name)).toEqual([
      'Applied',
      'Screen',
      'Interview',
      'Offer',
      'Rejected',
    ]);
    expect(stages.map((stage) => stage.position)).toEqual([0, 1, 2, 3, 4]);
    expect(stages.filter((stage) => stage.terminal).map((stage) => stage.name)).toEqual([
      'Rejected',
    ]);
    const edges = core.all<{ fromStage: string; targetName: string }>(
      `SELECT t.from_stage_id AS fromStage, s.name AS targetName
       FROM application_stage_transitions t
       JOIN application_stages f ON f.id=t.from_stage_id
       JOIN application_stages s ON s.id=t.to_stage_id
       ORDER BY f.position`,
    );
    expect(edges.map((edge) => `${edge.fromStage}:${edge.targetName}`)).toEqual([
      `${stageByName(stages, 'Applied').id}:Screen`,
      `${stageByName(stages, 'Screen').id}:Interview`,
      `${stageByName(stages, 'Interview').id}:Offer`,
      `${stageByName(stages, 'Offer').id}:Rejected`,
    ]);
    // No edge may originate from the terminal stage.
    expect(
      Number(
        core.scalar(
          'SELECT COUNT(*) FROM application_stage_transitions WHERE from_stage_id=?',
          [stageByName(stages, 'Rejected').id],
        ),
      ),
    ).toBe(0);
    core.close();
  });

  it('refuses a second setup, duplicate stage names, and out-of-bounds stage counts', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    setUpWorkspace(repo, NOW);
    expect(() =>
      repo.setupWorkspace(
        {
          displayName: 'Again',
          primaryEmail: 'founder@example.test',
          stages: [{ name: 'Applied' }],
        },
        LATER,
      ),
    ).toThrow('Workspace is already set up');
    const duplicateCore = vault();
    const duplicateRepo = new OutreachrRepository(duplicateCore);
    expect(() =>
      duplicateRepo.setupWorkspace(
        {
          displayName: 'Dupes',
          primaryEmail: 'founder@example.test',
          stages: [
            { name: 'Same' },
            { name: 'same' },
          ],
        },
        NOW,
      ),
    ).toThrow('Stage names must be unique');
    duplicateCore.close();
    const boundedCore = vault();
    const boundedRepo = new OutreachrRepository(boundedCore);
    const tooMany = Array.from({ length: 33 }, (_, index) => ({ name: `Stage ${index}` }));
    expect(() =>
      boundedRepo.setupWorkspace(
        { displayName: 'Many', primaryEmail: 'founder@example.test', stages: tooMany },
        NOW,
      ),
    ).toThrow();
    boundedCore.close();
    core.close();
  });
});

describe('company and contact CRUD', () => {
  it('creates, lists, and updates companies and contacts with FK enforcement', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    const company = addCompany(repo, NOW);
    expect(repo.listCompanies()).toEqual([company]);
    const updated = repo.updateCompany(
      { id: company.id, name: 'Acme Corp', website: null, location: null },
      LATER,
    );
    expect(updated).toMatchObject({ name: 'Acme Corp', website: null, location: null });
    const contact = addContact(repo, 'contact-jane', 'jane@acme.example', NOW);
    expect(repo.listContacts()).toEqual([contact]);
    const contactUpdated = repo.updateContact(
      { id: contact.id, companyId: null, name: 'Jane Smith', title: null, primaryEmail: null },
      LATER,
    );
    expect(contactUpdated).toMatchObject({ companyId: null, title: null, primaryEmail: null });
    expect(() =>
      repo.createContact(
        { id: 'contact-orphan', companyId: 'company-missing', name: 'Orphan' },
        NOW,
      ),
    ).toThrow();
    core.close();
  });
});

describe('job application lifecycle', () => {
  it('requires workspace setup and writes the initial history in the same transaction', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    const company = addCompany(repo, NOW);
    expect(() =>
      repo.createJobApplication({ id: 'app-1', companyId: company.id, role: 'Engineer', stageId: 'stage-x' }, NOW),
    ).toThrow('Workspace must be set up');
    const stages = setUpWorkspace(repo, NOW);
    const applied = stageByName(stages, 'Applied');
    const detail = addApplication(repo, 'app-1', applied.id, NOW);
    expect(detail.stageName).toBe('Applied');
    expect(detail.company).toMatchObject({ id: 'company-acme', name: 'Acme' });
    expect(detail.stageHistory).toEqual([
      {
        id: expect.any(String),
        applicationId: 'app-1',
        fromStageId: null,
        toStageId: applied.id,
        changedAt: NOW,
        note: null,
      },
    ]);
    expect(verifyAuditChain(core).ok).toBe(true);
    core.close();
  });

  it('transitions along explicit edges and appends history atomically', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    addCompany(repo, NOW);
    const stages = setUpWorkspace(repo, NOW);
    const applied = stageByName(stages, 'Applied');
    const screen = stageByName(stages, 'Screen');
    addApplication(repo, 'app-1', applied.id, NOW);
    const detail = repo.transitionJobApplication({ id: 'app-1', toStageId: screen.id, note: 'Resume looks good' }, LATER);
    expect(detail.stageId).toBe(screen.id);
    expect(detail.stageName).toBe('Screen');
    expect(detail.stageHistory.map((item) => [item.fromStageId, item.toStageId, item.note])).toEqual([
      [null, applied.id, null],
      [applied.id, screen.id, 'Resume looks good'],
    ]);
    expect(verifyAuditChain(core).ok).toBe(true);
    core.close();
  });

  it('rejects self, unallowed, and archived-stage transitions before any mutation', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    addCompany(repo, NOW);
    const stages = setUpWorkspace(repo, NOW);
    const applied = stageByName(stages, 'Applied');
    const interview = stageByName(stages, 'Interview');
    addApplication(repo, 'app-1', applied.id, NOW);
    const historyBefore = Number(core.scalar('SELECT COUNT(*) FROM application_stage_history'));
    const auditBefore = Number(core.scalar('SELECT COUNT(*) FROM audit_log'));

    expect(() =>
      repo.transitionJobApplication({ id: 'app-1', toStageId: applied.id }, LATER),
    ).toThrow('already in that stage');
    expect(() =>
      repo.transitionJobApplication({ id: 'app-1', toStageId: interview.id }, LATER),
    ).toThrow('Stage transition is not allowed');

    // Grant the explicit edge, then the same transition succeeds.
    repo.setApplicationStageTransition(
      { fromStageId: applied.id, toStageId: interview.id, allowed: true },
      LATER,
    );
    const detail = repo.transitionJobApplication(
      { id: 'app-1', toStageId: interview.id },
      LATER,
    );
    expect(detail.stageId).toBe(interview.id);

    // A terminal stage can never be the source of an allowed edge.
    const rejected = stageByName(stages, 'Rejected');
    expect(() =>
      repo.setApplicationStageTransition(
        { fromStageId: rejected.id, toStageId: applied.id, allowed: true },
        LATER,
      ),
    ).toThrow('Terminal stages cannot have outgoing transitions');

    // Archiving a stage blocks transitions into it.
    repo.updateApplicationStage(
      { id: rejected.id, name: rejected.name, position: rejected.position, terminal: true, archived: true },
      LATER,
    );
    expect(() =>
      repo.transitionJobApplication({ id: 'app-1', toStageId: rejected.id }, LATER),
    ).toThrow('Cannot transition into an archived stage');

    // Failed attempts mutated nothing: history and audit only grew on success.
    expect(Number(core.scalar('SELECT COUNT(*) FROM application_stage_history'))).toBe(historyBefore + 1);
    expect(Number(core.scalar('SELECT COUNT(*) FROM audit_log'))).toBeGreaterThan(auditBefore);
    core.close();
  });

  it('keeps stage history append-only and durable across reopen', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    addCompany(repo, NOW);
    const stages = setUpWorkspace(repo, NOW);
    const applied = stageByName(stages, 'Applied');
    const screen = stageByName(stages, 'Screen');
    addApplication(repo, 'app-1', applied.id, NOW);
    repo.transitionJobApplication({ id: 'app-1', toStageId: screen.id }, LATER);
    expect(() => core.run("UPDATE application_stage_history SET note='tampered' WHERE 1=1")).toThrow(
      'append-only',
    );
    expect(() => core.run('DELETE FROM application_stage_history')).toThrow('append-only');
    expect(Number(core.scalar('SELECT COUNT(*) FROM application_stage_history'))).toBe(2);

    const exported = core.export();
    core.close();
    const reopened = new CoreVault(SQL, { bytes: exported, appliedAt: LATER });
    expect(reopened.schemaVersion).toBe(SCHEMA_VERSION);
    const detail = new OutreachrRepository(reopened).getJobApplication('app-1');
    expect(detail.stageHistory).toHaveLength(2);
    expect(detail.stageName).toBe('Screen');
    expect(reopened.integrityCheck().ok).toBe(true);
    reopened.close();
  });
});

describe('application relationships', () => {
  it('links contacts with at most one primary and supports unlinking', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    addCompany(repo, NOW);
    const stages = setUpWorkspace(repo, NOW);
    const applied = stageByName(stages, 'Applied');
    addContact(repo, 'contact-jane', 'jane@acme.example', NOW);
    addContact(repo, 'contact-john', 'john@acme.example', NOW);
    addApplication(repo, 'app-1', applied.id, NOW);

    let detail = repo.linkApplicationContact(
      { applicationId: 'app-1', contactId: 'contact-jane', relationship: 'Hiring manager', primary: true },
      NOW,
    );
    expect(detail.contacts).toEqual([
      expect.objectContaining({ id: 'contact-jane', relationship: 'Hiring manager', primary: true }),
    ]);

    // Promoting a second contact must demote the first (at most one primary).
    detail = repo.linkApplicationContact(
      { applicationId: 'app-1', contactId: 'contact-john', relationship: 'Recruiter', primary: true },
      LATER,
    );
    expect(detail.contacts.map((contact) => [contact.id, contact.primary])).toEqual([
      ['contact-john', true],
      ['contact-jane', false],
    ]);

    // Re-linking updates the relationship in place.
    detail = repo.linkApplicationContact(
      { applicationId: 'app-1', contactId: 'contact-jane', relationship: 'Second interviewer', primary: false },
      LATER,
    );
    expect(detail.contacts.find((contact) => contact.id === 'contact-jane')).toMatchObject({
      relationship: 'Second interviewer',
      primary: false,
    });

    detail = repo.unlinkApplicationContact({ applicationId: 'app-1', contactId: 'contact-john' }, LATER);
    expect(detail.contacts.map((contact) => contact.id)).toEqual(['contact-jane']);
    core.close();
  });

  it('enforces thread uniqueness per application and supports unlinking', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    addCompany(repo, NOW);
    const stages = setUpWorkspace(repo, NOW);
    const applied = stageByName(stages, 'Applied');
    addApplication(repo, 'app-1', applied.id, NOW);
    const thread = {
      applicationId: 'app-1',
      provider: 'google' as const,
      accountEmail: 'founder@example.test',
      providerThreadId: 'thread-1',
    };
    let detail = repo.linkApplicationThread(
      { ...thread, subjectSnapshot: 'Interview reminder' },
      NOW,
    );
    expect(detail.threads).toEqual([
      expect.objectContaining({ providerThreadId: 'thread-1', subjectSnapshot: 'Interview reminder' }),
    ]);
    expect(() =>
      repo.linkApplicationThread({ ...thread, subjectSnapshot: null }, LATER),
    ).toThrow('Thread is already linked to this application');
    detail = repo.unlinkApplicationThread(thread, LATER);
    expect(detail.threads).toEqual([]);
    core.close();
  });
});

describe('application notes and tasks', () => {
  it('creates and updates notes and tasks', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    addCompany(repo, NOW);
    const stages = setUpWorkspace(repo, NOW);
    const applied = stageByName(stages, 'Applied');
    addApplication(repo, 'app-1', applied.id, NOW);

    const note = repo.createApplicationNote({ id: 'note-1', applicationId: 'app-1', body: 'Follow up next week' }, NOW);
    expect(note).toMatchObject({ id: 'note-1', body: 'Follow up next week' });
    expect(repo.updateApplicationNote({ id: 'note-1', body: 'Follow up Monday' }, LATER).body).toBe(
      'Follow up Monday',
    );

    const task = repo.createApplicationTask(
      { id: 'task-1', applicationId: 'app-1', title: 'Send thank-you', notes: 'After interview', dueAt: LATER },
      NOW,
    );
    expect(task).toMatchObject({ title: 'Send thank-you', status: 'open', dueAt: LATER });
    expect(
      repo.updateApplicationTask({ id: 'task-1', status: 'done', notes: null }, LATER),
    ).toMatchObject({ status: 'done', notes: null });

    const detail = repo.getJobApplication('app-1');
    expect(detail.notes.map((item) => item.body)).toEqual(['Follow up Monday']);
    expect(detail.tasks).toEqual([expect.objectContaining({ status: 'done' })]);
    core.close();
  });
});

describe('application list cursor and filters', () => {
  function seedApplications(repo: OutreachrRepository, stages: ApplicationStageRecord[]): void {
    addCompany(repo, NOW);
    const applied = stageByName(stages, 'Applied');
    for (let index = 1; index <= 5; index += 1) {
      addApplication(repo, `app-${index}`, applied.id, NOW);
    }
  }

  it('enforces the 100-row limit and paginates with opaque cursors', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    const stages = setUpWorkspace(repo, NOW);
    seedApplications(repo, stages);
    expect(() => repo.listJobApplications({ limit: 101 })).toThrow();
    expect(() => repo.listJobApplications({ limit: 0 })).toThrow();
    expect(() => repo.listJobApplications({ limit: 2, cursor: 'not-a-cursor' })).toThrow(
      'Invalid application list cursor',
    );

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = repo.listJobApplications({ limit: 2, cursor });
      expect(page.applications.length).toBeLessThanOrEqual(2);
      if (page.nextCursor) {
        expect(page.nextCursor).not.toContain('app-');
        expect(page.nextCursor).not.toBe(page.applications[0]?.id);
      }
      for (const application of page.applications) {
        expect(seen).not.toContain(application.id);
        seen.push(application.id);
      }
      cursor = page.nextCursor ?? undefined;
      pages += 1;
      expect(pages).toBeLessThanOrEqual(4);
    } while (cursor);
    expect(seen.sort()).toEqual(['app-1', 'app-2', 'app-3', 'app-4', 'app-5']);
    core.close();
  });

  it('filters by query, stage, company, and task status', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    const stages = setUpWorkspace(repo, NOW);
    const applied = stageByName(stages, 'Applied');
    const screen = stageByName(stages, 'Screen');
    addCompany(repo, NOW);
    addApplication(repo, 'app-1', applied.id, NOW);
    addApplication(repo, 'app-2', screen.id, NOW);
    repo.createApplicationTask({ id: 'task-open', applicationId: 'app-1', title: 'Call' }, NOW);

    expect(repo.listJobApplications({ limit: 10, query: 'Engineer app-2' }).applications.map((app) => app.id)).toEqual(['app-2']);
    expect(repo.listJobApplications({ limit: 10, stageIds: [applied.id] }).applications.map((app) => app.id)).toEqual(['app-1']);
    expect(repo.listJobApplications({ limit: 10, companyId: 'company-acme' }).applications).toHaveLength(2);
    expect(repo.listJobApplications({ limit: 10, taskStatus: 'open' }).applications.map((app) => app.id)).toEqual(['app-1']);
    expect(repo.listJobApplications({ limit: 10, taskStatus: 'done' }).applications).toEqual([]);
    core.close();
  });
});

describe('application-bound drafts', () => {
  function seeded(repo: OutreachrRepository): { applied: ApplicationStageRecord } {
    addCompany(repo, NOW);
    const stages = setUpWorkspace(repo, NOW);
    const applied = stageByName(stages, 'Applied');
    addContact(repo, 'contact-jane', 'jane@acme.example', NOW);
    addApplication(repo, 'app-1', applied.id, NOW);
    repo.linkApplicationContact(
      { applicationId: 'app-1', contactId: 'contact-jane', relationship: 'Hiring manager', primary: true },
      NOW,
    );
    return { applied };
  }

  it('persists a bound initial draft and hashes its exact content', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    seeded(repo);
    const draft = repo.createApplicationDraft(
      {
        id: 'draft-1',
        applicationId: 'app-1',
        contactId: 'contact-jane',
        provider: 'google',
        accountEmail: 'founder@example.test',
        kind: 'initial',
        subject: 'Thank you for the interview',
        bodyText: 'Dear Jane, thank you for your time.',
      },
      NOW,
    );
    expect(draft).toMatchObject({
      id: 'draft-1',
      recipientName: 'Contact contact-jane',
      recipientEmail: 'jane@acme.example',
      kind: 'initial',
      threadId: null,
    });
    expect(draft.contentHash).toMatch(/^[a-f0-9]{64}$/);
    const row = core.one<{ application_id: string | null; application_contact_id: string | null }>(
      'SELECT application_id,application_contact_id FROM messages WHERE id=?',
      ['draft-1'],
    );
    expect(row).toEqual({ application_id: 'app-1', application_contact_id: 'contact-jane' });
    core.close();
  });

  it('rejects unlinked contacts, missing primary email, and inconsistent kind/thread pairs', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    seeded(repo);
    const base = {
      applicationId: 'app-1',
      contactId: 'contact-jane',
      provider: 'google' as const,
      accountEmail: 'founder@example.test',
      subject: 'Subject',
      bodyText: 'Body',
    };
    expect(() =>
      repo.createApplicationDraft({ ...base, contactId: 'contact-missing', kind: 'initial' }, NOW),
    ).toThrow('Draft contact is not linked to this application');
    repo.createContact(
      { id: 'contact-unlinked', companyId: 'company-acme', name: 'No Email', primaryEmail: null },
      NOW,
    );
    repo.linkApplicationContact(
      { applicationId: 'app-1', contactId: 'contact-unlinked', relationship: 'Recruiter', primary: false },
      NOW,
    );
    expect(() =>
      repo.createApplicationDraft({ ...base, contactId: 'contact-unlinked', kind: 'initial' }, NOW),
    ).toThrow('Draft contact must have a primary email');
    expect(() =>
      repo.createApplicationDraft({ ...base, kind: 'reply' }, NOW),
    ).toThrow('A reply draft requires a provider thread');
    expect(() =>
      repo.createApplicationDraft({ ...base, kind: 'initial', threadId: 'thread-1' }, NOW),
    ).toThrow('cannot be attached to a provider thread');
    core.close();
  });

  it('enforces one owned application context and immutable draft context', () => {
    const core = vault();
    const repo = new OutreachrRepository(core);
    const { applied } = seeded(repo);
    repo.createApplicationDraft(
      {
        id: 'draft-1',
        applicationId: 'app-1',
        contactId: 'contact-jane',
        provider: 'google',
        accountEmail: 'founder@example.test',
        kind: 'reply',
        subject: 'Re: Interview',
        bodyText: 'Thanks again.',
        threadId: 'thread-1',
      },
      NOW,
    );
    // The binding columns must be set together.
    expect(() =>
      core.run(
        `INSERT INTO messages(id,recipient_address,recipient_normalized,subject,body_text,application_id,created_at,updated_at)
         VALUES ('draft-broken','a@b.example','a@b.example','S','B','app-1',?,?)`,
        [NOW, NOW],
      ),
    ).toThrow();
    // A draft cannot be reparented after creation.
    expect(() =>
      core.run("UPDATE messages SET application_contact_id='contact-jane' WHERE id='draft-1'"),
    ).toThrow('immutable');
    // Legacy unbound messages remain insertable and readable.
    core.run(
      `INSERT INTO messages(id,recipient_address,recipient_normalized,subject,body_text,created_at,updated_at)
       VALUES ('draft-legacy','legacy@example.test','legacy@example.test','Old','Body',?,?)`,
      [NOW, NOW],
    );
    expect(
      core.one<{ application_id: string | null }>(
        'SELECT application_id FROM messages WHERE id=?',
        ['draft-legacy'],
      ),
    ).toEqual({ application_id: null });
    core.close();
  });
});

describe('v10 migration from a v9 vault', () => {
  it('migrates a v9 vault, adds draft binding columns, and keeps legacy messages readable', () => {
    const legacy = new SQL.Database();
    for (const migration of MIGRATIONS.filter((item) => item.version <= 9)) {
      legacy.run(migration.sql);
      legacy.run('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)', [
        migration.version,
        migration.name,
        NOW,
      ]);
      legacy.run(`PRAGMA user_version=${migration.version}`);
    }
    legacy.run(
      `INSERT INTO messages(id,recipient_address,recipient_normalized,subject,body_text,created_at,updated_at)
       VALUES ('message-legacy','legacy@example.test','legacy@example.test','Legacy subject','Legacy body',?,?)`,
      [NOW, NOW],
    );
    const bytes = legacy.export();
    legacy.close();

    const migrated = new CoreVault(SQL, { bytes, appliedAt: LATER });
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(Number(migrated.scalar('SELECT COUNT(*) FROM schema_migrations'))).toBe(SCHEMA_VERSION);
    const columns = migrated.all<{ name: string }>('PRAGMA table_info(messages)').map((column) => column.name);
    expect(columns).toEqual(
      expect.arrayContaining(['application_id', 'application_contact_id', 'reply_to_message_id']),
    );
    expect(
      migrated.one<{ application_id: string | null; subject: string }>(
        'SELECT application_id,subject FROM messages WHERE id=?',
        ['message-legacy'],
      ),
    ).toEqual({ application_id: null, subject: 'Legacy subject' });
    expect(migrated.integrityCheck().ok).toBe(true);
    migrated.close();
  });
});
