import {
  assertNoHorizontalScroll,
  connectGoogleRelationshipSync,
  expect,
  navigate,
  setupJobWorkspace,
  test,
} from './fixtures';

test.describe('Job Application Inbox & Mail Reader', () => {
  test('paginates thread list with cursor, loads full body for selected threads, verifies sanitization, and handles cancellation', async ({
    page,
    rendererErrors,
  }) => {
    await setupJobWorkspace(page);
    await connectGoogleRelationshipSync(page);
    await navigate(page, 'Inbox');

    await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();

    // 1. Search & List Cursor Pagination
    const searchInput = page.getByRole('searchbox', { name: 'Search mail' });
    await searchInput.fill('interview');
    await expect(searchInput).toHaveValue('interview');
    await searchInput.clear();

    const loadMoreButton = page.getByRole('button', { name: 'Load more threads' });
    await expect(loadMoreButton).toBeVisible();
    await loadMoreButton.click();

    // 2. Select Plain Text Thread
    await page.getByRole('button', { name: /Senior Software Engineer Interview/ }).click();
    const messageDetail = page.getByRole('main', { name: 'Thread content' });
    await expect(messageDetail).toBeVisible();
    await expect(messageDetail).toContainText(
      'Plain text body content for senior software engineer interview.',
    );

    // 3. View Plain Text & View Rich Content Mode Toggles
    await page.getByRole('button', { name: 'View plain text' }).click();
    await expect(messageDetail).toContainText(
      'Plain text body content for senior software engineer interview.',
    );

    await page.getByRole('button', { name: 'View rich content' }).click();
    await expect(
      messageDetail.locator('.inbox-rich-content').getByRole('heading', {
        name: 'Senior Software Engineer Interview',
      }),
    ).toBeVisible();
    await expect(messageDetail.getByRole('list')).toBeVisible();
    await expect(messageDetail.locator('blockquote')).toContainText('Please bring questions for the team.');
    await expect(messageDetail.locator('pre code')).toContainText('const interviewConfirmed = true;');
    await expect(
      messageDetail.getByRole('link', { name: 'Choose an interview slot' }),
    ).toHaveAttribute('href', 'https://jobs.techcorp.test/interview');
    expect(await messageDetail.locator('img').count()).toBe(0);

    // 4. Select Sanitized HTML Thread & Verify DOMPurify Strips Script/Style
    await page.getByRole('button', { name: /Job Offer Details/ }).click();
    await expect(messageDetail).toBeVisible();
    await expect(messageDetail).toContainText('Welcome to Acme Corp!');
    await expect(messageDetail).toContainText('Remote image omitted: Acme logo');

    const richBody = page.locator('.inbox-rich-content');
    const hasDangerousTags = await richBody.evaluate((el) =>
      Boolean(el.querySelector('script') || el.querySelector('style')),
    );
    expect(hasDangerousTags, 'DOMPurify HTML sanitizer must strip script and style elements').toBe(
      false,
    );

    // 5. Select Quoted Reply Thread & Verify <blockquote> Element
    await page.getByRole('button', { name: /Re: Application Status Update/ }).click();
    await expect(messageDetail).toBeVisible();
    await expect(messageDetail.locator('blockquote')).toBeVisible();

    // 6. Select Long URL Thread & Verify Horizontal Scroll Bounds
    await page.getByRole('button', { name: /Application Portal Access/ }).click();
    await expect(messageDetail).toBeVisible();
    await assertNoHorizontalScroll(page);

    // 7. Select Pre/Table Thread & Verify Internal Scroll Container
    await page
      .getByRole('button', { name: /Technical Interview Code Sample and Compensation Table/ })
      .click();
    await expect(messageDetail.locator('pre')).toBeVisible();
    await expect(messageDetail.locator('table')).toBeVisible();

    // 8. Select Empty Body Thread
    await page.getByRole('button', { name: /Blank Message Test/ }).click();
    await expect(page.getByText('(No text content)')).toBeVisible();

    // 9. Select Provider Error Thread
    await page.getByRole('button', { name: /Provider Error Failure/ }).click();
    await expect(page.getByRole('alert')).toContainText('Provider returned HTTP 500');

    // 10. Select Provider Truncated Thread
    await page.getByRole('button', { name: /Large Diagnostic Export Attachment/ }).click();
    await expect(messageDetail).toContainText('Message content truncated by provider', {
      timeout: 45_000,
    });

    // 11. Selection Cancellation / Stale Ignore
    // Click slow thread, then immediately click plain text thread; active view must show plain text
    await page.getByRole('button', { name: /Slow Responding Thread/ }).click();
    await page.getByRole('button', { name: /Senior Software Engineer Interview/ }).click();

    await expect(messageDetail).toContainText(
      'Plain text body content for senior software engineer interview.',
    );

    // 12. Provenance Metadata Verification
    await expect(messageDetail).toContainText('ada@local.test');

    expect(rendererErrors).toEqual([]);
  });
});
