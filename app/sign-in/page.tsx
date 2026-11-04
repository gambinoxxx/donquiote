import type { Metadata } from "next";
import { TrendingUp } from "lucide-react";
import { SignInForm } from "@/components/sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="flex flex-1 flex-col gap-10 px-2 pt-12">
      <div className="flex flex-col gap-5">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent">
          <TrendingUp className="h-7 w-7 text-on-accent" strokeWidth={2.2} aria-hidden="true" />
        </span>
        <div>
          <h1 className="text-[30px] leading-tight font-bold tracking-[-0.02em]">
            Donquixote
          </h1>
          <p className="mt-2 text-base leading-normal text-muted">
            Your setups, caught for you. Sign in to see your alerts and risk guard.
          </p>
        </div>
      </div>

      <SignInForm />

      <p className="mt-auto text-center text-[13px] leading-normal text-muted">
        Private app for two people. Alerts check DG&apos;s rules; they are not trade advice.
      </p>
    </div>
  );
}
