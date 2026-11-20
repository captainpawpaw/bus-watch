#!/usr/bin/env sh
# kindle-dash settings for the bus-watch dashboard.

export WIFI_TEST_IP=${WIFI_TEST_IP:-1.1.1.1}

# Every minute from 6am to midnight, so the clock stays right. Overnight it
# shows a "sleeping" screen. For every 2 minutes instead: "*/2 6-23 * * *"
export REFRESH_SCHEDULE=${REFRESH_SCHEDULE:-"* 6-23 * * *"}
export TIMEZONE=${TIMEZONE:-"Europe/London"}

# Quick updates leave faint ghosting on e-ink; do a full (flashing) refresh
# every 10th update, so about every 10 minutes.
export FULL_DISPLAY_REFRESH_RATE=${FULL_DISPLAY_REFRESH_RATE:-10}

export SLEEP_SCREEN_INTERVAL=3600
export LOW_BATTERY_REPORTING=${LOW_BATTERY_REPORTING:-false}
export LOW_BATTERY_THRESHOLD_PERCENT=10

# --- Bus Dashboard pages (used by bus-dash.sh) ---
# Swap between page 1 (buses) and page 2 (energy) every this many seconds.
export ROTATE_SECONDS=${ROTATE_SECONDS:-10}
# After a tap, stay on page 1 for this many seconds.
export TAP_HOLD_SECONDS=${TAP_HOLD_SECONDS:-300}
# Full (flashing) refresh every this many screen changes, to clear ghosting.
export FULL_REFRESH_EVERY=${FULL_REFRESH_EVERY:-30}
# The touchscreen is found automatically; set this only if taps don't work,
# e.g. "/dev/input/event1" (the log lists the devices it saw), or "off" to
# turn tap detection off.
export TOUCH_DEVICE=${TOUCH_DEVICE:-}
