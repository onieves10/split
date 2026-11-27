# Split

A phone-first app for Orlando and Jonah's shared expenses. It reads and writes the
"Orlando & Jonah Shared Expenses" Google Sheet, so the app and the sheet always match.

- `index.html` and `icon.png` are the website (served by GitHub Pages).
- `Code.gs` is the backend. It runs in Google Apps Script, attached to the sheet.

## One-time setup

### 1. Backend (easiest on a computer)

1. Open the Google Sheet, then **Extensions > Apps Script**.
2. Delete what's in the editor, paste in all of `Code.gs` from this repo, and save.
3. **Deploy > New deployment**. Click the gear next to "Select type" and pick **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy** and allow access. If Google warns that the app isn't verified, click
   **Advanced**, then **Go to (project name)**. It's your own script.
5. Copy the **Web app URL**. It ends in `/exec`. Put it in `index.html` as `API_URL`.

### 2. Website

1. In this repo on GitHub: **Settings > Pages**.
2. Under "Build and deployment", pick **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
3. After a minute or two the site is live at `https://onieves10.github.io/<repo name>/`.

### 3. Phones

1. Open the site in Safari, tap your name and pick a passcode, then **Connect**.
   The first passcode entered becomes the passcode for both of you.
2. Tap the Share button, then **Add to Home Screen**. It opens full screen like an app.
3. Jonah does the same on his phone: open the site, tap his name, enter the same passcode.

## Using it

- **Add expense:** amount, what it was for, who paid and the split. In a split like 60/40 the payer's share comes first.
- **Settle up:** shows who owes whom, opens Venmo with the amount filled in, then closes the month.
- **Months:** tap the month name to switch months or start a new one. New months are copied from the sheet's Template tab.
- **Settings:** Venmo usernames, default split, new split options, and switching between Orlando and Jonah.
- Add `?demo` to the site's URL to try it with sample data.

## Changing the backend later

Edit `Code.gs` in Apps Script, then **Deploy > Manage deployments**, click the pencil,
choose **Version: New version** and **Deploy**. The URL stays the same.

## Where things live

- All data is in the Google Sheet. Editing the sheet directly still works.
- The passcode and Venmo usernames are on the sheet's Settings tab (App settings block, added on first use).
- A closed month shows its status in cells J4:K7 and gets a warning-only protection, so the sheet asks before anyone edits it.
- The backend URL is baked into `index.html` as `API_URL`. The passcode is saved only on each phone, never in this repo.

## Development

- `dev/test_backend.js`: runs `Code.gs` against a fake copy of the sheet. `node dev/test_backend.js`
- `dev/e2e.py`: drives the app at iPhone size against that fake backend and saves screenshots to `dev/shots/`. Needs Playwright and Chrome. `python3 dev/e2e.py`
- `dev/build_tracker.py` and `dev/shared_expenses.xlsx`: how the original Google Sheet was built.
- `appsscript.json`: Apps Script manifest (web app settings) for deploying with `clasp`.
