import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  turbopack: {
    resolveAlias: {
      "@event-database/catalogue": "../../packages/catalogue/dist/index.js",
      "@event-database/core": "../../packages/core/dist/index.js",
    },
  },
};

export default nextConfig;
