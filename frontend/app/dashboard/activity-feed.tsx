import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  activityEventDetail,
  activityEventLabel,
  activityEventSubtitle,
  formatEventTimestamp,
} from './format';
import type { ActivityEvent } from './types';

/**
 * The dashboard Activity_Feed (feature-local, Task 15.4 / Req 5.5, 5.6).
 *
 * Renders up to the 20 most-recent events supplied by the parent, most-recent
 * first. The ordering and the 20-item cap are enforced server-side by
 * `GET /dashboard`, so this component renders the list as received. When the
 * user owns no events it shows an explicit empty state (Req 5.6).
 *
 * Each row shows the action plus, when the event has an associated invoice,
 * the client name / invoice number / amount (Dashboard upgrade: Improve
 * Recent Activity) and links to that invoice's detail page.
 */
export interface ActivityFeedProps {
  events: ActivityEvent[];
}

export function ActivityFeed({ events }: ActivityFeedProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="divide-y">
            {events.map((event) => {
              const detail = activityEventDetail(event);
              const subtitle = activityEventSubtitle(event);
              const rowContent = (
                <>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{activityEventLabel(event.type)}</p>
                    {subtitle ? (
                      <p className="truncate text-sm text-muted-foreground">
                        {subtitle}
                        {detail ? ` · ${detail}` : ''}
                      </p>
                    ) : detail ? (
                      <p className="truncate text-sm text-muted-foreground">{detail}</p>
                    ) : null}
                  </div>
                  <time
                    dateTime={event.created_at}
                    className="shrink-0 text-sm text-muted-foreground"
                  >
                    {formatEventTimestamp(event.created_at)}
                  </time>
                </>
              );

              return (
                <li key={String(event.id)}>
                  {event.invoice_id ? (
                    <Link
                      href={`/invoices/${event.invoice_id}`}
                      className="-mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {rowContent}
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between gap-4 py-3">
                      {rowContent}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
