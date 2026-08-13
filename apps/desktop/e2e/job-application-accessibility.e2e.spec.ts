import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, navigate, setupJobWorkspace, test } from './fixtures';

async function seriousAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target),
    }));
}

test.describe('Job application workspace accessibility', () => {
  test('loads every job workspace route without renderer errors or serious accessibility violations', async ({
    page,
    rendererErrors,
  }) => {
    await setupJobWorkspace(page);
    const routes: Array<[string, string]> = [
      ['Applications', 'Job Applications'],
      ['Inbox', 'Inbox'],
      ['Settings', 'Settings'],
    ];
    const violations = [];

    for (const theme of ['light', 'dark'] as const) {
      await navigate(page, 'Settings');
      await page.getByRole('combobox', { name: /^Theme/u }).selectOption(theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      for (const [link, heading] of routes) {
        await navigate(page, link);
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
        violations.push(
          ...(await seriousAxeViolations(page)).map((violation) => ({
            theme,
            route: link,
            ...violation,
          })),
        );
      }
    }

    expect(violations).toEqual([]);
    expect(rendererErrors).toEqual([]);
  });

  test('keeps job workspace navigation keyboard-operable at 200% zoom with reduced motion', async ({
    desktopApp,
    page,
    rendererErrors,
  }) => {
    await setupJobWorkspace(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await desktopApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error('Outreachr window is unavailable');
      window.webContents.setZoomFactor(2);
    });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Job Applications', exact: true }),
    ).toBeVisible();
    const routeBeforeSkip = await page.evaluate(() => window.location.hash);
    await page.evaluate(() => {
      document.body.tabIndex = -1;
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });

    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    expect(await page.evaluate(() => window.location.hash)).toBe(routeBeforeSkip);

    const inboxLink = page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'Inbox', exact: true });
    await inboxLink.focus();
    await expect(inboxLink).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible();
    expect(await seriousAxeViolations(page)).toEqual([]);
    expect(rendererErrors).toEqual([]);
  });
});
