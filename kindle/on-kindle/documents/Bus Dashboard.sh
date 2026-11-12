#!/bin/sh
# Name: Bus Dashboard
# Author: bus-watch
#
# Tap this "book" to start the dashboard. To get the normal Kindle back, restart it
# (hold the power button for about 40 seconds).
# Needs kindle-dash copied to the Kindle's drive as a folder called "dashboard".

DASH=/mnt/us/dashboard

if [ ! -f "$DASH/dash.sh" ]; then
  eips 1 1 "Bus Dashboard: no 'dashboard' folder found."
  eips 1 2 "Copy kindle-dash to the Kindle first."
  exit 1
fi

# Plugged-in mode: wait between updates instead of deep sleep. kindle-dash's
# wake-up timer is set up for the Kindle 4 and may not wake this model.
sed -i 's|^\([ \t]*\)echo "mem" >/sys/power/state|\1sleep "$duration"|' "$DASH/dash.sh"

# Make sure kindle-dash's scripts can run.
chmod +x "$DASH"/*.sh "$DASH"/local/*.sh "$DASH/xh" "$DASH/next-wakeup" 2>/dev/null

# Stop the Kindle's own screen so it doesn't draw over the dashboard.
# The name of this service differs between firmware versions, so try each.
(/etc/init.d/framework stop || stop framework || stop lab126_gui) >/dev/null 2>&1

sh "$DASH/start.sh"
