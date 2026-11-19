#!/bin/sh
# Name: Bus Dashboard
# Author: bus-watch
#
# Tap this "book" to start the dashboard. To get the normal Kindle back, restart it
# (hold the power button for about 40 seconds).
# Needs kindle-dash copied to the Kindle's drive as a folder called "dashboard",
# with bus-dash.sh and the local/ settings from this repo, and Wi-Fi on.

DASH=/mnt/us/dashboard

if [ ! -f "$DASH/bus-dash.sh" ]; then
  eips 1 1 "Bus Dashboard: dashboard/bus-dash.sh not found."
  eips 1 2 "Copy the dashboard files to the Kindle first."
  exit 1
fi

# Make sure the scripts and kindle-dash's download tool can run.
chmod +x "$DASH"/*.sh "$DASH"/local/*.sh "$DASH/xh" 2>/dev/null
mkdir -p "$DASH/logs"

# The rest runs in its own background process, because this script is started
# from the Kindle's screen, which is about to be switched off.
eips 1 1 "Starting Bus Dashboard..."
DETACH=nohup
command -v setsid >/dev/null 2>&1 && DETACH=setsid
$DETACH sh -c '
  # Stop an earlier copy (including the old kindle-dash loop) if one is running.
  # The [h] stops these patterns from matching this command itself.
  pkill -f "'"$DASH"'/bus-das[h].sh" ; pkill -f "'"$DASH"'/das[h].sh"
  sleep 3
  # Stop the Kindle'"'"'s own screen so it does not draw over the dashboard.
  # Its name differs between firmware versions, so try each.
  (/etc/init.d/framework stop || stop framework || stop lab126_gui) >/dev/null 2>&1
  sleep 2
  exec sh '"$DASH"'/bus-dash.sh
' </dev/null >>"$DASH/logs/bus-dash.log" 2>&1 &

exit 0
