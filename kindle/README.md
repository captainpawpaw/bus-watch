# Kindle dashboard

Turns an old e-ink Kindle into a wall dashboard showing:

- the current time and date
- weather now, the next 12 hours, and tomorrow
- live TfL bus times for your stops, with "leave in N min"
- drive time with live traffic for one journey, plus roadworks and incidents on the route
- gas and electricity use from your smart meter (yesterday, today so far, and the last 7 days)

![Example dashboard](example.png)

Made for the basic Kindle (8th generation, 6", 600 × 800). It works in two parts:

1. **A small web service on Vercel (free)** gathers the data and draws it as a grey-scale picture.
   Your keys and passwords stay in Vercel's settings, never on the Kindle or in this repo.
2. **The Kindle** (jailbroken, running [kindle-dash](https://github.com/pascalw/kindle-dash)) downloads
   that picture every 2 minutes and shows it.

Any section you don't set up is left out, and the buses get the space.

---

## Part 1: Get your keys and settings ready

| Setting | What it is | How to get it |
|---|---|---|
| `DASH_TOKEN` | A password for your dashboard's address, so only your Kindle can see it. **Required.** | Make up a long random one, e.g. 20+ letters and numbers. |
| `HOME_LATLON` | Where to get the weather for, as `latitude,longitude` | In Google Maps, press and hold on your home; the numbers at the top are it. E.g. `51.54,0.13` |
| `BUS_STOPS` | Your stops, separated by `;`. Add `:` and routes to show only those routes. | Find the stop on tfl.gov.uk; its ID is in the page address, e.g. `tfl.gov.uk/bus/stop/490000077E/...`. Example: `490000077E:5,145; 490005183E` |
| `BUS_WALK_MINUTES` | Optional. How long it takes you to walk to the stop. Shows "Leave in N min". | e.g. `4` |
| `TOMTOM_KEY` | Drive time and traffic. Free: 2,500 lookups a day (this uses about 1,100). | Sign up at developer.tomtom.com, then copy the key from your dashboard there. |
| `DRIVE_FROM`, `DRIVE_TO` | The journey, as `latitude,longitude` each | Same Google Maps trick as above. |
| `DRIVE_LABEL` | Optional name for the journey | e.g. `Home to work` |
| `GLOW_USERNAME`, `GLOW_PASSWORD` | Your smart meter, via the free **Bright** app (works with any UK supplier) | Install Bright (by Hildebrand), sign up and link your meter. Use that email and password. |
| `TFL_APP_KEY` | Optional. Only needed if TfL starts refusing requests. | api-portal.tfl.gov.uk |
| `TIMEZONE` | Optional. Defaults to `Europe/London`. | |

About the smart meter: Bright gets readings from the national smart meter network, usually a day
behind, so "Yesterday" is the reliable figure and "Today so far" may say "no data yet".
The first data can take a day or two to appear after you sign up for Bright.

## Part 2: Put the service on Vercel (free)

1. Merge this code into your `main` branch on GitHub.
2. Go to vercel.com and sign up with your GitHub account.
3. **Add New → Project**, and import `bus-watch`.
4. Set **Root Directory** to `kindle`. Leave Framework Preset as **Other**.
5. Under **Environment Variables**, add the settings from Part 1.
6. Click **Deploy**.
7. Check it: open `https://YOUR-PROJECT.vercel.app/dashboard.png?key=YOUR_DASH_TOKEN` in your phone's browser.
   You should see the dashboard picture. If a section says "unavailable", the message says why
   (for example a wrong key).

If you change a setting later, go to the project's **Deployments** page on Vercel and choose **Redeploy**.

## Part 3: Set up the Kindle

**Before anything else: turn on Airplane mode on the Kindle.** That stops it from updating itself,
because an update can block the jailbreak.

1. **Find your firmware:** Settings → Device Options → Device Info.
2. **Jailbreak it** with the method for your firmware. Follow the guide for your model and firmware on
   kindlemodding.org or the MobileRead forums (Kindle Developer's Corner).
   - Do the guide's step to **block automatic updates** before you turn Wi‑Fi back on.
   - Install **KUAL** (the guides cover this). That's the menu you'll start the dashboard from.
3. **Download kindle-dash:** get the latest release `.tgz` from
   github.com/pascalw/kindle-dash/releases and extract it on your computer.
4. **Add your settings:** copy the two files from `on-kindle/local/` in this repo over the ones in the
   extracted `local/` folder. Then edit `local/fetch-dashboard.sh` and put in your Vercel address and `DASH_TOKEN`.
5. **Plugged-in mode (recommended):** kindle-dash was built on an older Kindle, and its wake-up timer may not
   work on the 8th generation. If it doesn't, the Kindle goes to sleep and only the power button wakes it.
   To avoid that, open `dash.sh` in a text editor, find this line:

   ```sh
       echo "mem" >/sys/power/state
   ```

   and change it to:

   ```sh
       sleep "$duration"
   ```

   The Kindle then stays awake between updates, so **keep it plugged into USB power**.
   Updating every 2 minutes would use up the battery in about a day either way.
6. **Copy it over:** plug the Kindle into your computer by USB. It shows up as a drive. Copy the whole
   extracted folder to the drive and name it `dashboard` (so `start.sh` is at `dashboard/start.sh`).
   Also copy `on-kindle/extensions/kindle-dash` from this repo into the drive's `extensions` folder
   (this adds "Kindle Dashboard" to the KUAL menu).
7. Eject the Kindle, turn Airplane mode off and connect to Wi‑Fi (only after updates are blocked).
8. Open **KUAL → Kindle Dashboard**. After about 10 to 20 seconds your dashboard appears.

**To get the normal Kindle back:** restart it (hold the power button for about 40 seconds, or choose
Restart from the power menu).

**If the screen doesn't change:** look at `dashboard/logs/dash.log` on the Kindle's drive (connect it
by USB). It shows each update and any error.

## Changing the dashboard

- **Preview with made-up data:** `npm install`, then `npm run demo`. This writes `preview.png`.
- **Preview with your real data:** put your settings in a `.env` file in this folder
  (`NAME=value`, one per line; it's ignored by git), then `npm run preview`.
- **See it in a browser:** `https://YOUR-PROJECT.vercel.app/dashboard.svg?key=YOUR_DASH_TOKEN`
- The layout is in `src/render.js`; each data source has its own file in `src/`.

Data: TfL Open Data, Open-Meteo, TomTom and Bright (Glowmarkt). Font: Inter (SIL Open Font Licence, `fonts/OFL.txt`).
