# Architecture

This document explains the ticketing & loyalty architecture and trust boundaries used in this project.

Goals
- Make the system safe and lightweight for ticketing/loyalty use-cases.
- Keep the backend as the primary source of truth for issuance, redemption, and revocation.
- Support offline redemption for validators while minimizing replay/fraud risk.

High-level components

1) API (Express)
- Exposes endpoints to issue passes, request pass payloads (Apple `.pkpass` and Google Wallet links), validate scans, and manage events.

2) Database / State
- Relational DB / state store with audit event records for issuance, redemption, and revocation actions.
- `tickets` store ticket metadata and current state.

3) Pass Generation
- Apple `.pkpass` generator: builds pass.json, manifest, signs with Apple certificate (p12) kept in KMS/HSM or secure storage; never commit certs.
- Google Wallet: creates signed JWTs via a service account; keep credentials in KMS with minimal scopes.

4) Gate Validator / Verifier
- Primary mode: online verification
  - Scanner reads QR or pass payload and calls `/api/passes/verify` to confirm single-use and mark CHECKED_IN atomically.
- Offline mode (turnstiles, intermittent connectivity)
  - Use short-lived signed receipts (JWS) that encode ticket_id, nonce, issued_at, expires_at, and a signature by operator key.
  - Keep offline tokens TTL very short (e.g., 30–120s) and single-use. Prefer short-distance validators that sync frequently.

Offline & replay protection
- Nonce + short TTL on token
- Single-use counters stored in DB where possible; for strictly offline validators, accept small risk but limit TTL to mitigate replay
- Prefer hybrid: offline scanning allows preliminary acceptance but requires online reconciliation within short window (e.g., 1–5 minutes)

Security notes
- Never commit or store p12, service account JSON, or raw keys in repo or plain DB
- Use KMS/HSM for all signing operations where possible
- Maintain a key rotation policy and emergency key revocation process

Appendix
- See docs/SIGNED_RECEIPT.md for examples of signed receipts and verification examples.
