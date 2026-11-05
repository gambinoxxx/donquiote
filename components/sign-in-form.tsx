"use client";

import { useState, type FormEvent } from "react";
import { useSignIn } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Step = "email" | "code";

const CODE_LENGTH = 6;
const AFTER_SIGN_IN_PATH = "/";

const inputClass =
  "h-[52px] w-full rounded-xl border border-input bg-surface px-4 text-base text-foreground outline-none placeholder:text-muted focus:border-accent";

/**
 * Clerk Core 3 custom email-code flow:
 * create sign-in → emailCode.sendCode → emailCode.verifyCode → finalize.
 */
export function SignInForm() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const busy = fetchStatus === "fetching" || signIn === null;
  const fieldError =
    step === "email" ? errors.fields.identifier?.message : errors.fields.code?.message;
  const errorText = message ?? fieldError ?? errors.global?.[0]?.message ?? null;

  async function sendCode(): Promise<boolean> {
    if (!signIn) return false;
    const { error } = await signIn.emailCode.sendCode();
    if (error) {
      setMessage(error.message);
      return false;
    }
    return true;
  }

  async function handleEmail() {
    if (!signIn) return;
    const identifier = email.trim();
    if (identifier.length === 0) {
      setMessage("Enter your email.");
      return;
    }
    const { error } = await signIn.create({ identifier });
    if (error) {
      setMessage(error.message);
      return;
    }
    if (await sendCode()) {
      setStep("code");
      setNotice(null);
    }
  }

  async function handleCode() {
    if (!signIn) return;
    if (code.length !== CODE_LENGTH) {
      setMessage(`Enter the ${CODE_LENGTH}-digit code.`);
      return;
    }
    const { error } = await signIn.emailCode.verifyCode({ code });
    if (error) {
      setMessage(error.message);
      return;
    }
    if (signIn.status !== "complete") {
      setMessage("Sign-in needs another step that this app does not support.");
      return;
    }
    const finalized = await signIn.finalize({
      navigate: ({ decorateUrl }) => {
        // A full page load (not router.push) so the splash shows while the
        // first screen loads after sign-in (ui-context.md → Loading States).
        window.location.assign(decorateUrl(AFTER_SIGN_IN_PATH));
      },
    });
    if (finalized.error) setMessage(finalized.error.message);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    if (step === "email") await handleEmail();
    else await handleCode();
  }

  async function onResend() {
    setMessage(null);
    if (await sendCode()) setNotice("New code sent.");
  }

  async function onChangeEmail() {
    await signIn?.reset();
    setStep("email");
    setCode("");
    setMessage(null);
    setNotice(null);
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          readOnly={step === "code"}
          className={cn(inputClass, step === "code" && "text-muted")}
        />
        {step === "code" ? (
          <button
            type="button"
            onClick={onChangeEmail}
            className="self-start text-[13px] font-medium text-accent"
          >
            Use a different email
          </button>
        ) : null}
      </div>

      {step === "code" ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="code" className="text-sm font-medium">
            6-digit code
          </label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={CODE_LENGTH}
            placeholder="000000"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={cn(inputClass, "font-mono text-xl tracking-[0.3em]")}
          />
          <p className="text-[13px] text-muted">
            We sent a code to your email.{" "}
            <button
              type="button"
              onClick={onResend}
              disabled={busy}
              className="font-medium text-accent"
            >
              Resend
            </button>
            {notice ? <span className="ml-1">{notice}</span> : null}
          </p>
        </div>
      ) : null}

      <Button
        type="submit"
        disabled={busy}
        className="h-[52px] w-full rounded-xl text-base font-bold"
      >
        {step === "email" ? "Send code" : "Sign in"}
      </Button>

      {errorText ? (
        <p role="alert" className="text-sm text-error">
          {errorText}
        </p>
      ) : null}
    </form>
  );
}
