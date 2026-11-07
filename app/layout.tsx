import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Sora } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Splash } from "@/components/brand/splash";
import { SplashGate } from "@/components/brand/splash-gate";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { TabBar } from "@/components/tab-bar";
import { ToastProvider } from "@/components/toast";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Brand wordmark on the splash only.
const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: "700",
});

export const metadata: Metadata = {
  title: {
    default: "Donquixote",
    template: "%s · Donquixote",
  },
  description: "DG's forex setups, caught for him.",
  applicationName: "Donquixote",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0E1116",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`dark ${inter.variable} ${jetbrainsMono.variable} ${sora.variable} h-full`}
    >
      {/* Browser extensions sometimes add styles to <body> before React loads
          (e.g. padding-right / overflow): don't treat that as an app error. */}
      <body className="min-h-full" suppressHydrationWarning>
        <ClerkProvider>
          <ToastProvider>
            <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col overflow-x-clip">
              <main className="flex flex-1 flex-col gap-4 px-4 pt-6 pb-[calc(var(--tab-bar-height)+28px+env(safe-area-inset-bottom))]">
                {children}
              </main>
            </div>
          </ToastProvider>
          <TabBar />
          <ServiceWorkerRegister />
          {/* Full page loads only (cold start, after sign-in); see SplashGate. */}
          <SplashGate>
            <Splash status="Checking your setups…" />
          </SplashGate>
          <noscript>
            <style>{".splash{display:none}"}</style>
          </noscript>
        </ClerkProvider>
      </body>
    </html>
  );
}
