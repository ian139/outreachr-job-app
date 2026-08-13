# Next-session fork expansion roadmap

## 0. Scope, truth status, and operating rules

This document is a self-contained execution plan for the next chat session in the Outreachr fork. **Current facts** below are grounded in source paths in this worktree. A file's presence is not proof that its screen renders, its data loads, or its interactions work; dormant pages are explicitly **not verified**. **Proposed** contracts are targets, not implemented behavior.

The current renderer entry point is `apps/desktop/src/renderer/src/App.tsx`: it currently routes `/applications`, `/inbox`, and `/settings/*`, redirects `/` to applications, and sends unknown paths to applications. The following page modules exist but are dormant/unverified: `InvestorsPage.tsx`, `ListsPage.tsx`, `IntroductionsPage.tsx`, `RoundOverviewPage.tsx`, `PipelinePage.tsx`, `TasksPage.tsx`, `UpNextPage.tsx`, `MeetingsPage.tsx`, `KnowledgePage.tsx`, `DocumentsPage.tsx`, `OutreachPage.tsx`, `ReviewPage.tsx`, and `AgentPage.tsx` under `apps/desktop/src/renderer/src/pages/`.

Shared typed contracts already define investor, pipeline, round, work-item, task, meeting, knowledge, list, mail, draft, agent, connector, suppression, and audit models in `apps/desktop/src/shared/contracts.ts`. Existing command names include `investor.*`, `pipeline.*`, `round.update`, `task.*`, `meeting.*`, `knowledge.save`, `list.*`, `draft.*`, `mail.review`, `agent.*`, and connector synchronization. The bridge exposes `bootstrap`, typed `command`, `listMailThreads`, `getMailThread`, and cancellation in the same file. These are available integration seams, not proof of end-to-end behavior.

Invariants for every packet:

- Read-only exploration must never mutate messages, delete mail, send mail, or alter relationship-sync/audit behavior.
- Draft approval and sending remain explicit, policy-checked, hash-bound actions; no feature silently sends.
- Connector scope, vault handling, sanitization, suppression, and audit rules remain owned by existing main/preload services (`apps/desktop/src/main/`, `src/preload/index.ts`) and must not be bypassed.
- Use synthetic fixtures and provider mocks only. Never inspect credentials or private email content.
- Every packet adds focused contract/unit tests and renderer/Electron/browser evidence where its surface warrants it; do not claim evidence until run.

## 1. Investor universe, lists, and introductions

### Current implemented-but-unreachable assets (fact)

- Dormant pages: `pages/InvestorsPage.tsx`, `ListsPage.tsx`, and `IntroductionsPage.tsx` (presence only; **not verified**).
- Contracts: `InvestorSummary`, `InvestorDetail`, `PersonSummary`, `ListItem`, `SourceRef`; commands `investor.get/create/target`, `person.contact.add`, and `list.create/update` in `src/shared/contracts.ts`.
- Bootstrap already carries `investors`, `people`, `lists`, and counts. Main ownership is in `apps/desktop/src/main/` command/connector services (exact implementation must be traced before coding).

### Proposed user-visible behavior

- `/investors` provides searchable, keyboard-operable firm table/detail; users can target a firm, inspect confidence/source references, and add only explicitly permitted contact values.
- `/lists` creates/edits named lists, membership, description, and empty/error states; membership updates are idempotent.
- `/introductions` shows people and introduction context, with a clear “request/draft” path that never sends automatically.
- Preserve unknown/stale confidence visibly; never present inference as verified fact.

### Non-goals

No scraping, automatic enrichment, unsolicited sending, contact guessing, hidden personal-email import, or relationship-sync changes. Do not redesign seed data or merge duplicate firms in this packet.

### Ownership and interfaces

Renderer ownership: the three page modules, shared UI in `components/ui.tsx`, table patterns in `components/InvestorTable.tsx`, and navigation wiring in `App.tsx`/`components/AppShell.tsx`. Typed payload/result ownership remains `shared/contracts.ts`; persistence/authorization remains the existing main command service and vault/database layer. Use existing `SourceRef`, visibility, and `contributionEligible` fields rather than parallel types.

### Data, privacy, edge cases, accessibility

Add no migration unless current persistence cannot represent list membership; if needed, version it in the existing database migration owner and provide backup/restore compatibility. Handle duplicate names, missing website, stale source, zero lists, long names, failed commands, and concurrent refresh. Never reveal private contacts in list exports or agent context without grant. Tables require semantic headers, row focus, visible target state, labels/errors, and narrow-screen card/overflow behavior.

### Acceptance and evidence

- Unit/contract tests prove targeting and list membership payloads, idempotence, and privacy visibility rules.
- Electron/renderer tests prove route rendering, loading/error/empty states, and keyboard operation.
- Browser/E2E smoke (synthetic bootstrap) navigates investor → list → introduction and confirms URL/deep-link refresh behavior.
- Evidence must name commands and fixture IDs, not real records. Gates: reviewer confirms no send/mutation path was added; accessibility and mobile checks pass.

### Worktree/dependencies/order

Packet branch/worktree: `fork-investors-lists-intros`. Depends on routing packet's route contract and existing bootstrap shape. Can run in parallel with pipeline, knowledge, and email packets; it must merge before final navigation snapshot and full E2E. Shared bottleneck: `App.tsx`, `AppShell.tsx`, `contracts.ts`; one owner resolves conflicts.

## 2. Pipeline and round

### Current assets

Dormant `RoundOverviewPage.tsx` and `PipelinePage.tsx` (**not verified**). Contracts in `shared/contracts.ts` define `RoundState`, `PipelineColumn`, `PipelineStage`, `pipeline.move`, `pipeline.amount`, and `round.update`; bootstrap carries `round` and `pipeline`.

### Proposed behavior/non-goals

`/round` summarizes stage, target, check range, sectors, geography, narrative, and status. `/pipeline` supports accessible columns/cards, explicit move confirmation, amount editing, and audit-visible transitions. Non-goals: auto-moving on email, changing exhaustive sync/audit, or inventing stages outside the typed contract.

### Ownership/interfaces/data

Pages own presentation; command service owns validation and persistence; `RoundState`, `PipelineColumn`, and command maps are the sole interface. Preserve stage history and null amounts. If a migration is required, add a versioned migration plus backup/restore test; otherwise do not change schema.

### Safety/edge/accessibility

Reject invalid stage transitions and stale writes; show network/provider failure without losing edits. Keyboard drag alternative must exist; cards need semantic headings, focus order, responsive horizontal scroll or list alternative, and color-independent status.

### Acceptance/evidence/order

Unit tests cover valid/invalid transitions, null check, stale update, and round validation. Electron tests cover rendering and command error. Browser E2E exercises move and reload with synthetic state. Branch/worktree: `fork-round-pipeline`; depends on routing; parallel with most packets; merge before navigation/E2E gate.

## 3. Up Next, tasks, meetings, and calendar

### Current assets

Dormant `TasksPage.tsx`, `UpNextPage.tsx`, and `MeetingsPage.tsx` (**not verified**). Contracts define `WorkItem`, `TaskItem`, `MeetingItem`, `task.*`, `meeting.*`; connector command `connector.syncCalendar` exists.

### Proposed behavior/non-goals

`/up-next` presents deterministic prioritized work; `/tasks` filters and edits status/title/due date; `/meetings` lists agenda/notes and calendar-sync status. Calendar sync is read/import only unless an explicit future contract says otherwise. Non-goals: background auto-scheduling, deletion without confirmation, or changing provider sync semantics.

### Ownership/interfaces/data/privacy

Use existing typed commands and bootstrap arrays. Main connector service owns provider access and timezone normalization; renderer owns optimistic state only when rollback is guaranteed. Do not expose attendee private data beyond existing grants. Handle timezone/DST, overdue/null due dates, duplicate sync items, deleted remote events, and clock skew.

### Acceptance/evidence/order

Test priority ordering and timezone boundaries; Electron tests cover edit/rollback; browser E2E uses provider mock and synthetic calendar. Accessibility: headings, status announcements, date input labels, keyboard controls, mobile stacked cards. Branch/worktree: `fork-up-next-calendar`; depends on routing and shared task contract; parallel with investor/knowledge/email; merge before final E2E.

## 4. Knowledge and documents

### Current assets

Dormant `KnowledgePage.tsx` and `DocumentsPage.tsx` (**not verified**). Contracts define `KnowledgeItem`, `knowledge.save`, and bootstrap `knowledge`; `revealPath` is exposed by the bridge. Existing data/privacy documentation is in `docs/data-contributions.md`, `docs/privacy-and-threat-model.md`, and `docs/credentials.md`.

### Proposed behavior/non-goals

`/knowledge` creates/edits searchable notes with source/confidence metadata; `/documents` indexes user-selected local documents and reveals a path only on explicit request. Non-goals: cloud upload, OCR/web crawling, silent file reads, or agent access without context grants.

### Ownership/interfaces/data/privacy

Renderer uses `knowledge.save`; main owns path validation, file selection, vault and sanitization. Do not introduce a second document store. Define supported file types/size limits before implementation; migration must preserve backup/export and avoid copying content into logs. Handle missing/moved files, malformed text, duplicate IDs, path traversal, and permission failures.

### Acceptance/evidence/order

Unit tests cover sanitization, path confinement, and save idempotence; Electron tests cover select/reveal rejection; browser smoke uses temporary synthetic files. Accessibility includes labels, previews, focus trap, truncation, and responsive layout. Branch/worktree: `fork-knowledge-documents`; depends on agent context/privacy review if exposing notes; parallel otherwise.

## 5. Outreach and review

### Current assets

Dormant `OutreachPage.tsx` and `ReviewPage.tsx` (**not verified**). Contracts define `DraftMessage`, `SourceReviewItem`, `draft.*`, `source.review`, `mail.review`, communication policy, suppressions, and audit integrity.

### Proposed behavior/non-goals

`/outreach` lists drafts and review state; `/review` presents source/draft review with explicit accept/reject/edit/approve. Sending is a separate, visibly dangerous action requiring expected content hash and policy checks. Non-goals: automatic send, bypassing suppression, bulk approval, or weakening audit.

### Ownership/interfaces/data/privacy

Main command service owns draft hash, policy, suppression, and audit invariants; renderer must display policy status and stale-content errors. Reuse sanitizer and existing draft contracts. Never log body content or recipients unnecessarily. Handle changed draft between review/send, blocked recipient, paused sending, provider disconnect, and duplicate click.

### Acceptance/evidence/order

Unit tests prove hash mismatch rejection, suppression/pause/limits, idempotent review, and no send from list/read actions. Electron test proves explicit confirmation; browser E2E proves draft lifecycle with provider mock and synthetic recipients. Accessibility includes confirmation semantics, focus, error announcement, contrast, and mobile review. Branch/worktree: `fork-outreach-review`; depends on privacy/security gate and investor/pipeline IDs; merge only after security reviewer evidence.

## 6. Agent workflow

### Current assets

Dormant `AgentPage.tsx` (**not verified**). Contracts define agent status, context grants, proposals, events, `agent.detect/login/logout/run/cancel`, and proposal review. Main files include `agent-controller.ts` and `agent-service.ts`; renderer bridge is typed in `shared/contracts.ts`.

### Proposed behavior/non-goals

`/agent` displays provider status, grants, run progress/cancel, and proposal review. Agents propose; humans explicitly apply/reject/convert. Non-goals: hidden context, automatic mutations, credential display, or sending.

### Ownership/interfaces/data/privacy

Agent main services enforce grant filtering, provider auth, cancellation, and proposal validation; renderer only renders disclosed metadata. Treat prompt/output as sensitive, redact logs, and require explicit subscription/credential confirmation. Handle cancellation races, provider failure, stale proposal, revoked grant, and malformed output.

### Acceptance/evidence/order

Unit tests cover grant intersection, cancellation, proposal validation, and redaction; Electron tests cover status/error; browser smoke uses fake agent provider only. Accessibility covers live progress and keyboard review. Branch/worktree: `fork-agent-workflow`; depends on knowledge/outreach contracts and security review; merge late, before final E2E.

## 7. Routing/navigation integration

### Current assets

`src/renderer/src/lib/router.tsx` is a local hash router with `Route`, `Routes`, `Navigate`, `NavLink`, and search params. `App.tsx` currently has only three functional route families. `components/AppShell.tsx` and `CommandPalette.tsx` are shared navigation surfaces (implementation must be exercised; presence is not proof).

### Proposed behavior/non-goals

Add stable routes and deep-link-safe navigation for all roadmap sections, active navigation state, command palette results, back/forward, and query/filter preservation. Unknown routes remain safe redirects. Non-goals: replacing the router, changing hash security, or introducing remote navigation.

### Ownership/interfaces

One routing owner edits `App.tsx`, AppShell, and router tests. Each feature supplies route path, element, and link metadata; no feature directly rewrites global route logic. Search result hrefs must use typed result kinds from `CommandResultMap`.

### Acceptance/evidence/order

Renderer tests cover every route, active links, unknown fallback, query decoding, and refresh; browser E2E deep-links each route and uses back/forward. Keyboard and screen-reader nav plus narrow viewport evidence required. Branch/worktree: `fork-routing-navigation`; first implementation packet, merge before feature finalization and owns shared-file conflict resolution.

## 8. Job-relevant email filtering

### Current assets

`InboxPage.tsx` is implemented surface but its full behavior is not assumed complete; mail types and bridge listing/get methods are in `shared/contracts.ts`. `mail-read-service.ts`, `connector-service.ts`, `navigation-security.ts`, and mail tests under `apps/desktop/test/` are the relevant main/security owners. Existing inbox E2E is `apps/desktop/e2e/job-application-inbox.e2e.spec.ts`.

### Proposed behavior/non-goals

Inbox defaults to **Job relevant**, with an explicit **All mail** escape hatch. Filtering applies only to display/read listing and thread read requests; it must not delete, mutate, send, alter exhaustive relationship sync, or alter audit. Search composes safely with the selected mode: typed provider query plus local/validated relevance predicate, with provider-specific escaping owned by mail-read service. Show mode, rationale/empty state, and a way to return to All mail.

### Ownership/interfaces/data

Extend `ListMailThreadsRequest`/result only if required, preserving backward-compatible explicit mode semantics; define relevance inputs without embedding provider-specific assumptions in renderer. `mail-read-service.ts` owns query composition and paging; connector service owns provider calls; InboxPage owns controls/rendering; preload validates payloads. No credential or body content in logs.

### Edge/accessibility/evidence

Handle missing subject/snippet, unknown sender, pagination, provider query limits, contradictory labels, no relevant mail, and search characters. Mode is keyboard-selectable, announced, visible on mobile, and retained in URL only if privacy review approves. Unit tests must prove default, All mail, composed search, paging, and no mutation calls; Electron tests prove mode state/error; browser E2E uses `google-provider-mock.ts` with synthetic mail. Branch/worktree: `fork-gmail-relevant-inbox`; depends on routing only, but merge requires security/privacy review and regression of relationship-sync/audit tests.

## 9. Typed parallel work-packet DAG and gates

Packet type is one of: `renderer`, `main-contract`, `security-review`, `e2e-review`. Useful concurrency is capped at five implementation packets:

```text
P0 routing-navigation (renderer) ─┬─> P1 investors/lists/introductions (renderer)
                                 ├─> P2 round/pipeline (renderer)
                                 ├─> P3 up-next/calendar (renderer)
                                 ├─> P4 knowledge/documents (renderer)
                                 └─> P5 gmail-relevant-inbox (main-contract + renderer)
P1 + P2 ─> P6 outreach/review (renderer + security-review)
P4 + P6 ─> P7 agent-workflow (renderer + security-review)
P0..P7 ─> P8 integration/e2e-review (e2e-review)
```

P1–P5 may run concurrently after P0's route contract is written; P6 waits for stable entity IDs and privacy review; P7 waits for context and draft contracts. Shared bottlenecks are `App.tsx`, `AppShell.tsx`, `shared/contracts.ts`, and main command/connector services. Assign one integration owner for each file; parallel workers submit narrow patches and do not reformat. Each packet must return changed paths, tests/evidence, invariants checked, and known gaps.

Review gates: (G1) source-fact audit before implementation; (G2) typed contract review; (G3) privacy/security review for mail, documents, agents, and sending; (G4) focused unit/Electron evidence; (G5) browser accessibility/responsive evidence; (G6) final diff checks that no source outside assignment changed and no dormant page is called verified without evidence. Risks: route conflicts, contract drift, provider query semantics, stale hashes, accidental send, private-data leakage, migration incompatibility, and flaky provider mocks. Mitigate with typed seams, synthetic fixtures, deterministic clocks, explicit command assertions, and serialized shared-file integration.

## 10. Open decisions (must be resolved, recorded, and tested)

- Exact relevance classifier: provider labels, sender/domain/job-role heuristics, or a versioned combination; define false-positive/negative policy.
- Whether inbox mode belongs in URL/search params or local UI state (privacy and deep-link trade-off).
- Whether documents are metadata-only initially and which file types/limits are allowed.
- Whether calendar remains read-only for this fork and how remote event identity is persisted.
- Which dormant page contracts are authoritative if implementation and contract fields diverge.
- Migration/version strategy if current persistence cannot represent any proposed field.

## 11. Copy-paste next-session kickoff

```text
Work in /Users/ian/worktrees/outreachr-expansion-roadmap (or create the named packet worktree). Read docs/roadmap/index.md and docs/roadmap/next-session.md first. Treat “Current fact” and “Proposed” labels literally; dormant pages are not verified. Start P0 routing-navigation and write its typed route contract, then fan out P1–P5 at most five concurrent packets. Do not touch credentials/private email; use synthetic fixtures/provider mocks. Preserve read-only job-relevant Gmail default + explicit All mail, and never change exhaustive relationship sync/audit. Each packet must update only its owned source/tests, skip broad suites until integration, run focused evidence, report exact paths/commands/results, and request security review for mail/documents/agents/sending. Resolve shared-file ownership before edits. Merge in DAG order, run final Electron/browser accessibility/responsive evidence, and record every open decision and unverified claim.
```
