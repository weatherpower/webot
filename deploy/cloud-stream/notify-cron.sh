#!/bin/sh
# Phone alerts, every minute from root's crontab (see CLOUD_STREAM.md):
#   * * * * * /opt/weatherpower/deploy/cloud-stream/notify-cron.sh
# Runs notify.cjs inside the stream container. If the container itself is down, it says so from here.
cd /opt/weatherpower || exit 0
TOPIC=$(grep -E '^NTFY_TOPIC=' .env | cut -d= -f2-)
[ -z "$TOPIC" ] && exit 0
SERVER=$(grep -E '^NTFY_SERVER=' .env | cut -d= -f2-)
SERVER=${SERVER:-https://ntfy.sh}
MILES=$(grep -E '^NOTIFY_MILES=' .env | cut -d= -f2-)
STATE=/var/tmp/wp-notify-container
if docker compose exec -T -e NTFY_TOPIC="$TOPIC" -e NTFY_SERVER="$SERVER" -e NOTIFY_MILES="${MILES:-40}" stream \
    node /app/deploy/cloud-stream/notify.cjs "$@" >> /var/log/wp-notify.log 2>&1; then
  if [ "$(cat $STATE 2>/dev/null || echo 0)" -ge 2 ]; then
    curl -s -m 15 -H "Title: WeatherPower server is back up" -H "Tags: white_check_mark" -d "The stream container is running again." "$SERVER/$TOPIC" > /dev/null
  fi
  rm -f $STATE
else
  n=$(( $(cat $STATE 2>/dev/null || echo 0) + 1 ))
  echo $n > $STATE
  # Two minutes in a row: tell the phone (once).
  if [ $n -eq 2 ]; then
    curl -s -m 15 -H "Title: WeatherPower server is DOWN" -H "Priority: 5" -H "Tags: rotating_light" \
      -d "The stream container isn't running. Restart it in WeBot Studio > Server (or: cd /opt/weatherpower && docker compose up -d)." "$SERVER/$TOPIC" > /dev/null
  fi
fi
