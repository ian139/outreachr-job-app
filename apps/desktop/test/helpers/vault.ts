import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { VaultService } from '../../src/main/vault-service';

export const FIXED_NOW = new Date('2026-07-31T19:00:00.000Z');
export const DESKTOP_ROOT = resolve(import.meta.dirname, '../..');
export const RESOURCE_ROOT = resolve(DESKTOP_ROOT, '../../resources');

export async function temporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `outreachr-${prefix}-`));
}

export async function removeTemporaryDirectory(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 3 });
}

export async function initializedVault(
  dataDirectory: string,
  now: () => Date = () => FIXED_NOW,
  importSeed = true,
): Promise<VaultService> {
  const service = new VaultService({
    appVersion: '0.2.0-test',
    platform: process.platform,
    dataDirectory,
    resourceDirectory: RESOURCE_ROOT,
    now,
  });
  await service.initialize();
  if (importSeed) {
    await service.importSeedFile(join(RESOURCE_ROOT, 'Outreachr_Investor_Seed.sqlite'));
  }
  return service;
}

export async function onboard(service: VaultService): Promise<void> {
  await service.completeOnboarding({
    founderName: 'Ada Founder',
    founderEmail: 'ada@local.test',
    companyName: 'Local Labs',
    companyOneLiner: 'Local-first infrastructure for trustworthy AI teams.',
    stage: 'seed',
    targetAmount: 3_000_000,
    targetCheckMinimum: 250_000,
    targetCheckMaximum: 1_000_000,
    sectors: ['AI', 'Agentic'],
    geographies: ['United States'],
    narrative: 'Founder-reviewed fixture narrative. Revenue figures are estimates.',
    postalAddress: '123 Founder Way\nSan Francisco, CA 94107\nUnited States',
  });
}

export function firstPersonWithoutEmail(service: VaultService): {
  id: string;
  name: string;
  firmId: string;
} {
  const row = service.vault.one<{ id: string; full_name: string; firm_id: string }>(
    `SELECT p.id,p.full_name,p.firm_id
       FROM people p
       WHERE p.firm_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM contact_methods c
           WHERE c.person_id=p.id AND c.kind IN ('work_email','personal_email')
         )
       ORDER BY p.full_name
       LIMIT 1`,
  );
  if (!row) throw new Error('Pinned seed does not contain a person fixture without email');
  return { id: row.id, name: row.full_name, firmId: row.firm_id };
}
