# No-Device Tickets Guide & Examples

This document describes how the platform supports event tickets for holders without smartphones or mobile wallet apps.

## Architecture & Principles

The system decouples **what was bought** (the ticket) from **how the holder proves ownership** (the carrier).

Supported Carriers & Scan Methods:
| Carrier | Proof Type | Scan Method |
|---|---|---|
| Wallet Pass / Smartphone | Rotating TOTP | `TOTP` |
| Printed Slip | Signed JWS QR Code (Static) | `STATIC_QR` |
| Printed Slip / SMS to Basic Phone | Typed 8-Char Short Code | `SHORT_CODE` |
| No Device / Paper Lost | Gate Staff Name/Phone Lookup | `LOOKUP` |

---

## 1. Printed Slip (Static Signed QR Code)

### Issuance (`POST /api/tickets`)
For cash walk-ups or paper receipts, issue a ticket with `codeMode: 'STATIC'`:

```bash
curl -X POST http://localhost:3000/api/tickets \
  -H "Authorization: Bearer <sales_key_min_32_characters_12345>" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_101",
    "codeMode": "STATIC",
    "holderName": "Jean Tremblay",
    "holderPhone": "+15145551234"
  }'
```

Response returns `qrPayload` (signed JWS, < 250 chars) and `shortCode` once:
```json
{
  "message": "Ticket issued successfully",
  "ticket": {
    "id": "tkt_1740001122_101",
    "eventId": "evt_101",
    "codeMode": "STATIC",
    "version": 1,
    "max_entries": 1,
    "holder_name": "Jean Tremblay",
    "holder_phone": "+15145551234",
    "status": "ISSUED"
  },
  "qrPayload": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Im9wLWtleS0xIn0...",
  "shortCode": "H7K9-M3P2"
}
```

### Gate Scanning (`POST /api/passes/verify`)
Gate scanner reads printed QR code:
```bash
curl -X POST http://localhost:3000/api/passes/verify \
  -H "Authorization: Bearer <verifier_key_min_32_characters_12345>" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "STATIC_QR",
    "payload": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6Im9wLWtleS0xIn0...",
    "eventId": "evt_101"
  }'
```

Response:
```json
{
  "message": "Entry check-in successful",
  "ticketId": "tkt_1740001122_101",
  "status": "CHECKED_IN",
  "entriesUsed": 1,
  "maxEntries": 1
}
```

---

## 2. SMS Short Code to Basic Feature Phone

When issuing a ticket to a feature phone via SMS, transmit the 8-character Crockford base32 short code (`H7K9-M3P2`).

### Gate Short Code Verification (`POST /api/passes/verify`)
```bash
curl -X POST http://localhost:3000/api/passes/verify \
  -H "Authorization: Bearer <verifier_key_min_32_characters_12345>" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "SHORT_CODE",
    "code": "H7K9-M3P2",
    "eventId": "evt_101"
  }'
```

*Note on Crockford Normalization:* Input `h7k9m3p2`, `H7K9-M3P2`, or `H7K9 M3P2` with `O->0` / `I/L->1` mapping all resolve identically.

---

## 3. Gate Lookup for Holders Without Anything to Show

If a holder lost their slip and has no phone:

### Step 1: Candidate Search (`POST /api/lookup`)
Gate staff search by holder's phone number or name + second factor (seat or phone last 4 digits):

```bash
curl -X POST http://localhost:3000/api/lookup \
  -H "Authorization: Bearer <verifier_key_min_32_characters_12345>" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_101",
    "name": "Jean",
    "secondFactor": "1234"
  }'
```

Response returns masked candidates and single-use, 2-minute TTL `lookupToken`s:
```json
{
  "eventId": "evt_101",
  "count": 1,
  "candidates": [
    {
      "lookupToken": "lkt_a1b2c3d4e5f678901234567890abcdef",
      "maskedName": "J***. T***.",
      "maskedPhone": "***-***-1234",
      "entriesRemaining": 1,
      "status": "ISSUED"
    }
  ]
}
```

### Step 2: Confirm Entry (`POST /api/passes/verify`)
Gate staff inspect holder's photo ID and verify:

```bash
curl -X POST http://localhost:3000/api/passes/verify \
  -H "Authorization: Bearer <verifier_key_min_32_characters_12345>" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "LOOKUP",
    "lookupToken": "lkt_a1b2c3d4e5f678901234567890abcdef",
    "idChecked": true
  }'
```

---

## 4. Family / Group Pass (`max_entries > 1`)

To issue a single printed ticket or short code for a group of 4:

```bash
curl -X POST http://localhost:3000/api/tickets \
  -H "Authorization: Bearer <sales_key_min_32_characters_12345>" \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "evt_101",
    "codeMode": "STATIC",
    "holderName": "Family Group",
    "holderPhone": "+15145559999",
    "maxEntries": 4
  }'
```

Scans 1 to 4 succeed (`status: ISSUED (1/4)`, `(2/4)`, `(3/4)`, `CHECKED_IN (4/4)`). The 5th scan is denied with code `DENIED_ALREADY_USED`.

---

## 5. Reissuing a Lost Printed Slip (`POST /api/tickets/:id/reissue`)

When an agent reissues a lost paper slip:

```bash
curl -X POST http://localhost:3000/api/tickets/tkt_1740001122_101/reissue \
  -H "Authorization: Bearer <agent_key_min_32_characters_12345>" \
  -H "Content-Type: application/json" \
  -d '{
    "recoveryMethod": "phone_lookup"
  }'
```

Effects:
- Version bumps from `v1` to `v2`.
- Old static QR code is revoked (scanning it gives `DENIED_SUPERSEDED`).
- Old short code no longer matches.
- New static QR code and new short code are issued.
- Remaining entries are preserved.

---

## 6. Offline Manifests & Reconciliation Conflict Mitigation

Offline turnstiles (e.g. buses or transit hubs) download static tickets via `/api/events/:id/manifest`:

```bash
curl -X GET http://localhost:3000/api/events/evt_101/manifest \
  -H "Authorization: Bearer <verifier_key_min_32_characters_12345>"
```

### Known Limit & Mitigation
A ticket reissued online *after* the offline manifest download remains valid offline until online reconciliation occurs. During `/reconcile`, offline scans containing superseded token versions are flagged as `CHECKIN_CONFLICT` / `DENIED_SUPERSEDED` for audit trail settlement.
