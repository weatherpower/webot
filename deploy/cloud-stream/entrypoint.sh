#!/usr/bin/env bash
# Make sure the data folder (a volume) belongs to the app user, then run everything as that user, not root.
set -e
mkdir -p /app/data
chown -R node:node /app/data
exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node bash /app/deploy/cloud-stream/run.sh
