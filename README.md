# Opal Shelf v0.0.17

Single flat source-of-truth package.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.17`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required.

## v0.0.17
- Fixes audiobook Finish Read:
  - the remaining interval from the last saved audiobook progress to 100% is inferred before the read-through is closed
  - current listening speed is used
  - existing timer overlap is subtracted to avoid double counting
  - Actual Listening and Effective Speed summaries therefore include the final interval
- Shelf visual update:
  - Reading remains face-out
  - Want to Read is displayed as book spines
  - Finished Reading is displayed as book spines
  - tapping a spine opens the existing book detail view with the front cover, creating the “pull it off the shelf” interaction
  - custom shelves remain face-out for now
- Preserves all v0.0.16 session editing, add-session behavior, Daily Progress, read-through summaries, pause/active-day logic, audiobook precision, and Opal styling.

No ratings.
