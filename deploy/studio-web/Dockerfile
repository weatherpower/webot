# WeBot Studio on the web: the same Studio, run on the cloud server next to the stream (see docker-compose.yml here).
FROM docker:cli
RUN apk add --no-cache nodejs npm bash procps coreutils
WORKDIR /app
RUN npm init -y >/dev/null && npm pkg set type=module && npm install --omit=dev express@5 && npm cache clean --force
COPY src/personality.js src/knowledge.js /app/src/
COPY public/assets /app/public/assets
COPY studio /app/studio
ENTRYPOINT []
CMD ["node", "studio/server.js"]
