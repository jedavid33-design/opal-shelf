# Opal Shelf v0.0.13

Single flat source-of-truth package.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.13`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required.

## v0.0.13
- Recalibrates inferred audiobook listening-time math to stay in seconds end-to-end.
- Manual audiobook progress now uses:
  audiobook_runtime_seconds_snapshot × percent_delta ÷ listening_speed
- Intermediate content duration is never rounded to whole minutes.
- Final inferred duration is rounded only once, to the nearest second.
- Existing timer-overlap subtraction remains intact.
- Preserves all v0.0.12 read-through summaries, pause/active-day tracking, daily pg/hr, session repair, and Opal styling.

No ratings.
