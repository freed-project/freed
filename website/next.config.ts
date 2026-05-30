import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable x-powered-by header
  poweredByHeader: false,
  transpilePackages: ["@freed/shared", "@freed/ui"],
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    };
    return config;
  },

  // Configure redirects if needed
  async redirects() {
    return [];
  },
};

export default nextConfig;
