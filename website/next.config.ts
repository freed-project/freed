import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable x-powered-by header
  poweredByHeader: false,
  transpilePackages: ["@freed/shared", "@freed/ui"],
  env: {
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  },

  async redirects() {
    return [
      {
        source: "/updates",
        destination: "/changelog",
        permanent: false,
      },
      {
        source: "/updates/:path*",
        destination: "/changelog",
        permanent: false,
      },
      {
        source: "/changelog/all",
        destination: "/changelog",
        permanent: true,
      },
      {
        source: "/changelog/all/:page",
        destination: "/changelog/:page",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
