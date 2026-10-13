# Bus Watch

Live TfL bus arrival times for up to 6 routes, shown only during the hours you choose.

- `scriptable/bus-watch.js` – iPhone widget for the Scriptable app (Home Screen and Lock Screen).
  Paste into a new Scriptable script named "Bus Watch" and run it to set up your buses.
- `web/` – the same idea as a web app. Host the folder (e.g. GitHub Pages) and add it to your Home Screen;
  it installs as an app and opens offline (`manifest.webmanifest`, `sw.js`, icons).

Features: setup for route, direction, stop, hours, days and walk time; countdown with "leave now" advice;
route bar showing where each bus is; "slipping / on track" trends; bunching and gap warnings;
soonest bus across all routes shown first, plus the next incoming bus.
If a bus is too tight to catch, it tells you when to leave for the next one you can make.
TfL diversions and disruptions are flagged on each route, with ones that name your stop shown first.
Set the same start and end time to watch a bus all day.
Web app only: smooth live updates, and a "Keep screen on" option while you watch.

Live data: TfL Open Data (api.tfl.gov.uk).
