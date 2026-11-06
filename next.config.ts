import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: false,
  devIndicators: false,
  allowedDevOrigins: [
    "*.workers.dev",
    "**.workers.dev",
    "openvn-cms-pos.p-khoa90.workers.dev",
    "*.trycloudflare.com",
    "**.trycloudflare.com",
  ],
  async rewrites() {
    const realtimePort = process.env.REALTIME_PORT || "3013";
    return {
      beforeFiles: [
        {
          source: "/",
          has: [{ type: "query", key: "EIO" }],
          destination: `http://localhost:${realtimePort}/`,
        },
      ],
    };
  },
};

export default nextConfig;
