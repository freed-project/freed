import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable x-powered-by header
  poweredByHeader: false,
  transpilePackages: ["@freed/shared", "@freed/ui"],
  env: {
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
  },

  // Configure redirects if needed
  async redirects() {
    return [];
  },
};

export default nextConfig;
