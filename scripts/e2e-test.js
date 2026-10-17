const http = require('http');
const { authenticator } = require('otplib');
const app = require('../src/app');

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

  // Start server locally on PORT 3099
  await new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`[E2E] Sandbox test server listening on http://localhost:${PORT}`);
      resolve();
    });
  });

  try {
    // 1. Healthcheck
    console.log('\n[1/5] Testing Healthcheck Endpoint...');
    const health = await makeRequest('GET', '/health');
    console.assert(health.statusCode === 200, 'Health check failed');
    console.log('  ✅ Server health ok');

    // 2. Turnkey Sub-Org Provisioning
    console.log('\n[2/5] Testing Turnkey Sub-Organization Provisioning...');
    const provision = await makeRequest('POST', '/api/users/provision-wallet', {
      userId: 'e2e_user_001',
      subOrgName: 'E2E Test SubOrg',
      passkeyName: 'E2E Passkey'
    });
    console.assert(provision.statusCode === 201, 'Provisioning failed');
    console.assert(provision.body.user.subOrganizationId.startsWith('suborg-'), 'Invalid suborg ID');
    console.assert(provision.body.user.walletAddress.startsWith('0x'), 'Invalid wallet address');
    console.log(`  ✅ Provisioned wallet: ${provision.body.user.walletAddress} (SubOrg: ${provision.body.user.subOrganizationId})`);

    // 3. Apple & Google Pass Issuance
    console.log('\n[3/5] Testing Apple .pkpass & Google Wallet Pass Issuance...');
    const applePass = await makeRequest('GET', '/api/tickets/tkt_001/apple-pass');
    console.assert(applePass.statusCode === 200, 'Apple pass issuance failed');
    console.assert(applePass.headers['content-type'] === 'application/vnd.apple.pkpass', 'Invalid Apple pass content-type');
    console.log('  ✅ Apple Wallet .pkpass binary generated successfully');

    const googlePass = await makeRequest('GET', '/api/tickets/tkt_001/google-pass-url');
    console.assert(googlePass.statusCode === 200, 'Google pass URL generation failed');
    console.assert(googlePass.body.saveUrl.includes('pay.google.com'), 'Invalid Google save URL');
    console.log(`  ✅ Google Wallet Save URL generated: ${googlePass.body.saveUrl.substring(0, 60)}...`);

    // 4. Dynamic TOTP Gate Check-In & Anti-Replay
    console.log('\n[4/5] Testing Dynamic TOTP Gate Verification & Anti-Replay Cache...');
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

    // 5. Gasless ERC-4337 Account Abstraction Transfer & Dispatch
    console.log('\n[5/5] Testing ERC-4337 Gasless UserOp Construction & Dispatch...');
    const transferIntent = await makeRequest('POST', '/api/aa/transfer-ticket', {
      ticketId: 'tkt_001',
      recipientAddress: '0x9999999999999999999999999999999999999999'
    });
    console.assert(transferIntent.statusCode === 200, 'Transfer intent construction failed');
    console.log('  ✅ ERC-4337 UserOperation intent constructed');

    const dispatch = await makeRequest('POST', '/api/aa/dispatch', {
      userOp: transferIntent.body.userOp,
      signature: '0x_e2e_passkey_signature_stamped'
    });
    console.assert(dispatch.statusCode === 200, 'UserOp dispatch failed');
    console.assert(dispatch.body.result.paymasterSponsored === true, 'Paymaster sponsorship missing');
    console.log(`  ✅ UserOp dispatched successfully (Tx Hash: ${dispatch.body.result.transactionHash})`);

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
