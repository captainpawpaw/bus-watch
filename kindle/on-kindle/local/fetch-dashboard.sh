#!/usr/bin/env sh
# Downloads the dashboard picture into "$1". kindle-dash runs this on every refresh.
# Put your own Vercel address and DASH_TOKEN below.
URL="https://YOUR-PROJECT.vercel.app/dashboard.png?key=YOUR_DASH_TOKEN"

# --check-status: if the server has a problem, keep showing the last good picture.
"$(dirname "$0")/../xh" -d -q --check-status --timeout 30 -o "$1" get "$URL"
