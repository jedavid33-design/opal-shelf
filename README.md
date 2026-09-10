# Opal Shelf v0.0.16

Single flat source-of-truth package.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.16`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required.

## v0.0.16
- Fixes Edit Session / Add Session validation on iOS Safari.
- Native time inputs are normalized to minute-precision `HH:MM` and explicitly use `step=60`.
- Duration now fills automatically from Date + Start + End.
- Editing Start or End recalculates Duration immediately.
- Editing Duration preserves Start and automatically moves End relative to Start.
- The same bidirectional behavior is used in both Add Session and Edit Session.
- Preserves all v0.0.15 session, read-through, audiobook, Daily Progress, and Opal styling behavior.
