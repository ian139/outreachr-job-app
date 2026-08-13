# Privacy and threat model

## Protected assets

- provider access/refresh tokens and optional agent credentials;
- user identity and sender postal/footer policy, job search strategy, notes, tasks, activity, drafts, approvals, send receipts, meetings, attendees, and relationship evidence;
- local documents and data-room references;
- public research provenance and contribution rights metadata.

## Primary threats and controls

| Threat                              | Control                                                                                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compromised renderer                | sandbox, context isolation, no Node integration, typed IPC allowlist, CSP, denied navigation/windows/permissions                                                                                                                                   |
| Plaintext token theft               | OS-backed encryption; fail closed on Linux `basic_text`; no renderer token exposure                                                                                                                                                                |
| OAuth interception                  | system browser, loopback-only callback, state validation, PKCE, timeout                                                                                                                                                                            |
| Accidental duplicate/spam send      | exact approval hash, visible configured sender/opt-out footer, canonical person/address unique ledger, user pause, daily/hourly/domain pacing triggers, suppression, synced-outbound detection, one lifetime provider send, no unattended sequence |
| Over-broad mailbox collection       | read scope optional for research-only use and required for send, header-only known-relationship and unmatched-outbound storage, no bodies/attachments, unrelated-inbound discard, provider-message deduplication                                   |
| Uncertain provider response         | terminal non-retryable ambiguous state; only exact operation-key, identity, and time validation against authoritative provider sent mail can confirm the original reservation; no second provider request                                          |
| Malicious seed/contribution         | schema/version/digest checks, isolated import, foreign keys, rights metadata, no private-table merge                                                                                                                                               |
| Agent overreach or prompt injection | selected context, record allowlists, no raw DB/files/shell, proposal-only MCP, deny-all provider tools, audited output schemas, and a minimal allowlist for secrets inherited by child agent processes                                             |
| Backup disclosure                   | scrypt-derived key, authenticated encryption, no password recovery, integrity checks before restore                                                                                                                                                |
| Contribution privacy leak           | new allowlisted database, deterministic diff, explicit exclusion of private tables and personal addresses                                                                                                                                          |
| Supply-chain substitution           | frozen lockfile, minimum release age, allowlisted install scripts, pinned GitHub Actions, SBOM, checksums, provenance and attestations                                                                                                             |
| Local audit mutation                | append-only SQL triggers plus a SHA-256 chain verified at startup/UI/export time                                                                                                                                                                   |

## Non-goals

Outreachr does not protect an unlocked device from an administrator or malware with equivalent user privileges. It does not make public-source facts redistributable when the source license forbids redistribution. It does not guarantee email delivery, interview responses, or completeness of public research.

## Logging

Production logs must not contain tokens, message bodies, mailbox subjects, calendar descriptions, document contents, or private agent context. Provider and agent errors are reduced to bounded diagnostics. Tests use synthetic credentials and MSW; CI never needs a real mailbox.
