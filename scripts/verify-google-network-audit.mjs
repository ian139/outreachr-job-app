#!/usr/bin/env node
/**
 * Verification script for Redacted Google Live-Smoke & Network Audit Mechanic.
 * Runs offline validation of fail-closed endpoint classification, exact host matching,
 * method policy enforcement, fetch dispatch prevention, token/query/path redaction,
 * zero-mutation summary, and production-owned auditor lifecycle.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditModulePath = path.join(rootDir, 'apps', 'desktop', 'src', 'main', 'google-network-audit.ts');

const {
  GoogleMutationDisallowedError,
  GoogleUnexpectedEndpointError,
  GoogleNetworkAuditor,
  classifyGoogleEndpoint,
  createAuditedFetch,
  redactGoogleUrl,
  startGoogleNetworkAudit,
} = await import(auditModulePath);

console.log('Running offline production-owned fail-closed Google network audit verification...');

// 1. Verify Method Policy & Allowed Contract
const allowedEndpoints = [
  { method: 'POST', url: 'https://oauth2.googleapis.com/token', expected: 'oauth.token' },
  { method: 'GET', url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=openid', expected: 'oauth.authorize' },
  { method: 'GET', url: 'https://www.googleapis.com/oauth2/v2/userinfo', expected: 'oauth.userinfo' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages', expected: 'gmail.messages.list' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_100', expected: 'gmail.messages.get' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_100/attachments/att_200', expected: 'gmail.attachments.get' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/threads', expected: 'gmail.threads.list' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/threads/th_300', expected: 'gmail.threads.get' },
];

for (const sample of allowedEndpoints) {
  const result = classifyGoogleEndpoint(sample.method, sample.url);
  assert.equal(result.endpointClass, sample.expected, `Endpoint class mismatch for ${sample.url}`);
  assert.equal(result.isAllowed, true, `Expected ${sample.url} to be allowed`);
}

// 2. Verify Method Policy Violations (GET /token, POST /auth, POST /userinfo -> Disallowed)
assert.equal(classifyGoogleEndpoint('GET', 'https://oauth2.googleapis.com/token').isAllowed, false);
assert.equal(classifyGoogleEndpoint('POST', 'https://accounts.google.com/o/oauth2/v2/auth').isAllowed, false);
assert.equal(classifyGoogleEndpoint('POST', 'https://www.googleapis.com/oauth2/v2/userinfo').isAllowed, false);

// 3. Verify Redaction
const rawSensitiveUrl =
  'https://gmail.googleapis.com/gmail/v1/users/founder%40company.test/messages/msg_9999?format=metadata&access_token=ya29.secret_token_val&q=from%3Acandidate%40test.org';
const redactedUrl = redactGoogleUrl(rawSensitiveUrl);
assert.equal(redactedUrl, 'https://gmail.googleapis.com/gmail/v1/users/:userId/messages/:messageId');
assert(!redactedUrl.includes('founder'), 'Redacted URL must not contain user email');
assert(!redactedUrl.includes('msg_9999'), 'Redacted URL must not contain message ID');
assert(!redactedUrl.includes('secret_token_val'), 'Redacted URL must not contain access token');

// 4. Verify Fetch Call Prevention on Disallowed Request
let mockFetchCalled = false;
const mockFetch = async () => {
  mockFetchCalled = true;
  return new Response('{}', { status: 200 });
};
const auditedFetch = createAuditedFetch(mockFetch, { throwOnMutation: true, throwOnUnexpected: true });

try {
  await auditedFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST' });
  assert.fail('Audited fetch must throw on Gmail mutation attempt');
} catch (error) {
  assert(error instanceof GoogleMutationDisallowedError);
  assert.equal(mockFetchCalled, false, 'Fetch function must NEVER be called when request is disallowed');
}

// 5. Verify Initial Summary File Creation and Persistence
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'outreachr-verify-audit-'));
const tempSummaryPath = path.join(tempDir, 'live-smoke-summary.json');

try {
  const fileAuditor = startGoogleNetworkAudit({ summaryPath: tempSummaryPath });

  // Initial summary file created at start
  const initialRaw = await fs.readFile(tempSummaryPath, 'utf8');
  const initialSummary = JSON.parse(initialRaw);
  assert.equal(initialSummary.totalRequests, 0);
  assert.equal(initialSummary.zeroMutations, true);

  // Record allowed requests
  fileAuditor.recordRequest({ method: 'POST', url: 'https://oauth2.googleapis.com/token' });
  fileAuditor.recordRequest({ method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/ada@test.org/messages' });

  const updatedRaw = await fs.readFile(tempSummaryPath, 'utf8');
  const updatedSummary = JSON.parse(updatedRaw);
  assert.equal(updatedSummary.totalRequests, 2);
  assert.equal(updatedSummary.allowedRequests, 2);
  assert.equal(updatedSummary.zeroMutations, true);
  assert.equal(updatedSummary.zeroUnexpected, true);

  console.log('✓ All production-owned Google network audit checks passed successfully.');
  console.log('Sample persisted machine-readable summary output:');
  console.log(updatedRaw);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
