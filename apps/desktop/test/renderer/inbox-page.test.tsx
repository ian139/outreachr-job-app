import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  GetMailThreadRequest,
  MailMessageBody,
  MailThreadListPage,
  MailThreadPage,
  MailThreadSummary,
} from '../../src/shared/contracts';
import { InboxPage } from '../../src/renderer/src/pages/InboxPage';
import { WorkspaceProvider } from '../../src/renderer/src/state/WorkspaceContext';
import { bootstrapFixture, installBridge } from './fixtures';

const mockThreadSummary1: MailThreadSummary = {
  provider: 'google',
  accountEmail: 'founder@example.com',
  threadId: 'thread_1',
  subject: 'Job Application Followup',
  snippet: 'Thanks for submitting your application. We would love to schedule a interview.',
  participants: ['recruiter@company.com', 'founder@example.com'],
  latestAt: new Date('2026-08-10T14:30:00Z').toISOString(),
  messageCount: 2,
  sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/thread_1',
};

const mockThreadSummary2: MailThreadSummary = {
  provider: 'google',
  accountEmail: 'founder@example.com',
  threadId: 'thread_2',
  subject: 'Software Engineer Application Status',
  snippet: 'Status update regarding your recent application.',
  participants: ['hr@techcorp.com', 'founder@example.com'],
  latestAt: new Date('2026-08-09T10:00:00Z').toISOString(),
  messageCount: 1,
  sourceUrl: null,
};

const mockMessage1: MailMessageBody = {
  provider: 'google',
  accountEmail: 'founder@example.com',
  threadId: 'thread_1',
  messageId: 'msg_1',
  internetMessageId: '<msg1@company.com>',
  subject: 'Job Application Followup',
  from: { email: 'recruiter@company.com', name: 'Recruiter' },
  to: [{ email: 'founder@example.com', name: 'Applicant' }],
  cc: [],
  occurredAt: new Date('2026-08-10T14:30:00Z').toISOString(),
  labels: ['INBOX'],
  direction: 'inbound',
  bodyText: 'Thanks for submitting your application. We would love to schedule an interview.',
  bodyHtml: `
    <p>Thanks for submitting your application. We would love to schedule an interview.</p>
    <p>Schedule here: <a href="https://cal.example.com/interview">Interview Portal</a></p>
    <script>alert("hacked")</script>
  `,
  providerTruncated: false,
  truncationReason: null,
  sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/msg_1',
  fetchedAt: new Date().toISOString(),
};

const mockMessageHtmlOnly: MailMessageBody = {
  provider: 'google',
  accountEmail: 'founder@example.com',
  threadId: 'thread_1',
  messageId: 'msg_html_only',
  internetMessageId: '<msg2@company.com>',
  subject: 'Re: Job Application Followup',
  from: { email: 'recruiter@company.com', name: 'Recruiter' },
  to: [{ email: 'founder@example.com', name: 'Applicant' }],
  cc: [],
  occurredAt: new Date('2026-08-10T15:00:00Z').toISOString(),
  labels: ['INBOX'],
  direction: 'inbound',
  bodyText: null, // HTML-only message with null bodyText
  bodyHtml: '<p>HTML only message body with <strong>bold detail</strong>.</p>',
  providerTruncated: false,
  truncationReason: null,
  sourceUrl: null,
  fetchedAt: new Date().toISOString(),
};

const mockMessage2Truncated: MailMessageBody = {
  provider: 'google',
  accountEmail: 'founder@example.com',
  threadId: 'thread_1',
  messageId: 'msg_2',
  internetMessageId: '<msg3@company.com>',
  subject: 'Re: Job Application Followup',
  from: { email: 'founder@example.com', name: 'Applicant' },
  to: [{ email: 'recruiter@company.com', name: 'Recruiter' }],
  cc: [],
  occurredAt: new Date('2026-08-10T15:30:00Z').toISOString(),
  labels: ['SENT'],
  direction: 'outbound',
  bodyText: 'Sounds great! Tuesday works best for me.',
  bodyHtml: '<p>Sounds great! Tuesday works best for me.</p>',
  providerTruncated: true,
  truncationReason: 'Body exceeds maximum connector size limit',
  sourceUrl: null,
  fetchedAt: new Date().toISOString(),
};

function setupInboxFixture() {
  const fixture = bootstrapFixture();
  fixture.connectors = [
    {
      provider: 'google',
      state: 'connected',
      accountEmail: 'founder@example.com',
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      relationshipSync: true,
      lastSyncAt: new Date().toISOString(),
      error: null,
      encryptionAvailable: true,
    },
  ];

  const listMailThreads = vi.fn(async (): Promise<MailThreadListPage> => {
    return {
      threads: [mockThreadSummary1, mockThreadSummary2],
      nextCursor: 'cursor_page_2',
    };
  });

  const getMailThread = vi.fn(async (req: GetMailThreadRequest): Promise<MailThreadPage> => {
    if (req.cursor === 'detail_cursor_2') {
      return {
        thread: mockThreadSummary1,
        messages: [mockMessageHtmlOnly],
        nextCursor: null,
      };
    }
    return {
      thread: mockThreadSummary1,
      messages: [mockMessage1, mockMessage2Truncated],
      nextCursor: 'detail_cursor_2',
    };
  });

  const cancelMailRequest = vi.fn(async (): Promise<void> => {});
  const openExternal = vi.fn(async (): Promise<void> => {});

  const bridge = installBridge(fixture);
  bridge.listMailThreads = listMailThreads;
  bridge.getMailThread = getMailThread;
  bridge.cancelMailRequest = cancelMailRequest;
  bridge.openExternal = openExternal;

  return { bridge, listMailThreads, getMailThread, cancelMailRequest, openExternal };
}

function renderInboxPage() {
  return render(
    <WorkspaceProvider>
      <InboxPage />
    </WorkspaceProvider>,
  );
}

describe('InboxPage component & messaging behavior', () => {
  it('renders thread list, filters threads, and displays updated copy', async () => {
    const { listMailThreads } = setupInboxFixture();
    renderInboxPage();

    // Check header copy for job-application communications
    expect(await screen.findByRole('heading', { name: 'Inbox' })).toBeInTheDocument();
    expect(
      screen.getByText(/Read email conversations and sync job-application communications/i),
    ).toBeInTheDocument();

    // Verify threads rendered
    expect(await screen.findByText('Job Application Followup')).toBeInTheDocument();
    expect(screen.getByText('Software Engineer Application Status')).toBeInTheDocument();

    // Verify pagination button for list
    const loadMoreButton = screen.getByRole('button', { name: /load more threads/i });
    expect(loadMoreButton).toBeInTheDocument();

    fireEvent.click(loadMoreButton);
    expect(listMailThreads).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: 'cursor_page_2',
        accountEmail: 'founder@example.com',
      }),
    );

    // Verify loaded-row search input
    const searchInput = screen.getByPlaceholderText('Search mail...');
    fireEvent.change(searchInput, { target: { value: 'Followup' } });

    expect(await screen.findByText('Job Application Followup')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Software Engineer Application Status')).not.toBeInTheDocument(),
    );
  });

  it('selects a thread, loads messages, and handles detail cursor pagination', async () => {
    const { getMailThread, cancelMailRequest } = setupInboxFixture();
    renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    await waitFor(() => {
      expect(getMailThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread_1',
          accountEmail: 'founder@example.com',
        }),
      );
    });

    // Detail pagination button should be present
    const loadMoreMessagesBtn = await screen.findByRole('button', {
      name: /load more messages/i,
    });
    expect(loadMoreMessagesBtn).toBeInTheDocument();

    fireEvent.click(loadMoreMessagesBtn);

    await waitFor(() => {
      expect(getMailThread).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: 'thread_1',
          cursor: 'detail_cursor_2',
        }),
      );
    });

    // Verify newly appended message from page 2 appears
    expect(await screen.findByText(/HTML only message body with/i)).toBeInTheDocument();

    // Rapid selection of second thread to test cancellation call
    const thread2Card = screen.getByText('Software Engineer Application Status');
    fireEvent.click(thread2Card);

    expect(cancelMailRequest).toHaveBeenCalled();
  });

  it('provides plain text fallback extracted from HTML for HTML-only messages', async () => {
    setupInboxFixture();
    renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    // Load detail page 2 which has HTML-only message
    const loadMoreMessagesBtn = await screen.findByRole('button', {
      name: /load more messages/i,
    });
    fireEvent.click(loadMoreMessagesBtn);

    // Switch to plain text view
    const plainButton = await screen.findByRole('button', { name: 'View plain text' });
    fireEvent.click(plainButton);

    // Verify HTML-only message plain text fallback works without displaying '(No text content)'
    expect(await screen.findByText('HTML only message body with bold detail.')).toBeInTheDocument();
    expect(screen.queryByText('(No text content)')).not.toBeInTheDocument();
  });

  it('ignores stale thread detail response if requestId is mismatched', async () => {
    const fixture = bootstrapFixture();
    fixture.connectors = [
      {
        provider: 'google',
        state: 'connected',
        accountEmail: 'founder@example.com',
        scopes: [],
        relationshipSync: true,
        lastSyncAt: null,
        error: null,
        encryptionAvailable: true,
      },
    ];

    const { promise: delayedPromise, resolve: delayedResolve } =
      Promise.withResolvers<MailThreadPage>();
    const getMailThread = vi.fn(() => delayedPromise);

    const bridge = installBridge(fixture);
    bridge.listMailThreads = vi.fn(async () => ({
      threads: [mockThreadSummary1, mockThreadSummary2],
      nextCursor: null,
    }));
    bridge.getMailThread = getMailThread;
    bridge.cancelMailRequest = vi.fn(async () => {});

    renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    // While request 1 is pending, click thread 2
    const thread2Card = screen.getByText('Software Engineer Application Status');
    fireEvent.click(thread2Card);

    // Resolve the first delayed promise now (stale response)
    delayedResolve({
      thread: mockThreadSummary1,
      messages: [mockMessage1],
      nextCursor: null,
    });

    // Thread 1's subject should NOT be active detail heading if request was stale
    await waitFor(() => {
      expect(
        screen.queryByRole('heading', { name: 'Job Application Followup' }),
      ).not.toBeInTheDocument();
    });
  });

  it('toggles plain vs rich text view and intercepts rich link clicks without console errors', async () => {
    const { openExternal } = setupInboxFixture();
    renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    // Rich view is default
    const richButton = await screen.findByRole('button', { name: 'View rich content' });
    const plainButton = screen.getByRole('button', { name: 'View plain text' });

    expect(richButton).toHaveClass('active');

    // Rich view sanitized HTML check (script stripped, link present)
    const link = await screen.findByRole('link', { name: 'Interview Portal' });
    expect(link).toHaveAttribute('href', 'https://cal.example.com/interview');
    expect(screen.queryByText(/alert\("hacked"\)/)).not.toBeInTheDocument();

    // Click link -> openExternal intercept
    fireEvent.click(link);
    expect(openExternal).toHaveBeenCalledWith('https://cal.example.com/interview');

    // Switch to plain text view
    fireEvent.click(plainButton);
    expect(plainButton).toHaveClass('active');
    expect(
      screen.getByText(
        'Thanks for submitting your application. We would love to schedule an interview.',
      ),
    ).toBeInTheDocument();
  });

  it('displays provider-truncated alert and source links', async () => {
    const { openExternal } = setupInboxFixture();
    renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    // Truncated alert banner
    expect(await screen.findByText(/Message content truncated by provider/i)).toBeInTheDocument();
    expect(screen.getByText(/Body exceeds maximum connector size limit/i)).toBeInTheDocument();

    // Source link
    const sourceButtons = screen.getAllByRole('button', { name: /view in provider|source/i });
    expect(sourceButtons.length).toBeGreaterThan(0);

    fireEvent.click(sourceButtons[0]);
    expect(openExternal).toHaveBeenCalledWith('https://mail.google.com/mail/u/0/#inbox/thread_1');
  });

  it('handles mobile Back to inbox button navigation and unmount cleanup', async () => {
    const { cancelMailRequest } = setupInboxFixture();
    const { unmount } = renderInboxPage();

    const thread1Card = await screen.findByText('Job Application Followup');
    fireEvent.click(thread1Card);

    const backButton = await screen.findByRole('button', { name: /back to inbox/i });
    expect(backButton).toBeInTheDocument();

    fireEvent.click(backButton);
    // Detail pane hidden in mobile mode
    expect(
      screen.queryByRole('heading', { name: 'Job Application Followup' }),
    ).not.toBeInTheDocument();

    unmount();
    expect(cancelMailRequest).toHaveBeenCalled();
  });
});
