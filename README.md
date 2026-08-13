# Outreachr Job Applications

**A private desktop workspace for job-application communication.**

[![License](https://img.shields.io/badge/license-Apache--2.0-0b7285.svg)](LICENSE)

This dedicated fork of Outreachr turns the local-first Electron workspace into a
job-application tracker. Applications, companies, contacts, stage history, notes,
tasks, related provider threads, and reviewed drafts remain in a user-owned SQLite
vault. Mail bodies are fetched on demand for the selected thread and are not
persisted merely to populate the inbox.

## What it does

- Creates durable job applications with user-defined lifecycle stages and explicit valid transitions.
- Keeps append-only stage history, company and contact relationships, notes, and follow-up tasks.
- Searches and filters applications and paginates provider thread lists.
- Fetches complete selected-thread content through the privileged main process, with cancellation when selection changes.
- Renders plain text and sanitized provider HTML, including quoted replies, preformatted text, long links, and wide tables.
- Shows provider provenance, truncation, empty-body, and retrieval-error states.
- Prepares application-bound drafts for exact-content review. Provider dispatch remains behind Outreachr's approval, reservation, audit, and connector boundaries; ambiguous sends are never retried automatically.
- Supports desktop and mobile list/detail navigation without retaining every mailbox body.

## Local-first privacy and trust boundaries

The canonical workspace is a local SQLite vault. OAuth tokens remain behind the
operating-system credential and main-process boundaries. The sandboxed renderer
uses a frozen, allowlisted preload bridge; it has no Node integration and cannot
navigate arbitrarily.

Mailbox list calls retrieve metadata only. Selecting a thread performs a bounded,
cancelable detail request. Returned bodies live in renderer/request memory and are
not written to the vault. Untrusted HTML is sanitized before rendering, and only
safe HTTPS source links can be opened through the privileged external-link handler.

Every external send remains bound to reviewed recipient, sender, subject, body,
thread identity, and content hash. No bulk outreach, sequence, autonomous follow-up,
or retry-after-ambiguous-send behavior is included.

## Integrations

- Gmail through user-created desktop OAuth credentials.
- Outlook through user-created public-client credentials.
- Google and Microsoft Calendar connectors retained from upstream.

Integrations are optional. Fixture-backed tests use isolated vaults and mock
providers; they require no production credentials and perform no live send.

## Install or build

Download a signed release artifact from [GitHub Releases](https://github.com/ian139/outreachr-job-app/releases) or build the current source locally:

To run from source:

```bash
corepack enable
corepack prepare pnpm@11.18.0 --activate
pnpm install
pnpm dev
```

Run the complete local verification gates:

```bash
pnpm verify
pnpm test:e2e
```

Tests use isolated local vaults and mock mail/calendar providers; they never require production credentials.

## Repository map

- `apps/desktop` — Electron shell, secure preload bridge, React UI, and Playwright Electron tests.
- `packages/core` — SQLite schema, repositories, migrations, seed handling, and safety invariants.
- `packages/connectors` — Gmail, Google Calendar, Outlook, and Microsoft Calendar adapters.
- `packages/agents` — Codex and Claude Agent SDK adapters with proposal-only external actions.
- `packages/mcp` — typed, host-filterable local MCP server.
- `resources` — upstream immutable seed and rights metadata retained for license and provenance obligations.

Architecture, security, testing, privacy, and release details remain in `docs/`.

## License and data rights

First-party code and project-authored documentation are licensed under [Apache-2.0](LICENSE). Upstream data retains source-specific rights recorded in its package manifest and is not automatically Apache-licensed.
