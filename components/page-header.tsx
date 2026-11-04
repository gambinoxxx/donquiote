import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  eyebrow?: string;
  /** Optional control on the right, e.g. the Settings gear on Home. */
  action?: ReactNode;
}

export function PageHeader({ title, eyebrow, action }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between gap-3">
      <div>
        {eyebrow ? <p className="text-[13px] text-muted">{eyebrow}</p> : null}
        <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-[-0.02em]">
          {title}
        </h1>
      </div>
      {action}
    </header>
  );
}
