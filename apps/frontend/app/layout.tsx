import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LayoutChrome } from "@/components/LayoutChrome";
import { AuthProvider } from "@/components/AuthProvider";
import { EffectivePricesProvider } from "@/components/EffectivePricesProvider";
import { getServerCustomer } from "@/lib/auth-server";

// Tek 512x512 PNG (public/toptanbudur-icon.png) hem yüksek çözünürlüklü
// favicon hem apple-touch-icon olarak kullanılıyor; /favicon.ico eski
// tarayıcılar için 16x16 + 32x32 içerir.
export const metadata: Metadata = {
  title: "Toptan Budur",
  description: "Toptan Budur — B2B toptan ürün kataloğu ve bayi paneli",
  applicationName: "Toptan Budur",
  icons: {
    icon: [
      { url: "/toptanbudur-icon.png", type: "image/png", sizes: "any" },
    ],
    shortcut: ["/toptanbudur-icon.png"],
    apple: [
      { url: "/toptanbudur-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    title: "Toptan Budur",
    capable: true,
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const customer = await getServerCustomer();
  return (
    <html lang="tr">
      <body className="min-h-screen flex flex-col bg-[var(--surface)] text-[var(--text)]">
        <AuthProvider initial={customer}>
          <EffectivePricesProvider>
            <LayoutChrome customer={customer}>{children}</LayoutChrome>
          </EffectivePricesProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
