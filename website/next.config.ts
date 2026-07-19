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
