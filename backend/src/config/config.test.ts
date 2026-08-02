import { describe, expect, it } from 'vitest';

import { ConfigValidationError, loadConfig } from './index.js';

/**
 * Smoke tests for startup configuration validation (Requirement 8.7).
 *
 * Each case passes an explicit env object into `loadConfig` so nothing leaks
 * through the shared `process.env`.
 */

// A complete set of realistic dummy values that should pass validation.
const validEnv: NodeJS.ProcessEnv = {
  GOOGLE_API_KEY: 'test-google-api-key',
  RESEND_API_KEY: 're_test_resend_key',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'test-supabase-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'test-supabase-service-role-key',
  PORT: '4000',
};

/** Returns a copy of the valid env with the given keys removed. */
function envWithout(...keys: string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...validEnv };
  for (const key of keys) {
    delete env[key];
  }
  return env;
}

describe('loadConfig', () => {
  it('throws ConfigValidationError when GOOGLE_API_KEY is absent', () => {
    expect(() => loadConfig(envWithout('GOOGLE_API_KEY'))).toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError when the Resend key is absent', () => {
    expect(() => loadConfig(envWithout('RESEND_API_KEY'))).toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError when SUPABASE_URL is absent', () => {
    expect(() => loadConfig(envWithout('SUPABASE_URL'))).toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError when SUPABASE_ANON_KEY is absent', () => {
    expect(() => loadConfig(envWithout('SUPABASE_ANON_KEY'))).toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError when SUPABASE_SERVICE_ROLE_KEY is absent', () => {
    expect(() => loadConfig(envWithout('SUPABASE_SERVICE_ROLE_KEY'))).toThrow(
      ConfigValidationError,
    );
  });

  it('reports every missing Supabase key in a single error', () => {
    try {
      loadConfig(envWithout('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'));
      throw new Error('expected loadConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const issues = (error as ConfigValidationError).issues.join('\n');
      expect(issues).toContain('SUPABASE_URL');
      expect(issues).toContain('SUPABASE_ANON_KEY');
      expect(issues).toContain('SUPABASE_SERVICE_ROLE_KEY');
    }
  });

  it('returns a valid config when all required vars are present', () => {
    const config = loadConfig(validEnv);

    expect(config.GOOGLE_API_KEY).toBe('test-google-api-key');
    expect(config.RESEND_API_KEY).toBe('re_test_resend_key');
    expect(config.SUPABASE_URL).toBe('https://example.supabase.co');
    expect(config.SUPABASE_ANON_KEY).toBe('test-supabase-anon-key');
    expect(config.SUPABASE_SERVICE_ROLE_KEY).toBe('test-supabase-service-role-key');
    expect(config.PORT).toBe(4000);
  });

  it('defaults PORT to 4000 when omitted', () => {
    const config = loadConfig(envWithout('PORT'));
    expect(config.PORT).toBe(4000);
  });
});
