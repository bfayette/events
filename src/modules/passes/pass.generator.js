const JSZip = require('jszip');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { config } = require('../../config');

class PassGeneratorService {
  /**
   * Generates Apple .pkpass file as a Buffer (Zip archive containing pass.json, manifest.json, signature, and assets)
   */
  static async createApplePkPassBuffer(passJsonObject) {
    const zip = new JSZip();

    // 1. Serialize pass.json
    const passJsonContent = JSON.stringify(passJsonObject, null, 2);
    zip.file('pass.json', passJsonContent);

    // 2. Mock icon and logo assets if missing (minimal 1x1 transparent png)
    const mockPngBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    zip.file('icon.png', mockPngBuffer);
    zip.file('logo.png', mockPngBuffer);

    // 3. Compute SHA-1 manifest dictionary for pass files
    const manifest = {};
    manifest['pass.json'] = crypto.createHash('sha1').update(passJsonContent).digest('hex');
    manifest['icon.png'] = crypto.createHash('sha1').update(mockPngBuffer).digest('hex');
    manifest['logo.png'] = crypto.createHash('sha1').update(mockPngBuffer).digest('hex');

    const manifestContent = JSON.stringify(manifest, null, 2);
    zip.file('manifest.json', manifestContent);

    // 4. Mock signature file for manifest.json
    const mockSignature = crypto.createHash('sha256').update(manifestContent).digest();
    zip.file('signature', mockSignature);

    // 5. Generate pkpass zip buffer
    const pkpassBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    return pkpassBuffer;
  }

  /**
   * Generates Google Wallet JWT Save URL
   */
  static createGoogleWalletSaveUrl(googleJwtClaims) {
    const secret = config.googleWalletSecret;
    const signedJwt = jwt.sign(googleJwtClaims, secret, { algorithm: 'HS256' });

    return `https://pay.google.com/gp/v/save/${signedJwt}`;
  }
}

module.exports = PassGeneratorService;
