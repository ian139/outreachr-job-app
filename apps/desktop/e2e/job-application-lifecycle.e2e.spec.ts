import {
  assertZeroLiveSends,
  connectGoogleRelationshipSync,
  expect,
  navigate,
  setupJobWorkspace,
  test,
} from './fixtures';

test.describe('Job Application Lifecycle & Record Management', () => {
  test('executes workspace setup, company/contact/application creation, stage transition, notes/tasks, thread linking, draft approval enforcement, and persistence reload', async ({
    page,
    googleProviderMock,
    rendererErrors,
  }) => {
    // 1. Setup workspace with candidate profile and connect Google account
    await setupJobWorkspace(page);
    await connectGoogleRelationshipSync(page);

    // 2. Navigate to Applications page
    await navigate(page, 'Applications');
    await expect(page.getByRole('heading', { name: 'Job Applications' })).toBeVisible();

    // 3. New application -> + New company workflow
    await page.getByRole('button', { name: 'New application', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'New application' })).toBeVisible();

    await page.getByRole('button', { name: '+ New company' }).click();
    await expect(page.getByRole('dialog', { name: 'New company' })).toBeVisible();

    await page.getByLabel('Company name').fill('TechCorp Solutions');
    await page.getByLabel('Website').fill('https://techcorp.test');
    await page.getByLabel('Location').fill('San Francisco, CA');
    await page.getByRole('button', { name: 'Create company' }).click();

    await page.getByLabel('Select company').selectOption({ label: 'TechCorp Solutions' });
    await page.getByLabel('Role title').fill('Senior Full Stack Engineer');
    await page.getByLabel('Select stage').selectOption({ label: 'Applied' });
    await page.getByRole('button', { name: 'New application', exact: true }).click();

    // Assert Application detail view loaded
    await expect(
      page.getByRole('heading', { name: 'Senior Full Stack Engineer' }),
    ).toBeVisible();
    await expect(page.getByText('TechCorp Solutions')).toBeVisible();

    // 4. Link contact workflow -> + New contact
    await page.getByRole('button', { name: 'Link contact' }).click();
    await expect(page.getByRole('dialog', { name: 'Link contact' })).toBeVisible();

    await page.getByRole('button', { name: '+ New contact' }).click();
    await expect(page.getByRole('dialog', { name: 'New contact' })).toBeVisible();

    await page.getByLabel('Contact name').fill('Jane Recruiter');
    await page.getByLabel('Title / Role').fill('Talent Partner');
    await page.getByLabel('Email address').fill('jane.recruiter@techcorp.test');
    await page.getByRole('button', { name: 'Create contact' }).click();

    await page.getByLabel('Primary point of contact for this application').check();
    await page.getByRole('button', { name: 'Link contact', exact: true }).click();
    await expect(page.getByText('Jane Recruiter')).toBeVisible();

    // 5. Valid stage transition and stage history recording
    await page.getByRole('button', { name: 'Change stage' }).click();
    await page.getByLabel('Target stage').selectOption({ label: 'Interviewing' });
    await page.getByLabel('Transition note (optional)').fill('Passed recruiter screen');
    await page.getByRole('button', { name: 'Confirm stage change' }).click();

    await expect(page.locator('.stage-badge', { hasText: 'Interviewing' })).toBeVisible();
    await expect(page.getByText('Applied → Interviewing')).toBeVisible();

    // 6. Notes and Tasks
    await page.getByRole('button', { name: 'Add note' }).click();
    await page
      .getByLabel('Note body')
      .fill('Completed phone screen with Jane. Technical interview scheduled.');
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(
      page.getByText('Completed phone screen with Jane. Technical interview scheduled.'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByLabel('Task title').fill('System design interview preparation');
    await page.getByRole('button', { name: 'Save task' }).click();
    await expect(
      page.getByText('System design interview preparation'),
    ).toBeVisible();

    // 7. Link Thread
    await page.getByRole('button', { name: '+ Link thread' }).click();
    await expect(page.getByRole('dialog', { name: 'Link thread' })).toBeVisible();
    await page.getByLabel('Account email').fill('ada@local.test');
    await page.getByLabel('Provider thread ID').fill('thread-plain-text');
    await page.getByLabel('Subject snapshot').fill('Senior Software Engineer Interview');
    await page.getByRole('button', { name: 'Link thread', exact: true }).click();
    await expect(page.getByText('Senior Software Engineer Interview')).toBeVisible();

    // 8. Draft Review and Approval Enforcement with No Live Send
    await page.getByRole('button', { name: 'Prepare reply' }).click();
    await expect(page.getByRole('dialog', { name: 'Prepare reply' })).toBeVisible();

    await page.getByLabel('Subject').fill('Re: Senior Software Engineer Interview');
    await page
      .getByLabel('Message body')
      .fill('Thank you for setting up the technical interview. I look forward to speaking.');
    await page.getByRole('button', { name: 'Prepare reply', exact: true }).click();

    // Open review modal on created draft
    await page.getByRole('button', { name: 'Review draft' }).click();
    await expect(page.getByRole('dialog', { name: 'Review draft' })).toBeVisible();

    // Verify "Send draft" button is ABSENT before approval
    const sendDraftButton = page.getByRole('button', { name: 'Send draft' });
    await expect(sendDraftButton).toHaveCount(0);

    // Click "Approve draft" -> "Send draft" button appears enabled
    await page.getByRole('button', { name: 'Approve draft' }).click();
    await expect(sendDraftButton).toBeVisible();
    await expect(sendDraftButton).toBeEnabled();

    // DO NOT CLICK SEND. Assert zero live network send attempts
    assertZeroLiveSends(googleProviderMock);

    // Close review modal
    await page.getByRole('button', { name: 'Close' }).click();

    // 9. Reload page and assert all state persists intact
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await expect(
      page.getByRole('heading', { name: 'Senior Full Stack Engineer' }),
    ).toBeVisible();
    await expect(page.locator('.stage-badge', { hasText: 'Interviewing' })).toBeVisible();
    await expect(page.getByText('Applied → Interviewing')).toBeVisible();
    await expect(
      page.getByText('Completed phone screen with Jane. Technical interview scheduled.'),
    ).toBeVisible();
    await expect(
      page.getByText('System design interview preparation'),
    ).toBeVisible();
    await expect(page.getByText('Jane Recruiter')).toBeVisible();
    await expect(page.getByText('Senior Software Engineer Interview')).toBeVisible();

    expect(rendererErrors).toEqual([]);
  });
});
