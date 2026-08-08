'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Logout control with confirmation dialog (Req 1.8).
 *
 * Shows a confirmation dialog before logging out to prevent accidental
 * session termination. On confirm, submits a form POST to `/auth/logout`.
 */
export function LogoutButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function handleConfirm() {
    formRef.current?.submit();
  }

  return (
    <div className={className}>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Log out
      </Button>

      {/* Hidden form for the actual POST */}
      <form ref={formRef} action="/auth/logout" method="post" className="hidden" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log out?</DialogTitle>
            <DialogDescription>
              Are you sure you want to log out? You&apos;ll need to sign in again to access your
              account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirm}>
              Log out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
