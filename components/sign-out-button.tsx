"use client";

import { useState, type ReactNode } from "react";
import { useClerk } from "@clerk/nextjs";

interface SignOutButtonProps {
  className?: string;
  children?: ReactNode;
}

/** Signs out of Clerk and returns to /sign-in. */
export function SignOutButton({ className, children = "Sign out" }: SignOutButtonProps) {
  const { signOut } = useClerk();
  const [pending, setPending] = useState(false);

  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await signOut({ redirectUrl: "/sign-in" });
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? "Signing out…" : children}
    </button>
  );
}
