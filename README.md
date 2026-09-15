# Opal Shelf v0.0.22

Single flat source-of-truth package. Opal Shelf uses free catalog sources only.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.22`.
3. Replace the GitHub repository root files with this ZIP.

No new manual D1 migration is required.

## v0.0.22
- Keeps the catalog stack strictly free: Open Library + Google Books.
- ISBN searches now try an exact Open Library edition lookup before broad search.
- Open Library broad search requests edition metadata and checks edition identifiers for exact ISBN / Amazon-ASIN matches when those identifiers exist in the catalog.
- Exact identifier matches are ranked above approximate title/author results.
- Richer records (cover/page count/publisher/date) rank above sparse duplicates.
- Google Books remains the free secondary catalog and exact ISBN matches are identified/ranked.
- ASINs are preserved even when the Kindle edition is absent from both free catalogs.
- Empty ASIN searches now explain that no free-catalog metadata was found and keep the ASIN in manual entry.
- No paid APIs, subscriptions, affiliate APIs, or credentials are introduced.
- Preserves v0.0.21 Safari search fix, v0.0.20 ASIN storage/delete controls, and all prior reading/session/shelf behavior.
