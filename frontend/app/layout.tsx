import type { Metadata } from 'next';
import NextTopLoader from 'nextjs-toploader';
import { ThemeProvider } from '@/components/theme-provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'PayNudge',
  description:
    'Create invoices, track payments, and let AI draft follow-ups for overdue invoices — with you approving every message.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {/*
           * Smooth top-of-page route progress bar shown during navigation
           * (Req: premium feel while pages/loading.tsx skeletons resolve).
           * Color matches the app's primary/ring token; height kept subtle.
           */}
          <NextTopLoader color="#0f172a" height={3} showSpinner={false} shadow={false} />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
