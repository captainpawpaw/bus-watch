#!/usr/bin/env sh
# Downloads a dashboard page into "$1". The second argument is the page:
# 1 = buses (the default), 2 = energy.
# Put your own Vercel address and DASH_TOKEN below.
URL="https://YOUR-PROJECT.vercel.app/dashboard.png?key=YOUR_DASH_TOKEN"
PAGE="${2:-1}"

# --check-status: if the server has a problem (or there's no such page),
# fail instead of saving an error message as the picture.
"$(dirname "$0")/../xh" -d -q --check-status --timeout 30 -o "$1" get "$URL&page=$PAGE"
