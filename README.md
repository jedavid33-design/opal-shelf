# Opal Shelf — GitHub Pages frontend

This is the Opal Shelf v0.0.1 progressive web app.

## Connect it to the Worker

Open `config.js` and replace the empty `apiBaseUrl` value with the deployed Worker URL, without a trailing slash:

```js
window.OPAL_SHELF_CONFIG = {
  apiBaseUrl: "https://opal-shelf.YOUR-SUBDOMAIN.workers.dev",
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
