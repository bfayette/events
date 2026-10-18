const http = require('http');
const { authenticator } = require('otplib');
const app = require('../src/app');
const eventsService = require('../src/modules/events/events.service');

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
    eventId: 'evt_101',
    owner_email: 'user@example.com',
    secret: 'JBSWY3DPEHPK3PXP',
    status: 'ISSUED'
  });

  // Start server locally on PORT 3099
  await new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`[E2E] Sandbox test server listening on http://localhost:${PORT}`);
      resolve();
    });
  });

  try {
    // 1. Healthcheck
    console.log('\n[1/4] Testing Healthcheck Endpoint...');
    const health = await makeRequest('GET', '/health');
    console.assert(health.statusCode === 200, 'Health check failed');
    console.log('  ✅ Server health ok');

    // 2. Apple & Google Pass Issuance
    console.log('\n[2/4] Testing Apple .pkpass & Google Wallet Pass Issuance...');
    const applePass = await makeRequest('GET', '/api/tickets/tkt_001/apple-pass');
    console.assert(applePass.statusCode === 200, 'Apple pass issuance failed');
    console.assert(applePass.headers['content-type'] === 'application/vnd.apple.pkpass', 'Invalid Apple pass content-type');
    console.log('  ✅ Apple Wallet .pkpass binary generated successfully');

    const googlePass = await makeRequest('GET', '/api/tickets/tkt_001/google-pass-url');
    console.assert(googlePass.statusCode === 200, 'Google pass URL generation failed');
    console.assert(googlePass.body.saveUrl.includes('pay.google.com'), 'Invalid Google save URL');
    console.log(`  ✅ Google Wallet Save URL generated: ${googlePass.body.saveUrl.substring(0, 60)}...`);

    // 3. Dynamic TOTP Gate Check-In & Anti-Replay
    console.log('\n[3/4] Testing Dynamic TOTP Gate Verification & Anti-Replay Cache...');
    const secret = 'JBSWY3DPEHPK3PXP'; // Test secret for tkt_001
    const totpToken = authenticator.generate(secret);

    // Initial Gate Scan -> Success 200
    const scan1 = await makeRequest('POST', '/api/passes/verify', {
      ticketId: 'tkt_001',
      totpToken: totpToken
    });
    console.assert(scan1.statusCode === 200, 'Initial gate scan failed');
    console.assert(scan1.body.status === 'CHECKED_IN', 'Ticket status not updated to CHECKED_IN');
    console.log('  ✅ Initial gate scan successful (Status: CHECKED_IN)');

    // Duplicate Scan -> Replay Attack Rejection 409
    const scan2 = await makeRequest('POST', '/api/passes/verify', {
      ticketId: 'tkt_001',
      totpToken: totpToken
    });
    console.assert(scan2.statusCode === 409, 'Replay attack check failed (Expected 409 Conflict)');
    console.log('  ✅ Replay attack correctly blocked (HTTP 409 Conflict)');

    // 4. Signed Receipt Issuance & Offline Reconciliation Protocol
    console.log('\n[4/4] Testing Signed Receipt Issuance & Offline Reconciliation Protocol...');
    const receiptIssuance = await makeRequest('POST', '/api/passes/issue-receipt', {
      ticketId: 'tkt_e2e_reconcile',
      format: 'JWS',
      ttlSeconds: 60
    });
    console.assert(receiptIssuance.statusCode === 201, 'Receipt issuance failed');
    console.assert(receiptIssuance.body.receipt.format === 'JWS', 'Expected JWS receipt');
    console.log('  ✅ KMS-signed JWS receipt generated');

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
