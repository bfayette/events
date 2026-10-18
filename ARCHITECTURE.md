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

Data model suggestions

tickets
- id (uuid)
- event_id
- pass_type
- owner_email
- status ENUM (ISSUED, CHECKED_IN, TRANSFERRED, REVOKED)
- metadata JSON
- created_at, updated_at

audit_log (append-only audit log)
- id (uuid)
- ticket_id
- action ENUM (ISSUE, UPDATE, CHECKIN, REDEEM, REVOKE)
- actor (user_email / operator / system)
- payload_hash (sha256 of payload)
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
