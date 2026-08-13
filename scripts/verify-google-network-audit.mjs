#!/usr/bin/env node
/**
 * Verification script for Redacted Google Live-Smoke & Network Audit Mechanic.
 * Runs offline validation of endpoint classification, disallowed Gmail mutation hard-fails,
 * token/query/path redaction, zero-mutation machine-readable summary, and auditor lifecycle.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditModulePath = path.join(rootDir, 'apps', 'desktop', 'e2e', 'support', 'google-network-audit.ts');

const {
  GoogleMutationDisallowedError,
  GoogleNetworkAuditor,
  classifyGoogleEndpoint,
  redactGoogleUrl,
  startGoogleNetworkAudit,
} = await import(auditModulePath);

console.log('Running offline Google network audit verification...');

// 1. Verify Endpoint Classification
const allowedGetEndpoints = [
  { method: 'POST', url: 'https://oauth2.googleapis.com/token', expected: 'oauth.token' },
  { method: 'GET', url: 'https://accounts.google.com/o/oauth2/v2/auth?scope=openid', expected: 'oauth.authorize' },
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
  assert.equal(result.isMutation, false, `Expected ${sample.url} to not be a mutation`);
}

// 2. Verify Disallowed Gmail Mutations
const disallowedMutations = [
  { method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send', expected: 'gmail.messages.send' },
  { method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts', expected: 'gmail.drafts.create' },
  { method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send', expected: 'gmail.drafts.send' },
  { method: 'DELETE', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_100', expected: 'gmail.messages.delete' },
  { method: 'PUT', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_100', expected: 'gmail.messages.mutation' },
  { method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_100/modify', expected: 'gmail.messages.modify' },
];

for (const sample of disallowedMutations) {
  const result = classifyGoogleEndpoint(sample.method, sample.url);
  assert.equal(result.endpointClass, sample.expected, `Mutation class mismatch for ${sample.url}`);
  assert.equal(result.isAllowed, false, `Expected ${sample.url} to be disallowed`);
  assert.equal(result.isMutation, true, `Expected ${sample.url} to be a mutation`);
}

// 3. Verify Redaction
const rawSensitiveUrl =
  'https://gmail.googleapis.com/gmail/v1/users/founder%40company.test/messages/msg_9999?format=metadata&access_token=ya29.secret_token_val&q=from%3Acandidate%40test.org';
const redactedUrl = redactGoogleUrl(rawSensitiveUrl);
assert.equal(redactedUrl, 'https://gmail.googleapis.com/gmail/v1/users/:userId/messages/:messageId');
assert(!redactedUrl.includes('founder'), 'Redacted URL must not contain user email');
assert(!redactedUrl.includes('msg_9999'), 'Redacted URL must not contain message ID');
assert(!redactedUrl.includes('secret_token_val'), 'Redacted URL must not contain access token');
assert(!redactedUrl.includes('candidate'), 'Redacted URL must not contain query parameters');

// 4. Verify Auditor Lifecycle & Summary
const auditor = startGoogleNetworkAudit({ throwOnMutation: true });

auditor.recordRequest({
  method: 'POST',
  url: 'https://oauth2.googleapis.com/token',
  headers: { Authorization: 'Bearer test-bearer-token' },
  body: { client_secret: 'top_secret' },
});

auditor.recordRequest({
  method: 'GET',
  url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
});

auditor.recordRequest({
  method: 'GET',
  url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_100',
});

const summary = auditor.getSummary();
assert.equal(summary.totalRequests, 3);
assert.equal(summary.allowedRequests, 3);
assert.equal(summary.mutationAttempts, 0);
assert.equal(summary.zeroMutations, true);
assert.equal(summary.endpointCounts['POST oauth.token'], 1);
assert.equal(summary.endpointCounts['GET gmail.messages.list'], 1);
assert.equal(summary.endpointCounts['GET gmail.messages.get'], 1);

// Ensure no secrets leak into JSON summary
const summaryJson = JSON.stringify(summary, null, 2);
assert(!summaryJson.includes('test-bearer-token'), 'Summary JSON must not contain token');
assert(!summaryJson.includes('top_secret'), 'Summary JSON must not contain secret');
assert(!summaryJson.includes('msg_100'), 'Summary JSON must not contain message ID');

auditor.assertZeroMutations();

// 5. Verify Hard-Fail on Gmail Mutation
assert.throws(
  () => {
    auditor.recordRequest({
      method: 'POST',
      url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    });
  },
  GoogleMutationDisallowedError,
  'Auditor must throw GoogleMutationDisallowedError on Gmail send attempt',
);

console.log('✓ All Google network audit offline checks passed successfully.');
console.log('Machine-readable summary output sample:');
console.log(summaryJson);
