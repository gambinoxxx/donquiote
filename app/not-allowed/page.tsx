import type { Metadata } from "next";
import { Lock } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";

export const metadata: Metadata = { title: "Not allowed" };

export default function NotAllowedPage() {
  return (
    <div className="flex flex-1 flex-col gap-8 px-2 pt-12">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-surface">
        <Lock className="h-7 w-7 text-accent" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-[28px] leading-tight font-bold tracking-[-0.02em]">
          Not allowed
        </h1>
        <p className="mt-2 text-base leading-normal text-muted">
          This app is private. Your email isn&apos;t on the list.
        </p>
      </div>
      <SignOutButton className="inline-flex h-[52px] w-full items-center justify-center rounded-xl border border-input text-base font-semibold text-foreground disabled:opacity-50" />
    </div>
  );
}
