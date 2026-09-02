# Opal Shelf v0.0.4 — GitHub Pages frontend

This is the flat GitHub Pages frontend package for Opal Shelf v0.0.4.

## Connect it to the Worker

The included `config.js` already points to the live `opal-shelf` Worker. If the Worker URL ever changes, replace `apiBaseUrl` with the new URL, without a trailing slash:

```js
window.OPAL_SHELF_CONFIG = {
  apiBaseUrl: "https://opal-shelf.4d8v7jw78c.workers.dev",
  accessToken: ""
};
```

If you enabled `OPAL_SHELF_ACCESS_TOKEN` on the Worker, leave the token out of this public repository. Open the app and save it privately on your device under **Settings → Access token**.

## Publish on GitHub Pages

1. Upload every file from this ZIP to the root of a new GitHub repository.
2. Open **Settings → Pages**.
3. Choose **Deploy from a branch**.
4. Select the `main` branch and `/ (root)` folder.

The app can then be added to the iPhone or iPad home screen from Safari.

## v0.0.4 update order

1. Run `0003_session_listening_speed.sql` from the separate Worker ZIP against `opal-shelf-db` exactly once.
2. Replace the deployed Worker with the flat `worker.js` from that ZIP and confirm `/health` reports `0.0.4`.
3. Replace the GitHub repository files with this ZIP's contents.

Do not rerun either earlier migration.

This release:

- adds newest-first daily progress history with exact session-second totals and book/read-through contributions
- repairs Current Reads and forms for mobile screens
- preserves the originating read-through/card when a timer starts and sorts Current Reads by recent activity
- supports synchronized audiobook percentage and content-position entry
- snapshots listening speed on each new audiobook timer session so later speed changes do not rewrite history

Streak calculation is intentionally unchanged. No ratings were added.
