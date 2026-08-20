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
    await page.getByRole('button', { name: 'New application', exact: true }).first().click();
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
    await page
      .getByRole('dialog', { name: 'New application' })
      .getByRole('button', { name: 'New application', exact: true })
      .click();

    // Assert Application detail view loaded
    await expect(page.getByRole('heading', { name: 'Senior Full Stack Engineer' })).toBeVisible();
    await expect(
      page.getByLabel('Application details').getByText('TechCorp Solutions', { exact: true }),
    ).toBeVisible();

    // 4. Link contact workflow -> + New contact
    await page.getByRole('button', { name: 'Link contact' }).click();
    await expect(page.getByRole('dialog', { name: 'Link contact' })).toBeVisible();

    await page.getByRole('button', { name: '+ New contact' }).click();
    await expect(page.getByRole('dialog', { name: 'New contact' })).toBeVisible();

    await page.getByLabel('Contact name').fill('Jane Recruiter');
    await page.getByLabel('Title / Role').fill('Talent Partner');
    await page.getByLabel('Email address').fill('jane.recruiter@techcorp.test');
    await page.getByRole('button', { name: 'Create contact' }).click();
    await page
      .getByLabel('Select contact')
      .selectOption({ label: 'Jane Recruiter (Talent Partner) - jane.recruiter@techcorp.test' });

    await page.getByLabel('Primary point of contact for this application').check();
    const linkContactButton = page.getByRole('button', { name: 'Link contact', exact: true });
    await expect(linkContactButton).toBeEnabled();
    await linkContactButton.click();
    await expect(page.getByRole('dialog', { name: 'Link contact' })).toHaveCount(0, {
      timeout: 45_000,
    });
    await expect(
      page.getByLabel('Application details').getByText('Jane Recruiter', { exact: true }),
    ).toBeVisible();

    // 5. Valid stage transition and stage history recording
    await page.getByRole('button', { name: 'Change stage' }).click();
    await page.getByLabel('Target stage').selectOption({ label: 'Interviewing' });
    await page.getByLabel('Transition note (optional)').fill('Passed recruiter screen');
    await page.getByRole('button', { name: 'Confirm stage change' }).click();

    await expect(
      page.getByLabel('Application details').getByText('Interviewing', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Applied → Interviewing')).toBeVisible();

    // 6. Notes and Tasks
    await page.getByRole('button', { name: 'Add note' }).click();
    await page
      .getByLabel('Note body')
      .fill('Completed phone screen with Jane. Technical interview scheduled.');
    await page
      .getByLabel('Note body')
      .locator('xpath=ancestor::form')
      .getByRole('button', { name: 'Add note', exact: true })
      .click();
    await expect(
      page.getByText('Completed phone screen with Jane. Technical interview scheduled.'),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByLabel('Task title').fill('System design interview preparation');
    await page
      .getByLabel('Task title')
      .locator('xpath=ancestor::form')
      .getByRole('button', { name: 'Add task', exact: true })
      .click();
    await expect(page.getByText('System design interview preparation')).toBeVisible();

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
    await page
      .getByRole('dialog', { name: 'Prepare reply' })
      .getByRole('button', { name: 'Prepare reply', exact: true })
      .click();

    // Open review modal on created draft
    await page.getByRole('button', { name: 'Review draft' }).click();
    await expect(page.getByRole('dialog', { name: 'Review draft' })).toBeVisible();

    // Safety defaults fail closed: approval requires exact sender-compliance content,
    // and any later send also requires a canonical recipient plus an explicit approval.
    const reviewDialog = page.getByRole('dialog', { name: 'Review draft' });
    await expect(reviewDialog.getByRole('button', { name: 'Send draft' })).toHaveCount(0);
    await expect(reviewDialog.getByRole('button', { name: 'Approve draft' })).toBeDisabled();
    await expect(reviewDialog).toContainText('Delivery checks blocked');
    assertZeroLiveSends(googleProviderMock);

    // Close review modal
    await reviewDialog.getByRole('button', { name: 'Close' }).last().click();

    // 9. Reload page and assert all state persists intact
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const persistedApplication = page.getByRole('row', {
      name: /Senior Full Stack Engineer TechCorp Solutions Interviewing/u,
    });
    await expect(persistedApplication).toBeVisible();
    await persistedApplication.getByRole('button', { name: 'View details' }).click();

    await expect(page.getByRole('heading', { name: 'Senior Full Stack Engineer' })).toBeVisible();
    await expect(
      page.getByLabel('Application details').getByText('Interviewing', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Applied → Interviewing')).toBeVisible();
    await expect(
      page.getByText('Completed phone screen with Jane. Technical interview scheduled.'),
    ).toBeVisible();
    await expect(page.getByText('System design interview preparation')).toBeVisible();
    await expect(page.getByText('Jane Recruiter', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Senior Software Engineer Interview', { exact: true }),
    ).toBeVisible();

    expect(rendererErrors).toEqual([]);
  });
});
