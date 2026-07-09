import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Receipts are sent to Server Actions as base64. Client caps raw
      // files at 10MB (modern phone screenshots easily exceed 5MB).
      // Base64 overhead is ~1.33x, plus JSON envelope — 15MB gives
      // headroom above the 13.3MB worst case. Default 1MB silently
      // rejected legitimate submissions with a generic "Something went
      // wrong" error, so this cap must always match the client cap.
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
