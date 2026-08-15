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
    description: 'Perfect for testing the waters.',
    cta: 'Start free',
    features: [
      'Up to 3 clients',
      '5 invoices per month',
      'Branded PDF invoices',
      'Payment tracking',
      'Basic dashboard',
      'Manual follow-ups',
    ],
  },
  {
    name: 'Pro',
    price: '$9',
    period: '/month',
    yearlyNote: 'or $7/mo billed yearly',
    description: 'For freelancers who invoice regularly.',
    cta: 'Start 14-day trial',
    highlighted: true,
    features: [
      'Unlimited clients',
      '50 invoices per month',
      '10 AI follow-ups per month',
      'All 3 escalation tones',
      'Edit emails before sending',
      'Calendar view of due dates',
      'CSV import and export',
      'Your logo on invoices',
    ],
  },
  {
    name: 'Business',
    price: '$19',
    period: '/month',
    yearlyNote: 'or $15/mo billed yearly',
    description: 'For agencies and high-volume users.',
    cta: 'Start 14-day trial',
    features: [
      'Everything in Pro',
      'Unlimited invoices',
      'Unlimited AI follow-ups',
      'Custom follow-up schedule',
      'Full follow-up history',
      'Remove PayNudge branding',
      'Priority email delivery',
      'Early access to new features',
    ],
  },
];
