# Architecture

This document explains the db-first ticketing & loyalty architecture, trust boundaries, and system components.

Goals
- Make the system safe for ticketing/loyalty use-cases.
- Keep the backend as the primary source of truth (DB-first) for issuance, redemption, and revocation.
- Support offline redemption for validators while minimizing replay/fraud risk.

High-level components

1) API (Express)
- Exposes endpoints to issue passes, request pass payloads (Apple `.pkpass` and Google Wallet links), validate scans, and manage events.

2) Database (Primary source of truth)
- Relational DB (Postgres) with an append-only `audit_log` table for all issuance/redemption/revocation actions.
- `tickets` table stores ticket metadata and current state.

3) Pass Generation
- Apple `.pkpass` generator: builds pass.json, manifest, signs with Apple certificate (p12) kept in KMS/HSM or secure storage; never commit certs.
- Google Wallet: creates signed JWTs via a service account; keep credentials in KMS with minimal scopes.

4) Gate Validator / Verifier
- Primary mode: online verification
  - Scanner reads QR or pass payload and calls `/api/passes/verify` to confirm single-use and mark CHECKED_IN atomically.
- Offline mode (turnstiles, intermittent connectivity)
  - Use short-lived signed receipts (JWS) that encode ticket_id, nonce, issued_at, expires_at, and a signature by operator key.
  - Keep offline tokens TTL very short (e.g., 30–120s) and single-use. Prefer short-distance validators that sync frequently.

Multi-Carrier Architecture (Tickets for People Without Smartphones)

Separate **what was bought** (the ticket) from **how the holder proves ownership** (the carrier):

| Carrier | Proof Type | Scan Method Enum |
|---|---|---|
| Wallet Pass / Smartphone | Rotating TOTP | `TOTP` |
| Printed Slip | Signed JWS QR Code (Static) | `STATIC_QR` |
| Printed Slip or SMS | Typed 8-Char Short Code | `SHORT_CODE` |
| No Device / Paper Lost | Gate Staff Name/Phone Lookup | `LOOKUP` |

Role-Based Access Control (RBAC) Architecture
- `sales`: Issue tickets, print / reissue-at-issue. No scan or lookup access.
- `verifier`: Scan gate codes (`TOTP`, `STATIC_QR`, `SHORT_CODE`, `LOOKUP`), lookup, confirm entry. Event-scoped.
- `agent`: Everything `sales` does plus reissue with `phone_lookup` or `id_check`.
- `admin`: Full system access, `admin_override` reissue, and revocation.

Data model (Postgres & In-Memory Store)

tickets
- id (varchar 64)
- event_id (varchar 64)
- owner_email (varchar 255, nullable)
- secret (varchar 128, nullable for static tickets)
- status ENUM (ISSUED, ACTIVE, CHECKED_IN, REDEEMED, REVOKED)
- code_mode ENUM (TOTP, STATIC)
- version INT (default 1)
- max_entries INT (default 1)
- entries_used INT (default 0)
- holder_name VARCHAR(128, nullable)
- holder_phone VARCHAR(20, nullable, E.164)
- holder_binding JSONB (default `{"type":"none"}`)
- short_code_hash VARCHAR(64, nullable, HMAC-SHA256)
- reissue_count INT (default 0)
- metadata JSONB
- created_at, updated_at

events (append-only audit log)
- id (varchar 64)
- ticket_id (varchar 64)
- action ENUM (ISSUE, ISSUE_STATIC, UPDATE, CHECKIN, CHECKIN_DENIED, CHECKIN_OFFLINE, CHECKIN_CONFLICT, LOOKUP, REISSUE, REDEEM, REVOKE)
- actor (keyLabel)
- payload_hash (sha256)
- status_transition (varchar 64)
- method ENUM (TOTP, STATIC_QR, SHORT_CODE, LOOKUP)
- result VARCHAR(32)
- meta JSONB
- created_at

Signed receipt format (overview)
- Minimal claims: { ticket_id, issued_at, expires_at, nonce, issuer, schema_version }
- Sign using ES256 JWS
- Include signature and algorithm metadata in QR or pass payload

Offline & replay protection
- Nonce + short TTL on token
- Single-use counters stored in DB where possible; for strictly offline validators, accept small risk but limit TTL to mitigate replay
- Prefer hybrid: offline scanning allows preliminary acceptance but requires online reconciliation within short window (e.g., 1–5 minutes)

Monitoring & alerts
- Track unusual patterns: spikes in check-ins, repeated offline validations from same token, KMS access anomalies
- Alert on unexpected access patterns

Security notes
- Never commit or store p12, service account JSON, or raw keys in repo or plain DB
- Maintain a key rotation policy and emergency key revocation process

Appendix
- See docs/SIGNED_RECEIPT.md for details of signed receipts (JWS) and verification examples.
