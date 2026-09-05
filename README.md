# Budget Tool Web

Budget Tool Web is a private, offline-first daily budget planner inspired by the Buckwheat Android app. It helps you divide a budget across a fixed period, record spending as it happens, and keep the amount available for today visible.

It is a simple static web app designed to run on GitHub Pages. No account or backend is required: budget data is stored locally in the browser.

## What It Does

- Guides new users through an onboarding flow before creating a budget period.
- Creates and edits wallet periods with a total budget, start date, finish date, and currency.
- Calculates a daily spending amount for the remaining days in the period.
- Provides a custom numeric keypad for entering spends.
- Records a spend with an optional note or tag and date/time.
- Suggests previously used notes as reusable tags.
- Shows the remaining amount for today in the editor pill.
- Displays spend history grouped by day, with daily totals.
- Allows existing spends to be edited or deleted.
- Handles unused daily budget with three choices: always ask, split it across remaining days, or add it to today.
- Provides analytics for remaining budget, total spent, days left, spend count, minimum and maximum spends, and categories.
- Exports spending records as a CSV file with amount, comment, and readable commit time.
- Supports light and dark themes.
- Works as an installable Progressive Web App.
- Caches the app shell for offline use.

## Privacy and Storage

All wallet settings and transactions are stored in `localStorage` on the current browser profile. The app does not send budget data to a server or require an account. Clearing the browser's site data removes the local wallet.

## Use It Locally

The app is served as static files. With Python installed, run:

```sh
python3 -m http.server 4173
```

Then open <http://localhost:4173> in a browser. A local HTTP server is recommended because service workers and PWA installation require a secure context such as `localhost` or HTTPS.

## Development

If Node.js and npm are available:

```sh
npm install
npm run dev
```

The production output is created with:

```sh
npm run build
```

The generated `dist/` directory can be deployed to GitHub Pages as a static site. The app uses relative asset paths so it works when hosted under a repository subpath.

## PWA Installation

Open the deployed HTTPS site, or the app on `localhost`, in a browser that supports PWAs. Use the browser's install command to add Budget Tool Web to the desktop or home screen. Once cached, the editor, wallet, history, analytics, and locally stored data remain available offline.

## Project Files

- `index.html`: static app entry point and PWA metadata.
- `app.js`: wallet state, calculations, editor, history, analytics, and CSV export.
- `styles.css`: responsive editor, keypad, sheets, themes, and animations.
- `sw.js`: offline service-worker cache.
- `manifest.webmanifest`: installable PWA manifest.
- `icons/money-bags.svg`: app icon.
