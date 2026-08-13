import { describe, expect, it } from 'vitest';
import {
  GoogleMutationDisallowedError,
  GoogleNetworkAuditor,
  classifyGoogleEndpoint,
  redactGoogleUrl,
  startGoogleNetworkAudit,
} from '../../e2e/support/google-network-audit';

describe('Redacted Google Network Audit Mechanic', () => {
  describe('classifyGoogleEndpoint', () => {
    it('classifies allowed OAuth and token endpoints', () => {
      expect(classifyGoogleEndpoint('POST', 'https://oauth2.googleapis.com/token')).toEqual({
        endpointClass: 'oauth.token',
        isAllowed: true,
        isMutation: false,
      });

      expect(classifyGoogleEndpoint('GET', 'https://accounts.google.com/o/oauth2/v2/auth?scope=openid')).toEqual({
        endpointClass: 'oauth.authorize',
        isAllowed: true,
        isMutation: false,
      });

      expect(classifyGoogleEndpoint('POST', 'https://oauth2.googleapis.com/revoke?token=123')).toEqual({
        endpointClass: 'oauth.revoke',
        isAllowed: true,
        isMutation: false,
      });
    });

    it('classifies allowed Gmail GET read endpoints', () => {
      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages')).toEqual({
        endpointClass: 'gmail.messages.list',
        isAllowed: true,
        isMutation: false,
      });

      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/founder@example.com/messages/msg_12345')).toEqual({
        endpointClass: 'gmail.messages.get',
        isAllowed: true,
        isMutation: false,
      });

      expect(
        classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_12345/attachments/att_999'),
      ).toEqual({
        endpointClass: 'gmail.attachments.get',
        isAllowed: true,
        isMutation: false,
      });

      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/threads')).toEqual({
        endpointClass: 'gmail.threads.list',
        isAllowed: true,
        isMutation: false,
      });

      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread_abc123')).toEqual({
        endpointClass: 'gmail.threads.get',
        isAllowed: true,
        isMutation: false,
      });

      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/labels')).toEqual({
        endpointClass: 'gmail.labels.list',
        isAllowed: true,
        isMutation: false,
      });

      expect(classifyGoogleEndpoint('GET', 'https://gmail.googleapis.com/gmail/v1/users/me/profile')).toEqual({
        endpointClass: 'gmail.profile.get',
        isAllowed: true,
        isMutation: false,
      });
    });

    it('classifies and flags disallowed Gmail mutation endpoints', () => {
      expect(classifyGoogleEndpoint('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send')).toEqual({
        endpointClass: 'gmail.messages.send',
        isAllowed: false,
        isMutation: true,
      });

      expect(classifyGoogleEndpoint('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts')).toEqual({
        endpointClass: 'gmail.drafts.create',
        isAllowed: false,
        isMutation: true,
      });

      expect(classifyGoogleEndpoint('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send')).toEqual({
        endpointClass: 'gmail.drafts.send',
        isAllowed: false,
        isMutation: true,
      });

      expect(classifyGoogleEndpoint('DELETE', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_123')).toEqual({
        endpointClass: 'gmail.messages.delete',
        isAllowed: false,
        isMutation: true,
      });

      expect(classifyGoogleEndpoint('PUT', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_123')).toEqual({
        endpointClass: 'gmail.messages.mutation',
        isAllowed: false,
        isMutation: true,
      });

      expect(classifyGoogleEndpoint('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/messages/msg_123/modify')).toEqual({
        endpointClass: 'gmail.messages.modify',
        isAllowed: false,
        isMutation: true,
      });

      expect(classifyGoogleEndpoint('POST', 'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread_456/modify')).toEqual({
        endpointClass: 'gmail.threads.modify',
        isAllowed: false,
        isMutation: true,
      });
    });
  });

  describe('redactGoogleUrl', () => {
    it('strips query strings and replaces resource path identifiers with generic placeholders', () => {
      const raw =
        'https://gmail.googleapis.com/gmail/v1/users/founder%40company.com/messages/msg_998877/attachments/att_112233?format=metadata&access_token=ya29.secret123&q=from%3Asender%40test.com';
      const redacted = redactGoogleUrl(raw);

      expect(redacted).toBe('https://gmail.googleapis.com/gmail/v1/users/:userId/messages/:messageId/attachments/:attachmentId');
      expect(redacted).not.toContain('founder');
      expect(redacted).not.toContain('company.com');
      expect(redacted).not.toContain('msg_998877');
      expect(redacted).not.toContain('att_112233');
      expect(redacted).not.toContain('secret123');
      expect(redacted).not.toContain('sender');
    });

    it('redacts thread, draft, and label path components', () => {
      expect(redactGoogleUrl('https://gmail.googleapis.com/gmail/v1/users/ada@test.org/threads/th_001')).toBe(
        'https://gmail.googleapis.com/gmail/v1/users/:userId/threads/:threadId',
      );
      expect(redactGoogleUrl('https://gmail.googleapis.com/gmail/v1/users/ada@test.org/drafts/dr_002')).toBe(
        'https://gmail.googleapis.com/gmail/v1/users/:userId/drafts/:draftId',
      );
      expect(redactGoogleUrl('https://gmail.googleapis.com/gmail/v1/users/ada@test.org/labels/label_003')).toBe(
        'https://gmail.googleapis.com/gmail/v1/users/:userId/labels/:labelId',
      );
    });
  });

  describe('GoogleNetworkAuditor lifecycle and summary', () => {
    it('records allowed GET read requests and returns a machine-readable summary with zero mutations', () => {
      const auditor = startGoogleNetworkAudit({ throwOnMutation: true });

      auditor.recordRequest({
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token',
        headers: { Authorization: 'Bearer secret-token-value' },
        body: { code: 'secret_auth_code' },
      });

      auditor.recordRequest({
        method: 'GET',
        url: 'https://gmail.googleapis.com/gmail/v1/users/ada@test.org/messages?q=is%3Aunread',
      });

      auditor.recordRequest({
        method: 'GET',
        url: 'https://gmail.googleapis.com/gmail/v1/users/ada@test.org/messages/msg_123',
      });

      const summary = auditor.getSummary();

      expect(summary.totalRequests).toBe(3);
      expect(summary.allowedRequests).toBe(3);
      expect(summary.mutationAttempts).toBe(0);
      expect(summary.zeroMutations).toBe(true);

      expect(summary.endpointCounts).toEqual({
        'POST oauth.token': 1,
        'GET gmail.messages.list': 1,
        'GET gmail.messages.get': 1,
      });

      expect(summary.records).toEqual([
        { method: 'POST', endpointClass: 'oauth.token', status: 'allowed' },
        { method: 'GET', endpointClass: 'gmail.messages.list', status: 'allowed' },
        { method: 'GET', endpointClass: 'gmail.messages.get', status: 'allowed' },
      ]);

      // Verify no tokens or sensitive strings leak into summary JSON
      const jsonStr = JSON.stringify(summary);
      expect(jsonStr).not.toContain('secret-token-value');
      expect(jsonStr).not.toContain('secret_auth_code');
      expect(jsonStr).not.toContain('ada@test.org');
      expect(jsonStr).not.toContain('msg_123');
      expect(jsonStr).not.toContain('is%3Aunread');

      expect(() => auditor.assertZeroMutations()).not.toThrow();
    });

    it('hard-fails on disallowed Gmail mutations when throwOnMutation is true', () => {
      const auditor = new GoogleNetworkAuditor({ throwOnMutation: true });

      auditor.recordRequest({
        method: 'GET',
        url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      });

      expect(() =>
        auditor.recordRequest({
          method: 'POST',
          url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
          body: { raw: 'base64_encoded_email_body_text' },
        }),
      ).toThrow(GoogleMutationDisallowedError);

      const summary = auditor.getSummary();
      expect(summary.totalRequests).toBe(2);
      expect(summary.allowedRequests).toBe(1);
      expect(summary.mutationAttempts).toBe(1);
      expect(summary.zeroMutations).toBe(false);

      expect(() => auditor.assertZeroMutations()).toThrow(/Zero mutations policy violated/);
    });

    it('counts disallowed Gmail mutations without throwing when throwOnMutation is false', () => {
      const auditor = new GoogleNetworkAuditor({ throwOnMutation: false });

      auditor.recordRequest({
        method: 'POST',
        url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      });

      auditor.recordRequest({
        method: 'POST',
        url: 'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
      });

      const summary = auditor.getSummary();
      expect(summary.totalRequests).toBe(2);
      expect(summary.allowedRequests).toBe(0);
      expect(summary.mutationAttempts).toBe(2);
      expect(summary.zeroMutations).toBe(false);

      expect(summary.records).toEqual([
        { method: 'POST', endpointClass: 'gmail.messages.send', status: 'disallowed' },
        { method: 'POST', endpointClass: 'gmail.drafts.create', status: 'disallowed' },
      ]);
    });

    it('supports reset and stop lifecycle operations', () => {
      const auditor = startGoogleNetworkAudit({ throwOnMutation: false });

      auditor.recordRequest({
        method: 'GET',
        url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      });
      expect(auditor.getSummary().totalRequests).toBe(1);

      auditor.reset();
      expect(auditor.getSummary().totalRequests).toBe(0);

      auditor.stop();
      auditor.recordRequest({
        method: 'GET',
        url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
      });
      expect(auditor.getSummary().totalRequests).toBe(0);

      auditor.start();
      auditor.recordRequest({
        method: 'GET',
        url: 'https://gmail.googleapis.com/gmail/v1/users/me/threads',
      });
      expect(auditor.getSummary().totalRequests).toBe(1);
    });
  });
});
