# Opal Shelf v0.0.28

GitHub root files are the source of truth. Opal Shelf uses free services only.

## Install
1. Deploy `worker.js`.
2. Confirm `/health` reports `0.0.28`.
3. D1 migrations run automatically inside the worker on first request (idempotent):
   new `reading_sessions` columns (`client_session_id` UNIQUE, `source`,
   `adjusts_session_id`) and a `read_throughs` CHECK widening
   (`state` admits `paused`, `format` admits `other`). No row values change.

## v0.0.28 — full session-integrity audit fixes
- **Idempotent session ingest (M1):** `POST /api/sessions` accepts
  `client_session_id`; retried POSTs replay the existing row instead of
  double-inserting. Client contract: `READER-SYNC-CONTRACT.md`.
- **Timezone fix (M2):** manual add/edit sends device wall-clock with its UTC
  offset; the worker stores the true instant — no more 4h display shift, no
  compounding on re-edit. Old rows untouched (Julie's call).
- **Paused/Other no longer 500 (M3):** D1 CHECKs widened; the paused-period
  machinery actually works now.
- **Stale timers (M4):** `start` names-and-refuses timers open >24h; `stop`
  caps duration at 24h and 400s on end-before-start; `started_at` validated.
- **Inferred double-count guard (M5/m7):** late real sessions void overlapped
  inferred estimates via negative `adjustment` rows (existing rows never
  touched); downward audiobook corrections void the prior save's estimate.
- `DELETE /api/reads/:id` now also removes its `read_state_periods` (m1).
- Backfill insert is race-safe single-statement; dashboard merges duplicate
  same-state periods when counting active days (m2).
- `POST /api/sessions` requires active reads, 409s on overlapping intervals,
  checks `local_date` vs start-time date (m3); exact-duplicate retries replay.
- Shelf rename collisions → 409, missing shelf → 404 (m5); `cleanBook`
  coerces NaN numerics to null (m6); read edits send `local_date` (m8);
  deleted-read 404s name the re-link recovery step (m9); version labels
  bumped (m10).

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
