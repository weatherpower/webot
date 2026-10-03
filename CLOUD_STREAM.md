# WeatherPower Live on a cloud server (no OBS)

One Docker container runs everything: the WeatherPower server, a hidden Chrome showing the stream page at
1920x1080, and ffmpeg sending it to YouTube. If any piece stops, it restarts itself. You keep using
Live Control the same way.

## 1. Rent the server

- **Type:** a *dedicated-CPU* Linux server with **8 vCPUs and 16-32 GB RAM**. Examples (Oct 2026 prices;
  both billed by the hour):
  - Akamai Cloud **G8 Dedicated 16x8**: $0.27/hr (about $197/month). It includes no transfer, so the
    ~2 TB/month a 6 Mbps stream sends adds about $10. The cheaper option to try after the dry run is
    the shared-CPU **Linode 16 GB** at $96/month, which includes 8 TB of transfer.
  - Hetzner Cloud **CCX33**: roughly $50/month.
  - Spaceship **CPU-optimized 3** (8 cores, 8 GB): $30.90/month. **CPU-optimized 2** (4 cores, 4 GB)
    has a free 7-day trial, then $15.89/month. It's enough for **720p**; see "Small servers" below.
  Shared-CPU plans are cheaper but can stutter when neighbors get busy. Test them with a dry run first.
- **Image:** Ubuntu 24.04.
- **Location:** a US one (Ashburn or Hillsboro on Hetzner), close to YouTube's servers and the NWS.
- **Login:** add your SSH key when you create it.

Billing runs while the server exists. Deleting it stops the charges.

## 2. Install Docker (on the server)

```bash
ssh root@SERVER_IP
curl -fsSL https://get.docker.com | sh
mkdir -p /opt/weatherpower
```

## 3. Copy the app over (from this PC, in Git Bash)

```bash
cd /c/Users/josh/Documents/Codex/2026-06-24/mka/outputs
scp warning-card-service-v3-deploy-2026-10-02.tar.gz root@SERVER_IP:/opt/weatherpower/
scp warning-card-service-v3/data/live-control.json warning-card-service-v3/data/live-secrets.json root@SERVER_IP:/opt/weatherpower/
```

`live-control.json` carries your Live Control settings. `live-secrets.json` carries the Puter link; you
can skip it and link Puter again in Live Control instead.

On the server:

```bash
cd /opt/weatherpower
tar xzf warning-card-service-v3-deploy-2026-10-02.tar.gz
mkdir -p data && mv live-control.json live-secrets.json data/
```

## 4. Settings: `/opt/weatherpower/.env`

Create it with `nano .env`. This is all the stream needs:

```
CONTROLLER_TOKEN=<the same token as now, or a new long random one>
YOUTUBE_STREAM_KEY=<from YouTube Studio → Go live → Stream key>
CAMERA_ON_AIR=false
```

Optional (defaults shown):

```
STREAM_WIDTH=1920
STREAM_HEIGHT=1080
STREAM_FPS=30
STREAM_BITRATE=6000k
STREAM_PRESET=veryfast
LIVE_CONTROL_BIND=127.0.0.1
```

Keep the stream key private. Anyone with it can stream to your channel.

## 5. Dry run (recommended): record 2 minutes to a file, not YouTube

```bash
cd /opt/weatherpower
docker compose build
docker compose run --rm -e STREAM_OUTPUT=/app/data/test.flv stream
```

Let it run about 2 minutes, then press Ctrl+C. In a second SSH window during the run, `docker stats`
shows the CPU. Under ~80% is comfortable.

Copy the file to this PC to watch it:

```bash
scp root@SERVER_IP:/opt/weatherpower/data/test.flv .
```

## 6. Go live

1. Stop streaming in OBS on the home PC, since YouTube takes one source per stream key.
2. On the server:

```bash
docker compose up -d
docker compose logs -f
```

The logs say `streaming 1920x1080 at 30 fps` when it's sending.

## 7. Live Control from your phone or PC

Live Control isn't open to the internet (it's plain http). Two ways in:

- **SSH tunnel (PC):** `ssh -L 8899:127.0.0.1:8899 root@SERVER_IP`, then open
  `http://localhost:8899/warningcenter/live/control`.
- **Tailscale (phone and PC, free):** install Tailscale on the server (`curl -fsSL https://tailscale.com/install.sh | sh && tailscale up`)
  and on your phone. Set `LIVE_CONTROL_BIND=<the server's Tailscale IP>` in `.env`, run
  `docker compose up -d`, and open `http://<Tailscale IP>:8899/warningcenter/live/control`.

To relink Puter, use Live Control → WeBot → Puter → Sign in & link. The stream picks it up in a few
seconds.

## Small servers (4 cores, 4 GB): stream 720p

Add to `.env`:

```
STREAM_WIDTH=1280
STREAM_HEIGHT=720
STREAM_BITRATE=4000k
LOCAL_VOICE=off
```

`LOCAL_VOICE=off` skips WeBot's free backup voice (about 1 GB of RAM). Alloy through Puter still works;
if Puter runs out, WeBot goes quiet until you link another Puter account.

Also give the server a 4 GB swap file, so a memory spike slows things down instead of crashing:

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## If the picture stutters

- In `.env`, try `STREAM_PRESET=superfast`, or `STREAM_FPS=30` with `STREAM_BITRATE=4500k`. Then run
  `docker compose up -d`.
- Still choppy: move to a bigger box (16 vCPUs) or a GPU server. The setup is the same.

## Everyday commands

```bash
docker compose logs -f --tail 50                  # what it's doing
docker compose restart                            # restart everything
docker compose down                               # stop streaming
docker compose up -d --build                      # after copying a new version
```

## Notes

- Safe mode is on: it never posts to Discord or X, and auto Shorts rendering is off.
- On the cloud server, only the server itself counts as "home network". The Puter link and the free
  voice are never handed to anyone else.
- Cameras stay off air (`CAMERA_ON_AIR=false`) until you have permission to broadcast them.
