import { describe, expect, it } from 'vitest';
import type { CreateEmailResponse } from 'resend';

import {
  DEFAULT_EMAIL_TIMEOUT_MS,
  createEmailService,
  type EmailMessage,
  type EmailSendClient,
} from './emailService.js';

const message: EmailMessage = {
  from: 'billing@example.com',
  to: 'client@example.com',
  subject: 'Invoice #1',
  html: '<p>Invoice</p>',
  text: 'Invoice',
};

/** Builds a fake Resend-compatible client from a `send` implementation. */
function fakeClient(
  send: (payload: unknown) => Promise<CreateEmailResponse>,
): EmailSendClient {
  return { emails: { send: send as EmailSendClient['emails']['send'] } };
}

describe('createEmailService', () => {
  it('exposes a 30 second default confirmation window', () => {
    expect(DEFAULT_EMAIL_TIMEOUT_MS).toBe(30_000);
  });

  it('resolves with the message id on confirmed delivery (Req 4.1)', async () => {
    const client = fakeClient(async () => ({ data: { id: 'email_123' }, error: null }));
    const service = createEmailService(client);

    const result = await service.sendEmail(message);

    expect(result).toEqual({ ok: true, id: 'email_123' });
  });

  it('forwards the composed payload to the client', async () => {
    let received: Record<string, unknown> | undefined;
    const client = fakeClient(async (payload) => {
      received = payload as Record<string, unknown>;
      return { data: { id: 'email_456' }, error: null };
    });

    await createEmailService(client).sendEmail({ ...message, replyTo: 'me@example.com' });

    expect(received).toMatchObject({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: 'me@example.com',
    });
  });

  it('returns a delivery-failure signal when Resend reports an error (Req 4.4)', async () => {
    const client = fakeClient(async () => ({
      data: null,
      error: { message: 'domain not verified', name: 'validation_error' },
    }));

    const result = await createEmailService(client).sendEmail(message);

    expect(result).toEqual({
      ok: false,
      reason: 'delivery_error',
      message: 'domain not verified',
    });
  });

  it('returns a delivery-failure signal when the SDK throws (Req 4.4)', async () => {
    const client = fakeClient(async () => {
      throw new Error('network down');
    });

    const result = await createEmailService(client).sendEmail(message);

    expect(result).toEqual({
      ok: false,
      reason: 'delivery_error',
      message: 'network down',
    });
  });

  it('returns a timeout failure when delivery is not confirmed in time (Req 4.5)', async () => {
    // Client never confirms; the injectable short timeout drives the branch.
    const client = fakeClient(() => new Promise<CreateEmailResponse>(() => {}));
    const service = createEmailService(client, { timeoutMs: 20 });

    const result = await service.sendEmail(message);

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('timeout');
      expect(result.message).toContain('20ms');
    }
  });

  it('honors a per-call timeout override', async () => {
    const client = fakeClient(
      () =>
        new Promise<CreateEmailResponse>((resolve) => {
          setTimeout(() => resolve({ data: { id: 'late' }, error: null }), 100);
        }),
    );
    const service = createEmailService(client, { timeoutMs: 30_000 });

    const result = await service.sendEmail(message, { timeoutMs: 10 });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('timeout');
    }
  });
});
