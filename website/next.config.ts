import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable x-powered-by header
  poweredByHeader: false,
  transpilePackages: ["@freed/shared", "@freed/ui"],
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },

  // Configure redirects if needed
  async redirects() {
    return [];
  },
};

export default nextConfig;
