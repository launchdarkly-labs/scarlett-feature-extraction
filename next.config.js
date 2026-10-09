/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    /**
     * Load the LaunchDarkly SDKs from node_modules at runtime instead of
     * bundling them.
     *
     * @launchdarkly/ai-server dynamically imports its optional OpenTelemetry
     * peers and logs "Telemetry is disabled" when they are absent. Bundling it
     * would make webpack try to resolve those imports at build time.
     *
     * This affects: Local dev, Docker builds, and Vercel deployments
     */
    serverComponentsExternalPackages: [
      '@launchdarkly/node-server-sdk',
      '@launchdarkly/ai-server',
    ],
  },
}

module.exports = nextConfig
