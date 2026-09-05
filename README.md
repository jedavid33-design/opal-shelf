# Opal Shelf v0.0.11

Single flat source-of-truth package.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.11`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required.

## v0.0.11
- Fixes first-open-of-the-day progress reconciliation so the popup is explicitly saved to the historical session date it is reconciling.
- Historical page deltas are derived from the most recent earlier daily check-in (or the read-through starting point), rather than from the already-updated live progress value.
- Saving a historical reconciliation cannot roll the current read-through backward.
- The popup now shows the exact date receiving the reconciliation.
- Repairs the v0.0.10 Daily Progress `pg/hr` display so it uses page gains divided by timed physical/ebook reading time and excludes audiobook time.
- Preserves all v0.0.10 Opal styling and existing reading/session/audiobook behavior.

No ratings.
