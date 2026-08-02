import { cn } from '@/lib/utils';
import { formatStatus } from './format';
import type { InvoiceStatus } from './types';

/**
 * Small colored pill that communicates an invoice's status at a glance
 * (Req 3.8). Feature-local because it is only meaningful within the invoice
 * views. Colors are conveyed alongside the status text so the meaning does not
 * rely on color alone (accessibility).
 */
const STATUS_STYLES: Record<InvoiceStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-blue-100 text-blue-800',
  overdue: 'bg-red-100 text-red-800',
  paid: 'bg-green-100 text-green-800',
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {formatStatus(status)}
    </span>
  );
}
