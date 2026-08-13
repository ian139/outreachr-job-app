import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GoogleMutationDisallowedError,
  GoogleNetworkAuditor,
  GoogleUnexpectedEndpointError,
  classifyGoogleEndpoint,
  createAuditedFetch,
  redactGoogleUrl,
  startGoogleNetworkAudit,
} from '../../e2e/support/google-network-audit';
import { ConnectorService } from '../../src/main/connector-service';

describe('Redacted Google Network Audit Mechanic (Fail-Closed)', () => {
  describe('classifyGoogleEndpoint', () => {
    it('classifies ONLY contract-allowed OAuth authorize/token/userinfo and Gmail GET list/thread/message/attachment', () => {
      // Allowed OAuth
      expect(classifyGoogleEndpoint('POST', 'https://oauth2.googleapis.com/token')).toEqual({
        endpointClass: 'oauth.token',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      expect(classifyGoogleEndpoint('GET', 'https://accounts.google.com/o/oauth2/v2/auth?scope=openid')).toEqual({
        endpointClass: 'oauth.authorize',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      expect(classifyGoogleEndpoint('GET', 'https://www.googleapis.com/oauth2/v2/userinfo')).toEqual({
        endpointClass: 'oauth.userinfo',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      // Allowed Gmail GETs
      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages')).toEqual({
        endpointClass: 'gmail.messages.list',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_123')).toEqual({
        endpointClass: 'gmail.messages.get',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      expect(
        classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_123/attachments/att_456'),
      ).toEqual({
        endpointClass: 'gmail.attachments.get',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/threads')).toEqual({
        endpointClass: 'gmail.threads.list',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/threads/th_789')).toEqual({
        endpointClass: 'gmail.threads.get',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });
    });

    it('disallows uncontracted Google endpoints as unexpected (OAuth revoke, Gmail labels/drafts/profile, Calendar)', () => {
      expect(classifyGoogleEndpoint('POST', 'https://oauth2.googleapis.com/revoke?token=123')).toEqual({
        endpointClass: 'oauth.revoke',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/labels')).toEqual({
        endpointClass: 'gmail.labels.get',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts')).toEqual({
        endpointClass: 'gmail.drafts.get',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/profile')).toEqual({
        endpointClass: 'gmail.profile.get',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      expect(classifyGoogleEndpoint('GET', 'https://calendar.googleapis.com/calendar/v3/calendars/primary/events')).toEqual({
        endpointClass: 'calendar.events.list',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      expect(classifyGoogleEndpoint('POST', 'https://calendar.googleapis.com/calendar/v3/calendars/primary/events')).toEqual({
        endpointClass: 'calendar.events.create',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });
    });

    it('enforces exact host matching and rejects spoofed subdomains', () => {
      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com.evil.test/gmail/v1/users/me/messages')).toEqual({
        endpointClass: 'external.unexpected',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      expect(classifyGoogleEndpoint('POST', 'https://oauth2.googleapis.com.attacker.com/token')).toEqual({
        endpointClass: 'external.unexpected',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });
    });

    it('classifies and flags disallowed Gmail mutation endpoints', () => {
      expect(classifyGoogleEndpoint('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send')).toEqual({
        endpointClass: 'gmail.messages.send',
        isAllowed: false,
        isGmailMutation: true,
        isUnexpected: false,
      });

      expect(classifyGoogleEndpoint('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts')).toEqual({
        endpointClass: 'gmail.drafts.create',
        isAllowed: false,
        isGmailMutation: true,
        isUnexpected: false,
      });

      expect(classifyGoogleEndpoint('DELETE', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_123')).toEqual({
        endpointClass: 'gmail.messages.delete',
        isAllowed: false,
        isGmailMutation: true,
        isUnexpected: false,
      });

      expect(classifyGoogleEndpoint('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_123/modify')).toEqual({
        endpointClass: 'gmail.messages.modify',
        isAllowed: false,
        isGmailMutation: true,
        isUnexpected: false,
      });
    });
  });

  describe('redactGoogleUrl', () => {
    it('strips query strings and replaces resource path identifiers with generic placeholders', () => {
      const raw =
        'https://gmail.googleapis.com/gmail/v1/users/founder%40company.test/messages/msg_9999/attachments/att_1111?format=metadata&access_token=ya29.secret_token_val&q=from%3Acandidate%40test.org';
      const redacted = redactGoogleUrl(raw);

      expect(redacted).toBe('https://gmail.googleapis.com/gmail/v1/users/:userId/messages/:messageId/attachments/:attachmentId');
      expect(redacted).not.toContain('founder');
      expect(redacted).not.toContain('msg_9999');
      expect(redacted).not.toContain('secret_token_val');
      expect(redacted).not.toContain('candidate');
    });
  });

  describe('GoogleNetworkAuditor lifecycle and metrics separation', () => {
    it('separates Gmail mutation attempts from unexpected endpoint requests in summary', () => {
      const auditor = startGoogleNetworkAudit({ throwOnMutation: false, throwOnUnexpected: false });

      // Allowed
      auditor.recordRequest({ method: 'POST', url: 'https://oauth2.googleapis.com/token' });
      auditor.recordRequest({ method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages' });

      // Gmail Mutation
      auditor.recordRequest({ method: 'POST', url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send' });

      // Unexpected Request
      auditor.recordRequest({ method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/labels' });

      const summary = auditor.getSummary();

      expect(summary.totalRequests).toBe(4);
      expect(summary.allowedRequests).toBe(2);
      expect(summary.disallowedRequests).toBe(2);
      expect(summary.gmailMutationAttempts).toBe(1);
      expect(summary.unexpectedRequests).toBe(1);
      expect(summary.zeroMutations).toBe(false);
      expect(summary.zeroUnexpected).toBe(false);

      expect(() => auditor.assertZeroMutations()).toThrow(/Zero mutations policy violated/);
      expect(() => auditor.assertZeroUnexpected()).toThrow(/exceeding fixed allowed contract/);
    });

    it('can throw GoogleUnexpectedEndpointError on unexpected requests when throwOnUnexpected is enabled', () => {
      const auditor = new GoogleNetworkAuditor({ throwOnUnexpected: true });
      expect(() =>
        auditor.recordRequest({ method: 'GET', url: 'https://gmail.googleapis.com/gmail/v1/users/me/labels' }),
      ).toThrow(GoogleUnexpectedEndpointError);
    });
  });

  describe('Live Electron process / ConnectorService opt-in fetch audit hook', () => {
    it('emits method + endpoint class/count summary to explicit file path when configured', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'outreachr-audit-test-'));
      const summaryFile = join(tempDir, 'audit-summary.json');

      try {
        const mockFetch = async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 });
        const auditedFetch = createAuditedFetch(mockFetch, { summaryPath: summaryFile, throwOnMutation: false });

        await auditedFetch('https://oauth2.googleapis.com/token', { method: 'POST' });
        await auditedFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages', { method: 'GET' });
        await auditedFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_001', { method: 'GET' });

        const summaryRaw = await readFile(summaryFile, 'utf8');
        const summary = JSON.parse(summaryRaw);

        expect(summary.totalRequests).toBe(3);
        expect(summary.allowedRequests).toBe(3);
        expect(summary.gmailMutationAttempts).toBe(0);
        expect(summary.zeroMutations).toBe(true);
        expect(summary.endpointCounts).toEqual({
          'POST oauth.token': 1,
          'GET gmail.messages.list': 1,
          'GET gmail.messages.get': 1,
        });

        // Ensure file contains NO secrets, tokens, or identifiers
        expect(summaryRaw).not.toContain('msg_001');
        expect(summaryRaw).not.toContain('Authorization');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });
});
