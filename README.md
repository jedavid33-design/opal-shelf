# Opal Shelf v0.0.15

Single flat source-of-truth package.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.15`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required.

## v0.0.15
- Fixes iOS/Safari native validation on Add Session and Edit Session time fields.
- Time inputs now receive canonical 24-hour `HH:MM` values internally.
- iOS may display those values in the user's normal 12-hour format, such as `6:40 PM`.
- Preserves the existing session duration/edit behavior and all v0.0.14 features.
