/**
 * Pure logic layer for PayNudge.
 *
 * Modules in `src/lib` contain framework-free, side-effect-free functions
 * (invoice numbering helpers, validation, escalation-tier mapping,
 * days-overdue arithmetic, aggregation, ordering, and follow-up state
 * transitions). Keeping this logic pure makes it directly property-testable
 * with fast-check, with external services (Supabase, Resend, Gemini) mocked.
 *
 * Concrete modules are added in later tasks; this file establishes the
 * package entry point.
 */

export * from './clientValidation.js';

export {
  tierForDaysOverdue,
  tierRank,
  compareTiers,
  shouldDraft,
  POLITE_MIN_DAYS,
  FIRM_MIN_DAYS,
  FINAL_NOTICE_MIN_DAYS,
  type Tier,
} from './escalation.js';

export {
  buildInvoiceEmail,
  formatAmount,
  formatDueDate,
  type InvoiceEmailInput,
  type InvoiceEmailContent,
} from './invoiceEmail.js';

export {
  DEFAULT_EMAIL_TIMEOUT_MS,
  createEmailService,
  createResendEmailService,
  type EmailMessage,
  type EmailAttachment,
  type EmailDeliveryResult,
  type EmailDeliverySuccess,
  type EmailDeliveryFailure,
  type EmailService,
  type EmailSendClient,
  type SendEmailOptions,
  type CreateEmailServiceOptions,
} from './emailService.js';

export { generateInvoicePdf, type InvoicePdfInput } from './invoicePdf.js';

export * from './invoiceValidation.js';

export {
  CREATE_INVOICE_RPC,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_RETRY_AFTER_SECONDS,
  UNIQUE_VIOLATION_CODE,
  computeBackoffDelayMs,
  createInvoiceWithNumber,
  createSupabaseInvoiceExecutor,
  isUniqueViolation,
  type CreateInvoiceOutcome,
  type InsertAttemptResult,
  type InvoiceInsertExecutor,
  type InvoiceRecord,
  type NewInvoiceInput,
  type RetryOptions,
} from './invoiceNumbering.js';

export * from './overdue.js';

export {
  ACTIVITY_FEED_LIMIT,
  overdueCount,
  pendingFollowUpCount,
  activityFeed,
  type InvoiceStatus,
  type FollowUpStatus,
  type ActivityEventType,
  type InvoiceStatusRecord,
  type FollowUpStatusRecord,
  type ActivityEvent,
} from './dashboard.js';

export * from './outstandingTotal.js';

export * from './followUp.js';

export * from './settingsValidation.js';

export * from './dashboardMetrics.js';

export * from './clientStats.js';
