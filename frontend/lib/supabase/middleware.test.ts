import { describe, expect, it } from 'vitest';
import { isProtectedPath, PROTECTED_PREFIXES } from './middleware';

describe('isProtectedPath', () => {
  it('matches each protected prefix exactly', () => {
    for (const prefix of PROTECTED_PREFIXES) {
      expect(isProtectedPath(prefix)).toBe(true);
    }
  });

  it('matches sub-paths of protected prefixes', () => {
    expect(isProtectedPath('/dashboard/summary')).toBe(true);
    expect(isProtectedPath('/clients/123')).toBe(true);
    expect(isProtectedPath('/invoices/abc/history')).toBe(true);
  });

  it('does not match unrelated public routes', () => {
    expect(isProtectedPath('/')).toBe(false);
    expect(isProtectedPath('/login')).toBe(false);
    expect(isProtectedPath('/signup')).toBe(false);
    expect(isProtectedPath('/auth/logout')).toBe(false);
  });

  it('does not match routes that merely share a prefix string', () => {
    expect(isProtectedPath('/clientside')).toBe(false);
    expect(isProtectedPath('/invoices-archive')).toBe(false);
    expect(isProtectedPath('/dashboards')).toBe(false);
  });
});
