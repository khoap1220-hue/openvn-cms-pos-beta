import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: false,
  devIndicators: false,
  experimental: {
    agentUpgrade: "security",
  },
  allowedDevOrigins: [
    "*.workers.dev",
    "**.workers.dev",
    "openvn-cms-pos.p-khoa90.workers.dev",
    "*.trycloudflare.com",
    "**.trycloudflare.com",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
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
