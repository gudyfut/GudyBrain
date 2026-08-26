import type { NextConfig } from "next";
import { findProjectRoot } from "../src/core/project-root";

const repositoryRoot = findProjectRoot();

const nextConfig: NextConfig = {
  agentRules: false,
  outputFileTracingRoot: repositoryRoot,
  poweredByHeader: false,
  reactStrictMode: true,
  turbopack: { root: repositoryRoot },
};

export default nextConfig;
