# Opal Shelf v0.0.26

GitHub root files are the source of truth. Opal Shelf uses free services only.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.26`.
3. No D1 migration is required.

## v0.0.26
- First-open daily reconciliation only asks about currently-reading books (active/paused). Finished and DNF books no longer appear.
- Finishing or DNF-ing a book also removes it from the check-in queue already loaded on the device.

## v0.0.25
- First-open daily reconciliation asks about every read-through that was active yesterday, including books with no timed session.
- Untimed books offer **Didn’t read** and **I read, but didn’t time it**.
- Forgotten reading can open Add Session with yesterday’s date.
- Adds **Opal Shelf Import v1** under Shelf → Import Books.
- Import JSON is previewed before anything is added.
- Existing books are skipped using ISBN, ASIN, or title+author matching.
- Selected imports go to Want to Read.
- Preserves v0.0.24 page ↔ percent reconciliation and v0.0.23 estimated time remaining.

See `PROJECT_CONTEXT.md` for the durable project handoff.
