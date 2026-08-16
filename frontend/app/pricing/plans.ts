/**
 * Single source of truth for pricing plans.
 *
 * Shared by the landing page pricing section and the dedicated /pricing page
 * so the two never drift apart.
 */

export interface Plan {
  name: string;
  price: string;
  period: string;
  /** Optional note shown under the price, e.g. yearly discount. */
  yearlyNote?: string;
  description: string;
  cta: string;
  highlighted?: boolean;
  features: string[];
}

export const PLANS: Plan[] = [
  {
    name: 'Free',
    price: '$0',
    period: '/month',
    description: 'Everything you need to start invoicing.',
    cta: 'Start free',
    features: [
      'Up to 5 clients',
      '10 invoices per month',
      'Branded PDF invoices',
      'Email delivery with confirmation',
      'Dashboard & calendar view',
      'CSV export',
    ],
  },
  {
    name: 'Pro',
    price: '$9',
    period: '/month',
    yearlyNote: 'or $7/mo billed yearly',
    description: 'AI chases your overdue invoices for you.',
    cta: 'Start 14-day trial',
    highlighted: true,
    features: [
      'Unlimited clients',
      'Unlimited invoices',
      '15 AI follow-ups per month',
      'All 3 escalation tones',
      'Edit & regenerate drafts',
      'CSV import',
      'Your logo on invoices',
    ],
  },
  {
    name: 'Business',
    price: '$19',
    period: '/month',
    yearlyNote: 'or $15/mo billed yearly',
    description: 'For agencies and high-volume senders.',
    cta: 'Start 14-day trial',
    features: [
      'Everything in Pro',
      'Unlimited AI follow-ups',
      'Custom escalation cadence',
      'Remove PayNudge branding',
      'Priority email delivery',
    ],
  },
];
