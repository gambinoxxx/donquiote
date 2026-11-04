import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { TabBar } from "@/components/tab-bar";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "DG Signals",
    template: "%s · DG Signals",
  },
  description: "DG's forex setups, caught for him.",
  applicationName: "DG Signals",
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
      className={`dark ${inter.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full">
        <ClerkProvider>
          <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
            <main className="flex flex-1 flex-col gap-4 px-4 pt-6 pb-[calc(var(--tab-bar-height)+28px+env(safe-area-inset-bottom))]">
              {children}
            </main>
          </div>
          <TabBar />
        </ClerkProvider>
      </body>
    </html>
  );
}
