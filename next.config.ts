import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/dashboard", destination: "/dashboard.html" },
      { source: "/farah", destination: "/dashboard.html" },
      { source: "/omar", destination: "/omar.html" },
    ];
  },
};

export default nextConfig;
