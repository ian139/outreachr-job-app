# Security policy

Outreachr is a local-first job-application communication workspace. Please do not disclose a vulnerability in a public issue when it could expose credentials, private application data, or allow outbound communication without approval.

Until a private security address is configured, use GitHub private vulnerability reporting on the canonical repository. Include the affected version, operating system, reproduction steps, and whether any external message or credential may have been affected.

## Security invariants

- OAuth refresh/access tokens are encrypted with Electron `safeStorage`; the application fails closed when secure encryption is unavailable.
- The SQLite vault contains no plaintext provider or agent secrets.
- No external message is sent without an immutable user approval bound to recipient, sender, subject, body, attachments, and thread context.
- A canonical-person ledger blocks a second unsolicited initial message.
- Agent operations are read-only by default and may only propose external actions.
- Imported seed and contribution databases are treated as untrusted input and validated before attachment or copy.

Supported security fixes target the latest stable release. The project does not promise support for unreleased forks or modified distributions.
