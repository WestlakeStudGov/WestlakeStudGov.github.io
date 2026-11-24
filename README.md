# Westlake Student Government website

The WSG website: https://westlakestudgov.github.io/

**You never need to edit code to change the website.** Everything (events, committees, people, photos, pages, filters) is changed from the website itself.

## How to edit the site

1. Scroll to the very bottom of any page and click **Edit site**.
2. Type the passcode.
   - **Editor passcode:** for officers and committee chairs. Can change and add anything.
   - **Advisor passcode:** can do everything editors can, and can also delete whole committees and special pages and change the passcodes.
3. The editor panel opens on the right. Pick a tab (Events, Committees, People, and so on), make changes, and watch the page update behind it. Gold **✎ Edit** buttons on the page jump straight to the right spot.
4. When you're done, click **Publish** in the bar at the bottom of the screen. The live site updates in about a minute.

Changes are saved on your device until you publish, so it's fine to close the tab and come back. Use **⋯ > Discard unpublished changes** to throw them away.

### Tips that keep the site looking good
- **Photos:** upload straight from your phone or computer. They're shrunk automatically. Use wide (landscape) photos for events and committees and tall (portrait) photos for headshots.
- **People:** add each person once on the People tab, then put them on committees. Set their Position (Member, Vice President, Class President, and so on).
- **Events:** uncheck "Planned by student government" for things you're only promoting, like a game. Check "Feature on the home page" for the big ones (up to 3 show).
- **Big events** like Homecoming live inside the committee that plans them (Committees tab > the committee > Highlighted big events). Add a new year each year with the theme and photos.
- **Spirit bowls:** Committees tab > Assemblies Committee > Class scoreboard. Add each spirit bowl and type in the points.
- **New school year:** add the new grade on the Filters & grades tab (check "This is a grade"), update the People tab, and have the adviser change the passcodes in Settings.

## For advisers: passcodes and the GitHub key

Behind the scenes, the site saves changes into this GitHub repository using a **GitHub key** (a fine-grained personal access token). The key is stored locked with the passcodes in `data/auth.json`, so nobody can use it without a passcode.

### Change the passcodes
Edit site > Settings tab (advisor passcode only). Do this at the start of each school year or whenever a passcode has been shared too widely. Use long passphrases, like four random words.

### Make a new GitHub key (first-time setup, or when the old one expires)
1. Sign in to GitHub as **WestlakeStudGov**.
2. Go to https://github.com/settings/personal-access-tokens/new
3. Name it something like "WSG website editing".
4. **Expiration:** pick the longest option. Put a reminder on your calendar a week before it expires.
5. **Repository access:** Only select repositories > **WestlakeStudGov.github.io**.
6. **Permissions > Repository permissions > Contents:** Read and write.
7. Click **Generate token** and copy it.
8. On the website: Edit site > Settings > paste it into **New GitHub key**, retype the editor passcode in **New editor passcode**, type the current advisor passcode, and click **Save settings**.
   - First-time setup: Edit site > **Set up editing** asks for the key and both passcodes.

If the key expires, publishing will say "The GitHub key stopped working." Make a new one with the steps above.

## The Christmas Jars total
The amount raised updates itself every 30 minutes from the donation link set on the Christmas Jars page (Special pages tab). Change the link there any time. To add money raised somewhere else (like a separate donation link), type it in "Amount to add by hand"; it's added on top of the live total. To use only a typed-in total, uncheck "Include the live total".

If the total stops updating:
1. Open the **Actions** tab of this repository.
2. If there's a banner saying workflows are disabled, click **Enable**. (GitHub pauses scheduled jobs after 60 days with no changes to the repository.)
3. Click **Update donation totals** > **Run workflow**.

## Undoing a mistake
Every publish is saved in this repository's history. To get an old version back, ask someone comfortable with GitHub to open `data/site.json` > **History**, find the version before the mistake, and copy its contents back. Editors can also download a backup any time from Edit site > **⋯ > Download a backup**.

## How it's built (for whoever maintains the code)
- `index.html`, `assets/css`, `assets/js/app.js`: the site. All content comes from `data/site.json`.
- `assets/js/editor.js`: edit mode. The GitHub key is encrypted (AES-GCM, PBKDF2) with each passcode and stored in `data/auth.json`. Publishing writes `data/site.json` and uploads photos to `assets/uploads/` with the GitHub contents API.
- `scripts/update-total.mjs` and `.github/workflows/total.yml`: the donation total.
- Animations use GSAP and ScrollTrigger from cdnjs.
- Preview locally with `python3 -m http.server`, then open http://localhost:8000. On localhost, edit mode offers a test mode that saves only in your browser.

## School events (automatic)
Once a day, GitHub reads the Westlake High calendar and saves home games, concerts, shows and community nights to `data/school-events.json` (the "Import school calendar events" workflow in the Actions tab). They show under "Also happening" on the Events page, and on the home page only the day before and the day of. In edit mode, the **School events** tab lets you hide any of them, force one onto the home page, or turn the import off.

## Preset pictures
Every photo spot in edit mode has **Pick a preset**: real photos for sports, concerts, dance, theater, community and Christmas Jars (in `assets/presets/photos/`, free Unsplash photos; sources in CREDITS.md), the Westlake bolt graphic, and the Westlake logos. Any photo you upload can be saved with **Save as preset**. Events without a photo get a matching preset automatically. The Westlake bolt graphic is drawn by `scripts/make_presets.py`.
