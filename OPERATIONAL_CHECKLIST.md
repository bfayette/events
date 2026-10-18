# Operational Security & System Checklist

This document provides operational guidance for managing operator signing keys, KMS/HSM usage, rotation, access control, monitoring, and incident response for the DB-first ticketing and loyalty platform.

---

## 1. KMS / HSM Key Management & Storage

- **No Raw Key Storage:** Raw private keys, `.p12` files, or service account secrets MUST NEVER be checked into the repository or stored in plaintext database fields or logs.
- **Hardware Security Modules (HSMs) & Cloud KMS:**
  - Operator signing keys used for generating short-lived signed receipts or PassKit archives MUST be hosted in a managed Cloud KMS (AWS KMS, GCP KMS, Azure Key Vault) or dedicated HSM.
  - Signing operations MUST be performed inside the KMS envelope via RPC / API calls (e.g. Asymmetric Sign).

---

## 2. Key Rotation & Revocation Protocols

- **Scheduled Key Rotation:**
  - Active operator signing keys MUST be rotated periodically (recommended every 30 to 90 days).
  - Support multi-key verification windows so offline verifiers can accept receipts signed by either the active key or the immediately preceding rotated key during the grace period.
- **Emergency Revocation Procedure:**
  - Maintain a dynamic **Key Revocation List (KRL)** stored in the DB cache / Redis and distributed to offline verifiers during sync.
  - In the event of suspected operator key compromise:
    1. Immediately publish the compromised `key_id` (`kid`) to the backend revocation registry.
    2. Revoke the key in AWS KMS / GCP KMS to prevent further signature generation.
    3. Push the revocation delta to all online and edge verifiers.
    4. Issue new operator signing keys and trigger re-authorization for active verifiers.

---

## 3. Allowlists & Per-Operation Limits

- **Operator Scoping:**
  - Backend operator accounts operate under strict, scoped authority bound to specific events, venues, and time windows.
- **Per-Operation Constraints:**
  - Rate limiting on ticket pass generation and gate verification endpoints.
  - Value thresholds for loyalty point adjustments or ticket status overrides requiring multi-party operator confirmation or step-up authentication.

---

## 4. Anti-Replay Protection

- **Dynamic TOTP Gates:** Short-lived rotating TOTP codes (30-second window) with single-use replay caches to prevent reused scans.
- **Signed Receipt Nonces:**
  - Every offline/online signed receipt MUST contain a unique cryptographic `nonce` (UUID v4 / CSPRNG bytes).
  - Verifiers maintain a local bloom filter or single-use nonce cache covering the token's lifetime (`expires_at`).
- **Short TTL Enforceability:** Signed receipts carry a tight Time-To-Live (e.g., 30s to 120s) to limit the exposure window of offline tokens.

---

## 5. Monitoring & Alerting

- **Anomaly Detection:**
  - **Duplicate Scan Spikes:** Alert if multiple duplicate/replay HTTP 409 responses occur within a short window at a single verifier terminal.
  - **Clock Skew Alerts:** Monitor NTP time synchronization across all edge validator devices. Reject receipts with timestamps drifting beyond ±15 seconds.
  - **KMS Anomaly Alerts:** Alert on unexpected spikes in KMS signing requests or unauthorized API calls attempting to use revoked keys.

---

## 6. Incident Handling & Response

1. **Detection & Isolation:**
   - On suspicion of breach or key leak, isolate affected endpoints immediately via API Gateway rate limits or circuit breakers.
2. **Key Invalidation:**
   - Revoke the compromised operator `key_id` via backend configuration and KMS policy disablement.
3. **Audit Trail Review:**
   - Inspect the append-only `audit_log` database log to determine the exact timestamp, actor, and scope of unauthorized actions.
4. **Reconciliation & Recovery:**
   - Invalidate compromised passes, reissue clean signed receipts with fresh keys to legitimate ticket holders, and resync edge verifiers.
