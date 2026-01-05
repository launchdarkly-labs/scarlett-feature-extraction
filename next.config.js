/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    /**
     * NEXT.JS BUNDLING WORKAROUND for LaunchDarkly AI SDK
     *
     * The LaunchDarkly AI SDK uses dynamic imports to load provider-specific packages
     * only when needed (e.g., import('@launchdarkly/server-sdk-ai-openai')).
     *
     * Next.js statically analyzes these imports at build time and tries to bundle them,
     * even though they're optional and we don't have them installed.
     *
     * This configuration tells Next.js to treat these packages as external Node.js
     * modules that should NOT be bundled into the application.
     *
     * This affects: Local dev, Docker builds, and Vercel deployments
     */
    serverComponentsExternalPackages: [
      '@launchdarkly/node-server-sdk',
      '@launchdarkly/server-sdk-ai',
      '@launchdarkly/server-sdk-ai-vercel',
    ],
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      /**
       * Tell webpack to ignore these optional LaunchDarkly provider packages
       * that we don't have installed. The SDK tries to dynamically import these
       * based on the provider configuration, but we're using the Vercel provider
       * directly with @ai-sdk packages instead.
       *
       * Setting these to 'false' tells webpack: "Don't try to resolve these modules"
       */
      config.resolve.alias = {
        ...config.resolve.alias,
        '@launchdarkly/server-sdk-ai-openai': false,
        '@launchdarkly/server-sdk-ai-anthropic': false,
        '@launchdarkly/server-sdk-ai-bedrock': false,
        '@launchdarkly/server-sdk-ai-langchain': false,
      };
    }

    // Suppress "Module not found" warnings for these optional dependencies
    // in the build output to keep the console clean
    config.ignoreWarnings = [
      {
        module: /@launchdarkly\/server-sdk-ai/,
        message: /Module not found.*@launchdarkly\/server-sdk-ai-/,
      },
    ];

    return config;
  },
}

module.exports = nextConfig
