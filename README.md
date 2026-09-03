# Opal Shelf v0.0.6 — GitHub Pages frontend

This is the flat GitHub Pages frontend package for Opal Shelf v0.0.6.

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

## v0.0.6 update

Replace the GitHub repository files with this ZIP's contents.

This is a frontend-only patch. Do not replace the Worker and do not rerun any database migration.

This release:

- adds mobile bottom clearance so every Current Reads card and action can scroll fully above the fixed navigation
- derives print/ebook progress from current page divided by the read-through page-count snapshot
- displays page progress as, for example, `Page 177 of 335 · 53% complete`
- uses the same derived percentage for the progress bar without rewriting historical records

Streak calculation is intentionally unchanged. No ratings were added.
