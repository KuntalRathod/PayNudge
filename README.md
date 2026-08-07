# PayNudge

**AI-powered invoice follow-up automation for freelancers and small businesses.**

Create invoices, track payments, and let AI draft follow-up emails for overdue invoices — with you approving every message before it's sent.

---

## Why PayNudge?

Chasing overdue payments is awkward, time-consuming, and easy to forget. PayNudge automates the uncomfortable part:

1. You create and send invoices
2. When one goes overdue, AI drafts a tactful follow-up email (escalating in tone over time)
3. You review, edit if needed, and approve — nothing is sent without your say
4. Payment lands? The chase stops automatically

---

## Architecture

```
┌─────────────────────┐       ┌──────────────────────┐
│   Next.js Frontend  │◄─────►│   Express.js API     │
│   (React, Tailwind, │       │   (TypeScript, ESM)  │
│    shadcn/ui)       │       │                      │
└─────────────────────┘       └──────────┬───────────┘
                                         │
                    ┌────────────────────┼────────────────────┐
                    │                    │                    │
              ┌─────▼─────┐      ┌──────▼──────┐     ┌──────▼──────┐
              │ Supabase   │      │   Gemini    │     │   Resend    │
              │ (Postgres  │      │   (AI Draft │     │   (Email    │
              │  + Auth    │      │    Engine)  │     │   Delivery) │
              │  + Storage │      │             │     │             │
              │  + RLS)    │      └─────────────┘     └─────────────┘
              └────────────┘
```

**Key architectural decisions:**

- **Row Level Security (RLS)** on every table — multi-tenant by default, zero data leakage risk
- **LangGraph state machine** for the AI draft pipeline — structured, debuggable, testable (not a single prompt-and-pray call)
- **Human-in-the-loop** — AI drafts, human approves. Nothing is emailed without explicit user action
- **Pure logic + injectable I/O** — every business rule is a side-effect-free function, tested with property-based tests (fast-check). I/O boundaries are injected for full testability without network calls
- **In-memory PDF generation** — no headless browser, no filesystem writes. Renders on demand via pdfkit

---

## Features

### Invoice Management
- Create invoices with auto-assigned sequential numbering
- Send invoices to clients via email (with professional PDF attachment)
- Mark as paid (captures payment date + note, halts follow-up automation)
- Download invoice PDF
- List view with status filters (Draft/Sent/Overdue/Paid) and search
- Calendar view of due dates (month grid, color-coded by status)
- Full activity timeline per invoice
- Delete with cascade cleanup

### AI Follow-up Automation
- Daily overdue detection cron job
- AI drafts follow-up emails using Google Gemini (via LangGraph)
- 3-tier tone escalation: Polite → Firm → Final Notice
- Configurable escalation cadence (days per tier)
- Strict tier-increase guard (no duplicate-tone spam)
- 3-failure cap (stops after 3 consecutive AI failures)
- Email preview with editable subject before sending
- Regenerate with different tone
- Sent follow-up history

### Client Management
- Create, edit, view, search clients
- Per-client stats (invoices, outstanding, overdue, last activity)
- Client invoice history
- Bulk import from CSV (with validation, dedup, error reporting)

### Dashboard
- Outstanding total, overdue count, pending follow-ups
- Overdue amount, collected this month, average days to pay
- "Needs attention" action panel
- Recent activity feed (clickable, enriched with context)
- Onboarding checklist for new accounts

### Settings
- Business name, address, payment instructions, terms
- Email signature (flows into AI-generated emails)
- Company logo upload (appears on PDFs)
- Follow-up cadence configuration

### Export & Data
- Export invoices to CSV
- Export clients to CSV (with stats)
- Import clients from CSV

### UX & Design
- Dark / Light / System theme toggle
- Mobile-responsive (hamburger nav, scrollable tables)
- Skeleton loading screens (no flashing text)
- Confetti celebration on Mark as Paid and Follow-up Sent
- Toast notifications (Sonner)
- Sticky navbar with backdrop blur

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript |
| Styling | Tailwind CSS, shadcn/ui, lucide-react icons |
| Backend | Express.js (TypeScript, ESM) |
| Database | Supabase (PostgreSQL + Auth + Storage + RLS) |
| AI | Google Gemini (via @google/generative-ai), LangGraph state machine |
| Email | Resend (transactional delivery with timeout handling) |
| PDF | pdfkit (in-memory generation, no filesystem) |
| Testing | Vitest, fast-check (property-based), 380+ tests |
| Validation | Custom pure validators (zero dependencies, deterministic) |

---

## Project Structure

```
PayNudge/
├── backend/
│   └── src/
│       ├── ai/           # Gemini draft generation + LangGraph worker
│       ├── config/       # Env validation (fail-fast)
│       ├── jobs/         # Overdue detection cron
│       ├── lib/          # Pure business logic (validation, escalation, PDF, email)
│       ├── middleware/   # Auth (JWT verification, RLS-scoped client)
│       ├── routes/       # Express route handlers (clients, invoices, dashboard, follow-ups, settings)
│       └── index.ts      # Server entry point
├── frontend/
│   ├── app/              # Next.js App Router pages
│   │   ├── dashboard/    # Stats, activity feed, onboarding
│   │   ├── invoices/     # List, detail, create, calendar view
│   │   ├── clients/      # List, detail, create, edit, CSV import
│   │   ├── follow-ups/   # Pending approval, sent history
│   │   ├── settings/     # Business profile
│   │   └── login/signup/ # Auth flows
│   ├── components/       # Shared UI (nav, theme, mode toggle)
│   ├── hooks/            # Custom hooks (confetti)
│   └── lib/              # API client, utils, CSV export
└── .env.example          # Required environment variables
```

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm 9+
- A Supabase project (free tier works)
- A Google AI API key (free tier: 1,500 req/day)
- A Resend API key (free tier: 100 emails/day)

### Setup

```bash
# Clone
git clone https://github.com/your-username/PayNudge.git
cd PayNudge

# Install dependencies
npm install

# Configure environment
cp .env.example backend/.env
# Edit backend/.env with your real keys

# Create frontend/.env
cat > frontend/.env << EOF
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_API_URL=http://localhost:4000
EOF

# Start backend (port 4000)
cd backend && npm run dev

# Start frontend (port 3000, in another terminal)
cd frontend && npm run dev
```

### Run Tests

```bash
# Backend (380+ tests including property-based)
cd backend && npm test

# Frontend
cd frontend && npm test
```

---

## Testing Philosophy

PayNudge uses a layered testing approach:

- **Property-based tests (fast-check)** for all pure business logic — escalation rules, validation, overdue detection, invoice numbering. These generate thousands of random inputs to catch edge cases humans miss.
- **Unit tests** for all route handlers using injected fakes (no real DB/network in tests)
- **Integration tests** for API contract verification
- **Type checking** as a safety net (`tsc --noEmit` in CI)

Every business rule lives in a **pure, injectable function** — no database calls, no clock reads, no side effects. The I/O layer is a thin shell that calls these functions. This makes the system:
- Trivially testable (inject fakes, assert results)
- Easy to reason about (read the pure function, know the behavior)
- Safe to refactor (tests catch regressions instantly)

---

## Database Schema

```sql
-- Clients: one per billed entity
clients (id, user_id, name, email, company, created_at, updated_at)

-- Invoices: the billing lifecycle
invoices (id, user_id, client_id, invoice_number, amount, description,
          due_date, status, sent_at, paid_at, payment_note,
          send_lock_at, draft_failure_count, created_at)

-- Follow-ups: AI-drafted chase emails
follow_ups (id, user_id, invoice_id, tier, content, status,
            drafted_at, sent_at, follow_up_number)

-- Activity events: the audit/timeline log
activity_events (id, user_id, invoice_id, type, metadata, created_at)

-- Profiles: business settings
profiles (id, business_name, logo_url, business_address,
          payment_instructions, default_payment_terms, email_signature,
          cadence_polite_days, cadence_firm_days, cadence_final_notice_days)
```

All tables enforce Row Level Security. Background jobs use the service role key with explicit `user_id` filtering.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Google Generative AI key for Gemini |
| `RESEND_API_KEY` | Yes | Resend transactional email key |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service role key (server-only) |
| `PORT` | No | API port (default: 4000) |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Frontend Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Frontend anon key |
| `NEXT_PUBLIC_API_URL` | No | API base URL (default: http://localhost:4000) |

---

## Design Decisions

**Why LangGraph for AI drafting?**
A simple `generateContent()` call would work for basic cases but fails silently in production. The state machine gives us: structured retries, failure counting, tier escalation guards, content validation, and clear debugging — all as named graph nodes you can reason about independently.

**Why pure validators instead of Zod/Joi for domain logic?**
Zod is great for parsing untrusted input shapes. But business rules ("escalation tier must strictly increase", "at-most-one pending follow-up per invoice") aren't schema problems — they're logic problems. Pure functions are simpler to test, compose, and debug than declarative schema DSLs for this use case.

**Why in-memory PDF instead of Puppeteer/Chrome?**
pdfkit produces clean, deterministic PDFs in ~50ms from pure data. No filesystem, no headless browser, no Docker complexity, no cold starts. The trade-off is less layout flexibility — acceptable for a single-page invoice.

**Why RLS instead of application-level auth checks?**
Defense in depth. Even if a route handler has a bug, the database won't serve another user's data. The request-scoped Supabase client enforces this at the SQL layer, not the application layer.

---

## License

MIT

---

Built by [Kuntal](https://github.com/KuntalRathod) as a proof-of-work project demonstrating full-stack product engineering: AI integration, state machines, real-time email delivery, PDF generation, property-based testing, and production-grade architecture.
