"use client";

import { useState, type ReactNode } from "react";
import { useClerk } from "@clerk/nextjs";
import { PendingButton } from "./pending-button";

interface SignOutButtonProps {
  className?: string;
  children?: ReactNode;
}

/** Signs out of Clerk and returns to /sign-in. */
export function SignOutButton({ className, children = "Sign out" }: SignOutButtonProps) {
  const { signOut } = useClerk();
  const [pending, setPending] = useState(false);

  return (
    <PendingButton
      type="button"
      className={className}
      pending={pending}
      pendingLabel="Signing out…"
      onClick={async () => {
        setPending(true);
        try {
          await signOut({ redirectUrl: "/sign-in" });
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
    </PendingButton>
  );
}
