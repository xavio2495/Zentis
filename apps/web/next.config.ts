import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next writes AGENTS.md and CLAUDE.md into the app on dev start; this repo
  // keeps no markdown outside the README, so the generator stays off.
  agentRules: false,
};

export default nextConfig;
