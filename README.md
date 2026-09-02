# Opal Shelf v0.0.5 — GitHub Pages frontend

This is the flat GitHub Pages frontend package for Opal Shelf v0.0.5.

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

## v0.0.5 update order

1. Replace the deployed Worker with the flat `worker.js` from the separate Worker ZIP and confirm `/health` reports `0.0.5`.
2. Replace the GitHub repository files with this ZIP's contents.

No database migration is required. Do not rerun any earlier migration, including `0003_session_listening_speed.sql`.

This release:

- gives mobile Current Reads a fixed 116px cover column and a separate flexible information column
- persists forward audiobook progress as actual listening time using the interval's listening speed
- reuses existing timer sessions instead of inferring duplicate time when timer activity covers the interval
- keeps each inferred interval's speed frozen on its session record

Streak calculation is intentionally unchanged. No ratings were added.
