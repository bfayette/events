# Signed Receipt & Offline Verification Specification

This document details the signed receipt format, claim requirements, short TTL constraints, offline validation, and reconciliation protocol used by the platform.

---

## 1. Overview & Objectives

In offline or intermittent connectivity environments (such as event gates, turnstiles, or underground venues), real-time database queries are not always guaranteed. To allow secure, fraud-resistant offline entry, the backend issues short-lived **Signed Receipts**.

Key requirements:
- **Tamper-proof:** Signed by a KMS-backed operator key.
- **Short-lived:** Tight TTL (e.g., 30s – 120s) to minimize window for reuse.
- **Minimal payload:** Compact format suitable for fast QR code rendering and optical scanning.
- **Auditable:** Offline scans produce receipt logs that are later reconciled atomically against the central database.

---

## 2. Receipt Payload Schemas

Signed receipts use JSON Web Signature (JWS / Compact JWT) format.

### Minimal Required Claims

Every signed receipt payload MUST contain the following 6 core claims:

| Claim Name | Type | Description |
|---|---|---|
| `ticket_id` | `string` | Unique identifier of the ticket (e.g. `tkt_001`) |
| `issued_at` | `integer` | Unix timestamp (seconds) when receipt was issued |
| `expires_at` | `integer` | Unix timestamp (seconds) when receipt expires (e.g., `issued_at + 60`) |
| `nonce` | `string` | Cryptographically random unique string (UUID v4 / hex) preventing replay |
| `issuer` | `string` | Identifier or URI of the issuing platform / operator (e.g. `urn:events:operator:main`) |
| `schema_version` | `string` | Version of receipt schema (e.g. `1.0`) |

---

## 3. Format Details

### JWS Compact Payload Format

A JWS receipt uses the compact dot-separated format (`header.payload.signature`):

**Header:**
```json
{
  "alg": "ES256",
  "typ": "JWT",
  "kid": "op-key-2025-v1"
}
```

**Payload:**
```json
{
  "ticket_id": "tkt_001",
  "issued_at": 1740000000,
  "expires_at": 1740000060,
  "nonce": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "issuer": "urn:events:operator:main",
  "schema_version": "1.0"
}
```

---

## 4. Verifier Validation Flow

When a verifier scans a receipt payload JWS string:

1. **Schema & Claim Extraction:** Parse header and extract claims (`ticket_id`, `issued_at`, `expires_at`, `nonce`, `issuer`, `schema_version`). Confirm all required claims are present.
2. **Key Check:** Match `kid` against active (non-revoked) operator keys. If key is revoked, REJECT immediately.
3. **Expiration Check:** Verify `currentTime <= expires_at` and `currentTime >= issued_at - maxClockSkew` (max skew 15s). If expired or from the future, REJECT.
4. **Nonce Replay Check:** Query verifier's local single-use nonce cache. If `nonce` was previously scanned, REJECT (replay attempt).
5. **Signature Verification:** Recompute digest using public operator key and verify cryptographic signature.
6. **Local Cache Record:** Record `nonce` in local replay cache with TTL equal to `expires_at`. Queue the scanned receipt record locally for online reconciliation.

---

## 5. Offline Reconciliation Protocol

When an offline verifier regains internet connectivity:

1. **Batch Submission:** Verifier posts queued scan receipts to `POST /api/passes/reconcile`.
2. **Server-Side Audit & State Sync:**
   - For each receipt:
     - Re-validate operator signature, TTL, and key revocation status.
     - Check database for previous ticket status.
     - If ticket is currently `ISSUED` or `ACTIVE`, transition ticket status atomically to `CHECKED_IN`.
     - Append entry to `audit_log` (`action: 'CHECKIN_OFFLINE'`, `actor: verifier_id`, `payload_hash: sha256(receipt)`).
     - If ticket was already `CHECKED_IN` by another scan prior to reconciliation, record a `CHECKIN_CONFLICT` event and mark scan status as duplicate in response.
3. **Reconciliation Response:** Server returns status for each submitted receipt ID/nonce (success, duplicate conflict, invalid signature, expired).
