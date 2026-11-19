#!/bin/sh
# bus-watch dashboard loop for a jailbroken Kindle (started by the Bus Dashboard scriptlet).
#
# Every minute it downloads page 1 (buses) and page 2 (energy), then swaps between
# them every ROTATE_SECONDS. Tapping the screen goes back to page 1 and stays there
# for TAP_HOLD_SECONDS. If there's no page 2 (smart meter not set up), it just shows page 1.
# During screensaver hours (set on the server), the server also offers page 0, a big
# clock: that shows instead, and a tap wakes the normal pages for TAP_HOLD_SECONDS.
# Settings are in local/env.sh. Uses kindle-dash's local/fetch-dashboard.sh and xh.

DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
[ -f "$DIR/local/env.sh" ] && . "$DIR/local/env.sh"

ROTATE_SECONDS=${ROTATE_SECONDS:-10}
TAP_HOLD_SECONDS=${TAP_HOLD_SECONDS:-300}
FULL_REFRESH_EVERY=${FULL_REFRESH_EVERY:-30}
FETCH="${FETCH:-$DIR/local/fetch-dashboard.sh}"
TMP="${BUS_DASH_TMP:-/tmp/bus-dash}"
TAP_FILE="$TMP/tapped"
mkdir -p "$TMP"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

# The touchscreen's input device. Its name differs between Kindle models, so
# look for a likely one (TOUCH_DEVICE in env.sh overrides this).
find_touch() {
  for d in /sys/class/input/event*; do
    [ -e "$d" ] || continue
    name=$(cat "$d/device/name" 2>/dev/null)
    log "input device /dev/input/$(basename "$d"): $name" >&2
    case "$name" in
      *[Tt]ouch* | *cyttsp* | *zforce* | *pt_mt* | *_mt* | *[Gg]oodix* | *[Ee]lan*)
        echo "/dev/input/$(basename "$d")"
        return
        ;;
    esac
  done
}

# Each touch event the screen sends updates the time of the last tap.
watch_taps() {
  while true; do
    if dd if="$1" of=/dev/null bs=16 count=1 2>/dev/null; then
      date +%s >"$TAP_FILE"
    else
      sleep 5
    fi
  done
}

# Downloads one page; keeps the previous picture if it fails.
fetch_page() {
  if "$FETCH" "$TMP/new$1.png" "$1" >/dev/null 2>&1 && [ -s "$TMP/new$1.png" ]; then
    mv "$TMP/new$1.png" "$TMP/page$1.png"
    return 0
  fi
  rm -f "$TMP/new$1.png"
  return 1
}

show() {
  if [ "$2" = full ]; then eips -f -g "$1" >/dev/null 2>&1; else eips -g "$1" >/dev/null 2>&1; fi
  # Keep the "no connection" warning on screen while it applies.
  [ -n "$WARNING" ] && eips 1 1 "$WARNING" >/dev/null 2>&1
}

# With the Kindle's own software stopped, nothing reconnects Wi-Fi when it drops,
# so ask for it here: first a gentle "be on", and after a few failed minutes in a
# row, switch it off and on again.
reconnect_wifi() {
  log "download failed ($fails in a row): reconnecting Wi-Fi"
  if [ $((fails % 5)) -eq 0 ]; then
    lipc-set-prop com.lab126.wifid enable 0 >/dev/null 2>&1
    sleep 3
  fi
  lipc-set-prop com.lab126.cmd wirelessEnable 1 >/dev/null 2>&1
  lipc-set-prop com.lab126.wifid enable 1 >/dev/null 2>&1
  # Give it up to WIFI_WAIT_SECONDS (default 30) to connect.
  i=0
  while [ $i -lt $((${WIFI_WAIT_SECONDS:-30} / 2)) ]; do
    state=$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null)
    [ "$state" = CONNECTED ] && sleep 2 && return 0
    sleep 2
    i=$((i + 1))
  done
  return 1
}

lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1

TOUCH="${TOUCH_DEVICE:-$(find_touch)}"
if [ -n "$TOUCH" ] && [ -e "$TOUCH" ]; then
  log "watching taps on $TOUCH"
  watch_taps "$TOUCH" &
else
  log "no touchscreen found, so tapping won't switch pages (set TOUCH_DEVICE in env.sh)"
fi

echo 0 >"$TAP_FILE"
fails=0
last_ok=$(date +%s)
last_ok_hm=$(date +%H:%M)
WARNING=""
last_min=""
shown=""
count=$FULL_REFRESH_EVERY # so the first picture is a full, clean refresh
log "started: swap every ${ROTATE_SECONDS}s, tap holds page 1 for ${TAP_HOLD_SECONDS}s"

while true; do
  now=$(date +%s)
  min=$(date +%H%M)
  fresh=0

  # New pictures at the start of each minute, so the clock stays right.
  if [ "$min" != "$last_min" ]; then
    last_min=$min
    if fetch_page 1 || { fails=$((fails + 1)); reconnect_wifi; fetch_page 1; }; then
      fresh=1
      if [ "$fails" -gt 0 ]; then log "connected again after $fails failed minute(s)"; fi
      fails=0
      last_ok=$now
      last_ok_hm=$(date +%H:%M)
      [ -n "$WARNING" ] && { WARNING=""; count=$FULL_REFRESH_EVERY; } # full refresh clears the warning
    elif [ $((now - last_ok)) -ge 180 ] && [ -z "$WARNING" ]; then
      # The picture on screen is out of date: say so, so stale bus times aren't trusted.
      WARNING="No connection since $last_ok_hm, retrying"
      eips 1 1 "$WARNING" >/dev/null 2>&1
    fi
    if fetch_page 2; then
      fresh=1
    elif [ -f "$TMP/page2.png" ]; then
      rm -f "$TMP/page2.png" # No page 2 (or no connection): stay on page 1.
    fi
    # Page 0 (the screensaver) only exists during screensaver hours.
    if fetch_page 0; then
      fresh=1
    else
      rm -f "$TMP/page0.png"
    fi
  fi

  tap=$(cat "$TAP_FILE" 2>/dev/null)
  idle=1
  [ $((now - ${tap:-0})) -lt "$TAP_HOLD_SECONDS" ] && idle=0

  # Screensaver when it's that time and nobody has tapped; otherwise page 1, or
  # page 2 on its turn (not straight after a tap).
  if [ "$idle" = 1 ] && [ -f "$TMP/page0.png" ]; then
    want=0
  elif [ "$idle" = 1 ] && [ -f "$TMP/page2.png" ] && [ $(((now / ROTATE_SECONDS) % 2)) -eq 1 ]; then
    want=2
  else
    want=1
  fi

  if [ -f "$TMP/page$want.png" ] && { [ "$want" != "$shown" ] || [ "$fresh" = 1 ]; }; then
    count=$((count + 1))
    mode=quick
    # A full (flashing) refresh now and then clears e-ink ghosting.
    if [ "$count" -ge "$FULL_REFRESH_EVERY" ]; then
      mode=full
      count=0
    fi
    show "$TMP/page$want.png" "$mode"
    shown=$want
  fi

  sleep 1
done
