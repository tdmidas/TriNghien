import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone app: repo root also has a lockfile, so pin the workspace root
  // to this app to keep Turbopack from resolving against the monorepo root.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
