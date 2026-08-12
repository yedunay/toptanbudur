import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 0,
    },
  },
  ...(process.env.NODE_ENV === "development"
    ? { allowedDevOrigins: ["*.trycloudflare.com"] }
    : {}),
  images: {
    // Supplier image hosts are dynamic (supplier identity is internal).
    // Allow any https host; we always render with `unoptimized` so Next is
    // only used for layout/sizing, not as a proxy.
    remotePatterns: [
      { protocol: "https", hostname: "**", pathname: "/**" },
      { protocol: "http", hostname: "localhost", pathname: "/**" },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/musteri", destination: "/hesabim", permanent: true },
      { source: "/musteri/profil", destination: "/hesabim/profil", permanent: true },
      { source: "/musteri/profil/sifre", destination: "/hesabim/profil/sifre", permanent: true },
      { source: "/musteri/adreslerim", destination: "/hesabim/adreslerim", permanent: true },
      { source: "/musteri/siparislerim", destination: "/hesabim/siparislerim", permanent: true },
      { source: "/musteri/siparislerim/:id", destination: "/hesabim/siparislerim/:id", permanent: true },
      { source: "/musteri/odemelerim", destination: "/hesabim/bakiyem", permanent: true },
      { source: "/musteri/cari-bakiye", destination: "/hesabim/bakiyem", permanent: true },
      { source: "/musteri/talepler", destination: "/hesabim/destek", permanent: true },
      { source: "/musteri/ayarlar", destination: "/hesabim/ayarlar", permanent: true },
    ];
  },
};

export default nextConfig;
