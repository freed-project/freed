import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable static export for pre-rendering all pages
  output: "standalone",

  // Disable x-powered-by header
  poweredByHeader: false,

  // Configure redirects if needed
  async redirects() {
    return [];
  },
};

export default nextConfig;
