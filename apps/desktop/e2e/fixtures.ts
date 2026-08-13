/* eslint-disable no-empty-pattern -- Playwright requires fixture dependencies to use object destructuring. */
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test as base } from '@playwright/test';
import type { ElectronApplication, Page, TestInfo } from '@playwright/test';
import { startGoogleProviderMock, type GoogleProviderMockState } from './google-provider-mock';

interface DesktopFixtures {
  desktopApp: ElectronApplication;
  page: Page;
  dataDirectory: string;
  exportDirectory: string;
  rendererErrors: string[];
  startupLogs: string[];
  googleProviderMock: GoogleProviderMockState;
}

const desktopRoot = resolve(import.meta.dirname, '..');
const investorSeedPath = resolve(desktopRoot, '../../resources/Outreachr_Investor_Seed.sqlite');

export const test = base.extend<DesktopFixtures>({
  dataDirectory: async ({}, provide) => {
    const directory = await mkdtemp(join(tmpdir(), 'outreachr-e2e-data-'));
    await provide(directory);
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  },

  exportDirectory: async ({}, provide) => {
    const directory = await mkdtemp(join(tmpdir(), 'outreachr-e2e-export-'));
    await mkdir(directory, { recursive: true });
    await provide(directory);
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  },

  startupLogs: async ({}, provide) => {
    await provide([]);
  },

  googleProviderMock: async ({}, provide) => {
    const mock = await startGoogleProviderMock();
    try {
      await provide(mock.state);
    } finally {
      await mock.close();
    }
  },

  desktopApp: async ({ dataDirectory, googleProviderMock, startupLogs }, provide) => {
    const application = await electron.launch({
      // The main process requests its single-instance lock before it can apply
      // OUTREACHR_E2E_DATA_DIR. Give Electron the isolated user-data path at
      // process launch so sequential fixtures never contend for the same lock.
      args: [desktopRoot, `--user-data-dir=${dataDirectory}`],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        OUTREACHR_E2E_DATA_DIR: dataDirectory,
        OUTREACHR_E2E_GOOGLE_PROVIDER_URL: googleProviderMock.baseUrl,
        OUTREACHR_E2E_SECRET_KEY: randomBytes(32).toString('hex'),
        CLAUDE_CODE_OAUTH_TOKEN: 'e2e-setup-token-must-never-persist',
        OUTREACHR_STARTUP_DIAGNOSTICS: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      },
      timeout: 60_000,
    });
    application.process().stdout?.on('data', (chunk: Buffer) => startupLogs.push(chunk.toString()));
    application.process().stderr?.on('data', (chunk: Buffer) => startupLogs.push(chunk.toString()));
    try {
      await provide(application);
    } finally {
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      const closed = await Promise.race([
        application.close().then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolveTimeout) => {
          closeTimer = setTimeout(() => resolveTimeout(false), 5_000);
        }),
      ]);
      if (closeTimer) clearTimeout(closeTimer);
      if (!closed && !application.process().killed) application.process().kill('SIGKILL');
    }
  },

  page: async ({ desktopApp, startupLogs }, provide) => {
    let page: Page;
    try {
      page = await desktopApp.firstWindow({ timeout: 60_000 });
    } catch (error) {
      const detail = startupLogs.join('').trim() || 'No Electron process output was captured.';
      throw new Error(`Electron did not create its first window.\n${detail}`, { cause: error });
    }
    await page.setViewportSize({ width: 1440, height: 940 });
    await page.waitForLoadState('domcontentloaded');

    const bootstrapSelector = '.onboarding-shell, .job-setup-shell, .app-shell, .error-screen';
    try {
      await page.waitForSelector(bootstrapSelector, {
        state: 'visible',
        timeout: 60_000,
      });
    } catch (error) {
      await throwBootstrapDiagnosticError(
        page,
        startupLogs,
        'Timed out waiting for renderer bootstrap readiness (expected .onboarding-shell, .app-shell, or .error-screen)',
        error,
      );
    }

    const isErrorScreenVisible = await page
      .locator('.error-screen')
      .isVisible()
      .catch(() => false);
    if (isErrorScreenVisible) {
      await throwBootstrapDiagnosticError(
        page,
        startupLogs,
        'Renderer displayed error screen during bootstrap',
      );
    }

    await provide(page);
  },

  rendererErrors: async ({ page }, provide) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await provide(errors);
  },
});

export { expect };
async function getSanitizedRendererState(page: Page): Promise<string> {
  try {
    const state = await page.evaluate(() => {
      const getShellStatus = (selector: string) => {
        const el = document.querySelector(selector);
        if (!el) return 'absent';
        const style = window.getComputedStyle(el);
        const isVisible =
          style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        return isVisible ? 'visible' : 'hidden';
      };

      const shells = {
        loadingScreen: getShellStatus('.loading-screen'),
        onboardingShell: getShellStatus('.onboarding-shell'),
        jobSetupShell: getShellStatus('.job-setup-shell'),
        appShell: getShellStatus('.app-shell'),
        errorScreen: getShellStatus('.error-screen'),
      };
      const errorEl = document.querySelector('.error-screen');
      const rawMsg = errorEl
        ? errorEl.querySelector('p')?.textContent?.trim() || errorEl.textContent?.trim()
        : null;

      const sanitizedMsg = rawMsg
        ? rawMsg.replace(/[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]').slice(0, 300)
        : null;
      return {
        url: window.location.href,
        readyState: document.readyState,
        shells,
        errorMessage: sanitizedMsg,
      };
    });
    const lines: string[] = [
      `URL: ${state.url}`,
      `ReadyState: ${state.readyState}`,
      `Shells: loading-screen=${state.shells.loadingScreen}, onboarding-shell=${state.shells.onboardingShell}, job-setup-shell=${state.shells.jobSetupShell}, app-shell=${state.shells.appShell}, error-screen=${state.shells.errorScreen}`,
    ];
    if (state.errorMessage) {
      lines.push(`Error message: ${state.errorMessage}`);
    }
    return lines.join('\n');
  } catch (evalError) {
    return `Could not evaluate renderer state: ${evalError instanceof Error ? evalError.message : String(evalError)}`;
  }
}
async function throwBootstrapDiagnosticError(
  page: Page,
  startupLogs: string[],
  reason: string,
  cause?: unknown,
): Promise<never> {
  const rendererState = await getSanitizedRendererState(page);
  const stageLines = startupLogs
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('[outreachr-startup]'));

  const stageDiagnostics =
    stageLines.length > 0
      ? stageLines.join('\n')
      : startupLogs.join('').trim() || 'No process startup logs were captured.';

  const message = [
    `Electron renderer bootstrap failure: ${reason}`,
    '--- Sanitized Renderer State ---',
    rendererState,
    '--- OUTREACHR_STARTUP_DIAGNOSTICS Stage Lines ---',
    stageDiagnostics,
  ].join('\n');

  throw new Error(message, { cause });
}

export async function attachScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const body = await page.screenshot({ animations: 'disabled' });
  await testInfo.attach(name, {
    body,
    contentType: 'image/png',
  });
  await writeFile(testInfo.outputPath(`${name}.png`), body);
}
export async function setupJobWorkspace(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.outreachr.command('workspace.setup', {
      displayName: 'Ada Candidate',
      primaryEmail: 'ada@local.test',
      stages: [
        { name: 'Applied', terminal: false },
        { name: 'Interviewing', terminal: false },
        { name: 'Offer', terminal: true },
      ],
    });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

export async function connectGoogleRelationshipSync(page: Page): Promise<void> {
  await navigate(page, 'Settings');
  await page.getByRole('button', { name: 'Mail & calendar', exact: true }).click();
  const googleSection = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Google Workspace', exact: true }),
  });
  await expect(googleSection).toBeVisible();
  await googleSection
    .getByRole('textbox', { name: 'Application (client) ID' })
    .fill('e2e-founder-owned-desktop-client');
  await googleSection.getByRole('radio', { name: /Relationship sync/u }).check();
  await googleSection.getByRole('button', { name: 'Save and connect in browser' }).click();

  await expect(page.getByText('Google connected', { exact: true })).toBeVisible();
  await expect(googleSection.getByText('ada@local.test', { exact: true })).toBeVisible();
}

export async function completeOnboarding(page: Page): Promise<void> {
  if (
    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .isVisible()
      .catch(() => false)
  ) {
    await page.evaluate(async (path) => {
      await window.outreachr.command('data.importSeed', { path });
    }, investorSeedPath);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    return;
  }

  const setupHeading = page.getByRole('heading', { name: 'Set up your job search' });
  if (await setupHeading.isVisible().catch(() => false)) {
    await page.getByLabel('Your name').fill('Ada Founder');
    await page.getByLabel('Primary email').fill('ada@local.test');
    await page.getByLabel('Stage 1 name').fill('Applied');
    await page.getByLabel('Stage 2 name').fill('Interviewing');
    await page.getByRole('button', { name: 'Create local workspace' }).click();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();

    await page.evaluate(async (path) => {
      await window.outreachr.command('data.importSeed', { path });
    }, investorSeedPath);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    return;
  }

  await expect(page.getByRole('heading', { name: 'Who is running this round?' })).toBeVisible();
  await page.getByLabel('Your name').fill('Ada Founder');
  await page.getByLabel('Work email').fill('ada@local.test');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Company name').fill('Local Labs');
  await page
    .getByLabel('One-line description')
    .fill('Local-first infrastructure for trustworthy AI teams.');
  await page
    .getByLabel('Fundraising narrative')
    .fill('Founder-reviewed traction and narrative. All estimates are labeled.');
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Round stage').selectOption('seed');
  await page.getByLabel('Target raise (USD)').fill('3000000');
  await page.getByLabel('Minimum useful check').fill('250000');
  await page.getByLabel('Maximum expected check').fill('1000000');
  await page.getByLabel('Sector tags').fill('AI, Agentic, Developer Tools');
  await page.getByLabel('Geographies').fill('United States');
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(
    page.getByRole('heading', { name: 'Your fundraising history stays on this device.' }),
  ).toBeVisible();
  await page
    .getByLabel('Sender postal address (optional during setup)')
    .fill('123 Founder Way\nSan Francisco, CA 94107\nUnited States');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(
    page.getByRole('heading', { name: 'Your local workspace is ready to build.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create local workspace' }).click();

  await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeVisible();
  await page.evaluate(async (path) => {
    await window.outreachr.command('data.importSeed', { path });
  }, investorSeedPath);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

export async function navigate(page: Page, label: string): Promise<void> {
  const navigation =
    label === 'Settings'
      ? page.getByRole('complementary', { name: 'Workspace sidebar' })
      : page.getByRole('navigation', { name: 'Primary navigation' });

  await navigation
    .getByRole('link', {
      name: label,
      exact: true,
    })
    .click();
}
export interface LayoutMeasurement {
  viewportWidth: number;
  viewportHeight: number;
  documentScrollWidth: number;
  documentClientWidth: number;
  overflowX: boolean;
}

export async function setViewportAndMeasure(
  page: Page,
  width: number,
  height: number,
): Promise<LayoutMeasurement> {
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  const measurement = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  return measurement;
}

export async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const measurement = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    measurement.scrollWidth,
    `Document scrollWidth (${measurement.scrollWidth}px) exceeds clientWidth (${measurement.clientWidth}px)`,
  ).toBeLessThanOrEqual(measurement.clientWidth);
}

export interface ControlSizeMeasurement {
  role?: string;
  name?: string;
  width: number;
  height: number;
  meetsTouchTarget: boolean;
}

export async function measureControlSizes(
  page: Page,
  controls: Array<{ role: string; name: string }>,
): Promise<ControlSizeMeasurement[]> {
  const results: ControlSizeMeasurement[] = [];
  for (const control of controls) {
    const locator = page.getByRole(control.role as Parameters<Page['getByRole']>[0], {
      name: control.name,
    });
    const box = await locator.first().boundingBox();
    const width = box?.width ?? 0;
    const height = box?.height ?? 0;
    results.push({
      role: control.role,
      name: control.name,
      width,
      height,
      meetsTouchTarget: width >= 44 && height >= 44,
    });
  }
  return results;
}
export async function measureAllVisibleControls(page: Page): Promise<ControlSizeMeasurement[]> {
  const elements = await page.locator('button, a[href], input, select, textarea').all();
  const results: ControlSizeMeasurement[] = [];
  for (const element of elements) {
    if (await element.isVisible()) {
      const box = await element.boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        const tagName = await element.evaluate((node) => node.tagName.toLowerCase());
        const text =
          (await element.textContent())?.trim() ||
          (await element.getAttribute('aria-label')) ||
          (await element.getAttribute('title')) ||
          '';
        const role = (await element.getAttribute('role')) || tagName;
        const type = await element.getAttribute('type');
        results.push({
          role,
          name: `${text.slice(0, 40)} [${tagName}${type ? `:${type}` : ''}]`,
          width: box.width,
          height: box.height,
          meetsTouchTarget: box.width >= 44 && box.height >= 44,
        });
      }
    }
  }
  return results;
}

export async function captureResponsiveScreenshot(
  page: Page,
  testInfo: TestInfo,
  viewport: { width: number; height: number },
  name: string,
): Promise<LayoutMeasurement> {
  const layout = await setViewportAndMeasure(page, viewport.width, viewport.height);
  await assertNoHorizontalScroll(page);
  await attachScreenshot(page, testInfo, `${name}-${viewport.width}x${viewport.height}`);
  return layout;
}

export function assertZeroLiveSends(googleProviderMockState: GoogleProviderMockState): void {
  googleProviderMockState.auditor.assertZeroMutations();
  expect(
    googleProviderMockState.sentRawMessages.length,
    'Mock state recorded live send calls without founder approval',
  ).toBe(0);
  expect(
    googleProviderMockState.gmailSendCalls,
    'Gmail send API was called without explicit approval',
  ).toBe(0);
}
