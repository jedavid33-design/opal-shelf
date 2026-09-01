# Opal Shelf v0.0.2 — GitHub Pages frontend

This is the Opal Shelf v0.0.1 progressive web app.

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

## v0.0.2 update order

1. Run the included `0002_readthrough_management.sql` migration from the Worker ZIP against `opal-shelf-db`.
2. Replace the Worker with the flat `worker.js` from the Worker ZIP.
3. Replace the GitHub repository files with this ZIP's contents.

This release adds read-through editing, deletion, recovery of accidental status changes, per-read notes, clearer read/reread labels, `Other` format support, and edition-length snapshots. It adds no ratings.
