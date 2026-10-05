import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: "/dashboard", destination: "/dashboard.html" }];
  },
};

export default nextConfig;
