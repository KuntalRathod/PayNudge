/**
 * Settings/Profile API router.
 *
 * Endpoints:
 *   GET  /settings/profile        Read the authenticated user's profile.
 *   PUT  /settings/profile        Update the authenticated user's profile:
 *                                 business name, business address, payment
 *                                 instructions, default payment terms, email
 *                                 signature, and follow-up cadence (days
 *                                 overdue before each escalation tier).
 *   POST /settings/profile/logo   Upload a company logo (base64 data URL in
 *                                 the JSON body) to Supabase Storage and save
 *                                 its public URL on the profile.
 *
 * The profile is stored in `public.profiles` keyed by `auth.users.id`. If no
 * profile row exists (e.g. the user signed up before the migration), one is
 * created on first read/write with the email prefix as the default business_name.
 *
 * These settings automatically flow into generated invoice PDFs/emails and AI
 * follow-up emails (see `lib/invoicePdf.ts`, `lib/invoiceEmail.ts`,
 * `ai/geminiDraft.ts` callers in `routes/invoices.ts` / `ai/draftWorker.ts`).
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';

import { validateSettings } from '../lib/settingsValidation.js';
import { requireAuth } from '../middleware/auth.js';

/** The table backing user profiles. */
const PROFILES_TABLE = 'profiles';

/** Storage bucket for uploaded company logos (Migration 0007). */
const LOGO_BUCKET = 'logos';

/** Maximum accepted logo upload size, in bytes (post base64-decode). */
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2MB

/** Content types accepted for a logo upload. */
const ALLOWED_LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
};

const PROFILE_COLUMNS =
  'id, business_name, logo_url, business_address, payment_instructions, ' +
  'default_payment_terms, email_signature, cadence_polite_days, cadence_firm_days, ' +
  'cadence_final_notice_days, created_at, updated_at';

/** Sends a generic 500 when the database layer reports an unexpected error. */
function sendServerError(res: Response): void {
  res.status(500).json({ error: 'An unexpected error occurred.' });
}

/** Shape of a profile row as stored/returned by Supabase. */
interface ProfileRow {
  id: string;
  business_name: string;
  logo_url: string | null;
  business_address: string | null;
  payment_instructions: string | null;
  default_payment_terms: string | null;
  email_signature: string | null;
  cadence_polite_days: number;
  cadence_firm_days: number;
  cadence_final_notice_days: number;
  created_at: string;
  updated_at: string;
}

/**
 * Ensures a profile row exists for the caller, creating one with the email
 * prefix as a default business_name when missing (e.g. pre-migration users).
 * Returns the existing or newly-created row, or `null` on an unrecoverable
 * database error.
 */
async function ensureProfile(req: Request): Promise<ProfileRow | null> {
  const { data, error } = await req.supabase
    .from(PROFILES_TABLE)
    .select(PROFILE_COLUMNS)
    .eq('id', req.userId)
    .maybeSingle<ProfileRow>();

  if (error) {
    return null;
  }
  if (data) {
    return data;
  }

  const { data: userData } = await req.supabase.auth.getUser();
  const email = userData?.user?.email ?? '';
  const defaultName = email.split('@')[0] || '';

  const { data: created, error: createError } = await req.supabase
    .from(PROFILES_TABLE)
    .insert({ id: req.userId, business_name: defaultName })
    .select(PROFILE_COLUMNS)
    .single<ProfileRow>();

  if (createError) {
    const { data: retry } = await req.supabase
      .from(PROFILES_TABLE)
      .select(PROFILE_COLUMNS)
      .eq('id', req.userId)
      .maybeSingle<ProfileRow>();
    return retry ?? null;
  }

  return created;
}

/**
 * GET /settings/profile — read the authenticated user's profile.
 */
const handleGetProfile: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const profile = await ensureProfile(req);
  if (!profile) {
    sendServerError(res);
    return;
  }
  res.status(200).json({ profile });
};

/**
 * PUT /settings/profile — update the authenticated user's profile.
 *
 * Accepts `{ business_name, business_address?, payment_instructions?,
 * default_payment_terms?, email_signature?, cadence_polite_days?,
 * cadence_firm_days?, cadence_final_notice_days? }`. Validation runs first so
 * an invalid payload is rejected before any write.
 */
const handleUpdateProfile: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const existing = await ensureProfile(req);
  if (!existing) {
    sendServerError(res);
    return;
  }

  const validation = validateSettings(req.body ?? {}, {
    polite: existing.cadence_polite_days,
    firm: existing.cadence_firm_days,
    finalNotice: existing.cadence_final_notice_days,
  });

  if (!validation.ok) {
    res.status(400).json({
      error: validation.message,
      field: validation.field,
      code: validation.code,
    });
    return;
  }

  const { value } = validation;
  const result = await req.supabase
    .from(PROFILES_TABLE)
    .update({
      business_name: value.business_name,
      business_address: value.business_address,
      payment_instructions: value.payment_instructions,
      default_payment_terms: value.default_payment_terms,
      email_signature: value.email_signature,
      cadence_polite_days: value.cadence_polite_days,
      cadence_firm_days: value.cadence_firm_days,
      cadence_final_notice_days: value.cadence_final_notice_days,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.userId)
    .select(PROFILE_COLUMNS)
    .single<ProfileRow>();

  if (result.error || !result.data) {
    sendServerError(res);
    return;
  }

  res.status(200).json({ profile: result.data });
};

/**
 * POST /settings/profile/logo — upload a company logo.
 *
 * Accepts `{ dataUrl: string }` where `dataUrl` is a base64-encoded
 * `data:<mime>;base64,<data>` string (what `FileReader.readAsDataURL` produces
 * client-side). Validates the mime type and decoded size, uploads to the
 * `logos` storage bucket under `<user_id>/logo.<ext>` (overwriting any
 * previous logo), and saves the resulting public URL on the profile.
 */
const handleUploadLogo: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const { dataUrl } = (req.body ?? {}) as { dataUrl?: unknown };

  if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
    res.status(400).json({ error: 'A logo image is required.', field: 'dataUrl' });
    return;
  }

  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    res.status(400).json({
      error: 'The logo must be provided as a base64 data URL.',
      field: 'dataUrl',
    });
    return;
  }

  const mimeType = match[1]!;
  const base64Data = match[2]!;
  const extension = ALLOWED_LOGO_TYPES[mimeType];

  if (!extension) {
    res.status(400).json({
      error: 'Logo must be a PNG, JPEG, WEBP, or SVG image.',
      field: 'dataUrl',
    });
    return;
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch {
    res.status(400).json({ error: 'The logo data could not be decoded.', field: 'dataUrl' });
    return;
  }

  if (buffer.byteLength === 0 || buffer.byteLength > MAX_LOGO_BYTES) {
    res.status(400).json({
      error: `Logo must be between 1 byte and ${MAX_LOGO_BYTES / (1024 * 1024)}MB.`,
      field: 'dataUrl',
    });
    return;
  }

  const path = `${req.userId}/logo.${extension}`;
  const upload = await req.supabase.storage.from(LOGO_BUCKET).upload(path, buffer, {
    contentType: mimeType,
    upsert: true,
  });

  if (upload.error) {
    sendServerError(res);
    return;
  }

  const { data: publicUrlData } = req.supabase.storage.from(LOGO_BUCKET).getPublicUrl(path);
  // Cache-bust so the browser doesn't keep showing a stale logo after re-upload.
  const logoUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

  const result = await req.supabase
    .from(PROFILES_TABLE)
    .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
    .eq('id', req.userId)
    .select(PROFILE_COLUMNS)
    .maybeSingle<ProfileRow>();

  if (result.error) {
    sendServerError(res);
    return;
  }
  if (!result.data) {
    // No profile row existed yet; create one carrying the logo URL.
    const created = await req.supabase
      .from(PROFILES_TABLE)
      .insert({ id: req.userId, business_name: '', logo_url: logoUrl })
      .select(PROFILE_COLUMNS)
      .single<ProfileRow>();
    if (created.error || !created.data) {
      sendServerError(res);
      return;
    }
    res.status(200).json({ profile: created.data });
    return;
  }

  res.status(200).json({ profile: result.data });
};

/** Options for {@link createSettingsRouter}. */
export interface SettingsRouterOptions {
  authMiddleware?: RequestHandler;
}

/**
 * Builds the Settings API router.
 */
export function createSettingsRouter(options: SettingsRouterOptions = {}): Router {
  const auth = options.authMiddleware ?? requireAuth;

  const router = Router();

  router.get('/settings/profile', auth, handleGetProfile);
  router.put('/settings/profile', auth, handleUpdateProfile);
  router.post('/settings/profile/logo', auth, handleUploadLogo);

  return router;
}
