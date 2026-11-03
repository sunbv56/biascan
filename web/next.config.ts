import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "cdn0.fahasa.com", pathname: "/**" }],
  },
};

export default nextConfig;
