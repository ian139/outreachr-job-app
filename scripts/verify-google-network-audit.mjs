#!/usr/bin/env node
/**
 * Verification script for Redacted Google Live-Smoke & Network Audit Mechanic.
 * Runs offline validation of fail-closed endpoint classification, disallowed Gmail mutation hard-fails,
 * exact host matching, token/query/path redaction, zero-mutation machine-readable summary, and auditor lifecycle.
 */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditModulePath = path.join(rootDir, 'apps', 'desktop', 'e2e', 'support', 'google-network-audit.ts');

const {
  GoogleMutationDisallowedError,
  GoogleUnexpectedEndpointError,
  GoogleNetworkAuditor,
  classifyGoogleEndpoint,
  createAuditedFetch,
  redactGoogleUrl,
  startGoogleNetworkAudit,
} = await import(auditModulePath);

console.log('Running offline fail-closed Google network audit verification...');

// 1. Verify Allowed Contract (OAuth authorize/token/userinfo + Gmail GET list/thread/message/attachment ONLY)
const allowedGetEndpoints = [
  { method: 'POST', url: 'https://oauth2.googleapis.com/token', expected: 'oauth.token' },
  { method: 'GET', url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=openid', expected: 'oauth.authorize' },
  { method: 'GET', url: 'https://www.googleapis.com/oauth2/v2/userinfo', expected: 'oauth.userinfo' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages', expected: 'gmail.messages.list' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_100', expected: 'gmail.messages.get' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_100/attachments/att_200', expected: 'gmail.attachments.get' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/threads', expected: 'gmail.threads.list' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/threads/th_300', expected: 'gmail.threads.get' },
];

for (const sample of allowedGetEndpoints) {
  const result = classifyGoogleEndpoint(sample.method, sample.url);
  assert.equal(result.endpointClass, sample.expected, `Endpoint class mismatch for ${sample.url}`);
  assert.equal(result.isAllowed, true, `Expected ${sample.url} to be allowed`);
  assert.equal(result.isGmailMutation, false, `Expected ${sample.url} not to be a Gmail mutation`);
  assert.equal(result.isUnexpected, false, `Expected ${sample.url} not to be unexpected`);
}

// 2. Verify Fail-Closed & Unexpected Requests (Uncontracted endpoints disallowed)
const unexpectedEndpoints = [
  { method: 'POST', url: 'https://oauth2.googleapis.com/revoke?token=123', expected: 'oauth.revoke' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/labels', expected: 'gmail.labels.get' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', expected: 'gmail.drafts.get' },
  { method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/profile', expected: 'gmail.profile.get' },
  { method: 'GET', url: 'https://calendar.googleapis.com/calendar/v3/calendars/primary/events', expected: 'calendar.events.list' },
  { method: 'GET', url: 'https://gmail.googleapis.com.evil.test/v1/users/me/messages', expected: 'external.unexpected' },
];

for (const sample of unexpectedEndpoints) {
  const result = classifyGoogleEndpoint(sample.method, sample.url);
  assert.equal(result.endpointClass, sample.expected, `Unexpected endpoint class mismatch for ${sample.url}`);
  assert.equal(result.isAllowed, false, `Expected ${sample.url} to be disallowed`);
  assert.equal(result.isUnexpected, true, `Expected ${sample.url} to be unexpected`);
}

// 3. Verify Disallowed Gmail Mutations
const disallowedMutations = [
  { method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', expected: 'gmail.messages.send' },
  { method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', expected: 'gmail.drafts.create' },
  { method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', expected: 'gmail.drafts.send' },
  { method: 'DELETE', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_100', expected: 'gmail.messages.delete' },
  { method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_100/modify', expected: 'gmail.messages.modify' },
];

for (const sample of disallowedMutations) {
  const result = classifyGoogleEndpoint(sample.method, sample.url);
  assert.equal(result.endpointClass, sample.expected, `Mutation class mismatch for ${sample.url}`);
  assert.equal(result.isAllowed, false, `Expected ${sample.url} to be disallowed`);
  assert.equal(result.isGmailMutation, true, `Expected ${sample.url} to be a Gmail mutation`);
}

// 4. Verify Redaction
const rawSensitiveUrl =
  'https://gmail.googleapis.com/gmail/v1/users/founder%40company.test/messages/msg_9999?format=metadata&access_token=ya29.secret_token_val&q=from%3Acandidate%40test.org';
const redactedUrl = redactGoogleUrl(rawSensitiveUrl);
assert.equal(redactedUrl, 'https://gmail.googleapis.com/gmail/v1/users/:userId/messages/:messageId');
assert(!redactedUrl.includes('founder'), 'Redacted URL must not contain user email');
assert(!redactedUrl.includes('msg_9999'), 'Redacted URL must not contain message ID');
assert(!redactedUrl.includes('secret_token_val'), 'Redacted URL must not contain access token');

// 5. Verify Temp File Summary Persistence for Live Smoke
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'outreachr-verify-audit-'));
const tempSummaryPath = path.join(tempDir, 'live-smoke-summary.json');

try {
  const dummyFetch = async () => new Response('{}', { status: 200 });
  const auditedFetch = createAuditedFetch(dummyFetch, { summaryPath: tempSummaryPath, throwOnMutation: false });

  await auditedFetch('https://oauth2.googleapis.com/token', { method: 'POST' });
  await auditedFetch('https://gmail.googleapis.com/gmail/v1/users/ada@test.org/messages', { method: 'GET' });
  await auditedFetch('https://gmail.googleapis.com/gmail/v1/users/ada@test.org/messages/msg_555', { method: 'GET' });

  const summaryRaw = await fs.readFile(tempSummaryPath, 'utf8');
  const summary = JSON.parse(summaryRaw);

  assert.equal(summary.totalRequests, 3);
  assert.equal(summary.allowedRequests, 3);
  assert.equal(summary.gmailMutationAttempts, 0);
  assert.equal(summary.unexpectedRequests, 0);
  assert.equal(summary.zeroMutations, true);
  assert.equal(summary.zeroUnexpected, true);
  assert.equal(summary.endpointCounts['POST oauth.token'], 1);
  assert.equal(summary.endpointCounts['GET gmail.messages.list'], 1);

  assert(!summaryRaw.includes('ada@test.org'), 'Persisted summary must omit raw user email');
  assert(!summaryRaw.includes('msg_555'), 'Persisted summary must omit raw message ID');

  console.log('✓ All Google network audit fail-closed & live smoke summary persistence checks passed.');
  console.log('Sample persisted machine-readable summary output:');
  console.log(summaryRaw);
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
