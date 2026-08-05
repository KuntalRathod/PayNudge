'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatAmount } from './format';
import { StatusBadge } from './status-badge';
import type { InvoiceListItem } from './types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Parses an ISO `YYYY-MM-DD` due date into a UTC-based Date, or null if invalid. */
function parseIsoDate(isoDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Key used to group invoices by calendar day, e.g. "2026-08-05". */
function dayKey(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Dot color per invoice status for the calendar day markers. */
const STATUS_DOT: Record<string, string> = {
  draft: 'bg-muted-foreground',
  sent: 'bg-blue-500',
  overdue: 'bg-red-500',
  paid: 'bg-green-600',
};

/**
 * Month-grid calendar of invoice due dates.
 *
 * Groups invoices by their due date and renders a standard 7-column month
 * grid. Each day with due invoices shows small colored dots (one per invoice,
 * colored by status). Clicking a day selects it and shows the full list of
 * invoices due that day below the grid, each linking to its detail page.
 */
export function InvoiceCalendarView({ invoices }: { invoices: InvoiceListItem[] }) {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(today.getUTCMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const invoicesByDay = useMemo(() => {
    const map = new Map<string, InvoiceListItem[]>();
    for (const invoice of invoices) {
      const date = parseIsoDate(invoice.due_date);
      if (!date) continue;
      const key = dayKey(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
      const list = map.get(key) ?? [];
      list.push(invoice);
      map.set(key, list);
    }
    return map;
  }, [invoices]);

  const grid = useMemo(() => {
    const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
    const startWeekday = firstOfMonth.getUTCDay(); // 0=Sun
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();

    const cells: Array<{ day: number | null; key: string | null }> = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push({ day: null, key: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, key: dayKey(viewYear, viewMonth, d) });
    }
    // Pad to complete the final week
    while (cells.length % 7 !== 0) {
      cells.push({ day: null, key: null });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const monthLabel = new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const todayKey = dayKey(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());

  function goToPrevMonth() {
    setSelectedDay(null);
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    setSelectedDay(null);
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function goToToday() {
    setViewYear(today.getUTCFullYear());
    setViewMonth(today.getUTCMonth());
    setSelectedDay(todayKey);
  }

  const selectedInvoices = selectedDay ? invoicesByDay.get(selectedDay) ?? [] : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          {/* Header: month navigation */}
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">{monthLabel}</h2>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" onClick={goToToday}>
                Today
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToPrevMonth}>
                <ChevronLeft className="h-4 w-4" />
                <span className="sr-only">Previous month</span>
              </Button>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToNextMonth}>
                <ChevronRight className="h-4 w-4" />
                <span className="sr-only">Next month</span>
              </Button>
            </div>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="py-1.5">
                {label}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-1">
            {grid.map((cell, index) => {
              if (cell.day === null || cell.key === null) {
                return <div key={index} className="aspect-square" />;
              }
              const dayInvoices = invoicesByDay.get(cell.key) ?? [];
              const isToday = cell.key === todayKey;
              const isSelected = cell.key === selectedDay;

              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => setSelectedDay(cell.key === selectedDay ? null : cell.key)}
                  className={cn(
                    'flex aspect-square flex-col items-center justify-start gap-1 rounded-md border p-1 text-xs transition-colors hover:bg-accent',
                    isSelected && 'border-primary bg-accent',
                    isToday && !isSelected && 'border-primary/50',
                    dayInvoices.length === 0 && 'border-transparent',
                  )}
                  aria-label={`${cell.key}${dayInvoices.length > 0 ? `, ${dayInvoices.length} invoice${dayInvoices.length !== 1 ? 's' : ''} due` : ''}`}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full text-xs',
                      isToday && 'bg-primary font-semibold text-primary-foreground',
                    )}
                  >
                    {cell.day}
                  </span>
                  {dayInvoices.length > 0 ? (
                    <div className="flex flex-wrap items-center justify-center gap-0.5">
                      {dayInvoices.slice(0, 4).map((inv) => (
                        <span
                          key={inv.id}
                          className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[inv.status] ?? 'bg-muted-foreground')}
                        />
                      ))}
                      {dayInvoices.length > 4 ? (
                        <span className="text-[10px] text-muted-foreground">+{dayInvoices.length - 4}</span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Selected day's invoices */}
      {selectedDay ? (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-3 text-sm font-semibold">
              Due{' '}
              {parseIsoDate(selectedDay)?.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC',
              })}
            </h3>
            {selectedInvoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No invoices due this day.</p>
            ) : (
              <ul className="space-y-2">
                {selectedInvoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link
                      href={`/invoices/${invoice.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border p-3 transition-colors hover:bg-accent"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-primary">
                          #{invoice.invoice_number}
                          <span className="ml-2 font-normal text-foreground">
                            {invoice.description}
                          </span>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatAmount(invoice.amount)}
                        </p>
                      </div>
                      <StatusBadge status={invoice.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
