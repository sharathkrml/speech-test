import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  async headers() {
    const cache = [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }];
    return ["/cactus.js", "/cactus.wasm", "/whistle.cact"].map((source) => ({ source, headers: cache }));
  },
};

export default nextConfig;
