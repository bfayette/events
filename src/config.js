const dotenv = require('dotenv');
const crypto = require('crypto');
const { z } = require('zod');

// Load environment variables from .env file according to process.env.NODE_ENV
const envFile = `.env${process.env.NODE_ENV ? `.${process.env.NODE_ENV}` : ''}`;
dotenv.config({ path: envFile });

const KNOWN_OLD_DEFAULTS = new Set([
  'kms-operator-secret-2025-key-v1',
  'kms-operator-secret-2025-key-v2-backup',
  'dev_secret_key_for_testing_123456'
]);

// Zod schemas for variable validations
const nodeEnvSchema = z.enum(['development', 'test', 'production']);
const portSchema = z.coerce.number().int().min(1).max(65535);

/**
 * Pure function to validate and load configuration from a given env object.
 * @param {Record<string, any>} env - Object containing environment variables (defaults to process.env)
 * @returns {Readonly<Record<string, any>>} Frozen config object
 */
function loadConfig(env = process.env) {
  const errors = [];

  // 1. NODE_ENV
  const rawNodeEnv = env.NODE_ENV !== undefined && env.NODE_ENV !== '' ? env.NODE_ENV : 'development';
  const envParsed = nodeEnvSchema.safeParse(rawNodeEnv);
  let nodeEnv = 'development';
  if (!envParsed.success) {
    errors.push(`NODE_ENV must be one of 'development', 'test', 'production'`);
  } else {
    nodeEnv = envParsed.data;
  }

  // 2. PORT
  const rawPort = env.PORT !== undefined && env.PORT !== '' ? env.PORT : 3000;
  const portParsed = portSchema.safeParse(rawPort);
  let portNum = 3000;
  if (!portParsed.success) {
    errors.push(`PORT must be a valid integer between 1 and 65535`);
  } else {
    portNum = portParsed.data;
  }

  // 3. SEED_DEMO_DATA
  let seedDemoData;
  const rawSeedDemoData = env.SEED_DEMO_DATA;
  if (rawSeedDemoData !== undefined && rawSeedDemoData !== '') {
    if (typeof rawSeedDemoData === 'boolean') {
      seedDemoData = rawSeedDemoData;
    } else if (rawSeedDemoData === 'true') {
      seedDemoData = true;
    } else if (rawSeedDemoData === 'false') {
      seedDemoData = false;
    } else {
      errors.push(`SEED_DEMO_DATA must be 'true' or 'false'`);
    }
  } else {
    seedDemoData = nodeEnv !== 'production';
  }

  if (nodeEnv === 'production' && seedDemoData === true) {
    errors.push(`SEED_DEMO_DATA cannot be true in production mode`);
  }

  // 4. OPERATOR_KEY_ID
  const operatorKeyId = env.OPERATOR_KEY_ID || 'op-key-1';

  // 5. OPERATOR_PREVIOUS_KEYS
  let operatorPreviousKeys = {};
  const rawPrevKeys = env.OPERATOR_PREVIOUS_KEYS;
  if (rawPrevKeys !== undefined && rawPrevKeys !== '' && rawPrevKeys !== null) {
    if (typeof rawPrevKeys === 'object' && !Array.isArray(rawPrevKeys)) {
      operatorPreviousKeys = rawPrevKeys;
    } else if (typeof rawPrevKeys === 'string') {
      try {
        const parsed = JSON.parse(rawPrevKeys);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          operatorPreviousKeys = parsed;
        } else {
          errors.push(`OPERATOR_PREVIOUS_KEYS must be a valid JSON object`);
        }
      } catch {
        errors.push(`OPERATOR_PREVIOUS_KEYS must be valid JSON`);
      }
    } else {
      errors.push(`OPERATOR_PREVIOUS_KEYS must be a valid JSON object`);
    }

    for (const [kid, secret] of Object.entries(operatorPreviousKeys)) {
      if (kid === operatorKeyId) {
        errors.push(`OPERATOR_PREVIOUS_KEYS key ID '${kid}' cannot be equal to active OPERATOR_KEY_ID`);
      }
      if (typeof secret !== 'string' || secret.length < 32) {
        errors.push(`OPERATOR_PREVIOUS_KEYS secret for key '${kid}' must be at least 32 characters long`);
      }
      if (nodeEnv === 'production' && KNOWN_OLD_DEFAULTS.has(secret)) {
        errors.push(`OPERATOR_PREVIOUS_KEYS secret for key '${kid}' must not equal known old default secrets`);
      }
    }
  }

  // Helper for secret validation
  const validateSecret = (varName, value) => {
    let secret = value;
    if (!secret || secret === '') {
      if (nodeEnv === 'production') {
        errors.push(`${varName} is required in production`);
        return null;
      } else {
        secret = crypto.randomBytes(32).toString('base64');
        console.warn(`[config] Warning: ${varName} is missing. Generated a random secret for this process; tokens will not survive a restart.`);
        return secret;
      }
    }

    if (typeof secret !== 'string' || secret.length < 32) {
      errors.push(`${varName} must be at least 32 characters long`);
    }

    if (nodeEnv === 'production' && KNOWN_OLD_DEFAULTS.has(secret)) {
      errors.push(`${varName} must not equal known old default secrets`);
    }

    return secret;
  };

  const operatorSecret = validateSecret('OPERATOR_SECRET', env.OPERATOR_SECRET);
  const googleWalletSecret = validateSecret('GOOGLE_WALLET_SECRET', env.GOOGLE_WALLET_SECRET);

  // 6. AUTH_ENFORCED
  let authEnforced = nodeEnv === 'production';
  const rawAuthEnforced = env.AUTH_ENFORCED;
  if (rawAuthEnforced !== undefined && rawAuthEnforced !== '') {
    if (typeof rawAuthEnforced === 'boolean') {
      authEnforced = rawAuthEnforced;
    } else if (rawAuthEnforced === 'true') {
      authEnforced = true;
    } else if (rawAuthEnforced === 'false') {
      authEnforced = false;
    } else {
      errors.push(`AUTH_ENFORCED must be 'true' or 'false'`);
    }
  }

  // 7. API_KEYS
  let apiKeys = {};
  const rawApiKeys = env.API_KEYS;
  const ALLOWED_ROLES = new Set(['sales', 'verifier', 'agent', 'admin']);

  if (rawApiKeys !== undefined && rawApiKeys !== '' && rawApiKeys !== null) {
    if (typeof rawApiKeys === 'object' && !Array.isArray(rawApiKeys)) {
      apiKeys = rawApiKeys;
    } else if (typeof rawApiKeys === 'string') {
      try {
        const parsed = JSON.parse(rawApiKeys);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          apiKeys = parsed;
        } else {
          errors.push(`API_KEYS must be a valid JSON map`);
        }
      } catch {
        errors.push(`API_KEYS must be valid JSON`);
      }
    } else {
      errors.push(`API_KEYS must be a valid JSON map`);
    }

    for (const [key, val] of Object.entries(apiKeys)) {
      if (typeof key !== 'string' || key.length < 32) {
        errors.push(`API_KEYS key '${key.substring(0, 10)}...' must be at least 32 characters long`);
      }
      if (!val || typeof val !== 'object') {
        errors.push(`API_KEYS entry for key '${key.substring(0, 10)}...' must be an object`);
        continue;
      }
      if (!ALLOWED_ROLES.has(val.role)) {
        errors.push(`API_KEYS entry for key '${key.substring(0, 10)}...' must have role 'sales', 'verifier', 'agent', or 'admin'`);
      }
      if (val.eventIds !== undefined && !Array.isArray(val.eventIds)) {
        errors.push(`API_KEYS eventIds for key '${key.substring(0, 10)}...' must be an array of strings`);
      }
    }
  } else if (nodeEnv === 'production' && authEnforced) {
    errors.push(`API_KEYS is required in production`);
  }

  if (errors.length > 0) {
    const errorMsg = `Invalid configuration:\n${errors.map(e => ` - ${e}`).join('\n')}`;
    throw new Error(errorMsg);
  }

  if (!authEnforced) {
    console.warn('[auth] Warning: AUTH_ENFORCED is false. Unauthenticated requests will default to admin role with keyLabel "dev".');
  }

  // 8. HOLDER_DATA_RETENTION_DAYS
  const rawRetention = env.HOLDER_DATA_RETENTION_DAYS !== undefined && env.HOLDER_DATA_RETENTION_DAYS !== '' ? env.HOLDER_DATA_RETENTION_DAYS : 30;
  const retentionNum = parseInt(rawRetention, 10);
  const holderDataRetentionDays = isNaN(retentionNum) || retentionNum < 1 ? 30 : retentionNum;

  // 9. RATE LIMITS
  const verifierRateLimit = parseInt(env.RATE_LIMIT_VERIFIER_FAILS_PER_MIN || '5', 10);
  const eventRateLimit = parseInt(env.RATE_LIMIT_EVENT_FAILS_PER_MIN || '30', 10);

  // 10. REISSUE CAP
  const maxReissues = parseInt(env.MAX_REISSUES_PER_TICKET || '3', 10);

  return Object.freeze({
    nodeEnv,
    port: portNum,
    operatorKeyId,
    operatorSecret,
    operatorPreviousKeys,
    googleWalletSecret,
    seedDemoData,
    authEnforced,
    apiKeys,
    holderDataRetentionDays,
    rateLimitVerifierFailsPerMin: isNaN(verifierRateLimit) ? 5 : verifierRateLimit,
    rateLimitEventFailsPerMin: isNaN(eventRateLimit) ? 30 : eventRateLimit,
    maxReissuesPerTicket: isNaN(maxReissues) ? 3 : maxReissues
  });
}

// Singleton config instance initialized with process.env
const config = loadConfig(process.env);

module.exports = {
  loadConfig,
  config
};
