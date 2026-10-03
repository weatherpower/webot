# WeatherPower Live, cloud edition: the server plus a 24/7 YouTube stream with no OBS.
# Build and run with docker compose (see CLOUD_STREAM.md).
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Virtual screen, sound card, encoder, fonts, and the tools the start script uses.
RUN apt-get update && apt-get install -y --no-install-recommends \
      xvfb pulseaudio pulseaudio-utils ffmpeg curl ca-certificates util-linux \
      fonts-liberation fonts-noto-core fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install --with-deps chrome && rm -rf /var/lib/apt/lists/*

COPY . .
RUN chmod +x deploy/cloud-stream/run.sh deploy/cloud-stream/entrypoint.sh

EXPOSE 8899
ENTRYPOINT ["deploy/cloud-stream/entrypoint.sh"]
