# Running and Testing the Service

This document describes how to run the events service locally, how to configure common environment variables used for development and test, and how to run the unit/integration and end-to-end test suites.

Use this as a quick technical runbook for developers and operators who need to bootstrap the repo and verify behavior.

Prerequisites
- Node.js 18.x or newer
- npm 9.x or newer
- (Optional) OpenSSL for generating secrets

Quickstart (development)
1. Clone the repository and install dependencies:

```bash
git clone https://github.com/bfayette/events.git
cd events
npm install
```

2. Create a local env file from the example:

```bash
cp .env.example .env.development
```

3. Edit `.env.development` and set any values you want to override. Important vars for dev:
- NODE_ENV=development
- AUTH_ENFORCED=false (default for dev/test — enables convenient dev mode)
- SEED_DEMO_DATA=true (seeds in-memory demo fixtures)
- OPERATOR_SECRET (dev default is generated; you can override)
- API_KEYS (dev default is `{}` — set a long key for testing if you want auth enforced)

Start the server (development):

```bash
npm run dev
```

The server listens on PORT (3000 by default). Healthcheck: `GET /health`.

Configuration (important env vars)
- AUTH_ENFORCED — When `true`, all protected endpoints require an operator API key (production default). When `false`, unauthenticated requests are treated as an admin actor ({ role: 'admin', keyLabel: 'dev' }) and a startup warning is logged.
- API_KEYS — JSON map of API keys to metadata. Example (single-line JSON in `.env`):

```
API_KEYS='{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":{"role":"admin","label":"dev"}}'
```

Keys must be at least 32 characters in production. Each value is an object: `{ "role": "sales|verifier|agent|admin", "eventIds": ["evt_101"], "label": "Gare Longueuil agent 3" }`. `eventIds` is optional; omitting it implies access to all events (admin only).

- OPERATOR_SECRET — secret used for HS256 token signing. Must be at least 32 chars in production. Generate using:

```bash
openssl rand -base64 48
```

- HOLDER_DATA_RETENTION_DAYS — integer, default 30, used by the `purgeExpiredHolderData()` function to null PII after retention.
- MAX_REISSUES_PER_TICKET — integer, default 3.

Running tests

Unit & integration tests (Jest)

```bash
npm test
```

Run a single Jest file or test name (useful when iterating):

```bash
# run a single test file
npx jest path/to/file.test.js

# run tests matching a name or pattern
npx jest -t "should accept a static QR"
```

End-to-end (sandbox) tests

The repository includes an automated E2E runner. Run the full sandbox E2E suite with:

```bash
npm run test:e2e
```

The E2E suite uses seeded demo fixtures (SEED_DEMO_DATA) and the same runtime as the dev server. It assumes `AUTH_ENFORCED=false` or a valid operator API key is present in `API_KEYS` — see the E2E guide in `docs/E2E_GUIDE.md` for detailed flows.

Seeding demo data

The default development configuration seeds in-memory stores with demo data (controlled by `SEED_DEMO_DATA`). To run without seeded data, set `SEED_DEMO_DATA=false` in your `.env.development`.

Running with auth enforced locally

If you want to test with authorization turned on (closer to production), create a strong API key and set `AUTH_ENFORCED=true` in your `.env.development` and provide a matching `API_KEYS` value. Example:

```bash
# .env.development snippet
AUTH_ENFORCED=true
API_KEYS='{"dev_super_admin_key_0123456789012345678901234567":{"role":"admin","label":"dev-admin"}}'
```

Then start the server and include the API key in requests using the Authorization header:

```
Authorization: Bearer dev_super_admin_key_0123456789012345678901234567
```

Developer notes about keys & production
- Production requires `API_KEYS` and `OPERATOR_SECRET` to be set and strong. The server will fail to start in production if required values are absent or keys are too short.
- We recommend using a secret manager or KMS for operator secrets and rotating keys regularly.

Sample cURL flows (examples)

1) Healthcheck

```bash
curl http://localhost:3000/health
```

2) Issue a static ticket (example)

```bash
curl -X POST http://localhost:3000/api/tickets \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <API_KEY>" \
  -d '{
    "eventId":"evt_demo",
    "codeMode":"STATIC",
    "holderName":"Mary Q",
    "holderPhone":"+15551231234",
    "maxEntries":1
  }'
```

Response: the service returns carrier material once. For `STATIC` this includes `qrPayload` (the signed token) and an optional short code plaintext shown only on issuance.

3) Verify a static QR (scan)

```bash
curl -X POST http://localhost:3000/api/passes/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <VERIFIER_KEY>" \
  -d '{ "method":"STATIC_QR", "payload":"<jws>", "eventId":"evt_demo" }'
```

4) Verify a typed short code

```bash
curl -X POST http://localhost:3000/api/passes/verify \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <VERIFIER_KEY>" \
  -d '{ "method":"SHORT_CODE", "code":"ABCD-EFGH", "eventId":"evt_demo" }'
```

5) Perform a staff lookup

```bash
curl -X POST http://localhost:3000/api/lookup \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <VERIFIER_KEY>" \
  -d '{ "eventId":"evt_demo", "phone":"+15551231234" }'
```

The response contains masked candidates and a `lookupToken` which you then pass to `POST /api/passes/verify` with `method: 'LOOKUP'`.

Reconciliation (offline uploads)

Send batches of offline receipts to `/api/passes/reconcile`. The reconcile payloads should include method and version so the server can detect conflicts; version mismatches are logged as `CHECKIN_CONFLICT` with `DENIED_SUPERSEDED` result.

Troubleshooting & common issues
- If the server fails to start in `production` with missing env vars, ensure `API_KEYS` and `OPERATOR_SECRET` are set and satisfy minimum length requirements.
- If `AUTH_ENFORCED=true` but you forgot to supply `API_KEYS`, the server will reject requests (401). Use `AUTH_ENFORCED=false` for local development convenience.
- If E2E tests fail, check the seeded fixture IDs in `src/modules/events` and ensure the `.env.development` config matches the test expectations.

Where to update this doc
- When adding or renaming endpoints, update the sample cURL commands here.
- If new env vars are added to `config.js`, list them in the environment variable section above.

Questions or next steps
- Want me to add a set of ready-to-run Postman or HTTPie scripts for the common flows? I can add them to `docs/` or `scripts/` for developer convenience.

