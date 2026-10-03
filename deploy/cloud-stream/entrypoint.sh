#!/usr/bin/env bash
# Make sure the data folder (a volume) belongs to the app user, then run everything as that user, not root.
set -e
# Folders the server writes to (both are volumes): settings/state and the rendered warning cards.
mkdir -p /app/data /app/cards
chown -R node:node /app/data /app/cards
exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node bash /app/deploy/cloud-stream/run.sh
