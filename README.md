# Opal Shelf v0.0.24

Single flat source-of-truth package.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.24`.
3. GitHub repository files are the source of truth.

No D1 migration is required.

## v0.0.24
- Fixes the **first-open / previous-day reading reconciliation popup** for ebooks.
- The popup now uses the same live page ↔ percent calculation already working in Update Progress.
- Entering percent immediately calculates page when the read-through/book has a page total.
- Entering page immediately calculates percent.
- The most recently edited field drives the paired value.
- Print/other page-based reads also get percent crossover when a page total exists.
- Preserves v0.0.23 estimated time remaining and all prior behavior.

No ratings.
