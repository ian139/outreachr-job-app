# Contributing to Outreachr

Outreachr welcomes code, documentation, accessibility, connector, and application-data contributions.

## Development

1. Install Node.js 22 or newer and pnpm 11.18.0.
2. Run `pnpm install --frozen-lockfile` after the first lockfile is published, or `pnpm install` while bootstrapping.
3. Run `pnpm verify` before opening a pull request.
4. For desktop changes, also run `pnpm test:e2e` and the appropriate local package smoke test.

## Data contributions

Never commit a founder's private activity, email history, calendar content, notes, meetings, drafts, approvals, send receipts, relationship graph, credentials, or suppression reasons. Use the in-app contribution exporter, review the generated diff, and include source URLs and rights metadata for every assertion. Publicly published professional work email addresses are permitted when necessary, attributed, and legally redistributable; personal addresses are not.

By contributing code or project-authored documentation, you agree that your contribution is licensed under Apache-2.0. Data retains its actual per-source license or permission status.
