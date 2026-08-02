import { z } from 'zod';

/**
 * Startup configuration for the PayNudge backend.
 *
 * This module reads required environment variables, validates them, and
 * FAILS FAST (throws) if any required variable is missing or empty. Import
 * `loadConfig` at process startup so misconfiguration is caught before the
 * server begins accepting requests.
 *
 * Required variables (Requirement 8.7 for GOOGLE_API_KEY):
 *   - GOOGLE_API_KEY             Google Generative AI key (Gemini 2.5 Flash)
 *   - RESEND_API_KEY             Resend transactional email key
 *   - SUPABASE_URL               Supabase project URL
 *   - SUPABASE_ANON_KEY          Supabase anon/publishable key (RLS-scoped)
 *   - SUPABASE_SERVICE_ROLE_KEY  Supabase service role key (background jobs)
 */

const nonEmpty = (name: string) =>
  z
    .string({ required_error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

const configSchema = z.object({
  GOOGLE_API_KEY: nonEmpty('GOOGLE_API_KEY'),
  RESEND_API_KEY: nonEmpty('RESEND_API_KEY'),
  SUPABASE_URL: nonEmpty('SUPABASE_URL').url('SUPABASE_URL must be a valid URL'),
  SUPABASE_ANON_KEY: nonEmpty('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty('SUPABASE_SERVICE_ROLE_KEY'),
  PORT: z
    .string()
    .optional()
    .transform((value) => (value && value.trim().length > 0 ? Number(value) : 4000))
    .pipe(z.number().int().positive('PORT must be a positive integer')),
});

export type AppConfig = Readonly<z.infer<typeof configSchema>>;

/**
 * Error thrown when required configuration is missing or invalid.
 */
export class ConfigValidationError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

/**
 * Reads and validates configuration from the provided environment source
 * (defaults to `process.env`). Throws {@link ConfigValidationError} listing
 * every missing or invalid variable so problems can be fixed in one pass.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = configSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const field = issue.path.join('.') || '(root)';
      return `${field}: ${issue.message}`;
    });
    throw new ConfigValidationError(issues);
  }

  return Object.freeze(result.data);
}

let cachedConfig: AppConfig | undefined;

/**
 * Returns a memoized, validated config. The first call validates and caches;
 * subsequent calls return the cached instance.
 */
export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}
