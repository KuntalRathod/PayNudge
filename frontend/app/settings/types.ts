/**
 * Types for the expanded Settings page (Feature 2: Improved Company/Profile
 * Settings). Mirrors the backend `profiles` row shape returned by
 * `GET /settings/profile` / `PUT /settings/profile`.
 */
export interface Profile {
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

export interface ProfileResponse {
  profile: Profile;
}
