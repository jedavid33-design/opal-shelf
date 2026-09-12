# Opal Shelf v0.0.19

Single flat source-of-truth package.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.19`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required.

## v0.0.19
- Restores live page ↔ percent synchronization for print/ebook progress when a page-count snapshot exists.
- Entering percent recalculates Current page immediately.
- Entering Current page recalculates Percent complete immediately.
- The field edited most recently is treated as the source of truth.
- Percent → page uses normal nearest-page rounding.
- Page → percent keeps up to two decimal places in the editable field.
- Both values are saved together.
- Preserves v0.0.18 decimal-percent handling, audiobook logic, session tools, read-through summaries, and spine shelves.

No ratings.
