import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable x-powered-by header
  poweredByHeader: false,

  // Configure redirects if needed
  async redirects() {
    return [];
  },
};

export default nextConfig;
