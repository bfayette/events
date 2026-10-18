# Architecture

This document explains the db-first ticketing & loyalty architecture, trust boundaries, and the delegated operator transaction model used in this project.

Goals
- Make the system safe for ticketing/loyalty use-cases where passes carry little/no monetary value.
- Keep the backend as the primary source of truth (DB-first) for issuance, redemption, and revocation.
- Support offline redemption for validators while minimizing replay/fraud risk.
- Provide optional low-cost on-chain anchoring for auditability (not for real-time control).

High-level components

1) API (Express)
- Exposes endpoints to issue passes, request pass payloads (Apple `.pkpass` and Google Wallet links), validate scans, and manage events.
- Does not store raw user private keys or seed phrases.

2) Database (Primary source of truth)
- Relational DB (Postgres recommended) with an append-only `events` table for all issuance/redemption/revocation actions.
- `tickets` table stores ticket metadata and current state. Keep `events` as the canonical audit log.

3) Pass Generation
- Apple `.pkpass` generator: builds pass.json, manifest, signs with Apple certificate (p12) kept in KMS/HSM or secure storage; never commit certs.
- Google Wallet: creates signed JWTs via a service account; keep credentials in KMS with minimal scopes.

4) Gate Validator / Verifier
- Primary mode: online verification
  - Scanner reads QR or pass payload and calls `/api/passes/verify` to confirm single-use and mark CHECKED_IN atomically.
- Offline mode (turnstiles, intermittent connectivity)
  - Use short-lived signed receipts (JWS or EIP-712) that encode ticket_id, nonce, issued_at, expires_at, and a signature by operator key.
  - Keep offline tokens TTL very short (e.g., 30–120s) and single-use. Prefer short-distance validators that sync frequently.

5) Operator Transaction Layer (optional)
- Operator-managed transaction/execution model: server-side operator may submit on-chain UserOperations or direct transactions under scoped delegation.
- Enforce allowlists, per-operation limits, and strict paymaster policies where applicable.
- Operator signing keys must live in KMS/HSM and be rotated; give each service/environment its own keys.

6) Anchoring Worker (optional)
- Periodic job that batches recent `events` (or their hashes), computes a Merkle root, and anchors that root to a low-cost chain (Gnosis Chain / Polygon PoS) in a single tx.
- Store the anchor tx hash and block for each batch in DB for auditability.

Data model suggestions

tickets
- id (uuid)
- event_id
- pass_type
- owner_id (nullable if anonymous)
- status ENUM (ISSUED, ACTIVE, CHECKED_IN, REDEEMED, REVOKED)
- metadata JSON
- created_at, updated_at

events (append-only audit log)
- id (uuid)
- ticket_id
- action ENUM (ISSUE, UPDATE, CHECKIN, REDEEM, REVOKE)
- actor (user_id / operator / system)
- payload_hash (sha256 of payload)
- created_at

Signed receipt format (overview)
- Minimal claims: { ticket_id, issued_at, expires_at, nonce, issuer, schema_version }
- Sign using ES256K (secp256k1) JWS or EIP-712 typed data depending on verifier capabilities
- Include signature and algorithm metadata in QR or pass payload

Offline & replay protection
- Nonce + short TTL on token
- Single-use counters stored in DB where possible; for strictly offline validators, accept small risk but limit TTL to mitigate replay
- Prefer hybrid: offline scanning allows preliminary acceptance but requires online reconciliation within short window (e.g., 1–5 minutes)

Anchoring strategy
- Choose anchoring cadence based on audit needs and cost tradeoffs (hourly/daily)
- Anchor a Merkle root of event hashes; store mapping between root and event range in DB
- Keep on-chain anchors immutable evidence—not for operational revocation

Delegation & operator policy
- All operator actions must carry an auditable request record linking the user identity, consent (if any), action, timestamp, and operator principal
- Implement scoping tokens: operator can only act on allowed targets and within per-op limits
- Require multi-party approval for any operation that would change a ticket's economic value beyond configured thresholds

Monitoring & alerts
- Track unusual patterns: spikes in check-ins, repeated offline validations from same token, anchor failures, KMS access anomalies
- Alert on paymaster spend anomalies and unexpected on-chain transactions

Security notes
- Never commit or store p12, service account JSON, or raw mnemonic in repo or plain DB
- Use KMS/HSM for all signing operations where possible
- Maintain a key rotation policy and emergency key revocation process

Appendix
- See docs/SIGNED_RECEIPT.md for examples of signed receipts (JWS & EIP-712) and verification examples.
