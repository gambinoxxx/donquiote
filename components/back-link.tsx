import Link from "next/link";
import { ChevronLeft } from "lucide-react";

interface BackLinkProps {
  href: string;
  label: string;
}

export function BackLink({ href, label }: BackLinkProps) {
  return (
    <Link
      href={href}
      className="-mt-3 inline-flex min-h-11 items-center gap-1.5 self-start text-[15px] font-medium text-accent"
    >
      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
      {label}
    </Link>
  );
}
