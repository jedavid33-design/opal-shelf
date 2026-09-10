# Opal Shelf v0.0.14

Single flat source-of-truth package.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.14`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required.

## v0.0.14
- Adds **+ Add session** inside Reading History / Edit Read-through for reading you forgot to time.
- Manual sessions accept date, start/end time or direct duration, plus audiobook listening speed when applicable.
- Replaces the old E/M/D text prompt with a compact session action sheet:
  - Edit session
  - Move session
  - Delete session
- Move session now uses a visible read-through selection list rather than typed numbers.
- Suppresses first-open rollover reconciliation prompts for read-throughs that are already Finished, DNF, or Paused.
- Hardens audiobook position-entry precision: h:mm content positions are converted to exact content seconds server-side instead of relying on a rounded two-decimal percentage.
- Removes the two-decimal rounding when the frontend synchronizes content position to percentage.
- Preserves all v0.0.13 read-through summaries, pause/active-day history, Daily Progress, session repair, audiobook timer overlap protection, and Opal styling.

Note on Hat Trick: its runtime is 8h 45m and 1.75× means each 1% of content is exactly 3 minutes of real listening. So whole-minute inferred results from integer percent jumps can be mathematically correct.

No ratings.
