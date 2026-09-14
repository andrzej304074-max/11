import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@hyzyla/pdfium"],
  outputFileTracingIncludes: {
    "/api/**": ["./fonts/**", "./node_modules/@hyzyla/pdfium/dist/*.wasm"],
  },
};

export default nextConfig;
