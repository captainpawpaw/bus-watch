#!/bin/sh
# bus-watch dashboard loop for a jailbroken Kindle (started by the Bus Dashboard scriptlet).
#
# Every minute it downloads page 1 (buses) and page 2 (energy), then swaps between
# them every ROTATE_SECONDS. Tapping the screen goes back to page 1 and stays there
# for TAP_HOLD_SECONDS. If there's no page 2 (smart meter not set up), it just shows page 1.
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
    fetch_page 1 && fresh=1
    if fetch_page 2; then
      fresh=1
    elif [ -f "$TMP/page2.png" ]; then
      rm -f "$TMP/page2.png" # No page 2 (or no connection): stay on page 1.
    fi
  fi

  # Page 1, unless page 2 exists, the screen wasn't tapped recently and it's page 2's turn.
  want=1
  if [ -f "$TMP/page2.png" ]; then
    tap=$(cat "$TAP_FILE" 2>/dev/null)
    if [ $((now - ${tap:-0})) -ge "$TAP_HOLD_SECONDS" ] && [ $(((now / ROTATE_SECONDS) % 2)) -eq 1 ]; then
      want=2
    fi
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
