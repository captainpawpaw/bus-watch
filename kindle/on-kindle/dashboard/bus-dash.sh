#!/bin/sh
# bus-watch dashboard loop for a jailbroken Kindle (started by the Bus Dashboard scriptlet).
#
# Every minute it downloads page 1 (buses) and page 2 (energy), then swaps between
# them every ROTATE_SECONDS. Tapping the screen goes back to page 1 and stays there
# for TAP_HOLD_SECONDS. If there's no page 2 (smart meter not set up), it just shows page 1.
# During screensaver hours (set on the server), the server also offers page 0, a big
# clock: that shows instead, and a tap wakes the normal pages for TAP_HOLD_SECONDS.
# Night mode (NIGHT on the server, e.g. 22:00-04:00): Wi-Fi goes off and nothing is
# downloaded; the Kindle keeps the clock going itself, drawing digit pictures it
# fetched beforehand. A tap turns Wi-Fi on and wakes the dashboard for TAP_HOLD_SECONDS.
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
# Taps are logged (at most once every 10 seconds) so the log shows whether
# the screen only reports real taps or sends events all the time.
watch_taps() {
  logged=0
  watch_start=$(date +%s)
  while true; do
    if dd if="$1" of=/dev/null bs=16 count=1 2>/dev/null; then
      t=$(date +%s)
      # Ignore the first 15 seconds: the finger that tapped "Bus Dashboard" to
      # start it is still reported, and would hold page 1 for TAP_HOLD_SECONDS.
      [ $((t - watch_start)) -lt 15 ] && continue
      echo "$t" >"$TAP_FILE"
      if [ $((t - logged)) -ge 10 ]; then
        log "tap"
        logged=$t
      fi
    else
      log "can't read $1, so taps won't work"
      sleep 60
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

# Battery level and whether it's charging, for the log.
battery() {
  level=$(gasgauge-info -c 2>/dev/null || lipc-get-prop com.lab126.powerd battLevel 2>/dev/null)
  charging=$(lipc-get-prop com.lab126.powerd isCharging 2>/dev/null)
  case "$charging" in 1) charging=", charging" ;; 0) charging=", not charging" ;; *) charging="" ;; esac
  echo "${level:-unknown}${charging}"
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

# ---------- night mode ----------
N="$TMP/night"
mkdir -p "$N"
night_val() { sed -n "s/^$1 //p" "$N/info" 2>/dev/null; }

# Downloads what night mode needs: the times, a background for before and after
# midnight, and the clock's digits. Keeps the old set if anything fails.
night_fetch() {
  mkdir -p "$N/new"
  "$FETCH" "$N/new/info" "night&part=info" >/dev/null 2>&1 && [ -s "$N/new/info" ] || { rm -rf "$N/new"; return 1; }
  for part in "bg&day=0:bg0" "bg&day=1:bg1" "colon:colon" "digit&d=0:d0" "digit&d=1:d1" "digit&d=2:d2" \
    "digit&d=3:d3" "digit&d=4:d4" "digit&d=5:d5" "digit&d=6:d6" "digit&d=7:d7" "digit&d=8:d8" "digit&d=9:d9"; do
    "$FETCH" "$N/new/${part#*:}.png" "night&part=${part%%:*}" >/dev/null 2>&1 && [ -s "$N/new/${part#*:}.png" ] || { rm -rf "$N/new"; return 1; }
  done
  mv "$N/new/"* "$N/" && rm -rf "$N/new"
  return 0
}

# Draws one piece of the clock (a digit, or "colon") at its place on the screen.
night_piece() {
  set -- "$1" "$(night_val "pos $2")"
  # shellcheck disable=SC2086
  set -- "$1" $2
  eips -g "$N/$1.png" -x "$2" -y "$3" >/dev/null 2>&1
}

wifi_off() { lipc-set-prop com.lab126.cmd wirelessEnable 0 >/dev/null 2>&1; }
wifi_on() {
  lipc-set-prop com.lab126.cmd wirelessEnable 1 >/dev/null 2>&1
  lipc-set-prop com.lab126.wifid enable 1 >/dev/null 2>&1
  i=0
  while [ $i -lt 15 ]; do
    [ "$(lipc-get-prop com.lab126.wifid cmState 2>/dev/null)" = CONNECTED ] && sleep 2 && return 0
    sleep 2
    i=$((i + 1))
  done
  return 1
}

lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1

TOUCH="${TOUCH_DEVICE:-$(find_touch)}"
if [ "$TOUCH" = off ]; then
  log "tap detection is off (TOUCH_DEVICE=off)"
elif [ -n "$TOUCH" ] && [ -e "$TOUCH" ]; then
  log "watching taps on $TOUCH"
  watch_taps "$TOUCH" &
else
  log "no touchscreen found, so tapping won't switch pages (set TOUCH_DEVICE in env.sh)"
fi

echo 0 >"$TAP_FILE"
started=$(date +%s)
last_batt=0
has2=""
fails=0
last_ok=$(date +%s)
last_ok_hm=$(date +%H:%M)
WARNING=""
last_min=""
shown=""
count=$FULL_REFRESH_EVERY # so the first picture is a full, clean refresh
in_night=0
night_tried=0
night_ready_for=""
log "started: swap every ${ROTATE_SECONDS}s, tap holds page 1 for ${TAP_HOLD_SECONDS}s"

while true; do
  now=$(date +%s)
  min=$(date +%H%M)
  fresh=0

  # ----- night mode -----
  n_start=$(night_val start); n_end=$(night_val end)
  tap=$(cat "$TAP_FILE" 2>/dev/null)
  idle=1
  [ $((now - ${tap:-0})) -lt "$TAP_HOLD_SECONDS" ] && idle=0
  if [ -n "$n_start" ] && [ "$now" -ge "$n_start" ] && [ "$now" -lt "$n_end" ] && [ "$idle" = 1 ]; then
    if [ "$in_night" = 0 ]; then
      log "night mode on until $(date -d "@$n_end" '+%H:%M' 2>/dev/null || echo "$n_end"): Wi-Fi off, battery $(battery)"
      wifi_off
      in_night=1
      n_day=""
      n_full=0
    fi
    # The local time, from the time zone offset the server gave.
    lt=$((now + $(night_val offset)))
    hh=$(((lt / 3600) % 24)); mm=$(((lt / 60) % 60))
    digits="$((hh / 10))$((hh % 10))$((mm / 10))$((mm % 10))"
    day=0
    [ "$now" -ge "$(night_val midnight)" ] && day=1
    # The background (with the date) after midnight, and once an hour to clear ghosting.
    if [ "$day" != "$n_day" ] || [ $((now - n_full)) -ge 3600 ]; then
      eips -f -g "$N/bg$day.png" >/dev/null 2>&1
      night_piece colon colon
      n_day=$day
      n_full=$now
      n_shown="    "
    fi
    i=1
    for name in h1 h2 m1 m2; do
      new=$(echo "$digits" | cut -c$i); old=$(echo "$n_shown" | cut -c$i)
      [ "$new" != "$old" ] && night_piece "d$new" "$name"
      i=$((i + 1))
    done
    n_shown=$digits
    sleep 2
    continue
  fi
  if [ "$in_night" = 1 ]; then
    in_night=0
    if [ "$idle" = 0 ]; then log "night mode: tap, waking for ${TAP_HOLD_SECONDS}s"; else log "night mode off, battery $(battery)"; fi
    eips 1 1 "Waking up, connecting to Wi-Fi..." >/dev/null 2>&1
    wifi_on || log "Wi-Fi didn't connect yet"
    last_min=""                 # download straight away
    shown=""
    count=$FULL_REFRESH_EVERY   # and a full, clean refresh
    continue
  fi
  # Get the night mode pictures: when there are none (or they're for a night
  # that's over, at most every 30 minutes), and again in the 15 minutes before
  # the night starts, so the weather on them is fresh.
  if { [ -z "$n_end" ] || [ "$now" -ge "$n_end" ]; } && [ $((now - night_tried)) -ge 1800 ] ||
    { [ -n "$n_start" ] && [ "$now" -lt "$n_start" ] && [ $((n_start - now)) -le 900 ] && [ "$night_ready_for" != "$n_start" ]; }; then
    night_tried=$now
    if night_fetch; then
      n_start=$(night_val start)
      [ $((n_start - now)) -le 900 ] && night_ready_for=$n_start
      log "night mode pictures ready for $(date -d "@$n_start" '+%a %H:%M' 2>/dev/null || echo "$n_start") to $(date -d "@$(night_val end)" '+%H:%M' 2>/dev/null || night_val end)"
    fi
  fi

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
      [ "$has2" = 1 ] || log "page 2 (energy) downloaded: pages will rotate"
      has2=1
    else
      rm -f "$TMP/page2.png" # No page 2 (or no connection): stay on page 1.
      [ "$has2" = 0 ] || log "page 2 (energy) not available: showing page 1 only"
      has2=0
    fi
    # Page 0 (the screensaver) only exists during screensaver hours.
    if fetch_page 0; then
      fresh=1
    else
      rm -f "$TMP/page0.png"
    fi
  fi

  # Battery every 30 minutes, to see how long it lasts off the charger.
  if [ $((now - last_batt)) -ge 1800 ]; then
    log "battery $(battery)"
    last_batt=$now
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
    # Log page changes for the first 10 minutes, to check rotation is working,
    # and whenever the screensaver starts or ends.
    if [ "$want" != "$shown" ] && [ $((now - started)) -lt 600 ]; then
      log "showing page $want ($mode refresh)"
    elif [ "$want" = 0 ] && [ "$shown" != 0 ]; then
      log "screensaver on"
    elif [ "$shown" = 0 ] && [ "$want" != 0 ]; then
      log "screensaver off (showing page $want)"
    fi
    show "$TMP/page$want.png" "$mode"
    shown=$want
  fi

  sleep 1
done
