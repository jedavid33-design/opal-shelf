# Opal Shelf v0.0.20

Single flat source-of-truth package.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.20`.
3. Replace the GitHub repository root files with this ZIP.

No manual D1 migration is required. The Worker adds the optional `asin` column automatically.

## v0.0.20
- Adds ASIN as a first-class book metadata field for Kindle/KU and self-published editions.
- Search now accepts title, author, ISBN, or ASIN.
- Book search uses Open Library plus Google Books, de-duplicates results, and labels the source.
- If an ASIN has no public-catalog match, manual entry remains available with that ASIN prefilled.
- Adds permanent Delete Book under Edit Book → Advanced book management.
- Delete Book is deliberately hidden behind a disclosure and requires two confirmations.
- Permanent deletion removes the book, read-throughs, sessions, daily check-ins, state history, and custom-shelf memberships.
- Preserves v0.0.19 page ↔ percent sync and all existing Opal Shelf behavior.
