import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@ai-sdk/harness",
    "@ai-sdk/harness-claude-code",
    "@ai-sdk/harness-codex",
    "@ai-sdk/sandbox-vercel",
    "@vercel/sandbox"
  ]
};

export default nextConfig;
