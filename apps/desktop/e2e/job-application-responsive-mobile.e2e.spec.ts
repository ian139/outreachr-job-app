import {
  assertNoHorizontalScroll,
  captureResponsiveScreenshot,
  connectGoogleRelationshipSync,
  expect,
  measureAllVisibleControls,
  navigate,
  setupJobWorkspace,
  test,
} from './fixtures';

test.describe('Job Application Responsive Layout & Mobile Controls', () => {
  test('validates layout, mobile controls (>=44px), scroll bounds, and screenshots across 1440x1000, 1024x768, 390x844, 320x700', async ({
    page,
    rendererErrors,
  }, testInfo) => {
    await setupJobWorkspace(page);
    await connectGoogleRelationshipSync(page);

    // Seed an application record first so detail views are active
    await navigate(page, 'Applications');
    await page.getByRole('button', { name: 'New application', exact: true }).click();
    await page.getByRole('button', { name: '+ New company' }).click();
    await page.getByLabel('Company name').fill('Responsive Corp');
    await page.getByLabel('Website').fill('https://responsive.test');
    await page.getByLabel('Location').fill('Remote');
    await page.getByRole('button', { name: 'Create company' }).click();

    await page.getByLabel('Select company').selectOption({ label: 'Responsive Corp' });
    await page.getByLabel('Role title').fill('Lead Mobile Engineer');
    await page.getByLabel('Select stage').selectOption({ label: 'Applied' });
    await page.getByRole('button', { name: 'New application', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Lead Mobile Engineer' })).toBeVisible();

    const viewports = [
      { name: 'desktop-wide', width: 1440, height: 1000 },
      { name: 'tablet-standard', width: 1024, height: 768 },
      { name: 'mobile-portrait', width: 390, height: 844 },
      { name: 'compact-mobile', width: 320, height: 700 },
    ];

    for (const vp of viewports) {
      // Application detail view measurement & screenshot
      await navigate(page, 'Applications');
      await expect(page.getByRole('heading', { name: 'Lead Mobile Engineer' })).toBeVisible();
      const appLayout = await captureResponsiveScreenshot(
        page,
        testInfo,
        { width: vp.width, height: vp.height },
        `applications-detail-${vp.name}`,
      );
      expect(appLayout.overflowX).toBe(false);

      // Inbox detail view measurement & screenshot
      await navigate(page, 'Inbox');
      await page.getByRole('button', { name: /Senior Software Engineer Interview/ }).click();
      await expect(page.locator('.inbox-thread-detail')).toBeVisible();
      const inboxLayout = await captureResponsiveScreenshot(
        page,
        testInfo,
        { width: vp.width, height: vp.height },
        `inbox-detail-${vp.name}`,
      );
      expect(inboxLayout.overflowX).toBe(false);

      // On mobile viewports, validate control touch targets and back buttons
      if (vp.width <= 390) {
        // Mobile Inbox -> Back to inbox button
        const backToInboxButton = page.getByRole('button', { name: 'Back to inbox' });
        await expect(backToInboxButton).toBeVisible();
        await backToInboxButton.click();
        await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();

        // Mobile Applications -> Back to applications button
        await navigate(page, 'Applications');
        const backToApplicationsButton = page.getByRole('button', { name: 'Back to applications' });
        await expect(backToApplicationsButton).toBeVisible();
        await backToApplicationsButton.click();
        await expect(page.getByRole('heading', { name: 'Job Applications' })).toBeVisible();

        // Measure all visible interactive controls on mobile viewport
        const controls = await measureAllVisibleControls(page);
        for (const control of controls) {
          expect(
            control.meetsTouchTarget,
            `Interactive control "${control.name}" width (${control.width}px) and height (${control.height}px) must be >= 44px on mobile (${vp.width}x${vp.height})`,
          ).toBe(true);
        }
      }
    }

    await assertNoHorizontalScroll(page);
    expect(rendererErrors).toEqual([]);
  });
});
