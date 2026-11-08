import { NextResponse } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { isEmailAllowed } from "@/lib/allowlist";
import { getServerEnv } from "@/lib/env";

// Convenience redirects only. The real access check is requireAllowedUser()
// (lib/auth.ts), called by every page, server action and route handler that
// touches data, as Clerk recommends.
const SIGN_IN_PATH = "/sign-in";
// Public without a session:
// - /offline: shown by the service worker
// - /api/cron/scanner-check: called by cron-job.org, protected by its own
//   CRON_SECRET bearer check (app/api/cron/scanner-check/route.ts)
// The manifest, icons, /sw.js and static assets are skipped by the matcher.
// Every other route needs a signed-in, allowlisted user.
const PUBLIC_PATHS: readonly string[] = [SIGN_IN_PATH, "/not-allowed", "/offline", "/api/cron/scanner-check"];

function matchesPath(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default clerkMiddleware(async (auth, req) => {
  const { userId, sessionClaims, redirectToSignIn } = await auth();

  const { pathname } = req.nextUrl;
  const isSignIn = matchesPath(pathname, SIGN_IN_PATH);
  const isPublic = PUBLIC_PATHS.some((path) => matchesPath(pathname, path));

  // Already signed in: skip the sign-in page.
  if (userId && isSignIn) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (isPublic) return;

  if (!userId) return redirectToSignIn({ returnBackUrl: req.url });

  if (!isEmailAllowed(sessionClaims?.email, getServerEnv().allowedEmails)) {
    return NextResponse.redirect(new URL("/not-allowed", req.url));
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
