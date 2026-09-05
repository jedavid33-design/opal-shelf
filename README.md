# Opal Shelf v0.0.10

Single flat source-of-truth package.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.10`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required.

## v0.0.10
- Adds daily `pg/hr` to Daily Progress.
- Pace = total page gains for physical/ebook reading that day divided by timed physical/ebook reading hours that day.
- Audiobook time is excluded from the pace denominator.
- Days without both page gain and qualifying timed reading omit the pace stat.
- Preserves the v0.0.9 Opal Treatment and all existing reading/session/progress behavior.
