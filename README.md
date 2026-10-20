# Headless Ticketing & Loyalty Platform

A headless ticketing and loyalty platform built with Node.js and Express. It issues Apple Wallet `.pkpass` files and Google Wallet passes for event tickets and loyalty cards, and validates entry scans. This README focuses on typical operator usage and the recent addition of non‑smartphone ticket carriers (printed slips, short codes, and staff lookup).

---

## Typical usage (operator view)

- Issue tickets for an event (sales or agent role). The service returns the carrier material once: a wallet pass URL for device-native passes, or printed material / short code for non‑smartphone carriers.
- At the gate, verifiers validate presented proof using `POST /api/passes/verify` (TOTP wallet pass, scanned signed QR for printed slips, typed short code, or staff lookup token).
- When a ticket is lost, authorized agents can reissue a ticket using recovery workflows; reissue increments the ticket version and invalidates prior proof.
- Offline gate devices can download a manifest of static tickets (`GET /api/events/:id/manifest`) to verify signed printed slips while offline; later reconcile uploads resolve any conflicts.
- Audit history and reconcile tools provide a privacy-safe forensic trail for disputes and accounting (audit payloads never contain plaintext short codes or full phone numbers).

---

## Non‑smartphone ticket carriers (what changed)

This service now supports carriers that do not require a smartphone. Each carrier represents a different proof method and has different operational and security characteristics:

- STATIC (printed signed QR)
  - What: A short, signed JWS encoded as a QR that is printed on paper or displayed from any device.
  - How verification works: The verifier scans the QR, validates the JWS signature and `use:'static_ticket'` claim, then checks the ticket record (version, entries remaining, status). Because the token is signed, verifiers with the operator key can validate offline.
  - Best for: buses, remote gates, and printed slips where offline verification is required.

- SHORT_CODE (8-character typed code shown as `XXXX-XXXX`)
  - What: A human-friendly short code that can be read aloud or typed on a basic phone.
  - How verification works: The service returns the plaintext short code once at issuance, but stores only an HMAC of the code. At verification, the code is normalized and HMACed to look up the ticket for the event. This requires an online lookup, and strong rate limiting is enforced to prevent guessing.
  - Best for: holders with basic phones (SMS or voice) or when printing is unavailable.
  - Important: By default short codes are online-only and are NOT included in offline manifests (to prevent brute-force exposure). If you want manifest inclusion, that is a separate product decision.

- LOOKUP (staff-assisted)
  - What: Manual staff lookup by phone or name producing a single-use lookup token the staff can use to confirm and then consume an entry.
  - How verification works: `POST /api/lookup` returns masked candidates and a `lookupToken` bound to the verifier and ticket. `POST /api/passes/verify` with `method: 'LOOKUP'` and that token completes the check-in, recording whether an ID was checked.
  - Best for: cash walk-ups and people without devices or printed slips.

Security & privacy notes for non‑smartphone carriers
- The backend never stores plaintext short codes — only HMAC-SHA256 hashes derived from an operator secret (via HKDF). Short codes are shown only once on issue and are never logged.
- Audit logs store only non‑PII metadata and hashes. Full phone numbers and short codes are never saved in raw form.
- Reissue bumps ticket `version` and invalidates prior static QR and short codes; old proofs return `DENIED_SUPERSEDED`.

---

## Architecture Overview

### 1. Application Model
- **API layer:** Express service exposes event, pass, and verification endpoints.
- **Pass issuance:** Produces Apple Wallet `.pkpass` archives and Google Wallet JWT links for event tickets and loyalty cards. Also issues static QR payloads and short codes for non‑smartphone carriers.
- **Gate validation:** Uses TOTP-based validation for wallet passes and a unified consumeEntry flow for static QR, short codes, and lookup tokens.

### 2. Ticketing & Loyalty Scope
- **Ticketing:** Event access, carrier issuance, scan validation, status transitions, reissue and offline manifest support.
- **Loyalty:** Pass issuance, personalized offers, and points or redemption flows.

---

## Key Features & Architecture

### Device-Native Wallet Passes
- **Apple Wallet (`.pkpass`):** Dynamic pass archives compliant with PassKit for event tickets and loyalty cards.
- **Google Wallet (JWT):** Signed JWT links for pass issuance and Google Wallet object generation.
- **Dynamic barcodes:** Pass barcodes contain rotating TOTP tokens for short-lived validation.

### Gate Verification & Anti-Replay Engine
- **Endpoint:** `POST /api/passes/verify`
- **Dynamic TOTP validation:** Validates ticket or pass codes against a short-lived rotating secret.
- **Replay protection & atomic transitions:** Single-use replay cache and atomic entries consumption to prevent double scans. Multi-entry tickets (group passes) are tracked with `max_entries` and `entries_used`.

---

## Configuration

The application uses validated environment configuration. In production environments, required secrets must be supplied and meet length and security constraints.

### Environment Variables (highlights)

| Variable | Required in Production? | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Application environment (`development`, `test`, `production`). |
| `AUTH_ENFORCED` | No | `true` in prod, `false` in dev/test | Enforces API key role-based access control middleware. |
| `API_KEYS` | Yes in prod (min 32 chars per key) | `{}` (dev/test) | JSON map of API keys to `{ role, eventIds, label }`. Roles: `sales`, `verifier`, `agent`, `admin`. |
| `OPERATOR_SECRET` | Yes (min 32 chars) | Random string (dev/test) | HS256 secret for active operator key receipt and static-code signing. Must not be a known insecure default. |
| `HOLDER_TOKEN_SECRET` | Yes (min 32 chars) | Random string (dev/test) | HS256 secret for Holder Token & Download Token signing. Must not equal `OPERATOR_SECRET`. |
| `HOLDER_TOKEN_TTL_DAYS` | No | `7` | Holder Token TTL in days. |
| `TRUST_PROXY` | No | `false` | Enable Express proxy headers parsing (`req.ip`). |
| `RATE_LIMIT_PASS_REQUESTS_PER_MIN` | No | `60` | Sliding window request rate limit per IP for pass/token endpoints. |
| `RATE_LIMIT_PASS_FAILS_PER_MIN` | No | `10` | Sliding window failure/unauthorized rate limit per IP for pass/token endpoints. |
| `HOLDER_DATA_RETENTION_DAYS` | No | `30` | PII retention window in days after event end date before `purgeExpiredHolderData()` nulls PII. |

See the full table in the existing README for other variables and guidance on generating secrets and key rotation.

---

## API Endpoints (operator-focused)

- `POST /api/tickets` — Issue ticket and carrier material (`sales`, `agent`, `admin`): supports `codeMode: 'TOTP'` (wallet pass) and `codeMode: 'STATIC'` (printed QR + optional short code).
- `POST /api/tickets/:id/reissue` — Reissue ticket with recovery method (`agent`, `admin`): increments version, returns new carrier material once.
- `POST /api/passes/verify` — Validate presented proof (`verifier` role). Supports `method`: `TOTP` (default), `STATIC_QR`, `SHORT_CODE`, `LOOKUP`.
- `POST /api/lookup` — Staff manual lookup to produce a masked candidate list and a one-time `lookupToken` (`verifier` role).
- `GET /api/events/:id/manifest` — Download offline manifest for static tickets (`verifier` role). Manifests exclude plaintext short codes by default.
- `POST /api/passes/reconcile` — Batch reconcile offline scan receipts and resolve conflicts.

Authentication: `Authorization: Bearer <api_key>` is used for operator keys. When `AUTH_ENFORCED=false` in dev/test environments, unauthenticated requests default to admin role for developer convenience (startup logs an enforcement warning).

---

## Getting Started

Follow the same Getting Started steps as before (clone, npm install, copy .env, run dev). See the full README for testing, architecture details, and the E2E guide.

---

## Docs & Next Steps

- See `docs/E2E_GUIDE.md` for sandbox flows and `docs/NO_DEVICE_TICKETS.md` (planned) for worked examples of printed slips, short-code SMS, staff lookup, family/group passes, and lost-ticket reissue scenarios.

