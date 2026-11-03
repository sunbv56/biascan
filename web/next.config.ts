import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
    remotePatterns: [{ protocol: "https", hostname: "cdn0.fahasa.com", pathname: "/**" }],
  },
};

export default nextConfig;
