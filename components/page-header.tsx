import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** Text, or a skeleton block while a data-driven eyebrow loads. */
  eyebrow?: ReactNode;
  /** Optional control on the right, e.g. the Settings gear on Home. */
  action?: ReactNode;
}

export function PageHeader({ title, eyebrow, action }: PageHeaderProps) {
  return (
    <header className="flex items-end justify-between gap-3">
      <div>
        {typeof eyebrow === "string" ? (
          <p className="text-[13px] text-muted">{eyebrow}</p>
        ) : (
          eyebrow
        )}
        <h1 className="mt-1 text-[28px] leading-tight font-bold tracking-[-0.02em]">
          {title}
        </h1>
      </div>
      {action}
    </header>
  );
}
