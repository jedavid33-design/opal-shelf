# Opal Shelf v0.0.23

Single flat source-of-truth package. Opal Shelf uses free services only.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.23`.
3. Replace the GitHub repository root files with this ZIP.

No D1 migration is required.

## v0.0.23
- Adds **Estimated time remaining** to Current Reads.
- Print/ebook estimates use that read-through's own measured average pages/hour.
- Audiobook estimates use content remaining divided by the read-through's current listening speed.
- The estimate is hidden until Shelf has enough real data to calculate it responsibly.
- Read-through detail/summary includes the estimate plus its basis:
  - `Based on 47 pg/hr`
  - or `At 1.75×`
- Estimates are deliberately displayed at minute-level precision because they are forecasts, not recorded session time.
- Preserves v0.0.22 free catalog lookup, ASIN support, hidden permanent Delete Book, page ↔ percent synchronization, session tools, read-through summaries, and Opal styling.

No ratings.
