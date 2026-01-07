#!/bin/bash
# Docker startup script with automatic OIDC token refresh
set -e

echo "🔄 Refreshing Vercel OIDC token..."
npx vercel env pull .env.local --yes
echo "✅ OIDC token refreshed"

echo ""
echo "🐳 Stopping any existing containers..."
docker compose down

echo ""
echo "🏗️  Building and starting Docker containers..."
docker compose up --build

# Note: Removed -d flag so you can see the logs
# Use Ctrl+C to stop, or run with -d flag for detached mode
