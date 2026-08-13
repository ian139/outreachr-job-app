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
    await page.getByRole('button', { name: 'New application', exact: true }).first().click();
    await page.getByRole('button', { name: '+ New company' }).click();
    await page.getByLabel('Company name').fill('Responsive Corp');
    await page.getByLabel('Website').fill('https://responsive.test');
    await page.getByLabel('Location').fill('Remote');
    await page.getByRole('button', { name: 'Create company' }).click();

    await page.getByLabel('Select company').selectOption({ label: 'Responsive Corp' });
    await page.getByLabel('Role title').fill('Lead Mobile Engineer');
    await page.getByLabel('Select stage').selectOption({ label: 'Applied' });
    await page
      .getByRole('dialog', { name: 'New application' })
      .getByRole('button', { name: 'New application', exact: true })
      .click();
    await expect(page.getByRole('heading', { name: 'Lead Mobile Engineer' })).toBeVisible();
    const notificationDismissals = page.getByRole('button', { name: 'Dismiss notification' });
    while ((await notificationDismissals.count()) > 0) {
      await notificationDismissals.first().click();
    }

    const viewports = [
      { name: 'desktop-wide', width: 1440, height: 1000 },
      { name: 'tablet-standard', width: 1024, height: 768 },
      { name: 'mobile-portrait', width: 390, height: 844 },
      { name: 'compact-mobile', width: 320, height: 700 },
    ];
    const measurements: Array<Record<string, unknown>> = [];

    for (const vp of viewports) {
      // Application detail view measurement & screenshot
      await navigate(page, 'Applications');
      await page.getByRole('button', { name: 'View details' }).click();
      await expect(page.getByRole('heading', { name: 'Lead Mobile Engineer' })).toBeVisible();
      const appLayout = await captureResponsiveScreenshot(
        page,
        testInfo,
        { width: vp.width, height: vp.height },
        `applications-detail-${vp.name}`,
      );
      expect(appLayout.overflowX).toBe(false);
      measurements.push({ viewport: vp, surface: 'applications-detail', ...appLayout });

      // Inbox detail view measurement & screenshot
      await navigate(page, 'Inbox');
      await page.getByRole('button', { name: /Senior Software Engineer Interview/ }).click();
      await expect(page.getByRole('main', { name: 'Thread content' })).toBeVisible();
      const inboxLayout = await captureResponsiveScreenshot(
        page,
        testInfo,
        { width: vp.width, height: vp.height },
        `inbox-detail-${vp.name}`,
      );
      expect(inboxLayout.overflowX).toBe(false);
      measurements.push({ viewport: vp, surface: 'inbox-detail', ...inboxLayout });

      // On mobile viewports, validate control touch targets and back buttons
      if (vp.width <= 390) {
        // Mobile Inbox -> Back to inbox button
        const backToInboxButton = page.getByRole('button', { name: 'Back to inbox' });
        await expect(backToInboxButton).toBeVisible();
        await backToInboxButton.click();
        await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();

        // Mobile Applications -> Back to applications button
        await navigate(page, 'Applications');
        await page.getByRole('button', { name: 'View details' }).click();
        const backToApplicationsButton = page.getByRole('button', { name: 'Back to applications' });
        await expect(backToApplicationsButton).toBeVisible();
        await backToApplicationsButton.click();
        await expect(page.getByRole('heading', { name: 'Job Applications' })).toBeVisible();

        // Measure all visible interactive controls on mobile viewport
        const controls = await measureAllVisibleControls(page);
        const undersizedControls = controls
          .filter((control) => !control.meetsTouchTarget)
          .map(
            (control) =>
              `${control.name || '(unnamed)'} (${control.width}px × ${control.height}px)`,
          );
        expect(
          undersizedControls,
          `All visible controls must be >= 44px on mobile (${vp.width}x${vp.height})`,
        ).toEqual([]);
        measurements.push({ viewport: vp, surface: 'applications-list-controls', controls });
      }
    }

    await assertNoHorizontalScroll(page);
    await testInfo.attach('responsive-measurements.json', {
      body: Buffer.from(JSON.stringify(measurements, null, 2)),
      contentType: 'application/json',
    });
    expect(rendererErrors).toEqual([]);
  });
});
