import type { Metadata, Viewport } from "next";
import { DISPLAY_PREFERENCES_SCRIPT } from "@/components/layout/display-preferences";
import { ServiceWorkerRegistration } from "@/components/layout/service-worker-registration";
import { SetupRequired } from "@/components/layout/setup-required";
import { publicConfigurationProblems } from "@/lib/env";
import { APP_NAME, APP_SHORT_NAME } from "@/lib/app-info";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_SHORT_NAME}` },
  description: "Phonics, reading, vocabulary and spelling for children from KG1 to Grade 2.",
  applicationName: APP_SHORT_NAME,
  appleWebApp: { capable: true, title: APP_SHORT_NAME, statusBarStyle: "default" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#1d4ed8",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const configurationProblems = publicConfigurationProblems();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the device's text-size/contrast preference before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: DISPLAY_PREFERENCES_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="bg-primary text-primary-foreground sr-only z-50 rounded-xl px-4 py-3 font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        {configurationProblems.length > 0 ? <SetupRequired problems={configurationProblems} /> : children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
