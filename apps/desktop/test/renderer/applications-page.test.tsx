import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HashRouter } from '../../src/renderer/src/lib/router';
import { WorkspaceProvider } from '../../src/renderer/src/state/WorkspaceContext';
import { ApplicationsPage } from '../../src/renderer/src/pages/ApplicationsPage';
import { bootstrapFixture, installBridge } from './fixtures';
import type { ApplicationDetail, ApplicationSummary, Company, Contact, DraftMessage, OutreachrBridge } from '../../src/shared/contracts';

function renderApplicationsPage(props = {}): void {
  window.location.hash = '#/applications';
  render(
    <HashRouter>
      <WorkspaceProvider>
        <ApplicationsPage {...props} />
      </WorkspaceProvider>
    </HashRouter>,
  );
}

const mockCompany: Company = {
  id: 'company-1',
  name: 'Acme Corp',
  website: 'https://acme.com',
  location: 'San Francisco, CA',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockContact: Contact = {
  id: 'contact-1',
  companyId: 'company-1',
  name: 'Jane Doe',
  title: 'Recruiter',
  primaryEmail: 'jane@acme.com',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const mockSummary: ApplicationSummary = {
  id: 'app-1',
  companyId: 'company-1',
  companyName: 'Acme Corp',
  role: 'Software Engineer',
  stageId: 'stage-applied',
  stageName: 'Applied',
  sourceUrl: 'https://careers.acme.com/123',
  appliedAt: '2026-08-10T10:00:00.000Z',
  nextEventAt: null,
  createdAt: '2026-08-10T10:00:00.000Z',
  updatedAt: '2026-08-10T10:00:00.000Z',
};

const mockDetail: ApplicationDetail = {
  ...mockSummary,
  company: mockCompany,
  contacts: [{ ...mockContact, relationship: 'Recruiter', primary: true }],
  threads: [
    {
      applicationId: 'app-1',
      provider: 'google',
      accountEmail: 'user@example.com',
      providerThreadId: 'thread-123',
      subjectSnapshot: 'Interview invitation',
      linkedAt: '2026-08-10T10:00:00.000Z',
    },
  ],
  notes: [
    {
      id: 'note-1',
      applicationId: 'app-1',
      body: 'Recruiter screen scheduled for Friday.',
      createdAt: '2026-08-10T11:00:00.000Z',
      updatedAt: '2026-08-10T11:00:00.000Z',
    },
  ],
  tasks: [
    {
      id: 'task-1',
      applicationId: 'app-1',
      title: 'Prepare system design notes',
      notes: null,
      dueAt: '2026-08-15T00:00:00.000Z',
      status: 'open',
      createdAt: '2026-08-10T11:00:00.000Z',
      updatedAt: '2026-08-10T11:00:00.000Z',
    },
  ],
  stageHistory: [
    {
      id: 'hist-1',
      applicationId: 'app-1',
      fromStageId: null,
      toStageId: 'stage-applied',
      changedAt: '2026-08-10T10:00:00.000Z',
      note: 'Application submitted online',
    },
  ],
};

const mockDraft: DraftMessage = {
  id: 'draft-1',
  provider: 'google',
  accountEmail: 'user@example.com',
  personId: 'contact-1',
  recipientName: 'Jane Doe',
  recipientEmail: 'jane@acme.com',
  subject: 'Re: Interview invitation',
  bodyText: 'Thank you for reaching out. Friday at 2pm works great for me.',
  threadId: 'thread-123',
  kind: 'reply',
  contentHash: 'hash-abc-123',
  approvalState: 'draft',
  blockReason: null,
  canApprove: true,
  canSend: false,
  approvalBlockReasons: [],
  sendBlockReasons: ['Must be approved before sending'],
  approvedAt: null,
  sentAt: null,
  providerMessageId: null,
};

describe('Applications Page & Detailed Components', () => {
  it('renders application records, supports searching and switching to pipeline view', async () => {
    const fixture = bootstrapFixture();
    fixture.companies = [mockCompany];
    fixture.contacts = [mockContact];
    fixture.applicationStages = [
      { id: 'stage-applied', name: 'Applied', position: 1, terminal: false, archived: false, createdAt: '', updatedAt: '' },
      { id: 'stage-interview', name: 'Interview', position: 2, terminal: false, archived: false, createdAt: '', updatedAt: '' },
    ];
    fixture.applications = [mockSummary];

    const command = vi.fn(async (name: string) => {
      if (name === 'application.list') {
        return { applications: [mockSummary], nextCursor: null };
      }
      if (name === 'application.get') {
        return mockDetail;
      }
      throw new Error(`Unexpected command in test: ${name}`);
    });

    installBridge(fixture, command as unknown as OutreachrBridge['command']);
    renderApplicationsPage();

    expect(await screen.findByRole('heading', { name: 'Job Applications' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'New application' })).toBeVisible();

    // Check application item listed
    expect(await screen.findByText('Software Engineer')).toBeVisible();
    expect(screen.getByText('Acme Corp')).toBeVisible();

    // Switch view mode to Pipeline
    fireEvent.click(screen.getByRole('button', { name: 'Pipeline' }));
    expect(screen.getByRole('button', { name: 'Pipeline' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Applied')).toBeVisible();
  });

  it('selects application, shows details, excludes current stage from transition target, calls openExternal for website, and supports onNavigateThread', async () => {
    const fixture = bootstrapFixture();
    fixture.companies = [mockCompany];
    fixture.contacts = [mockContact];
    fixture.applicationStages = [
      { id: 'stage-applied', name: 'Applied', position: 1, terminal: false, archived: false, createdAt: '', updatedAt: '' },
      { id: 'stage-interview', name: 'Interview', position: 2, terminal: false, archived: false, createdAt: '', updatedAt: '' },
    ];
    fixture.applications = [mockSummary];

    const updatedDetail: ApplicationDetail = {
      ...mockDetail,
      stageId: 'stage-interview',
      stageName: 'Interview',
      stageHistory: [
        ...mockDetail.stageHistory,
        {
          id: 'hist-2',
          applicationId: 'app-1',
          fromStageId: 'stage-applied',
          toStageId: 'stage-interview',
          changedAt: new Date().toISOString(),
          note: 'Passed initial screening',
        },
      ],
    };

    const command = vi.fn(async (name: string, payload: unknown) => {
      if (name === 'application.list') return { applications: [mockSummary], nextCursor: null };
      if (name === 'application.get') return mockDetail;
      if (name === 'application.transition') {
        expect(payload).toEqual({
          id: 'app-1',
          toStageId: 'stage-interview',
          note: 'Passed initial screening',
        });
        return updatedDetail;
      }
      throw new Error(`Unexpected command: ${name}`);
    });

    const openExternalSpy = vi.fn();
    const bridge = installBridge(fixture, command as unknown as OutreachrBridge['command']);
    bridge.openExternal = openExternalSpy;

    const onNavigateThreadSpy = vi.fn();
    renderApplicationsPage({ onNavigateThread: onNavigateThreadSpy });

    // Click row to view details
    fireEvent.click(await screen.findByText('Software Engineer'));

    await waitFor(() => {
      expect(command).toHaveBeenCalledWith('application.get', { id: 'app-1' });
    });

    expect(await screen.findByRole('button', { name: 'Back to applications' })).toBeVisible();

    // Verify company open external website button
    const openWebsiteBtn = screen.getByRole('button', { name: 'Open website' });
    fireEvent.click(openWebsiteBtn);
    expect(openExternalSpy).toHaveBeenCalledWith('https://acme.com');

    // Verify view related thread button
    const viewThreadBtn = screen.getByRole('button', { name: 'View related thread' });
    fireEvent.click(viewThreadBtn);
    expect(onNavigateThreadSpy).toHaveBeenCalledWith('thread-123', 'google', 'user@example.com');

    // Trigger stage change
    fireEvent.click(screen.getByRole('button', { name: 'Change stage' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Transition note (optional)' }), {
      target: { value: 'Passed initial screening' },
    });

    // Verify current stage (stage-applied) is excluded from target stage select options
    const select = screen.getByRole('combobox', { name: 'Target stage' }) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain('stage-applied');
    expect(optionValues).toContain('stage-interview');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm stage change' }));

    await waitFor(() => {
      expect(command).toHaveBeenCalledWith('application.transition', {
        id: 'app-1',
        toStageId: 'stage-interview',
        note: 'Passed initial screening',
      });
    });

    // Test mobile back button
    fireEvent.click(screen.getByRole('button', { name: 'Back to applications' }));
    expect(screen.queryByRole('button', { name: 'Back to applications' })).not.toBeInTheDocument();
  });

  it('supports Prepare reply draft creation and explicit Review draft approve/send controls with application context', async () => {
    const fixture = bootstrapFixture();
    fixture.companies = [mockCompany];
    fixture.contacts = [mockContact];
    fixture.applicationStages = [
      { id: 'stage-applied', name: 'Applied', position: 1, terminal: false, archived: false, createdAt: '', updatedAt: '' },
    ];
    fixture.applications = [mockSummary];
    fixture.drafts = [mockDraft];

    const approvedDraft: DraftMessage = {
      ...mockDraft,
      approvalState: 'approved',
      canApprove: false,
      canSend: true,
      sendBlockReasons: [],
      approvedAt: new Date().toISOString(),
    };

    const sentDraft: DraftMessage = {
      ...approvedDraft,
      approvalState: 'sent',
      canSend: false,
      sentAt: new Date().toISOString(),
    };

    const command = vi.fn(async (name: string, payload: unknown) => {
      if (name === 'application.list') return { applications: [mockSummary], nextCursor: null };
      if (name === 'application.get') return mockDetail;
      if (name === 'draft.approve') {
        expect(payload).toEqual({ id: 'draft-1', expectedContentHash: 'hash-abc-123' });
        return approvedDraft;
      }
      if (name === 'draft.send') {
        expect(payload).toEqual({ id: 'draft-1', expectedContentHash: 'hash-abc-123' });
        return sentDraft;
      }
      throw new Error(`Unexpected command: ${name}`);
    });

    installBridge(fixture, command as unknown as OutreachrBridge['command']);
    renderApplicationsPage();

    // Select application to open details
    fireEvent.click(await screen.findByText('Software Engineer'));
    expect(await screen.findByRole('button', { name: 'Prepare reply' })).toBeVisible();

    // Review draft button
    expect(screen.getByRole('button', { name: 'Review draft' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Review draft' }));

    // Review dialog displays metadata, application context (Software Engineer at Acme Corp), subject, body, content hash, approval controls
    expect(await screen.findByRole('heading', { name: 'Review draft' })).toBeVisible();
    expect(screen.getByText('Software Engineer at Acme Corp')).toBeVisible();
    expect(screen.getByText('Re: Interview invitation')).toBeVisible();
    expect(screen.getByText('Thank you for reaching out. Friday at 2pm works great for me.')).toBeVisible();

    // Explicit Approve
    const approveBtn = screen.getByRole('button', { name: 'Approve draft' });
    fireEvent.click(approveBtn);

    await waitFor(() => {
      expect(command).toHaveBeenCalledWith('draft.approve', {
        id: 'draft-1',
        expectedContentHash: 'hash-abc-123',
      });
    });

    // Explicit Send
    expect(await screen.findByRole('button', { name: 'Send draft' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Send draft' }));

    await waitFor(() => {
      expect(command).toHaveBeenCalledWith('draft.send', {
        id: 'draft-1',
        expectedContentHash: 'hash-abc-123',
      });
    });
  });
});
