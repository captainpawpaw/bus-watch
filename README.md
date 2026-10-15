# Bus Watch

Live TfL bus arrival times for up to 6 routes, shown only during the hours you choose.

- `scriptable/bus-watch.js` – iPhone widget for the Scriptable app (Home Screen and Lock Screen).
  Paste into a new Scriptable script named "Bus Watch" and run it to set up your buses.
- `scriptable/bus-watch-countdown.js` – the same widget with live countdowns (e.g. 4:32) that keep ticking
  between widget refreshes, so the Lock Screen stays accurate. Later buses show as clock times.
  Paste into a new Scriptable script (e.g. "Bus Watch Countdown"); it uses the same saved buses.
- `web/` – the same idea as a web app. Host the folder (e.g. GitHub Pages) and add it to your Home Screen;
  it installs as an app and opens offline (`manifest.webmanifest`, `sw.js`, icons).

Features: setup for route, direction, stop, hours, days and walk time; countdown with "leave now" advice;
route bar showing where each bus is; "slipping / on track" trends; bunching and gap warnings;
soonest bus across all routes shown first, plus the next incoming bus.
If a bus is too tight to catch, it tells you when to leave for the next one you can make.
TfL diversions and disruptions are flagged on each route, with ones that name your stop shown first.
Widget only: a "Likely busy" / "Likely quieter" estimate for each bus. TfL doesn't publish how full buses are,
so it's a best guess from the pattern of buses (a long gap before it, bunching, delays, disruption, rush hour).
Set the same start and end time to watch a bus all day.
Web app only: smooth live updates, and a "Keep screen on" option while you watch.

The web app also covers TfL trains: Tube, Elizabeth line, Overground, DLR and trams. Pick the line,
your station and platform, and it shows the next trains with where they're heading and where they are now.
Turn on "Alert me when it's time to leave" for a chime and notification when it's time to set off.
Alerts work while the app is open (pair them with "Keep screen on"); phones pause web apps in the background.

Each journey card has a minimise button (top right) that shrinks it to one line with the countdown and
when to leave; the app remembers which ones you've minimised. Bus cards show the same "Likely busy" /
"Likely quieter" estimate as the widget, and Tube and Elizabeth line stations show TfL's live station
busyness (compared with that station's usual busiest time).

Tap a journey's title in "Edit my journeys" to give it your own name (e.g. "Home to work"). When you type in
the stop or station search, matches appear underneath; tap one to choose it.

Hosting with GitHub Pages: the root `index.html` forwards to `web/`, so the site address opens the app.

Live data: TfL Open Data (api.tfl.gov.uk).
