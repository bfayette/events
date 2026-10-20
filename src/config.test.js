const { loadConfig } = require('./config');

describe('Configuration Loader & Validation (loadConfig)', () => {
  const validProdEnv = {
    NODE_ENV: 'production',
    PORT: '3000',
    OPERATOR_KEY_ID: 'op-key-prod-1',
    OPERATOR_SECRET: 'a_very_long_production_operator_secret_1234567890_32chars',
    GOOGLE_WALLET_SECRET: 'a_very_long_production_google_wallet_secret_1234567890_32chars',
    HOLDER_TOKEN_SECRET: 'a_very_long_production_holder_token_secret_1234567890_32chars',
    API_KEYS: JSON.stringify({ 'a_very_long_production_api_key_32_chars_12345': { role: 'admin', label: 'Prod Key' } })
  };

  describe('Production Environment Rules', () => {
    it('throws when OPERATOR_SECRET, GOOGLE_WALLET_SECRET, or HOLDER_TOKEN_SECRET is missing, naming variables with no secret values', () => {
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/OPERATOR_SECRET/);
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/GOOGLE_WALLET_SECRET/);
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/HOLDER_TOKEN_SECRET/);

      try {
        loadConfig({ NODE_ENV: 'production' });
      } catch (err) {
        expect(err.message).toContain('OPERATOR_SECRET is required in production');
        expect(err.message).toContain('GOOGLE_WALLET_SECRET is required in production');
        expect(err.message).toContain('HOLDER_TOKEN_SECRET is required in production');
        // Ensure no secret values leaked in error message
        expect(err.message).not.toContain('dev_secret_key');
        expect(err.message).not.toContain('kms-operator-secret');
      }
    });

    it('throws when HOLDER_TOKEN_SECRET equals OPERATOR_SECRET in production', () => {
      const sameSecretEnv = {
        ...validProdEnv,
        HOLDER_TOKEN_SECRET: validProdEnv.OPERATOR_SECRET
      };
      expect(() => loadConfig(sameSecretEnv)).toThrow(/HOLDER_TOKEN_SECRET must not equal OPERATOR_SECRET/);
    });

    it('throws when production secrets are shorter than 32 characters', () => {
      const shortSecretEnv = {
        ...validProdEnv,
        OPERATOR_SECRET: 'short'
      };
      expect(() => loadConfig(shortSecretEnv)).toThrow(/OPERATOR_SECRET must be at least 32 characters long/);
    });

    it('throws when production secrets match any known old default values', () => {
      const knownOldDefaults = [
        'kms-operator-secret-2025-key-v1',
        'kms-operator-secret-2025-key-v2-backup',
        'dev_secret_key_for_testing_123456'
      ];

      for (const knownSecret of knownOldDefaults) {
        expect(() => loadConfig({ ...validProdEnv, OPERATOR_SECRET: knownSecret })).toThrow(
          /OPERATOR_SECRET must not equal known old default secrets/
        );
        expect(() => loadConfig({ ...validProdEnv, GOOGLE_WALLET_SECRET: knownSecret })).toThrow(
          /GOOGLE_WALLET_SECRET must not equal known old default secrets/
        );
        expect(() => loadConfig({ ...validProdEnv, HOLDER_TOKEN_SECRET: knownSecret })).toThrow(
          /HOLDER_TOKEN_SECRET must not equal known old default secrets/
        );
      }
    });

    it('defaults seedDemoData to false in production, and throws if SEED_DEMO_DATA=true in production', () => {
      const config = loadConfig(validProdEnv);
      expect(config.seedDemoData).toBe(false);

      expect(() => loadConfig({ ...validProdEnv, SEED_DEMO_DATA: 'true' })).toThrow(
        /SEED_DEMO_DATA cannot be true in production mode/
      );
    });
  });

  describe('Development and Test Environments Rules', () => {
    it('succeeds with no secrets in dev/test, generating distinct random secrets of sufficient length with warnings', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const config1 = loadConfig({ NODE_ENV: 'development' });
      const config2 = loadConfig({ NODE_ENV: 'test' });

      expect(config1.operatorSecret).toBeDefined();
      expect(config1.operatorSecret.length).toBeGreaterThanOrEqual(32);
      expect(config1.googleWalletSecret).toBeDefined();
      expect(config1.googleWalletSecret.length).toBeGreaterThanOrEqual(32);

      // Verify secrets are distinct random strings per process/invocation
      expect(config1.operatorSecret).not.toEqual(config2.operatorSecret);
      expect(config1.googleWalletSecret).not.toEqual(config2.googleWalletSecret);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('OPERATOR_SECRET is missing'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('GOOGLE_WALLET_SECRET is missing'));

      warnSpy.mockRestore();
    });

    it('behaves as development environment when NODE_ENV is unset', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const config = loadConfig({});
      expect(config.nodeEnv).toEqual('development');
      expect(config.seedDemoData).toBe(true);

      warnSpy.mockRestore();
    });
  });

  describe('OPERATOR_PREVIOUS_KEYS Validation', () => {
    it('throws if OPERATOR_PREVIOUS_KEYS is invalid JSON', () => {
      expect(() => loadConfig({ ...validProdEnv, OPERATOR_PREVIOUS_KEYS: '{invalid_json}' })).toThrow(
        /OPERATOR_PREVIOUS_KEYS must be valid JSON/
      );
    });

    it('throws if a key ID in OPERATOR_PREVIOUS_KEYS equals active OPERATOR_KEY_ID', () => {
      const prevKeys = JSON.stringify({ 'op-key-prod-1': 'a_very_long_previous_secret_1234567890_32chars' });
      expect(() => loadConfig({ ...validProdEnv, OPERATOR_PREVIOUS_KEYS: prevKeys })).toThrow(
        /cannot be equal to active OPERATOR_KEY_ID/
      );
    });

    it('throws if secret in OPERATOR_PREVIOUS_KEYS is shorter than 32 characters', () => {
      const prevKeys = JSON.stringify({ 'old-key': 'short_secret' });
      expect(() => loadConfig({ ...validProdEnv, OPERATOR_PREVIOUS_KEYS: prevKeys })).toThrow(
        /must be at least 32 characters long/
      );
    });
  });

  describe('PORT Validation', () => {
    it('throws when PORT is invalid', () => {
      expect(() => loadConfig({ PORT: 'not_a_number' })).toThrow(/PORT must be a valid integer/);
      expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT must be a valid integer/);
      expect(() => loadConfig({ PORT: '-5' })).toThrow(/PORT must be a valid integer/);
    });
  });
});
