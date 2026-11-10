#!/usr/bin/env sh
# kindle-dash settings for the bus-watch dashboard.

export WIFI_TEST_IP=${WIFI_TEST_IP:-1.1.1.1}

# Every 2 minutes from 6am to midnight. Overnight it shows a "sleeping" screen.
# For every 5 minutes instead: "*/5 6-23 * * *"
export REFRESH_SCHEDULE=${REFRESH_SCHEDULE:-"*/2 6-23 * * *"}
export TIMEZONE=${TIMEZONE:-"Europe/London"}

# Quick updates leave faint ghosting on e-ink; do a full (flashing) refresh
# every 5th update, so roughly every 10 minutes.
export FULL_DISPLAY_REFRESH_RATE=${FULL_DISPLAY_REFRESH_RATE:-5}

export SLEEP_SCREEN_INTERVAL=3600
export LOW_BATTERY_REPORTING=${LOW_BATTERY_REPORTING:-false}
export LOW_BATTERY_THRESHOLD_PERCENT=10
