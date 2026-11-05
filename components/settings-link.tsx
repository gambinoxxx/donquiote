import Link from "next/link";
import { Settings } from "lucide-react";

/** The gear button on Home that opens Settings. */
export function SettingsLink() {
  return (
    <Link
      href="/settings"
      aria-label="Settings"
      className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-foreground"
    >
      <Settings className="h-5 w-5" aria-hidden="true" />
    </Link>
  );
}
