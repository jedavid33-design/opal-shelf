# Opal Shelf v0.0.18

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.18`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required.

## v0.0.18
- Percent inputs now accept arbitrary decimal values on iOS/Safari.
- Content-position syncing writes a human-friendly percentage rounded to two decimal places instead of a long floating-point tail.
- Stored calculations retain decimal percentage precision.
- Display percentages continue to use standard nearest-integer rounding, so 65.7% displays as 66%.
- Preserves all v0.0.17 audiobook-finish and spine-shelf changes.
