# Opal Shelf v0.0.21

Single flat source-of-truth package.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.21`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required beyond the automatic ASIN-column support already introduced in v0.0.20.

## v0.0.21
- Fixes Add Book search on iOS/Safari.
- The search query is captured synchronously before the catalog request instead of reading `event.currentTarget` after an `await`.
- Fix applies to ASIN, ISBN, title, and author searches.
- Preserves the v0.0.20 Open Library + Google Books search, ASIN support, and tucked-away permanent Delete Book controls.
- Preserves v0.0.19 page ↔ percent synchronization and all prior reading/session behavior.
