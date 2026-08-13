# `@outreachr/connectors`

Provider-neutral email, calendar, and OAuth primitives for Outreachr. The package supports Gmail, Google Calendar, Microsoft Graph mail, and Microsoft Graph calendar without depending on Electron, SQLite, or a secret-storage implementation.

## Security and delivery contract

- OAuth uses Authorization Code + PKCE (`S256`) and a loopback redirect. Desktop/public clients authenticate with PKCE and never send `client_secret`; a Google OAuth client explicitly created as confidential may supply an optional `clientSecret`, which the helpers send only to Google's token endpoint. Microsoft always exchanges as a public client.
- The application injects `fetch`, an access-token callback, and a `SendAttemptLedger`. Production must implement the ledger in SQLite with a unique `operation_key` and an atomic insert.
- Sending fails closed unless the founder approved the exact message fingerprint and a duplicate check covered every recipient identity.
- If a recipient was contacted before, the connector blocks the send. There is deliberately no bypass flag in this package.
- Gmail's response includes a message id and produces a `sent` receipt. Microsoft Graph `202 Accepted` produces an `accepted` receipt: Graph accepted the request but did not confirm delivery. It is never automatically resent.
- A network interruption or 5xx response during send becomes `ambiguous`. The operation key remains claimed and a replay returns the existing receipt instead of contacting the provider again.
- Sent messages carry `X-Outreachr-Operation-Key`. Relationship-mail reads expose that value as `MailboxMessage.operationKey` when the provider preserves it, so the application can confirm an ambiguous operation from the provider-authoritative sent stream. The application must also match provider, recipient, subject, and a bounded send-time window; a header alone is never proof and reconciliation never triggers another provider send.
- Explicit `408` and `429` responses can be retried inside the same guarded call. Reads also retry transient network/5xx failures. Non-idempotent draft and event creation do not retry network/5xx failures.
- Tokens and client configuration are not persisted here. Store refresh/access tokens in the operating-system credential vault, not SQLite or logs.

## Install and verify

```sh
npm install
npm run verify
npm run test:coverage
```

The Node tests use [MSW](https://mswjs.io/) to intercept the injected `fetch` implementation. They do not call live Google or Microsoft accounts.

## Minimal integration

```ts
import { GoogleConnector, fingerprintEmail, type SendAttemptLedger } from '@outreachr/connectors';

const connector = new GoogleConnector({
  fetch,
  getAccessToken: () => credentialVault.getValidGoogleAccessToken(),
  sendLedger: sqliteSendAttemptLedger satisfies SendAttemptLedger,
});

const message = {
  to: [
    {
      email: 'partner@example.com',
      recipientKey: 'investor-person-uuid',
    },
  ],
  subject: 'Company — seed round',
  text: 'Founder-reviewed message',
};

const messageFingerprint = await fingerprintEmail(message);
const receipt = await connector.sendEmail({
  message,
  safety: {
    operationKey: crypto.randomUUID(),
    approval: {
      approved: true,
      approvalId: crypto.randomUUID(),
      approvedAt: new Date().toISOString(),
      messageFingerprint,
    },
    duplicateCheck: {
      checkedAt: new Date().toISOString(),
      checkedRecipientKeys: ['investor-person-uuid'],
      previouslyContactedRecipientKeys: [],
    },
  },
});
```

`sendDraft` also requires the exact approved message. The application must invalidate approval if a provider draft or the local draft changes.

## Founder-created Google credentials

Each founder supplies their own Google Desktop OAuth client:

1. [Create or select a Google Cloud project](https://console.cloud.google.com/projectcreate).
2. In the [API Library](https://console.cloud.google.com/apis/library), enable **Gmail API** and **Google Calendar API**.
3. Configure the [OAuth consent screen](https://console.cloud.google.com/auth/overview). For a personal/testing client, add the founder's Google account as a test user. Google documents the process in [Configure OAuth consent](https://developers.google.com/workspace/guides/configure-oauth-consent).
4. In [Google Auth Platform clients](https://console.cloud.google.com/auth/clients), create an OAuth client of type **Desktop app**. Google has a matching [desktop credential guide](https://developers.google.com/workspace/guides/create-credentials#desktop-app).
5. Copy the public desktop **Client ID** into Outreachr. A Desktop-app client is public and normally needs no secret; if you created a confidential client, paste its secret into Outreachr's optional Client secret field. The helpers send `client_secret` only for Google and only when the application supplies one.
6. Outreachr opens the system browser, binds a temporary `127.0.0.1` port, and supplies the same loopback callback to `prepareDesktopAuthorization` and `exchangeAuthorizationCode`. See Google's [OAuth for installed apps](https://developers.google.com/identity/protocols/oauth2/native-app).

The `minimum` Google scope profile contains:

- `openid` and `userinfo.email` — identify the connected account.
- `gmail.send` — send only after approval.
- `calendar.events.owned` — list and create events on calendars owned by the founder.
- `calendar.events.freebusy` — query availability.

The optional `relationship-sync` profile adds `gmail.readonly`. Provider-hosted Gmail drafts additionally require the exported `PROVIDER_DRAFT_SCOPES.google` value (`gmail.compose`); a local SQLite draft followed by `sendEmail` does not. Request either broader capability only at the moment the founder enables it. Review Google's current [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), and [Workspace user-data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) before distribution. Some Gmail scopes are sensitive or restricted; a broadly distributed OAuth project may require verification. Founder-owned testing projects have Google test-user and token-expiry limitations.

## Founder-created Microsoft credentials

Each founder supplies their own Microsoft Entra public-client registration:

1. Open [Microsoft Entra app registrations](https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) and select **New registration**. The [registration quickstart](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app) explains account-type choices.
2. Copy the **Application (client) ID** and **Directory (tenant) ID**. `common`, `organizations`, `consumers`, or a tenant id can be supplied to the OAuth helpers, depending on the registration.
3. Under **Authentication → Add a platform**, choose **Mobile and desktop applications**, add the exact loopback redirect `http://localhost/oauth/callback`, and enable public-client flows where required. Outreachr advertises `http://localhost:<dynamic-port>/oauth/callback` to Microsoft because Entra ignores a loopback port only for `localhost`; the listener itself remains bound to `127.0.0.1` and validates the exact Host. See [desktop app configuration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration) and the [Node desktop tutorial](https://learn.microsoft.com/en-us/entra/identity-platform/tutorial-v2-nodejs-desktop).
4. Do **not** create or import a client secret. This is a public desktop client and the token exchange uses PKCE.
5. Under **API permissions**, add delegated Microsoft Graph permissions. The founder consents in the system browser. Organizational policies may require administrator consent; see [permissions and consent](https://learn.microsoft.com/en-us/entra/identity-platform/permissions-consent-overview).

The `minimum` Microsoft profile contains `openid`, `profile`, `email`, `offline_access`, `User.Read`, `Mail.Send`, and `Calendars.ReadWrite`. The optional `relationship-sync` profile adds `Mail.ReadBasic`, which reads message metadata without body or attachment content. Provider-hosted Graph drafts additionally require the exported `PROVIDER_DRAFT_SCOPES.microsoft` value (`Mail.ReadWrite`); a local SQLite draft followed by `sendEmail` does not. This separation avoids granting full mailbox read/write access by default. Verify current definitions in the [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference).

## OAuth flow

```ts
import {
  createLoopbackRedirectUri,
  prepareDesktopAuthorization,
  validateOAuthCallback,
  exchangeAuthorizationCode,
} from '@outreachr/connectors';

const redirectUri = createLoopbackRedirectUri(boundLoopbackPort);
const authorization = await prepareDesktopAuthorization({
  provider: 'google',
  clientId: founderClientId,
  redirectUri,
  scopeProfile: 'minimum',
});

// Open authorization.authorizationUrl in the system browser, then receive one
// callback on the bound loopback listener.
const callback = validateOAuthCallback(callbackUrl, authorization.state);
const tokens = await exchangeAuthorizationCode({
  provider: 'google',
  fetch,
  clientId: founderClientId,
  code: callback.code,
  codeVerifier: authorization.pkce.verifier,
  redirectUri,
});
```

Bind the loopback listener before opening the browser, accept only one callback, validate `state`, close it immediately afterward, and never log the callback query, authorization code, verifier, access token, or refresh token.

## API surface

Both providers implement:

- `createDraft`, `sendDraft`, and `sendEmail`.
- `createEvent`, `listEvents`, and `queryFreeBusy`.
- Stable `ConnectorError` codes with provider code, HTTP status, request id, retryability, `mayHaveSucceeded`, and an attached send receipt when relevant.

Provider responses are treated as untrusted data. Mailbox records without a usable provider id,
sender, or timestamp and calendar records without a usable id, start, or end are skipped without
discarding the provider's next-page token. Malformed attendee identities are omitted. Outreachr
never substitutes placeholder email addresses or epoch timestamps. A successful create response
that cannot identify the object it may have created fails with `AMBIGUOUS_CREATE`,
`mayHaveSucceeded: true`, and `retryable: false`. The same fail-closed result applies when a
create POST loses its response, times out after dispatch, or receives a 5xx response; callers must
reconcile it instead of blindly retrying.

OAuth helpers implement PKCE generation, authorization URL preparation, callback validation, authorization-code exchange, and refresh-token exchange. `getScopes` returns a copy of either provider's minimum or relationship-sync profile.

## Production ledger requirement

The included `InMemorySendAttemptLedger` exists for tests and short-lived tools only. A production SQLite implementation should use one transaction to insert a `pending` row under a unique operation key. If that insert conflicts, return the existing row and do not call the provider. Never delete `pending`, `accepted`, `sent`, or `ambiguous` records during normal operation; those states are the mechanism that prevents repeated sends after crashes and uncertain responses.

Private outreach history, approvals, receipts, OAuth grants, and contact activity must remain in the founder's private SQLite vault. Do not include them in public investor seed or contribution databases.

## License

Apache-2.0. Provider names and APIs remain subject to their respective terms and policies.
