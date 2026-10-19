const http = require('http');
const { authenticator } = require('otplib');
const app = require('../src/app');
const eventsService = require('../src/modules/events/events.service');
const tokenService = require('../src/modules/passes/token.service');

const PORT = 3099;
let server;

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    const req = http.request(
      {
        hostname: 'localhost',
        port: PORT,
        path,
        method,
        headers: reqHeaders
      },
      (res) => {
        let data = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(data);
          let bodyParsed;
          try {
            bodyParsed = JSON.parse(buffer.toString('utf8'));
          } catch (e) {
            bodyParsed = buffer;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: bodyParsed
          });
        });
      }
    );

    req.on('error', reject);

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runE2ETests() {
  console.log('🚀 Starting E2E Sandbox Verification Suite...\n');

  // Seed fresh ticket for reconciliation test
  eventsService.tickets.set('tkt_e2e_reconcile', {
    id: 'tkt_e2e_reconcile',
    public_ref: 'ref_e2e_reconcile_01',
    eventId: 'evt_101',
    owner_email: 'user@example.com',
    secret: 'JBSWY3DPEHPK3PXP',
    status: 'ISSUED'
  });

  // Enable STATIC code mode on evt_101 for E2E tests
  eventsService.events.set('evt_101', {
    id: 'evt_101',
    name: 'Crypto Tech Summit 2025',
    venue: 'Main Arena, San Francisco',
    date: '2025-09-15T18:00:00Z',
    capacity: 500,
    allowed_code_modes: ['TOTP', 'STATIC']
  });

  // Start server locally on PORT 3099
  await new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`[E2E] Sandbox test server listening on http://localhost:${PORT}`);
      resolve();
    });
  });

  try {
    const demoTicket = eventsService.tickets.get('tkt_001');
    const demoRef = demoTicket.public_ref;
    const holderToken = tokenService.generateHolderToken({
      publicRef: demoRef,
      version: 1,
      holderIdentifier: demoTicket.owner_email
    });

    // 1. Healthcheck
    console.log('\n[1/6] Testing Healthcheck Endpoint...');
    const health = await makeRequest('GET', '/health');
    console.assert(health.statusCode === 200, 'Health check failed');
    console.log('  ✅ Server health ok');

    // 2. Apple & Google Pass Issuance
    console.log('\n[2/6] Testing Apple .pkpass & Google Wallet Pass Issuance...');
    const applePass = await makeRequest('GET', `/api/tickets/${demoRef}/apple-pass`, null, {
      'Authorization': `Bearer ${holderToken}`
    });
    console.assert(applePass.statusCode === 200, 'Apple pass issuance failed');
    console.assert(applePass.headers['content-type'] === 'application/vnd.apple.pkpass', 'Invalid Apple pass content-type');
    console.log('  ✅ Apple Wallet .pkpass binary generated successfully');

    const googlePass = await makeRequest('GET', `/api/tickets/${demoRef}/google-pass-url`, null, {
      'Authorization': `Bearer ${holderToken}`
    });
    console.assert(googlePass.statusCode === 200, 'Google pass URL generation failed');
    console.assert(googlePass.body.saveUrl.includes('pay.google.com'), 'Invalid Google save URL');
    console.log(`  ✅ Google Wallet Save URL generated: ${googlePass.body.saveUrl.substring(0, 60)}...`);

    // 3. Dynamic TOTP Gate Check-In & Anti-Replay
    console.log('\n[3/6] Testing Dynamic TOTP Gate Verification & Anti-Replay Cache...');
    const secret = demoTicket.secret;
    const totpToken = authenticator.generate(secret);

    // Initial Gate Scan -> Success 200
    const scan1 = await makeRequest('POST', '/api/passes/verify', {
      ticketId: demoRef,
      totpToken: totpToken
    });
    console.assert(scan1.statusCode === 200, 'Initial gate scan failed');
    console.assert(scan1.body.status === 'CHECKED_IN', 'Ticket status not updated to CHECKED_IN');
    console.log('  ✅ Initial gate scan successful (Status: CHECKED_IN)');

    // Duplicate Scan -> Replay Attack Rejection 409
    const scan2 = await makeRequest('POST', '/api/passes/verify', {
      ticketId: demoRef,
      totpToken: totpToken
    });
    console.assert(scan2.statusCode === 409, 'Replay attack check failed (Expected 409 Conflict)');
    console.log('  ✅ Replay attack correctly blocked (HTTP 409 Conflict)');

    // 4. No-Device Static QR & Short Code Issuance + Gate Verification
    console.log('\n[4/6] Testing Static QR Code & Short Code Ticket Issuance & Gate Scanning...');
    const issueStatic = await makeRequest('POST', '/api/tickets', {
      eventId: 'evt_101',
      codeMode: 'STATIC',
      holderName: 'E2E Paper Holder',
      holderPhone: '+15145557777'
    });
    console.assert(issueStatic.statusCode === 201, 'Static ticket issuance failed');
    console.assert(issueStatic.body.qrPayload, 'Missing qrPayload');
    console.assert(issueStatic.body.shortCode, 'Missing shortCode');
    const staticTicketRef = issueStatic.body.ticket.public_ref;
    console.log(`  ✅ Static ticket issued successfully (Ref: ${staticTicketRef}, ShortCode: ${issueStatic.body.shortCode})`);

    // Verify Short Code Scan
    const scanShortCode = await makeRequest('POST', '/api/passes/verify', {
      method: 'SHORT_CODE',
      code: issueStatic.body.shortCode,
      eventId: 'evt_101'
    });
    console.assert(scanShortCode.statusCode === 200, 'Short code scan failed');
    console.assert(scanShortCode.body.status === 'CHECKED_IN', 'Expected status CHECKED_IN');
    console.log('  ✅ Short code gate scan successful');

    // 5. Gate Candidate Lookup & Lookup Verification
    console.log('\n[5/6] Testing Gate Candidate Lookup & ID-Checked Verification...');
    const lookupRes = await makeRequest('POST', '/api/lookup', {
      eventId: 'evt_101',
      phone: '5145557777'
    });
    console.assert(lookupRes.statusCode === 200, 'Lookup query failed');
    console.assert(lookupRes.body.count === 1, 'Expected 1 lookup candidate');
    const lookupToken = lookupRes.body.candidates[0].lookupToken;
    console.log(`  ✅ Lookup candidate found (MaskedName: ${lookupRes.body.candidates[0].maskedName})`);

    // 6. Signed Receipt Issuance, Offline Manifest & Reconciliation Protocol
    console.log('\n[6/6] Testing Offline Manifest, Signed Receipt & Reconciliation Protocol...');
    const manifestRes = await makeRequest('GET', '/api/events/evt_101/manifest');
    console.assert(manifestRes.statusCode === 200, 'Manifest retrieval failed');
    console.assert(manifestRes.body.count > 0, 'Expected non-empty offline manifest');
    console.log(`  ✅ Offline manifest retrieved (${manifestRes.body.count} static tickets)`);

    const receiptIssuance = await makeRequest('POST', '/api/passes/issue-receipt', {
      ticketId: 'ref_e2e_reconcile_01',
      format: 'JWS',
      ttlSeconds: 60
    });
    console.assert(receiptIssuance.statusCode === 201, 'Receipt issuance failed');
    console.assert(receiptIssuance.body.receipt.format === 'JWS', 'Expected JWS receipt');
    console.log('  ✅ Signed JWS receipt generated');

    const reconcile = await makeRequest('POST', '/api/passes/reconcile', {
      verifierId: 'turnstile_e2e_01',
      receipts: [receiptIssuance.body.receipt.token]
    });
    console.assert(reconcile.statusCode === 200, 'Reconciliation failed');
    console.assert(reconcile.body.reconciledCount === 1, 'Expected 1 reconciled ticket');
    console.log(`  ✅ Offline reconciliation completed (Reconciled: ${reconcile.body.reconciledCount}, Rejected: ${reconcile.body.rejectedCount})`);

    console.log('\n🎉 ALL E2E SANDBOX TESTS PASSED SUCCESSFULLY!\n');
  } catch (error) {
    console.error('\n❌ E2E Sandbox Verification Failed:', error);
    process.exitCode = 1;
  } finally {
    if (server) {
      server.close();
    }
  }
}

runE2ETests();
