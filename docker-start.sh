#!/bin/bash
# Docker startup script with automatic OIDC token refresh
set -e

echo "Refreshing Vercel OIDC token..."
npx vercel env pull .env.local --yes

echo "Starting Docker containers..."
docker compose down
docker compose up --build -d web

echo "Docker started successfully!"
echo "Access the app at http://localhost:3000"
