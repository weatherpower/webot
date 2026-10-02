#!/usr/bin/env bash
# Local dev server that never posts anywhere (Discord/X off) and mimics the public production mount.
cd "$(dirname "$0")/.."
export PORT="${PORT:-8899}" HOST=127.0.0.1 PUBLIC_BASE_URL="http://localhost:${PORT:-8899}" \
  PUBLIC_WARNINGCENTER_ONLY=true HOME_PAGE=warningcenter \
  DISCORD_ENABLED=false DISCORD_AUTO_POST_ENABLED=false \
  X_USER_ACCESS_TOKEN= X_ACCESS_TOKEN= X_ACCESS_TOKEN_SECRET= PAGE_ENDPOINT_URL= \
  AUTO_RENDER_ENABLED="${AUTO_RENDER_ENABLED:-false}" RENDER_BROWSER_CHANNEL="${RENDER_BROWSER_CHANNEL:-chrome}"
exec node src/server.js
