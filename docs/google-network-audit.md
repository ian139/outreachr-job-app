# Redacted Google Live-Smoke & Network Audit Mechanic

## Overview

The Redacted Google Live-Smoke & Network Audit Mechanic is a main-owned acceptance tool designed for v0.2.0 release-readiness verification. It enforces strict read-only access and zero mutation policies when inspecting Google API traffic during live-smoke testing or automated Playwright provider mock execution.

The mechanic inspects outbound network requests to Google OAuth and Gmail endpoints, classifies each request into a canonical endpoint class, redacts all sensitive parameters and content, and hard-fails any attempt to mutate Gmail state.

---

## Scope & Endpoint Taxonomy

### Allowed Endpoints

The network auditor permits only authentication and read-only retrieval operations:

| Category | HTTP Method | Endpoint Class | Endpoint Pattern | Description |
| :--- | :--- | :--- | :--- | :--- |
| **OAuth** | `POST` / `GET` | `oauth.token` | `/token` | Code exchange and token refresh |
| **OAuth** | `GET` | `oauth.authorize` | `/auth`, `/o/oauth2/v2/auth` | OAuth authorization flow |
| **OAuth** | `POST` / `GET` | `oauth.revoke` | `/revoke` | Token revocation |
| **OAuth** | `GET` | `oauth.userinfo` | `/userinfo` | Identity verification |
| **Gmail** | `GET` | `gmail.messages.list` | `/users/:userId/messages` | Message list enumeration |
| **Gmail** | `GET` | `gmail.messages.get` | `/users/:userId/messages/:messageId` | Single message metadata/read |
| **Gmail** | `GET` | `gmail.attachments.get` | `/users/:userId/messages/:messageId/attachments/:attachmentId` | Attachment retrieval |
| **Gmail** | `GET` | `gmail.threads.list` | `/users/:userId/threads` | Thread list enumeration |
| **Gmail** | `GET` | `gmail.threads.get` | `/users/:userId/threads/:threadId` | Thread read |
| **Gmail** | `GET` | `gmail.labels.list` | `/users/:userId/labels` | Label enumeration |
| **Gmail** | `GET` | `gmail.labels.get` | `/users/:userId/labels/:labelId` | Label detail read |
| **Gmail** | `GET` | `gmail.profile.get` | `/users/:userId/profile` | User profile read |

### Disallowed Gmail Mutations

ANY non-GET request to Gmail API endpoints is classified as a disallowed mutation and hard-fails immediately when `throwOnMutation` is enabled:

- `POST /users/:userId/messages/send` (`gmail.messages.send`)
- `POST /users/:userId/drafts` (`gmail.drafts.create`)
- `POST /users/:userId/drafts/send` (`gmail.drafts.send`)
- `DELETE /users/:userId/messages/:messageId` (`gmail.messages.delete`)
- `PUT` or `PATCH` on messages (`gmail.messages.mutation`)
- `POST /users/:userId/messages/:messageId/modify` (`gmail.messages.modify`)
- `POST /users/:userId/threads/:threadId/modify` (`gmail.threads.modify`)

---

## Strict Redaction Guarantees

The network auditor guarantees that sensitive founder or contact data is NEVER persisted or logged:

1. **Tokens & Secrets:** Bearer access tokens, refresh tokens, client secrets, and authorization codes are completely omitted.
2. **Query Parameters:** Query strings (`?q=...`, `?access_token=...`, `?code=...`, `?pageToken=...`) are stripped from recorded URLs.
3. **Resource Identifiers:** User email addresses, message IDs, thread IDs, attachment IDs, draft IDs, and label IDs in URL path segments are replaced with generic placeholders (`:userId`, `:messageId`, `:threadId`, `:attachmentId`, `:draftId`, `:labelId`).
4. **Content & Headers:** Request/response headers, message bodies, MIME text, email subjects, sender/recipient addresses, and correspondent names are NEVER logged or stored.

---

## Machine-Readable Summary Structure

The auditor generates a sanitized machine-readable summary object suitable for automated assertions and release attestations:

```json
{
  "totalRequests": 3,
  "allowedRequests": 3,
  "mutationAttempts": 0,
  "zeroMutations": true,
  "endpointCounts": {
    "POST oauth.token": 1,
    "GET gmail.messages.list": 1,
    "GET gmail.messages.get": 1
  },
  "records": [
    { "method": "POST", "endpointClass": "oauth.token", "status": "allowed" },
    { "method": "GET", "endpointClass": "gmail.messages.list", "status": "allowed" },
    { "method": "GET", "endpointClass": "gmail.messages.get", "status": "allowed" }
  ]
}
```

---

## Auditor Lifecycle API

```typescript
import { startGoogleNetworkAudit, GoogleNetworkAuditor } from '../apps/desktop/e2e/support/google-network-audit';

// 1. Start audit
const auditor = startGoogleNetworkAudit({ throwOnMutation: true });

// 2. Intercept or record requests
auditor.recordRequest({
  method: 'GET',
  url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages',
});

// 3. Consume redacted summary
const summary = auditor.getSummary();
console.log(`Total: ${summary.totalRequests}, Zero Mutations: ${summary.zeroMutations}`);

// 4. Assert zero mutations
auditor.assertZeroMutations();

// 5. Reset or stop
auditor.reset();
auditor.stop();
```

---

## Verification & Self-Test

Run the isolated unit tests and offline verification script:

```bash
# Run unit tests
pnpm --filter @outreachr/desktop test:unit

# Run offline verification script
node scripts/verify-google-network-audit.mjs
```
