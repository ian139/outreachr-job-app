import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  GoogleMutationDisallowedError,
  GoogleUnexpectedEndpointError,
  classifyGoogleEndpoint,
  createAuditedFetch,
  redactGoogleUrl,
  startGoogleNetworkAudit,
} from '../../src/main/google-network-audit';

describe('Redacted Google Network Audit Mechanic (Production-Owned Fail-Closed)', () => {
  describe('classifyGoogleEndpoint & Exact Method Policy', () => {
    it('requires POST for oauth.token, GET for oauth.authorize, and GET for oauth.userinfo', () => {
      // Allowed POST /token
      expect(classifyGoogleEndpoint('POST', 'https://oauth2.googleapis.com/token')).toEqual({
        endpointClass: 'oauth.token',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      // Disallowed GET /token
      expect(classifyGoogleEndpoint('GET', 'https://oauth2.googleapis.com/token')).toEqual({
        endpointClass: 'oauth.token.unexpected_method',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      // Allowed GET /auth
      expect(
        classifyGoogleEndpoint('GET', 'https://accounts.google.com/o/oauth2/v2/auth?scope=openid'),
      ).toEqual({
        endpointClass: 'oauth.authorize',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      // Disallowed POST /auth
      expect(
        classifyGoogleEndpoint('POST', 'https://accounts.google.com/o/oauth2/v2/auth'),
      ).toEqual({
        endpointClass: 'oauth.authorize.unexpected_method',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      // Allowed GET /userinfo
      expect(
        classifyGoogleEndpoint('GET', 'https://www.googleapis.com/oauth2/v2/userinfo'),
      ).toEqual({
        endpointClass: 'oauth.userinfo',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      // Disallowed POST /userinfo
      expect(
        classifyGoogleEndpoint('POST', 'https://www.googleapis.com/oauth2/v2/userinfo'),
      ).toEqual({
        endpointClass: 'oauth.userinfo.unexpected_method',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });
    });

    it('classifies allowed Gmail GET read operations ONLY', () => {
      expect(
        classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages'),
      ).toEqual({
        endpointClass: 'gmail.messages.list',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      expect(
        classifyGoogleEndpoint(
          'GET',
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_123',
        ),
      ).toEqual({
        endpointClass: 'gmail.messages.get',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      expect(
        classifyGoogleEndpoint(
          'GET',
          'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_123/attachments/att_456',
        ),
      ).toEqual({
        endpointClass: 'gmail.attachments.get',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      expect(
        classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/threads'),
      ).toEqual({
        endpointClass: 'gmail.threads.list',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });

      expect(
        classifyGoogleEndpoint(
          'GET',
          'https://gmail.googleapis.com/gmail/v1/users/me/threads/th_789',
        ),
      ).toEqual({
        endpointClass: 'gmail.threads.get',
        isAllowed: true,
        isGmailMutation: false,
        isUnexpected: false,
      });
    });

    it('disallows uncontracted Google endpoints as unexpected (OAuth revoke, Gmail labels/drafts/profile, Calendar)', () => {
      expect(
        classifyGoogleEndpoint('POST', 'https://oauth2.googleapis.com/revoke?token=123'),
      ).toEqual({
        endpointClass: 'oauth.revoke',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      expect(
        classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/labels'),
      ).toEqual({
        endpointClass: 'gmail.labels.get',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      expect(
        classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts'),
      ).toEqual({
        endpointClass: 'gmail.drafts.get',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      expect(
        classifyGoogleEndpoint(
          'GET',
          'https://calendar.googleapis.com/calendar/v3/calendars/primary/events',
        ),
      ).toEqual({
        endpointClass: 'calendar.events.list',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });
    });

    it('enforces exact host matching and rejects spoofed subdomains', () => {
      expect(
        classifyGoogleEndpoint(
          'GET',
          'https://gmail.googleapis.com.evil.test/gmail/v1/users/me/messages',
        ),
      ).toEqual({
        endpointClass: 'external.unexpected',
        isAllowed: false,
        isGmailMutation: false,
        isUnexpected: true,
      });

      for (const [url, endpointClass] of [
        ['https://gmail.googleapis.com/evil/token', 'gmail.read.unexpected'],
        ['http://127.0.0.1/gmail/v1/users/me/messages', 'external.unexpected'],
        ['http://localhost/users/me/messages', 'external.unexpected'],
      ]) {
        expect(classifyGoogleEndpoint('GET', url)).toMatchObject({
          endpointClass,
          isAllowed: false,
          isUnexpected: true,
        });
      }
    });
  });

  describe('redactGoogleUrl', () => {
    it('strips query strings and replaces resource path identifiers with generic placeholders', () => {
      const raw =
        'https://gmail.googleapis.com/gmail/v1/users/founder%40company.test/messages/msg_9999/attachments/att_1111?format=metadata&access_token=ya29.secret_token_val&q=from%3Acandidate%40test.org';
      const redacted = redactGoogleUrl(raw);

      expect(redacted).toBe(
        'https://gmail.googleapis.com/gmail/v1/users/:userId/messages/:messageId/attachments/:attachmentId',
      );
      expect(redacted).not.toContain('founder');
      expect(redacted).not.toContain('msg_9999');
      expect(redacted).not.toContain('secret_token_val');
    });
  });

  describe('Disallowed requests prevent network fetch invocation', () => {
    it('prevents fetchFn from being called when a Gmail mutation or unexpected request occurs', async () => {
      const mockFetch = vi.fn(async () => new Response('{}', { status: 200 }));
      const auditedFetch = createAuditedFetch(mockFetch, {
        throwOnMutation: true,
        throwOnUnexpected: true,
      });

      // Disallowed mutation must throw and prevent mockFetch invocation
      await expect(
        auditedFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
        }),
      ).rejects.toThrow(GoogleMutationDisallowedError);

      expect(mockFetch).not.toHaveBeenCalled();

      // Disallowed unexpected request must throw and prevent mockFetch invocation
      await expect(
        auditedFetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', { method: 'GET' }),
      ).rejects.toThrow(GoogleUnexpectedEndpointError);

      expect(mockFetch).not.toHaveBeenCalled();

      const requestWithOverriddenMethod = new Request(
        'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      );
      await expect(auditedFetch(requestWithOverriddenMethod, { method: 'POST' })).rejects.toThrow(
        GoogleMutationDisallowedError,
      );
      expect(mockFetch).not.toHaveBeenCalled();

      // Allowed GET request succeeds and invokes mockFetch
      await auditedFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages', {
        method: 'GET',
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Initial summary creation and unwritable summary failure', () => {
    it('creates an initial zero-summary file upon auditor start when summaryPath is set', async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'outreachr-init-summary-'));
      const summaryFile = join(tempDir, 'initial-summary.json');

      try {
        startGoogleNetworkAudit({ summaryPath: summaryFile });

        const content = await readFile(summaryFile, 'utf8');
        const summary = JSON.parse(content);

        expect(summary.totalRequests).toBe(0);
        expect(summary.allowedRequests).toBe(0);
        expect(summary.gmailMutationAttempts).toBe(0);
        expect(summary.unexpectedRequests).toBe(0);
        expect(summary.zeroMutations).toBe(true);
        expect(summary.zeroUnexpected).toBe(true);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('fails closed when summaryPath is unwritable', () => {
      const invalidPath = join(tmpdir(), 'non_existent_folder_xyz_123', 'summary.json');

      expect(() => {
        startGoogleNetworkAudit({ summaryPath: invalidPath });
      }).toThrow();
    });
  });
});
