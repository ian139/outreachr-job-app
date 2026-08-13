# Redacted Google Live-Smoke & Network Audit Mechanic (Fail-Closed)

## Overview

The Redacted Google Live-Smoke & Network Audit Mechanic is a main-owned acceptance tool designed for v0.2.0 release-readiness verification. It enforces strict read-only access and zero mutation policies when inspecting Google API traffic during live-smoke testing or automated Playwright provider mock execution.

The mechanic inspects outbound network requests to Google OAuth and Gmail endpoints, classifies each request into a canonical endpoint class, redacts all sensitive parameters and content, and hard-fails any attempt to mutate Gmail state or execute uncontracted operations.

---

## Fail-Closed Scope & Endpoint Taxonomy

### Allowed Contract (Strict & Fail-Closed)

The network auditor permits ONLY authentication and explicit Gmail GET read operations:

| Category | HTTP Method | Endpoint Class | Endpoint Pattern | Description |
| :--- | :--- | :--- | :--- | :--- |
| **OAuth** | `POST` / `GET` | `oauth.token` | `oauth2.googleapis.com/token` | Code exchange and token refresh |
| **OAuth** | `GET` | `oauth.authorize` | `accounts.google.com/o/oauth2/v2/auth` | OAuth authorization flow |
| **OAuth** | `GET` | `oauth.userinfo` | `www.googleapis.com/oauth2/v2/userinfo` | Identity verification |
| **Gmail** | `GET` | `gmail.messages.list` | `gmail.googleapis.com/gmail/v1/users/:userId/messages` | Message list enumeration |
| **Gmail** | `GET` | `gmail.messages.get` | `gmail.googleapis.com/gmail/v1/users/:userId/messages/:messageId` | Single message metadata/read |
| **Gmail** | `GET` | `gmail.attachments.get` | `gmail.googleapis.com/gmail/v1/users/:userId/messages/:messageId/attachments/:attachmentId` | Attachment retrieval |
| **Gmail** | `GET` | `gmail.threads.list` | `gmail.googleapis.com/gmail/v1/users/:userId/threads` | Thread list enumeration |
| **Gmail** | `GET` | `gmail.threads.get` | `gmail.googleapis.com/gmail/v1/users/:userId/threads/:threadId` | Thread read |

### Exact Host Matching

Hostnames MUST match explicit approved domains (`oauth2.googleapis.com`, `accounts.google.com`, `www.googleapis.com`, `openidconnect.googleapis.com`, `gmail.googleapis.com`, `calendar.googleapis.com`, or loopback test interfaces `127.0.0.1`/`localhost`). Unapproved hostnames or spoofed subdomains are classified as `external.unexpected` and disallowed.

### Disallowed Traffic Categorization

The auditor separates disallowed traffic into two distinct metrics:

1. **Gmail Mutation Attempts (`gmailMutationAttempts`):**
   - `POST /users/:userId/messages/send` (`gmail.messages.send`)
   - `POST /users/:userId/drafts` (`gmail.drafts.create`)
   - `POST /users/:userId/drafts/send` (`gmail.drafts.send`)
   - `DELETE /users/:userId/messages/:messageId` (`gmail.messages.delete`)
   - `POST /users/:userId/messages/:messageId/modify` (`gmail.messages.modify`)
   - `POST /users/:userId/threads/:threadId/modify` (`gmail.threads.modify`)

2. **Unexpected Endpoint Requests (`unexpectedRequests`):**
   - Uncontracted endpoints exceeding the fixed allowed contract: OAuth revoke (`oauth.revoke`), Gmail labels GET (`gmail.labels.get`), Gmail drafts GET (`gmail.drafts.get`), Gmail profile GET (`gmail.profile.get`), Calendar endpoints (`calendar.events.list`, `calendar.events.create`), external/spoofed hosts.

---

## Strict Redaction Guarantees

The network auditor guarantees that sensitive founder or contact data is NEVER persisted or logged:

1. **Tokens & Secrets:** Bearer access tokens, refresh tokens, client secrets, and authorization codes are completely omitted.
2. **Query Parameters:** Query strings (`?q=...`, `?access_token=...`, `?code=...`, `?pageToken=...`) are stripped from recorded URLs.
3. **Resource Identifiers:** User email addresses, message IDs, thread IDs, attachment IDs, draft IDs, and label IDs in URL path segments are replaced with generic placeholders (`:userId`, `:messageId`, `:threadId`, `:attachmentId`, `:draftId`, `:labelId`).
4. **Content & Headers:** Request/response headers, message bodies, MIME text, email subjects, sender/recipient addresses, and correspondent names are NEVER logged or stored.

---

## Machine-Readable Summary Structure

```json
{
  "totalRequests": 3,
  "allowedRequests": 3,
  "disallowedRequests": 0,
  "gmailMutationAttempts": 0,
  "unexpectedRequests": 0,
  "zeroMutations": true,
  "zeroUnexpected": true,
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

## Live Electron Process Audit Hook

`ConnectorService` in `apps/desktop/src/main/connector-service.ts` supports opt-in main-process fetch auditing via `process.env.OUTREACHR_LIVE_SMOKE_AUDIT_PATH` or `options.auditSummaryPath`.

When set, all outbound fetch calls performed by `ConnectorService` pass through `createAuditedFetch`, writing/flushing the redacted summary JSON to the specified path after each request.

---

## Verification & Self-Test

Run the isolated unit tests and offline verification script:

```bash
# Run unit tests
pnpm --filter @outreachr/desktop test:unit

# Run offline verification script
node scripts/verify-google-network-audit.mjs
```
